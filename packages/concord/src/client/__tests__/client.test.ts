// ConcordClient over a dependency-injected EventStore/RelayPool — no network.
// Exercises the Community List (kind 13302) cast wiring: the client exposes
// `communityList$`, and `autoUnlock` decides whether the user-signer decryption is
// issued automatically or left for the app to trigger via the cast's `.unlock()`.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, delay, filter, firstValueFrom, from } from "rxjs";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import "applesauce-common/casts";
import type { RelayPool } from "applesauce-relay";
import { finalizeEvent, type NostrEvent } from "applesauce-core/helpers/event";
import { hexToBytes } from "@noble/hashes/utils.js";

import { ConcordClient } from "../client.js";
import type { ConcordCommunityList } from "../../casts/index.js";
import { memoryStorage } from "../storage.js";
import { COMMUNITY_LIST_KIND, mergeCommunities } from "../../helpers/community-list.js";
import { INVITE_LIST_KIND } from "../../helpers/invite-list.js";
import { createCommunity } from "../../helpers/community.js";
import {
  INVITE_BUNDLE_KIND,
  buildInviteBundle,
  buildInviteLink,
  getInviteBundle,
  newInviteToken,
} from "../../helpers/invite-bundle.js";
import { InviteBundleFactory } from "../../factories/invite-bundle.js";
import type { ConcordClientStatus, JoinMaterial } from "../../types.js";

const settle = () => new Promise((r) => setTimeout(r, 200));
// Longer than the client's post-sync auto-save debounce, so a single flush has fired.
const settleFlush = () => new Promise((r) => setTimeout(r, 600));

// A RelayPool stand-in whose per-relay methods are inert (no sockets) — the client's
// list fetch (`request`) completes empty; we feed the 13302 into the store by hand.
// `publish` records every event so tests can count kind-13302 republishes.
function fakePool(opts: { challenge?: string } = {}): {
  pool: RelayPool;
  published: NostrEvent[];
  authenticatedPubkeys: string[];
} {
  const authenticated = new Set<string>();
  const authenticatedPubkeys: string[] = [];
  const challenge = opts.challenge ?? null;
  const relay = {
    url: "wss://fake",
    challenge,
    challenge$: new BehaviorSubject<string | null>(challenge),
    isAuthenticated: (pubkeys: string | string[]) =>
      (Array.isArray(pubkeys) ? pubkeys : [pubkeys]).every((p) => authenticated.has(p)),
    authenticate: async (signer: { getPublicKey: () => string | Promise<string> }) => {
      const pubkey = await signer.getPublicKey();
      authenticated.add(pubkey);
      authenticatedPubkeys.push(pubkey);
      return { ok: true, from: "wss://fake" };
    },
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  const published: NostrEvent[] = [];
  const pool = {
    status$: challenge
      ? new BehaviorSubject({
          "wss://fake": {
            url: "wss://fake",
            connected: true,
            authenticated: false,
            authenticatedAs: null,
            authenticatedPubkeys: [],
            authentications: {},
            ready: true,
            authRequiredForRead: true,
            authRequiredForPublish: true,
            challenge,
          },
        })
      : new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: vi.fn(async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    }),
  } as unknown as RelayPool;
  return { pool, published, authenticatedPubkeys };
}

// A real genesis community + the self-encrypted 13302 that lists it as a live membership.
async function setup() {
  const signer = new PrivateKeySigner(generateSecretKey());
  const pubkey = await signer.getPublicKey();
  const decrypt = vi.spyOn(signer.nip44!, "decrypt");

  const genesis = await createCommunity({
    ownerPubkey: pubkey,
    name: "Test",
    description: "hi",
    relays: ["wss://fake"],
  });
  const cid = genesis.material.community_id;
  // Mirror the normalized material the community engine derives (held_roots defaults to []), so the
  // synthetic remote list matches what a real relay copy — itself written from engine material —
  // would hold. Without this the reconciled engine's material would legitimately differ by one field.
  const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
  const communities = mergeCommunities([], [{ community_id: cid, seed: material, current: material, added_at: 1 }]);
  // Wire document keys the array as `entries`; the parsed cast exposes `communities`.
  const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
  const listEvent = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });

  const store = new EventStore();
  const { pool, published } = fakePool();
  const client = new ConcordClient({
    signer,
    pool,
    eventStore: store,
    storage: memoryStorage(),
    relays: ["wss://fake"],
  });
  return { signer, pubkey, decrypt, genesis, cid, listEvent, store, client, pool, published };
}

const firstList = (client: ConcordClient) =>
  firstValueFrom(client.communityList$.pipe(filter((c): c is ConcordCommunityList => !!c)));

const listPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === COMMUNITY_LIST_KIND);
const inviteListPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === INVITE_LIST_KIND);

async function decryptInviteList(signer: PrivateKeySigner, event: NostrEvent) {
  const pubkey = await signer.getPublicKey();
  return JSON.parse(await signer.nip44!.decrypt(pubkey, event.content)) as {
    entries: Array<{
      token: string;
      signer_sk: string;
      community_id: string;
      url: string;
      label?: string;
      channels?: string[];
    }>;
    tombstones: Array<{ token: string; community_id: string }>;
  };
}

describe("ConcordClient community list (DI, no network)", () => {
  it("autoUnlock:false — exposes a locked cast, no signer prompt, bootstraps only on app .unlock()", async () => {
    const { signer, decrypt, cid, listEvent, store, client } = await setup();
    await client.start();
    store.add(listEvent as NostrEvent); // simulate the relay fetch landing in the store
    await settle();

    const cast = await firstList(client);
    expect(cast.unlocked).toBe(false);
    expect(decrypt).not.toHaveBeenCalled();
    expect(client.getCommunity(cid)).toBeUndefined(); // not bootstrapped while locked

    await cast.unlock(signer); // the consuming app decrypts on demand
    await settle();

    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(client.getCommunity(cid)).toBeDefined(); // reconcile subscription bootstraps it

    client.stop();
  });

  it("autoUnlock:true — decrypts automatically and bootstraps without an app .unlock()", async () => {
    const { decrypt, pubkey, signer, genesis, cid, listEvent, store } = await setup();
    const { pool } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });
    void genesis; // material lives inside listEvent

    await client.start();
    store.add(listEvent as NostrEvent);
    await settle();

    expect(decrypt).toHaveBeenCalledTimes(1);
    const cast = await firstList(client);
    expect(cast.unlocked).toBe(true);
    expect(client.getCommunity(cid)).toBeDefined();

    client.stop();
  });

  it("community startup authenticates stream keys, not the user key", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const storage = memoryStorage();
    await storage.setItem(pubkey, JSON.stringify([material]));

    const { pool, authenticatedPubkeys } = fakePool({ challenge: "challenge-abc" });
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });

    await client.start();
    await settle();

    expect(client.getCommunity(material.community_id)).toBeDefined();
    expect(authenticatedPubkeys.length).toBeGreaterThan(0);
    expect(authenticatedPubkeys).not.toContain(pubkey);

    client.stop();
  });

  it("watchDirectInvites:false — does not NIP-42-authenticate as the user on start", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, authenticatedPubkeys } = fakePool({ challenge: "challenge-abc" });
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      watchDirectInvites: false,
    });

    await client.start();
    await settle();

    expect(client.directInviteWatcher).toBeUndefined();
    expect(authenticatedPubkeys).not.toContain(await signer.getPublicKey());

    client.stop();
  });

  it("autoSaveCommunityList:false — sync is side-effect-free; explicit create still publishes", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
      autoSaveCommunityList: false,
    });

    await client.start();
    await settle();
    expect(listPublishes(published).length).toBe(0); // startup / sync: zero side effects

    // Creating a community is an explicit membership mutation → always publishes, even with autoSave off.
    await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();
    expect(listPublishes(published).length).toBe(1);

    client.stop();
  });

  it("autoSaveCommunityList:true — a sync-driven change flushes the list exactly once", async () => {
    // A mirrored community catches up its epoch during the walk (its material object changes), which
    // marks the list dirty. With autoSave on, a single debounced flush publishes once after settling.
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "T", relays: ["wss://fake"] });
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const storage = memoryStorage();
    await storage.setItem(pubkey, JSON.stringify([material])); // prior session's local mirror, no remote list

    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      autoSaveCommunityList: true,
    });

    await client.start();
    await settleFlush();
    expect(listPublishes(published).length).toBe(1);

    client.stop();
  });

  it("communityListDirty$ tracks unpublished sync changes; manual save clears it", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "T", relays: ["wss://fake"] });
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const storage = memoryStorage();
    await storage.setItem(pubkey, JSON.stringify([material]));

    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      autoSaveCommunityList: false, // manual mode: nothing publishes without an explicit save
    });

    await client.start();
    await settle();
    // The mirrored community caught up during sync → dirty, but nothing published (autoSave off).
    expect(client.communityListDirty$.value).toBe(true);
    expect(listPublishes(published).length).toBe(0);

    // The app publishes on demand → one publish, dirty cleared.
    await client.saveCommunityList();
    expect(listPublishes(published).length).toBe(1);
    expect(client.communityListDirty$.value).toBe(false);

    // A redundant save is a fingerprint no-op — no second publish.
    await client.saveCommunityList();
    expect(listPublishes(published).length).toBe(1);

    client.stop();
  });

  it("start against a matching remote list — no republish (dirty-check + seed)", async () => {
    // autoUnlock so the fetched 13302 reconciles without an app-driven .unlock().
    const { pubkey, signer, listEvent, store } = await setup();
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    store.add(listEvent as NostrEvent); // the relay's copy lands; reconcile seeds the fingerprint
    await settle();
    await settle(); // let the reconciled community's engine settle (key-roll reactive saves)

    // The relay copy matches our derived list, so nothing is re-encrypted/re-signed/republished.
    expect(listPublishes(published).length).toBe(0);

    client.stop();
  });

  it("slow (remote-signer) decrypt + local mirror already on the relay — start() waits, no republish", async () => {
    // Reproduces the startup race: a NIP-46-style signer whose decrypt is a slow round-trip, a local
    // material mirror that already matches the remote 13302, and the remote copy present before start.
    // Awaiting the fetch alone let the flush win the race and republish (clobbering the newer remote);
    // start() must instead wait for the reconcile before flushing.
    const base = new PrivateKeySigner(generateSecretKey());
    const pubkey = await base.getPublicKey();
    const signer: any = {
      getPublicKey: () => base.getPublicKey(),
      signEvent: (t: any) => base.signEvent(t),
      nip44: {
        encrypt: (pk: string, pt: string) => base.nip44!.encrypt(pk, pt),
        decrypt: async (pk: string, ct: string) => {
          await new Promise((r) => setTimeout(r, 400));
          return base.nip44!.decrypt(pk, ct);
        },
      },
    };

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const communities = mergeCommunities([], [{ community_id: cid, seed: material, current: material, added_at: 1 }]);
    const content = await signer.nip44.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
    const listEvent = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });

    const storage = memoryStorage();
    await storage.setItem(pubkey, JSON.stringify([material])); // prior session's local mirror
    const store = new EventStore();
    store.add(listEvent as NostrEvent); // the matching remote copy is already present at startup

    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage,
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    await settle();
    await settle();

    expect(listPublishes(published).length).toBe(0);

    client.stop();
  });

  it("re-driving the same remote list is idempotent — still no republish", async () => {
    const { pubkey, signer, listEvent, store } = await setup();
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    store.add(listEvent as NostrEvent);
    await settle();
    // Re-emit the same decrypted list through the store — the fingerprint is unchanged, so the
    // reactive reconcile path must not add a new 13302 publish.
    store.add(listEvent as NostrEvent);
    await settle();
    await settle();

    expect(listPublishes(published).length).toBe(0);

    client.stop();
  });

  it("a real mutation publishes the community list exactly once", async () => {
    // Fresh client, no remote list: creating a community is a genuine change → one publish.
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const store = new EventStore();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    await settle();
    expect(listPublishes(published).length).toBe(0); // empty startup does not republish

    await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();

    expect(listPublishes(published).length).toBe(1);

    client.stop();
  });

  it("client.invites.create mints a link, registers it, and saves the invite list", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    const community = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();
    const secret = await community.createChannel("secret", { private: true });
    const other = await community.createChannel("other", { private: true });
    await settle();
    published.length = 0;

    const invite = await client.invites.create(community.communityId, {
      base: "https://app.example",
      label: "Reddit",
      channels: [secret],
    });
    await settle();

    expect(invite.url).toContain("https://app.example/invite/");
    expect(invite.communityId).toBe(community.communityId);
    expect(invite.label).toBe("Reddit");
    expect(invite.channels).toEqual([secret]);
    expect(client.invites.live$.value.map((i) => i.token)).toContain(invite.token);
    expect(community.state$.value.inviteLinks.has(invite.signerPubkey)).toBe(true);

    const bundleEvent = published.find((e) => e.kind === INVITE_BUNDLE_KIND && e.pubkey === invite.signerPubkey)!;
    const bundle = getInviteBundle(bundleEvent, hexToBytes(invite.token));
    expect(bundle?.channels.map((c) => c.id)).toEqual([secret]);
    expect(bundle?.channels.map((c) => c.id)).not.toContain(other);

    const saves = inviteListPublishes(published);
    expect(saves).toHaveLength(1);
    const doc = await decryptInviteList(signer, saves[0]);
    expect(doc.entries.map((entry) => entry.token)).toEqual([invite.token]);
    expect(doc.entries[0].signer_sk).toBe(invite.signerSk);
    expect(doc.entries[0].label).toBe("Reddit");
    expect(doc.entries[0].channels).toEqual([secret]);
    expect(doc.tombstones).toEqual([]);

    client.stop();
  });

  it("client.invites.revoke tombstones the bundle, registry, and invite list", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    const community = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();
    const invite = await client.invites.create(community.communityId, { base: "https://app.example" });
    await settle();
    published.length = 0;

    const revoked = await client.invites.revoke(invite);
    await settle();

    expect(revoked.revoked).toBe(true);
    expect(client.invites.live$.value).toEqual([]);
    expect(client.invites.revoked$.value.map((i) => i.token)).toEqual([invite.token]);
    expect(community.state$.value.inviteLinks.has(invite.signerPubkey)).toBe(false);

    const bundleTombstone = published.find(
      (event) =>
        event.kind === 33301 &&
        event.pubkey === invite.signerPubkey &&
        event.tags.some((t) => t[0] === "vsk" && t[1] === "9"),
    );
    expect(bundleTombstone).toBeDefined();

    const saves = inviteListPublishes(published);
    expect(saves).toHaveLength(1);
    const doc = await decryptInviteList(signer, saves[0]);
    expect(doc.tombstones).toEqual([{ token: invite.token, community_id: community.communityId }]);

    client.stop();
  });

  it("client.invites.revoke cleans up an invite after leaving the community", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    const community = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();
    const invite = await client.invites.create(community.communityId, { base: "https://app.example" });
    await settle();

    // Leave the community — its engine is disposed, so the registry is no longer reachable.
    await client.leave(community.communityId);
    await settle();
    expect(client.getCommunity(community.communityId)).toBeUndefined();
    published.length = 0;

    // Cleanup still works: the bundle is revoked straight from the stored link key.
    const revoked = await client.invites.revoke(invite.token);
    await settle();

    expect(revoked.revoked).toBe(true);
    expect(client.invites.revoked$.value.map((i) => i.token)).toEqual([invite.token]);

    const bundleTombstone = published.find(
      (event) =>
        event.kind === 33301 &&
        event.pubkey === invite.signerPubkey &&
        event.tags.some((t) => t[0] === "vsk" && t[1] === "9"),
    );
    expect(bundleTombstone).toBeDefined();

    const saves = inviteListPublishes(published);
    const doc = await decryptInviteList(signer, saves.at(-1)!);
    expect(doc.tombstones).toContainEqual({ token: invite.token, community_id: community.communityId });

    client.stop();
  });

  // A leave on device A must stick when device B loads: B's mirror still holds the membership, so
  // the merged tombstone has to reap B's engine — and must never be republished as a fresh join.
  async function leftElsewhere(opts: { mirror: "legacy" | "document" }) {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };

    // The relay copy device A published: the membership stays in the document (nothing is ever
    // deleted) with a tombstone that postdates its add — so it is derived-dead.
    const communities = mergeCommunities(
      [],
      [{ community_id: cid, seed: material, current: material, added_at: 1000 }],
    );
    const remote = JSON.stringify({ entries: communities, tombstones: [{ community_id: cid, removed_at: 2000 }] });
    const listEvent = await signer.signEvent({
      kind: COMMUNITY_LIST_KIND,
      content: await signer.nip44!.encrypt(pubkey, remote),
      tags: [],
      created_at: 1,
    });

    // Device B's mirror, written before the leave — it has no idea the membership is gone.
    const storage = memoryStorage();
    await storage.setItem(
      pubkey,
      opts.mirror === "legacy" ? JSON.stringify([material]) : JSON.stringify({ entries: communities, tombstones: [] }),
    );

    const store = new EventStore();
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage,
      relays: ["wss://fake"],
      autoUnlock: true,
      autoSaveCommunityList: true,
    });
    return { client, store, listEvent, cid, published, storage, pubkey, signer };
  }

  it.each(["legacy", "document"] as const)(
    "reaps a membership left on another device (%s mirror) — no resurrection",
    async (mirror) => {
      const { client, store, listEvent, cid, published } = await leftElsewhere({ mirror });

      await client.start();
      // The mirror bootstraps the engine before the relay copy lands (offline-first).
      expect(client.getCommunity(cid)).toBeDefined();

      store.add(listEvent as NostrEvent); // the relay copy, carrying the tombstone, arrives
      await settleFlush();

      // The engine is reaped and the membership leaves communities$ — not merely hidden.
      expect(client.getCommunity(cid)).toBeUndefined();
      expect(client.communities$.value.map((s) => s.material.community_id)).not.toContain(cid);

      // And nothing republished it as a live join — the leave stays propagated.
      for (const event of listPublishes(published)) {
        const doc = JSON.parse(await client.signer.nip44!.decrypt(client.pubkey, event.content));
        const entry = doc.entries.find((e: any) => e.community_id === cid);
        const tomb = doc.tombstones.find((t: any) => t.community_id === cid);
        expect(entry === undefined || (tomb && entry.added_at <= tomb.removed_at)).toBe(true);
      }

      client.stop();
    },
  );

  it("prunes the reaped membership from the mirror, so a restart does not revive it", async () => {
    const { client, store, listEvent, cid, storage, pubkey } = await leftElsewhere({ mirror: "legacy" });
    await client.start();
    store.add(listEvent as NostrEvent);
    await settleFlush();
    client.stop();

    // The mirror now carries the tombstone, so a fresh client never spins the engine at all.
    const mirror = JSON.parse((await storage.getItem(pubkey))!);
    expect(mirror.tombstones).toContainEqual({ community_id: cid, removed_at: 2000 });

    const { pool } = fakePool();
    const revived = new ConcordClient({
      signer: client.signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
    });
    await revived.start();
    await settle();
    expect(revived.getCommunity(cid)).toBeUndefined();
    revived.stop();
  });

  it("an explicit re-join outlives an older tombstone", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    await client.start();
    const community = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    const cid = community.communityId;
    await client.leave(cid);
    await settle();
    expect(client.getCommunity(cid)).toBeUndefined();

    // Re-joining stamps a fresh added_at, which outranks the leave (CORD-02 §8) — the tombstone
    // itself is never removed.
    published.length = 0;
    await client.joinByBundle(buildInviteBundle(community.material, { name: "Test" }));
    await settle();

    expect(client.getCommunity(cid)).toBeDefined();
    const doc = JSON.parse(
      await signer.nip44!.decrypt(await signer.getPublicKey(), listPublishes(published).at(-1)!.content),
    );
    const entry = doc.entries.find((e: any) => e.community_id === cid);
    const tomb = doc.tombstones.find((t: any) => t.community_id === cid);
    expect(tomb).toBeDefined();
    expect(entry.added_at).toBeGreaterThan(tomb.removed_at);

    client.stop();
  });

  it("exposes a descriptive status$ (phase + aggregate over communities)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
    });

    let snap: ConcordClientStatus | undefined;
    const sub = client.status$.subscribe((v) => (snap = v));
    expect(snap?.phase).toBe("idle");
    expect(snap?.communities).toBe(0);

    await client.start();
    await settle();
    expect(client.phase$.value).toBe("ready");
    expect(snap?.phase).toBe("ready");

    // Creating a community bootstraps an engine; it walks the empty fake relays to
    // its tip → live, so the aggregate counts one community, one of it live.
    await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();
    expect(snap?.communities).toBe(1);
    expect((snap?.live ?? 0) + (snap?.syncing ?? 0)).toBe(1);
    expect(snap?.live).toBe(1);

    client.stop();
    expect(client.phase$.value).toBe("idle");
    sub.unsubscribe();
  });
});

// A pool that serves matching events ASYNCHRONOUSLY (a tick after subscribe), like a
// real relay, then completes on EOSE. This is what makes the join regression below
// meaningful: a synchronous `from(events)` mock would let a buggy `firstValueFrom`
// pipe see the real value first and hide the defect.
function asyncServingPool(events: NostrEvent[]): RelayPool {
  const serve = (filters: unknown) => {
    const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{ kinds?: number[]; authors?: string[] }>;
    const match = events.filter((e) =>
      fs.some((f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))),
    );
    return from(match).pipe(delay(0));
  };
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => serve(filters),
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => serve(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

describe("ConcordClient.joinByLink (DI, async-served bundle)", () => {
  // Regression: `mapEventsToTimeline` seeds an immediate `[]` so the pipe never
  // completes empty; a `firstValueFrom` there resolves with that synchronous `[]`
  // BEFORE any relay replies, so the invite bundle is never actually read and the
  // join throws "invite bundle not found". `joinByLink` must instead wait for the
  // request to complete (`lastValueFrom`) and take the accumulated timeline.
  it("waits for the relay reply and joins from the fetched bundle", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: ownerPub,
      name: "Async",
      description: "served after a tick",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;

    // Mint an invite bundle event exactly as `ConcordCommunity.createInvite` does:
    // a link-key-signed kind-13309 carrying the token-encrypted §1 bundle, plus the
    // shareable link that points at it.
    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);
    const bundle = buildInviteBundle(genesis.material, { name: "Async", creator_npub: ownerPub });
    const template = await InviteBundleFactory.create(bundle, token);
    const bundleEvent = finalizeEvent(template, linkSk) as NostrEvent;
    const link = buildInviteLink("https://app.example", linkPub, token, genesis.material.relays);

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      pool: asyncServingPool([bundleEvent]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    const community = await client.joinByLink(link);
    expect(community.communityId).toBe(cid);
    expect(client.getCommunity(cid)).toBeDefined();

    client.stop();
  });
});

// A pool stand-in that honors NIP-01 tag filters (e.g. "#d") the way an honest
// relay would — unlike `asyncServingPool` above, which serves every matching
// kind/author event regardless of tags (representing "some relay in the pool
// has this event", the union-forming behavior of a real multi-relay
// `RelayPool.request`). This stricter variant proves the request-level `#d`
// scope (D-02) actually withholds a sibling-`d` edition, not merely that the
// outgoing filter carries the key.
function filteringAsyncServingPool(events: NostrEvent[]): RelayPool {
  const matchesFilter = (e: NostrEvent, f: { kinds?: number[]; authors?: string[]; [tag: string]: unknown }) => {
    if (f.kinds && !f.kinds.includes(e.kind)) return false;
    if (f.authors && !f.authors.includes(e.pubkey)) return false;
    for (const key of Object.keys(f)) {
      if (!key.startsWith("#")) continue;
      const tagName = key.slice(1);
      const values = f[key] as string[];
      if (!e.tags.some((t) => t[0] === tagName && values.includes(t[1]))) return false;
    }
    return true;
  };
  const serve = (filters: unknown) => {
    const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{
      kinds?: number[];
      authors?: string[];
      [tag: string]: unknown;
    }>;
    const match = events.filter((e) => fs.some((f) => matchesFilter(e, f)));
    return from(match).pipe(delay(0));
  };
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => serve(filters),
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => serve(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

describe("ConcordClient.joinByLink (INVITE-01 collapse-then-tombstone, D-01/D-02/D-03)", () => {
  async function mintLinkAndCommunity() {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: ownerPub,
      name: "Lagging",
      description: "revocation must win across a lagging relay",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;

    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);
    const bundle = buildInviteBundle(genesis.material, { name: "Lagging", creator_npub: ownerPub });
    const link = buildInviteLink("https://app.example", linkPub, token, genesis.material.relays);
    return { cid, token, linkSk, linkPub, bundle, link };
  }

  // INVITE-01: a fresher tombstone must close the link even when another relay
  // still serves a stale live edition at the SAME coordinate (33301, link_signer, "").
  it("rejects when a fresher tombstone coexists with a stale live bundle from a lagging relay", async () => {
    const { cid: _cid, token, linkSk, bundle, link } = await mintLinkAndCommunity();
    const now = Math.floor(Date.now() / 1000);

    // The stale edition a lagging relay is still serving (vsk 6, live, older).
    const staleLiveTemplate = await InviteBundleFactory.create(bundle, token).created(now - 100);
    const staleLiveEvent = finalizeEvent(staleLiveTemplate, linkSk) as NostrEvent;

    // The fresher revocation another (honest, caught-up) relay serves at the
    // same coordinate (vsk 9, newer created_at).
    const freshTombstoneTemplate = await InviteBundleFactory.modify(staleLiveEvent).revoke().created(now);
    const freshTombstoneEvent = finalizeEvent(freshTombstoneTemplate, linkSk) as NostrEvent;

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      // `asyncServingPool` models the union RelayPool.request() would already
      // present from multiple relays — both editions land in one merged timeline.
      pool: asyncServingPool([staleLiveEvent, freshTombstoneEvent]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    // Non-vacuity: under the removed `events.filter(isValidInviteBundle &&
    // !isInviteBundleRevoked).sort(desc)[0]` inversion, `freshTombstoneEvent`
    // would have been excluded by the `!isInviteBundleRevoked` predicate BEFORE
    // sorting, leaving `staleLiveEvent` as the sole survivor -- the stale live
    // bundle would have won and the join would have SUCCEEDED. The fix instead
    // collapses the full union to the newest edition (the tombstone) FIRST,
    // then evaluates revocation on that single winner, so the join is refused.
    await expect(client.joinByLink(link)).rejects.toThrow(/invite bundle not found or revoked/);
    expect(client.getCommunity(bundle.community_id)).toBeUndefined();

    client.stop();
  });

  // INVITE-01/D-02: the pool.request filter must scope to the empty `d` so a
  // sibling-`d` coordinate can never pollute the union.
  it("scopes the pool.request filter to the empty d tag", async () => {
    const { token, linkSk, linkPub, bundle, link } = await mintLinkAndCommunity();

    const template = await InviteBundleFactory.create(bundle, token);
    const bundleEvent = finalizeEvent(template, linkSk) as NostrEvent;

    const pool = asyncServingPool([bundleEvent]);
    const requestSpy = vi.spyOn(pool, "request");

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    await client.joinByLink(link);

    expect(requestSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ kinds: [INVITE_BUNDLE_KIND], authors: [linkPub], "#d": [""] })]),
    );

    client.stop();
  });

  // INVITE-01/D-02: a decoy event at a sibling `d` coordinate (same author+kind,
  // newer created_at) must be ignored — proven end-to-end against an honest
  // relay stand-in that actually applies the "#d": [""] scope server-side.
  it("ignores a newer decoy event carrying a non-empty d tag (D-02)", async () => {
    const { cid, token, linkSk, bundle, link } = await mintLinkAndCommunity();
    const now = Math.floor(Date.now() / 1000);

    // The real bundle at the correct coordinate (d: "").
    const liveTemplate = await InviteBundleFactory.create(bundle, token).created(now);
    const liveEvent = finalizeEvent(liveTemplate, linkSk) as NostrEvent;

    // A decoy at a SIBLING coordinate (same author+kind, non-empty d), minted
    // LATER (higher created_at) so an unscoped collapse would incorrectly pick
    // it as "newest" -- only the request-level `#d` scope keeps it out of the
    // union at all.
    const decoyTemplate = await InviteBundleFactory.create(bundle, token).created(now + 1000);
    const decoyEvent = finalizeEvent(
      { ...decoyTemplate, tags: decoyTemplate.tags.map((t) => (t[0] === "d" ? ["d", "decoy"] : t)) },
      linkSk,
    ) as NostrEvent;
    expect(decoyEvent.created_at).toBeGreaterThan(liveEvent.created_at);

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      // The stricter, tag-honoring pool stand-in: withholds the decoy server-side
      // exactly like an honest relay applying "#d": [""] would.
      pool: filteringAsyncServingPool([liveEvent, decoyEvent]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    const community = await client.joinByLink(link);
    expect(community.communityId).toBe(cid);

    client.stop();
  });
});
