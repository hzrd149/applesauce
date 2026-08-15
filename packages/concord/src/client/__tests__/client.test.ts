// ConcordClient over a dependency-injected EventStore/RelayPool — no network.
// Exercises the Community List (kind 13302) cast wiring: the client exposes
// `communityList$`, and `autoUnlock` decides whether the user-signer decryption is
// issued automatically or left for the app to trigger via the cast's `.unlock()`.

import { format } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Observable, Subject, delay, filter, firstValueFrom, from } from "rxjs";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers/time";
import "applesauce-common/casts";
import type { RelayPool } from "applesauce-relay";
import type { Debugger } from "debug";
import { finalizeEvent, type NostrEvent } from "applesauce-core/helpers/event";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";

import { ConcordClient } from "../client.js";
import { ConcordInviteManager } from "../invite-manager.js";
import type { ConcordCommunityList } from "../../casts/index.js";
import { memoryStorage } from "../storage.js";
import {
  COMMUNITY_LIST_KIND,
  LIST_MAX_BYTES,
  communityListByteSize,
  mergeCommunities,
} from "../../helpers/community-list.js";
import { CORD_COMMUNITY_LIST_MEMBERSHIP_CAP } from "../../__tests__/cord-wire-fixtures.js";
import { INVITE_LIST_KIND } from "../../helpers/invite-list.js";
import { createCommunity } from "../../helpers/community.js";
import { deriveConcordKeys } from "../../helpers/keys.js";
import {
  INVITE_BUNDLE_KIND,
  buildInviteBundle,
  buildInviteLink,
  getInviteBundle,
  newInviteToken,
} from "../../helpers/invite-bundle.js";
import { InviteBundleFactory } from "../../factories/invite-bundle.js";
import type { CommunityListCommunity, ConcordClientStatus, JoinMaterial } from "../../types.js";

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
  /** Every live-`subscription()` call's options bag, in call order — lets a
   *  test capture a scope's `onAuthRequired` handler (CAUTH-01/02: it's only
   *  ever invoked by a relay's own `auth-required:` refusal, never by
   *  registration or `challenge$` presence alone) and invoke it directly. */
  subscriptionOptions: Record<string, unknown>[];
  /** Every `publish()` call's options bag, in call order, paired by index with
   *  `published` — lets a test capture and invoke `saveCommunityList`'s
   *  `onAuthRequired` handler directly (15-05 Task 3). */
  publishOptions: Record<string, unknown>[];
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
  const subscriptionOptions: Record<string, unknown>[] = [];
  const publishOptions: Record<string, unknown>[] = [];
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
    subscription: (_relays: string[], _filters: unknown, options: Record<string, unknown> = {}) => {
      subscriptionOptions.push(options);
      return NEVER;
    },
    request: () => EMPTY,
    publish: vi.fn(async (_relays: string[], event: NostrEvent, options: Record<string, unknown> = {}) => {
      published.push(event);
      publishOptions.push(options);
      return [];
    }),
  } as unknown as RelayPool;
  return { pool, published, authenticatedPubkeys, subscriptionOptions, publishOptions };
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
  const { pool, published, publishOptions } = fakePool();
  const client = new ConcordClient({
    signer,
    pool,
    eventStore: store,
    storage: memoryStorage(),
    relays: ["wss://fake"],
  });
  return { signer, pubkey, decrypt, genesis, cid, listEvent, store, client, pool, published, publishOptions };
}

const firstList = (client: ConcordClient) =>
  firstValueFrom(client.communityList$.pipe(filter((c): c is ConcordCommunityList => !!c)));

const listPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === COMMUNITY_LIST_KIND);
const inviteListPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === INVITE_LIST_KIND);

/** Pairs each recorded `publish()` call's event with its options bag (same push order,
 *  same index) and filters to the Community List publishes — 15-05 Task 3. */
const listPublishOptions = (published: NostrEvent[], publishOptions: Record<string, unknown>[]) =>
  published
    .map((event, i) => ({ event, options: publishOptions[i]! }))
    .filter(({ event }) => event.kind === COMMUNITY_LIST_KIND);

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

  it("community startup's live-subscription onAuthRequired handler authenticates stream keys, not the user key", async () => {
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

    const { pool, authenticatedPubkeys, subscriptionOptions } = fakePool({ challenge: "challenge-abc" });
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });

    await client.start();
    await settle();

    expect(client.getCommunity(material.community_id)).toBeDefined();

    // No registration- or challenge$-triggered proactive AUTH exists any more
    // (D-01) — the community's live-subscription options carry its OWN
    // onAuthRequired handler; capture it and invoke it the way a relay's
    // `auth-required:` refusal would (CAUTH-01/02), naming the community's
    // own core stream-plane pubkeys, derived independently via
    // `deriveConcordKeys`, never read off the engine itself.
    const captured = subscriptionOptions.find((o) => typeof o.onAuthRequired === "function");
    expect(captured).toBeDefined();
    const keys = deriveConcordKeys(material, []);
    const streamPubkeys = [keys.control.pk, keys.guestbook.pk, keys.dissolved.pk, keys.nextBaseRekey.key.pk];

    await (captured!.onAuthRequired as (ctx: unknown) => Promise<void>)({
      relay: pool.relay("wss://fake"),
      url: "wss://fake",
      challenge: "challenge-abc",
      request: { verb: "REQ", id: "sub", filters: [] },
      requirement: streamPubkeys,
      missingPubkeys: streamPubkeys,
      reason: "auth-required",
    });

    expect(authenticatedPubkeys.length).toBeGreaterThan(0);
    expect(authenticatedPubkeys).toEqual(expect.arrayContaining(streamPubkeys));
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

  it("saveCommunityList's publish carries waitForAuth: [pubkey] answered by the user's own handler (15-05 Task 3)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "T", relays: ["wss://fake"] });
    const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const storage = memoryStorage();
    await storage.setItem(pubkey, JSON.stringify([material]));

    const { pool, published, publishOptions, authenticatedPubkeys } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      autoSaveCommunityList: false,
    });

    await client.start();
    await settle();
    await client.saveCommunityList();

    const listCalls = listPublishOptions(published, publishOptions);
    expect(listCalls.length).toBe(1);
    const { options } = listCalls[0]!;
    expect(options.waitForAuth).toEqual([pubkey]);
    expect(typeof options.onAuthRequired).toBe("function");

    const handler = options.onAuthRequired as (ctx: unknown) => Promise<void>;
    await handler({
      relay: pool.relay("wss://fake"),
      url: "wss://fake",
      challenge: null,
      request: { verb: "EVENT" as const, id: "list-1", filters: [] },
      requirement: [pubkey],
      missingPubkeys: [pubkey],
      reason: "auth-required",
    });
    expect(authenticatedPubkeys).toEqual([pubkey]);

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

// A pool stand-in for a MISBEHAVING / compromised relay: it serves every event
// it holds regardless of the requested `kinds`/`authors`/tag filter. Unlike
// `asyncServingPool` (which still honors kinds+authors, modeling an honest relay
// that just lacks server-side tag filtering) this ignores the outgoing filter
// entirely -- the threat model CR-01 is about: the outgoing filter is a request,
// not a guarantee, so a bad relay can return an arbitrary-author / arbitrary-tag
// event and `mapEventsToTimeline` unions it in without re-validation.
function unfilteredServingPool(events: NostrEvent[]): RelayPool {
  const serve = () => from(events).pipe(delay(0));
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: () => serve(),
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => serve(),
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
      expect.arrayContaining([
        expect.objectContaining({ kinds: [INVITE_BUNDLE_KIND], authors: [linkPub], "#d": [""] }),
      ]),
      expect.objectContaining({ waitForAuth: true, onAuthRequired: expect.any(Function) }),
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

  // INVITE-01/D-02 (CR-01): a MISBEHAVING relay that ignores the outgoing
  // authors/"#d" filter must not be able to inject an off-coordinate event that
  // wins the collapse and controls the join outcome. The outgoing filter is a
  // request, not a guarantee -- `asyncServingPool` serves every kind match
  // regardless of author/tags, modeling exactly the union a relay that ignores
  // the filter would contribute. Here the injection is a wrong-AUTHOR kind-33301
  // event with garbage content and a NEWER created_at: under the pre-fix code
  // (which filtered only by `isValidInviteBundle`, i.e. kind) it would win
  // `newestAtCoordinate`, then `getInviteBundle`/`validateInviteBundle` would
  // fail on its garbage content and the join would be DENIED -- one bad relay
  // unconditionally blocking a valid join, the exact property INVITE-01 exists
  // to defend. `isAtCoordinate` re-enforces `pubkey === linkSigner && d === ""`
  // on inbound events, so the injection is dropped before the race.
  it("ignores an off-coordinate event injected by a filter-ignoring relay, so one bad relay can't deny a join (CR-01)", async () => {
    const { cid, token, linkSk, linkPub, bundle, link } = await mintLinkAndCommunity();
    const now = Math.floor(Date.now() / 1000);

    // The real bundle at the correct coordinate (author = link signer, d = "").
    const liveTemplate = await InviteBundleFactory.create(bundle, token).created(now);
    const liveEvent = finalizeEvent(liveTemplate, linkSk) as NostrEvent;

    // A wrong-author kind-33301 event with garbage content, minted LATER so it
    // wins any unguarded created_at race. A misbehaving relay serves it even
    // though the request scoped `authors: [linkPub], "#d": [""]`.
    const attackerSk = generateSecretKey();
    const injected = finalizeEvent(
      { kind: INVITE_BUNDLE_KIND, created_at: now + 1000, tags: [["d", ""]], content: "not-a-valid-encrypted-bundle" },
      attackerSk,
    ) as NostrEvent;
    expect(injected.pubkey).not.toBe(linkPub);
    expect(injected.created_at).toBeGreaterThan(liveEvent.created_at);

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      // Misbehaving-relay pool: serves the injected off-coordinate event despite
      // the scoped `authors`/`#d` request -- a compromised/non-compliant relay is
      // not trusted to honor the outgoing filter (that is the whole CR-01 threat).
      pool: unfilteredServingPool([liveEvent, injected]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    // Non-vacuity: without `isAtCoordinate` the newer `injected` event wins the
    // collapse and `getInviteBundle(injected, token)` throws on its garbage
    // content -> join REJECTED. Asserting the join RESOLVES proves the fix
    // dropped the off-coordinate injection and let the honest d:"" bundle win.
    const community = await client.joinByLink(link);
    expect(community.communityId).toBe(cid);

    client.stop();
  });

  // Gap closure (CR-01, 12.3-11): a hostile link whose bundle relays are ALL
  // junk (so validateInviteBundle's own filter empties them, making the
  // fallback branch reliably reachable) AND whose fragment carries a
  // plaintext-scheme remote URL plus a non-URL blob must join with NEITHER
  // hostile value in the resulting community.material.relays — it must fall
  // back to the client's own default relays instead. Hand-builds the hostile
  // fragment bytes directly (following invite-bundle.test.ts's byte-surgery
  // convention), then swaps it into a link minted by buildInviteLink (which
  // cannot itself emit these hostile entry shapes).
  it("CR-01: a hostile link (junk bundle relays + hostile fragment) joins with neither an attacker URL nor a junk blob in community.material.relays", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: ownerPub,
      name: "Hostile",
      description: "CR-01 regression",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;

    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);
    // Bundle relays entirely junk — validateInviteBundle's own (pre-existing)
    // filter drops all of them, which is what makes the fragment-fed fallback
    // branch reliably reachable: the exact regression condition CR-01 names.
    const bundle = buildInviteBundle(
      { ...genesis.material, relays: ["junk1", "junk2"] },
      { name: "Hostile", creator_npub: ownerPub },
    );
    const template = await InviteBundleFactory.create(bundle, token);
    const bundleEvent = finalizeEvent(template, linkSk) as NostrEvent;

    // Mint a normal link, then replace its fragment with a hand-built hostile
    // one — FRAGMENT_VERSION hand-derived as `4` (module-private in
    // invite-bundle.ts), following invite-bundle.test.ts's buildHostileFragment
    // convention: version byte, zero flags, entry count, then per-entry
    // lead/length/UTF-8 bytes, then the 16-byte token.
    const mintedLink = buildInviteLink("https://app.example", linkPub, token, genesis.material.relays);
    const hostileEntries: Array<{ text: string }> = [
      { text: "ws://evil.example.com" }, // plaintext-scheme remote URL
      { text: "not-a-relay-blob" }, // non-URL blob
    ];
    const hostileBytes: number[] = [4, 0x00, hostileEntries.length];
    for (const { text } of hostileEntries) {
      const enc = Array.from(new TextEncoder().encode(text));
      hostileBytes.push(0xff, enc.length, ...enc);
    }
    hostileBytes.push(...token);
    const hostileFragment = base64urlnopad.encode(new Uint8Array(hostileBytes));
    const link = `${mintedLink.slice(0, mintedLink.indexOf("#"))}#${hostileFragment}`;

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      pool: asyncServingPool([bundleEvent]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://joiner-default.example.com"],
    });
    await client.start();

    // Non-vacuity: pre-fix, decodeFragment's terminal filter was
    // `relays.filter(Boolean)` — both hostile entries are non-empty strings and
    // would have survived into ParsedInvite.bootstrapRelays, and (since the
    // bundle's own relays are all junk) from there straight into
    // JoinMaterial.relays via joinFromBundle's fallback branch.
    const community = await client.joinByLink(link);
    expect(community.communityId).toBe(cid);
    expect(community.material.relays).toEqual(["wss://joiner-default.example.com"]);
    expect(community.material.relays.some((r) => r.includes("evil"))).toBe(false);
    expect(community.material.relays.some((r) => r.includes("not-a-relay-blob"))).toBe(false);

    client.stop();
  });
});

describe("ConcordClient.joinByLink (INVITE-04 expires_at seconds join-time check, D-05)", () => {
  async function mintExpiringInviteEvent(expiresAt: number | undefined) {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: ownerPub,
      name: "Expiring",
      description: "expires_at (seconds) join-time check",
      relays: ["wss://fake"],
    });
    const cid = genesis.material.community_id;

    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);
    const bundle = buildInviteBundle(genesis.material, {
      name: "Expiring",
      creator_npub: ownerPub,
      expires_at: expiresAt,
    });
    const template = await InviteBundleFactory.create(bundle, token);
    const bundleEvent = finalizeEvent(template, linkSk) as NostrEvent;
    const link = buildInviteLink("https://app.example", linkPub, token, genesis.material.relays);
    return { cid, bundleEvent, link };
  }

  // INVITE-04/D-05: joinFromBundle's expiry check must compare unixNow() (seconds)
  // against bundle.expires_at (seconds) -- a past SECONDS value refuses.
  it("refuses to join when expires_at (unix seconds) is in the past", async () => {
    const { bundleEvent, link } = await mintExpiringInviteEvent(unixNow() - 100);

    const joiner = new PrivateKeySigner(generateSecretKey());
    const client = new ConcordClient({
      signer: joiner,
      pool: asyncServingPool([bundleEvent]),
      eventStore: new EventStore(),
      storage: memoryStorage(),
    });
    await client.start();

    await expect(client.joinByLink(link)).rejects.toThrow(/invite expired/);

    client.stop();
  });

  // The seconds-vs-seconds sibling of the above: a future SECONDS value joins.
  it("joins when expires_at (unix seconds) is in the future", async () => {
    const { cid, bundleEvent, link } = await mintExpiringInviteEvent(unixNow() + 100_000);

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

    client.stop();
  });

  // Non-vacuity (D-13): a correctly-SECONDS-encoded far-future expiry (~10 digits)
  // is what the pre-fix `Date.now() > bundle.expires_at` (ms vs seconds) comparison
  // would have misread as already-expired -- Date.now() (~13-digit ms) is always
  // numerically larger than any 10-digit seconds value, so EVERY seconds-encoded
  // expiry (past or future) would have refused under the removed ms comparison.
  // The fixed unixNow() (seconds) vs seconds comparison reads the same value
  // correctly. This proves the unit fix is not vacuous -- it changes real behavior,
  // not just documentation.
  it("demonstrates the unit change is not vacuous: Date.now() (ms) vs a seconds expires_at misreads a valid future expiry as already-past", () => {
    const futureSeconds = unixNow() + 100_000;
    expect(Date.now() > futureSeconds).toBe(true); // pre-fix comparison: wrongly "expired"
    expect(unixNow() > futureSeconds).toBe(false); // fixed comparison: correctly not yet expired
  });
});

// Gap closure (WR-05/WR-06): dispose() must release every engine's
// subscription to the app-supplied extras source; stop() must be pause-only
// and leave this client's own holder (and the invite manager's) alive and
// reactive across a stop()/start() cycle.
describe("ConcordClient extras lifecycle — dispose() releases the source, stop() is pause-only (WR-05/WR-06)", () => {
  it("dispose() releases every engine's subscription to the app-supplied extras source — no remaining Concord observer, and a later push changes nothing", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool } = fakePool();
    const extras$ = new BehaviorSubject<string[]>([]);
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      extraRelays: extras$,
    });
    await client.start();
    await settle();

    // Three engines (client, invite manager, invite watcher) each hold their
    // own subscription to the SAME app-supplied source by default.
    expect(extras$.observed).toBe(true);

    client.dispose();

    expect(extras$.observed).toBe(false);

    // A later push must not throw, and must not resurrect a subscriber.
    extras$.next(["wss://after-dispose.test"]);
    expect(extras$.observed).toBe(false);
  });

  it("stop() leaves the client's own extras subscription intact, and a start() after that stop() still reacts to a later extras emission", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const requestTargets: string[][] = [];
    const pool = {
      status$: new Subject(),
      relay: () => ({
        url: "wss://fake",
        challenge: null,
        challenge$: new BehaviorSubject<string | null>(null),
        isAuthenticated: () => false,
        authenticate: async () => ({ ok: true }),
        getSupported: async () => null,
        request: () => EMPTY,
        sync: () => EMPTY,
      }),
      subscription: () => NEVER,
      request: (relays: string[]) => {
        requestTargets.push([...relays]);
        return EMPTY;
      },
      publish: async () => [],
    } as unknown as RelayPool;

    const extras$ = new BehaviorSubject<string[]>([]);
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
      extraRelays: extras$,
      watchDirectInvites: false,
    });

    await client.start();
    await settle();
    client.stop();

    // stop() must NOT unsubscribe the client's own extras holder (pause-only).
    expect(extras$.observed).toBe(true);

    // Push a later emission WHILE stopped.
    extras$.next(["wss://client-extras-after-stop.test"]);

    requestTargets.length = 0;
    await client.start();
    await settle();

    // fetchList() (called during start()) reads through `transport()` — a
    // frozen (disposed) holder would never have picked up the post-stop push.
    expect(requestTargets.some((t) => t.some((u) => u.includes("client-extras-after-stop")))).toBe(true);

    client.dispose();
  });

  it("ConcordInviteManager.dispose() releases its own extras subscription", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool } = fakePool();
    const extras$ = new BehaviorSubject<string[]>([]);
    const manager = new ConcordInviteManager({
      signer,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
      extraRelays: extras$,
      getCommunity: () => undefined,
    });

    expect(extras$.observed).toBe(true);

    manager.dispose();

    expect(extras$.observed).toBe(false);
    extras$.next(["wss://after.test"]);
    expect(extras$.observed).toBe(false);
  });
});

/** A callable spy standing in for an injected `Debugger`: records every call's raw
 *  arguments and supports `.extend()` (returning a logger sharing the SAME
 *  `calls` array) so the client's constructor-time `this.log.extend("invite")` /
 *  `.extend("publish")` derivations don't throw. Mirrors sync-logging.test.ts's
 *  `spyLogger` convention. */
function spyLogger(): { log: Debugger; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = ((...args: unknown[]) => {
    calls.push(args);
  }) as unknown as Debugger;
  (log as unknown as Record<string, unknown>).extend = () => log;
  return { log, calls };
}

describe("ConcordClient join atomicity + reconcile fault-tolerance (CR-02, gap closure 12.3-11)", () => {
  // Gap closure (WR-06, 12.3-13): renamed and re-commented from "a malformed
  // community_root rejects the join and leaves no residue" — since 12.3-12,
  // `joinByBundle` itself calls `validateInviteBundle`, so `not-hex` is
  // rejected THERE, before `recordJoin`/`addCommunity` is ever entered. This
  // now covers `joinByBundle`-as-a-validation-boundary (WR-02), not the
  // engine-first ordering it was originally written to pin — that coverage is
  // restored below by a separate test using a store factory that throws for
  // otherwise FULLY VALID material.
  it("joinByBundle is itself a validation boundary — a malformed community_root is rejected before recordJoin is ever entered, no residue", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Hostile",
      description: "CR-02 regression",
      relays: ["wss://fake"],
    });
    const hostileBundle = { ...buildInviteBundle(genesis.material, { name: "Hostile" }), community_root: "not-hex" };

    await expect(client.joinByBundle(hostileBundle)).rejects.toThrow();
    expect(client.getCommunity(hostileBundle.community_id)).toBeUndefined();

    await client.saveCommunityList();
    const lastList = listPublishes(published).at(-1);
    const doc = lastList ? JSON.parse(await signer.nip44!.decrypt(pubkey, lastList.content)) : { entries: [] };
    expect(doc.entries.find((e: any) => e.community_id === hostileBundle.community_id)).toBeUndefined();

    client.stop();
  });

  it("joinByBundle is a validation boundary: a subsequent legitimate join succeeds after the rejected join, with the document containing exactly the legitimate entry", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const genesisHostile = await createCommunity({
      ownerPubkey: pubkey,
      name: "Hostile",
      description: "CR-02 regression",
      relays: ["wss://fake"],
    });
    const hostileBundle = {
      ...buildInviteBundle(genesisHostile.material, { name: "Hostile" }),
      community_root: "not-hex",
    };
    await expect(client.joinByBundle(hostileBundle)).rejects.toThrow();

    const genesisLegit = await createCommunity({
      ownerPubkey: pubkey,
      name: "Legit",
      description: "should still join",
      relays: ["wss://fake"],
    });
    const legitBundle = buildInviteBundle(genesisLegit.material, { name: "Legit" });
    await client.joinByBundle(legitBundle);

    expect(client.getCommunity(legitBundle.community_id)).toBeDefined();
    const raw = await storage.getItem(pubkey);
    const mirror = JSON.parse(raw!) as { entries: Array<{ community_id: string }> };
    expect(mirror.entries.map((e) => e.community_id)).toEqual([legitBundle.community_id]);

    client.stop();
  });

  // Gap closure (WR-06, 12.3-13): restores the engine-first ordering coverage
  // the two renamed tests above lost when `joinByBundle` became its own
  // validation boundary (12.3-12) — driven with a FULLY VALID bundle (the
  // validator cannot short-circuit this one) and a client-level store factory
  // that throws, so `addCommunity` -> `new ConcordCommunity(...)` ->
  // `storeFor("control")` throws INSIDE `recordJoin`, after the entry-size
  // guard but before `this.list` is touched.
  it("a construction failure for FULLY VALID material leaves this.list unchanged, asserted through both a subsequent save and the local mirror", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      storeFactory: () => {
        throw new Error("store factory boom");
      },
    });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Valid",
      description: "WR-06 atomicity",
      relays: ["wss://fake"],
    });
    const validBundle = buildInviteBundle(genesis.material, { name: "Valid" });

    await expect(client.joinByBundle(validBundle)).rejects.toThrow(/store factory boom/);
    expect(client.getCommunity(validBundle.community_id)).toBeUndefined();

    await client.saveCommunityList();
    expect(listPublishes(published).length).toBe(0);

    const raw = await storage.getItem(pubkey);
    if (raw) {
      const mirror = JSON.parse(raw) as { entries: Array<{ community_id: string }> };
      expect(mirror.entries.find((e) => e.community_id === validBundle.community_id)).toBeUndefined();
    }

    client.stop();
  });

  it("a Community List entry with malformed material is skipped during reconcile — the legitimate entry still starts, no unhandled rejection, and a log line records the skip", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Legit",
      description: "should still start",
      relays: ["wss://fake"],
    });
    const legitMaterial: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const malformedMaterial: JoinMaterial = {
      ...legitMaterial,
      community_id: "ff".repeat(32),
      community_root: "not-hex",
    };

    const communities = mergeCommunities(
      [],
      [
        { community_id: legitMaterial.community_id, seed: legitMaterial, current: legitMaterial, added_at: 1 },
        {
          community_id: malformedMaterial.community_id,
          seed: malformedMaterial,
          current: malformedMaterial,
          added_at: 1,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
    const listEvent = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });

    const store = new EventStore();
    const { pool } = fakePool();
    const { log, calls } = spyLogger();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
      logger: log,
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await client.start();
      store.add(listEvent as NostrEvent);
      await settle();

      // Non-vacuity: pre-fix, the unguarded `this.addCommunity(community.current)`
      // in the reconcile loop throws on the malformed entry's `hexToBytes`, which
      // — for the loop's first-encountered malformed entry — would abort the
      // whole `for` before the legitimate entry (iterated after it in Map
      // insertion order) ever starts.
      expect(client.getCommunity(legitMaterial.community_id)).toBeDefined();
      expect(client.getCommunity(malformedMaterial.community_id)).toBeUndefined();
      expect(
        calls.some((c) =>
          format(...(c as [unknown, ...unknown[]])).includes(malformedMaterial.community_id.slice(0, 8)),
        ),
      ).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
      client.stop();
    }
  });

  // ── Gap closure (WR-01, 12.3-12): 12.3-11's own skip-and-continue reconcile
  // amplified community.ts's constructor leak into a per-emission one — a
  // repeatedly-failing entry must cost one subscription, not one per emission.
  /** A counting Observable stand-in for `extraRelays`: increments a counter on
   *  subscribe, delegates to an inner BehaviorSubject, and decrements on
   *  teardown — mirrors community.test.ts's identical helper. */
  function countingExtrasSource(initial: string[] = []): {
    source: Observable<string[]>;
    count: () => number;
  } {
    const inner = new BehaviorSubject<string[]>(initial);
    let active = 0;
    const source = new Observable<string[]>((subscriber) => {
      active++;
      const sub = inner.subscribe(subscriber);
      return () => {
        active--;
        sub.unsubscribe();
      };
    });
    return { source, count: () => active };
  }

  it("a Community List with one unconstructable entry alongside one legitimate entry does not grow the extras subscriber count across several reconcile emissions, and the legitimate community stays started", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Legit",
      description: "should stay started",
      relays: ["wss://fake"],
    });
    const legitMaterial: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const malformedMaterial: JoinMaterial = {
      ...legitMaterial,
      community_id: "ff".repeat(32),
      community_root: "not-hex",
    };
    const communities = mergeCommunities(
      [],
      [
        { community_id: legitMaterial.community_id, seed: legitMaterial, current: legitMaterial, added_at: 1 },
        {
          community_id: malformedMaterial.community_id,
          seed: malformedMaterial,
          current: malformedMaterial,
          added_at: 1,
        },
      ],
    );

    const store = new EventStore();
    const { pool } = fakePool();
    const { source: extras, count } = countingExtrasSource([]);
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
      watchDirectInvites: false, // isolate the count to client + invite manager + community engines
      extraRelays: extras,
    });

    await client.start();
    // Baseline: the client itself + its always-constructed invite manager each
    // hold their own subscription to the same app-supplied source.
    const baseline = count();

    async function publishListAt(createdAt: number) {
      const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
      const event = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: createdAt });
      store.add(event as NostrEvent);
      await settleFlush();
    }

    await publishListAt(1);
    expect(client.getCommunity(legitMaterial.community_id)).toBeDefined();
    expect(client.getCommunity(malformedMaterial.community_id)).toBeUndefined();
    // One legitimate community engine constructed → +1 over baseline.
    const afterFirst = count();
    expect(afterFirst).toBe(baseline + 1);

    // Non-vacuity: pre-fix, EVERY emission below re-attempts
    // `this.addCommunity(malformedMaterial)`, and `ConcordCommunity`'s
    // constructor leaks a permanent subscriber on each throw — so the count
    // would grow by one per emission here. Re-publish the SAME content at
    // successive `created_at` values to force multiple reconcile passes over
    // the identically-failing entry.
    await publishListAt(2);
    await publishListAt(3);
    await publishListAt(4);

    expect(count()).toBe(afterFirst); // no growth
    expect(client.getCommunity(legitMaterial.community_id)).toBeDefined();
    expect(client.getCommunity(malformedMaterial.community_id)).toBeUndefined();

    client.stop();
  });

  it("a failed reconcile entry is not retried on every emission, but an entry whose current material changes is retried and starts once corrected", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Fixable",
      description: "starts once corrected",
      relays: ["wss://fake"],
    });
    const goodMaterial: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    const badMaterial: JoinMaterial = { ...goodMaterial, community_root: "not-hex" };
    const cid = goodMaterial.community_id;

    const store = new EventStore();
    const { pool } = fakePool();
    const { log, calls } = spyLogger();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
      logger: log,
    });
    await client.start();

    async function publishEntryAt(createdAt: number, material: JoinMaterial) {
      const communities = mergeCommunities([], [{ community_id: cid, seed: material, current: material, added_at: 1 }]);
      const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
      const event = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: createdAt });
      store.add(event as NostrEvent);
      await settleFlush();
    }

    await publishEntryAt(1, badMaterial);
    expect(client.getCommunity(cid)).toBeUndefined();
    calls.length = 0; // clear the first-failure log before asserting the suppressed retry below

    // Same failing material again — must be skipped SILENTLY (no re-log, no
    // construction attempt), not merely "still fails".
    await publishEntryAt(2, badMaterial);
    expect(client.getCommunity(cid)).toBeUndefined();
    expect(calls.some((c) => format(...(c as [unknown, ...unknown[]])).includes(cid.slice(0, 8)))).toBe(false);

    // The material CHANGES (corrected) — this must be retried, not permanently
    // suppressed by the id-only fingerprint.
    await publishEntryAt(3, goodMaterial);
    expect(client.getCommunity(cid)).toBeDefined();

    client.stop();
  });

  it("the happy-path join still stamps added_at and produces exactly one document entry (recordJoin reordering regression guard)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const before = Date.now();
    const community = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    const after = Date.now();

    const raw = await storage.getItem(pubkey);
    const mirror = JSON.parse(raw!) as { entries: Array<{ community_id: string; added_at: number }> };
    expect(mirror.entries.length).toBe(1);
    const entry = mirror.entries[0];
    expect(entry.community_id).toBe(community.communityId);
    expect(entry.added_at).toBeGreaterThanOrEqual(before);
    expect(entry.added_at).toBeLessThanOrEqual(after);

    client.stop();
  });
});

// ── Gap closure (WR-02, WR-03, CR-02 half two; 12.3-12): joinByBundle becomes
// a validation boundary, the untrusted-relay gate moves to joinByLink's own
// bootstrap selection (never the app's configured relays), and a byte-capped
// Community List becomes recoverable through leave() alone.
describe("ConcordClient joinByBundle validation, relay gate relocation, and Community List recovery (12.3-12)", () => {
  it("joinByBundle rejects a bundle that fails validation, and neither the community set nor the published document is affected", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Hostile",
      description: "WR-02 regression",
      relays: ["wss://fake"],
    });
    // The same malformed community_root repro CR-02's own describe block uses —
    // WR-02's fix is that THIS call path now catches it too (joinByBundle was
    // previously not itself a validation boundary).
    const hostileBundle = { ...buildInviteBundle(genesis.material, { name: "Hostile" }), community_root: "not-hex" };

    await expect(client.joinByBundle(hostileBundle)).rejects.toThrow(/invite failed validation/);
    expect(client.getCommunity(hostileBundle.community_id)).toBeUndefined();
    expect(listPublishes(published).length).toBe(0);

    client.stop();
  });

  it("joinByBundle given a bundle whose relays are entirely junk strings joins with none of them in material.relays", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://joiner-default.example.com"],
    });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "JunkRelays",
      description: "WR-02 regression",
      relays: ["wss://fake"],
    });
    const bundle = buildInviteBundle({ ...genesis.material, relays: ["junk1", "junk2"] }, { name: "JunkRelays" });

    // Non-vacuity: pre-fix, joinByBundle handed `bundle` straight to
    // joinFromBundle unvalidated — `bundle.relays.length` (2 junk strings) is
    // truthy, so the fallback branch is never reached at all and
    // material.relays would have been ["junk1", "junk2"] verbatim. Post-fix,
    // validateInviteBundle empties the junk relays FIRST (bundle.relays.length
    // becomes 0), which correctly falls through to the client's own default
    // relays — proving the bundle now passes through the validator on this
    // path, without asserting an unrealistic "always empty" outcome.
    const community = await client.joinByBundle(bundle);
    expect(community.material.relays).toEqual(["wss://joiner-default.example.com"]);
    expect(community.material.relays.some((r) => r.includes("junk"))).toBe(false);

    client.stop();
  });

  it("joinByBundle given a valid bundle still joins exactly as before (regression)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
    });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Valid",
      description: "regression guard",
      relays: ["wss://fake"],
    });
    const bundle = buildInviteBundle(genesis.material, { name: "Valid" });
    const community = await client.joinByBundle(bundle);
    expect(community.communityId).toBe(genesis.material.community_id);
    expect(community.material.relays).toEqual(genesis.material.relays);

    client.stop();
  });

  // WR-03: the untrusted-invite relay predicate must never filter the app's own
  // configured `relays` option — a LAN plaintext relay (neither loopback nor
  // wss://) must survive a join by bundle whose own relays are empty.
  it("WR-03: a client configured with a LAN plaintext relay joins by bundle with empty bundle relays, and material.relays carries the configured relay", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const lanRelay = "ws://192.168.1.10:4869";
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: [lanRelay],
    });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Lan",
      description: "WR-03 regression",
      relays: [lanRelay],
    });
    const bundle = { ...buildInviteBundle(genesis.material, { name: "Lan" }), relays: [] };

    // Non-vacuity: pre-fix, joinFromBundle's fallback branch filtered
    // `fallbackRelays` (here, the client's own configured `relays` option)
    // through `isSafeInviteRelayURL` — a LAN `ws://` host is neither loopback
    // nor `wss://`, so it would have been silently dropped, publishing
    // `material.relays: []`.
    const community = await client.joinByBundle(bundle);
    expect(community.material.relays).toEqual([lanRelay]);

    client.stop();
  });

  it("D-07/D-08 supersedes CR-02's old wedge: an oversized entry publishes immediately (with the size trace naming it), and leave() still prunes its bytes from the document afterward", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const { log, calls } = spyLogger();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      logger: log,
    });

    // Construct the oversized entry by feeding it directly into the client's
    // local mirror (legacy format: a bare array of materials) rather than via
    // any bundle-validating join path — Task 1 makes an oversized `name`
    // impossible to get past `validateInviteBundle`, so this test targets the
    // RECOVERY property, not the (now-closed) entry route. Plan 12-04's
    // write-side byte-cap assertion also makes an oversized `name` impossible
    // to get past `createCommunity` itself now, so the giant entry is padded
    // via `relays` (unbounded) instead of `name` (capped at 64 bytes).
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "x",
      description: "CR-02 heritage",
      relays: [`wss://${"x".repeat(45_000)}`], // serialized twice per entry (seed + current) — historically wedged the doc alone
    });
    const cid = genesis.material.community_id;
    const giantMaterial: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
    await storage.setItem(pubkey, JSON.stringify([giantMaterial]));

    await client.start();
    await settle();
    // A giant name does not break engine construction — the entry is reachable
    // via the public API exactly as the plan's fix-shape rationale requires.
    expect(client.getCommunity(cid)).toBeDefined();

    await client.saveCommunityList();
    // D-07/D-08: nothing withholds this publish anymore — the size trace still
    // names the offending entry, but as information, not a refusal reason.
    expect(listPublishes(published).length).toBe(1);
    expect(
      calls.some((c) => {
        const msg = format(...(c as [unknown, ...unknown[]]));
        return msg.includes("community list size trace") && msg.includes(cid.slice(0, 8));
      }),
    ).toBe(true);

    // leave() still prunes the entry's bytes (in addition to tombstoning it) —
    // now a hygiene property of the document, not a stuck-publish recovery.
    await client.leave(cid);
    await settle();
    expect(listPublishes(published).length).toBe(2); // a second publish carries the tombstone + prune
    const doc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published)[1].content));
    expect(doc.entries.find((e: any) => e.community_id === cid)).toBeUndefined();
    expect(doc.tombstones.find((t: any) => t.community_id === cid)).toBeDefined();

    client.stop();
  });

  // Gap closure (WR-07, 12.3-13): rewritten from "an ordinary leave() still
  // tombstones, still publishes, and the membership stays derived-dead after
  // a later merge of a stale remote copy that still holds the entry". The
  // prior fixture stamped the stale event at `created_at: 1` — strictly OLDER
  // than our leave-time publication — so kind 13302's replaceable-event
  // winner selection kept OUR event and the cast never re-emitted the stale
  // content; `mergeCommunities` was never actually reached with it, and the
  // final assertion's disjunction (`entry === undefined || ...`) was satisfied
  // trivially by the `undefined` half. This version stamps the stale event
  // STRICTLY NEWER (so the merge genuinely happens), carries a SECOND,
  // never-left entry (the only way to prove the merge ran rather than the
  // stale event being ignored for some other reason), and splits the old
  // disjunction into three independently meaningful assertions.
  it("CR-02(b): a stale remote copy stamped NEWER than our leave-time publication genuinely merges — the never-left sibling is picked up, the left entry's bytes stay absent, and the tombstone outranks the stale add", async () => {
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

    const left = await client.createNewCommunity("Left", "hi", ["wss://fake"]);
    const cid = left.communityId;
    const staleAddedAt = Date.now();
    await settle();

    await client.leave(cid);
    await settle();
    expect(client.getCommunity(cid)).toBeUndefined();
    const leaveTimePublication = listPublishes(published).at(-1)!;

    // A second, never-left community — the witness that proves the merge
    // below genuinely happened (WR-07's non-vacuity requirement).
    const neverLeft = await createCommunity({
      ownerPubkey: pubkey,
      name: "NeverLeft",
      description: "merge witness",
      relays: ["wss://fake"],
    });
    const neverLeftMaterial: JoinMaterial = { ...neverLeft.material, held_roots: neverLeft.material.held_roots ?? [] };
    const staleMaterial: JoinMaterial = { ...left.material, held_roots: left.material.held_roots ?? [] };
    const staleCommunities = mergeCommunities(
      [],
      [
        { community_id: cid, seed: staleMaterial, current: staleMaterial, added_at: staleAddedAt },
        {
          community_id: neverLeftMaterial.community_id,
          seed: neverLeftMaterial,
          current: neverLeftMaterial,
          added_at: staleAddedAt,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: staleCommunities, tombstones: [] }));
    // Derived from the SAME strictly-greater stamping rule saveCommunityList
    // itself uses (client.ts's `Math.max(nowSeconds, (previous?.created_at ??
    // 0) + 1)`) — never guessed, and comfortably newer than our own publish.
    const staleEvent = await signer.signEvent({
      kind: COMMUNITY_LIST_KIND,
      content,
      tags: [],
      created_at: leaveTimePublication.created_at + 60,
    });
    store.add(staleEvent as NostrEvent);
    await settleFlush();
    await settle();

    // Fact 1: the merge genuinely happened — the never-left sibling was
    // picked up and its engine started.
    expect(client.getCommunity(neverLeftMaterial.community_id)).toBeDefined();

    // Fact 2: the left entry's bytes stay absent from the next published document.
    expect(client.getCommunity(cid)).toBeUndefined();
    const lastDoc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(lastDoc.entries.find((e: any) => e.community_id === cid)).toBeUndefined();

    // Fact 3: the tombstone for the left cid outranks the stale re-merged add.
    const tomb = lastDoc.tombstones.find((t: any) => t.community_id === cid);
    expect(tomb).toBeDefined();
    expect(tomb.removed_at).toBeGreaterThan(staleAddedAt);

    client.stop();
  });
});

// ── Gap closure (CR-02, WR-06 reversal guard, WR-08 deferral note; 12.3-13):
// engine-less/unknown-cid leave() reachability, and prune idempotence.
describe("ConcordClient pruneDeadEntries — engine-less leave, unknown-cid no-op, idempotence (12.3-13)", () => {
  it("CR-02(a): leave() on an entry reconcile skipped as unconstructable (no running engine) still tombstones, prunes, and a subsequent save publishes with no entry for it", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Wedge",
      description: "engine-less leave",
      relays: ["wss://fake"],
    });
    const malformedMaterial: JoinMaterial = {
      ...genesis.material,
      held_roots: genesis.material.held_roots ?? [],
      community_root: "not-hex",
    };
    const cid = malformedMaterial.community_id;
    const communities = mergeCommunities(
      [],
      [{ community_id: cid, seed: malformedMaterial, current: malformedMaterial, added_at: 1 }],
    );
    // Setup sanity: the fixture genuinely carries the entry (pre-leave state) —
    // without this, a client that never merged it would ALSO show no engine.
    expect(communities.some((e) => e.community_id === cid)).toBe(true);
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
      autoUnlock: true,
    });
    await client.start();
    store.add(listEvent as NostrEvent);
    await settle();

    // Pre-leave: no running engine — reconcile skipped construction (its own
    // `community_root` throws inside `hexToBytes`).
    expect(client.getCommunity(cid)).toBeUndefined();

    await client.leave(cid);
    await settle();

    const doc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(doc.entries.find((e: any) => e.community_id === cid)).toBeUndefined();
    expect(doc.tombstones.find((t: any) => t.community_id === cid)).toBeDefined();

    client.stop();
  });

  it("CR-02(a): leave(cid) after stop() — a cid still present in the local mirror with no running engine — still tombstones and prunes, reachable through the public API alone", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const community = await client.createNewCommunity("StopThenLeave", "hi", ["wss://fake"]);
    const cid = community.communityId;
    await settle();
    expect(client.getCommunity(cid)).toBeDefined(); // sanity: the engine WAS running

    // stop() clears the engine map; this.list/this.tombstones are NOT reset by
    // stop() (it is pause-only) — the cid is still known to the document.
    client.stop();
    expect(client.getCommunity(cid)).toBeUndefined(); // now genuinely engine-less

    await client.leave(cid);

    const doc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(doc.entries.find((e: any) => e.community_id === cid)).toBeUndefined();
    expect(doc.tombstones.find((t: any) => t.community_id === cid)).toBeDefined();
  });

  it("CR-02(a): leave() on a cid the client has never seen adds NO tombstone and triggers no publish", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
    });
    await client.start();

    await client.leave("ff".repeat(32));
    await settle();

    expect(listPublishes(published).length).toBe(0);

    client.stop();
  });

  it("the prune is idempotent: re-merging the already-published document multiple times leaves a live membership untouched and a dead one still pruned", async () => {
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

    const live = await client.createNewCommunity("Live", "hi", ["wss://fake"]);
    const dead = await client.createNewCommunity("Dead", "hi", ["wss://fake"]);
    await client.leave(dead.communityId);
    await settle();

    const lastEvent = listPublishes(published).at(-1)!;
    const docBefore = JSON.parse(await signer.nip44!.decrypt(pubkey, lastEvent.content));
    expect(docBefore.entries.map((e: any) => e.community_id)).toEqual([live.communityId]);

    // Re-merge the SAME already-published content at successive created_at
    // values, several times — mirrors a stale peer (or the cast itself)
    // repeatedly re-emitting.
    for (let n = 0; n < 3; n++) {
      const content = await signer.nip44!.encrypt(pubkey, JSON.stringify(docBefore));
      const event = await signer.signEvent({
        kind: COMMUNITY_LIST_KIND,
        content,
        tags: [],
        created_at: lastEvent.created_at + 10 + n,
      });
      store.add(event as NostrEvent);
      await settleFlush();
    }

    expect(client.getCommunity(live.communityId)).toBeDefined(); // live membership never pruned
    expect(client.getCommunity(dead.communityId)).toBeUndefined();

    await client.saveCommunityList();
    const finalDoc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(finalDoc.entries.map((e: any) => e.community_id)).toEqual([live.communityId]);
    expect(finalDoc.tombstones.find((t: any) => t.community_id === dead.communityId)).toBeDefined();

    client.stop();
  });
});

// ── Gap closure (CR-01 structural half, WR-04, IN-01, IN-04; 12.3-13): the
// aggregate serialized-size ceiling at recordJoin, and two smaller fixes it
// shares a file edit with.
describe("ConcordClient recordJoin — D-07 byte ceiling removed, IN-01/IN-04 (12.3-13 -> 12-05)", () => {
  it("D-07: a community whose prospective entry would previously have exceeded the deleted per-entry ceiling now records successfully, appears in communities$, and a subsequent explicit save publishes it", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
    });
    await client.start();

    // A plain literal oversized field — no per-entry ceiling constant survives
    // to derive this from (D-07/D-10 deleted it outright). Padding via
    // `relays` (unbounded) rather than `name`: plan 12-04's
    // write-side byte-cap assertion rejects any name over 64 bytes before
    // `createCommunity` even builds material.
    const oversizedRelays = ["wss://fake", `wss://${"x".repeat(40_000)}.example`];

    const community = await client.createNewCommunity("x", "d", oversizedRelays);
    expect(client.communities$.value.length).toBe(1);
    expect(client.communities$.value[0].material.community_id).toBe(community.communityId);

    await client.saveCommunityList();
    expect(listPublishes(published).length).toBe(1); // publishes; nothing withheld

    client.stop();
  });

  it("createNewCommunity with an ordinary name still records exactly one entry with a stamped added_at (happy path untouched by the new guard)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const community = await client.createNewCommunity("Ordinary", "hi", ["wss://fake"]);
    const raw = await storage.getItem(pubkey);
    const mirror = JSON.parse(raw!) as { entries: Array<{ community_id: string; added_at: number }> };
    expect(mirror.entries.length).toBe(1);
    expect(mirror.entries[0].community_id).toBe(community.communityId);
    expect(typeof mirror.entries[0].added_at).toBe("number");

    client.stop();
  });

  it("IN-04: after a join whose bundle carries no relays, material.relays is not the same array reference as the client's configured default relay array", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const defaultRelays = ["wss://joiner-default.example.com"];
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: defaultRelays,
    });
    await client.start();

    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "NoRelays",
      description: "IN-04 regression",
      relays: ["wss://fake"],
    });
    const bundle = buildInviteBundle({ ...genesis.material, relays: [] }, { name: "NoRelays" });
    const community = await client.joinByBundle(bundle);

    expect(community.material.relays).toEqual(defaultRelays);
    // Non-vacuity: pre-fix, `relays: bundle.relays.length ? bundle.relays :
    // fallbackRelays` stored `this.defaultRelays` by REFERENCE — this asserts
    // reference inequality, which `toEqual` alone cannot.
    expect(community.material.relays).not.toBe(defaultRelays);

    client.stop();
  });

  it("IN-01: the size trace includes the tombstone byte total and omits the largest-entry clause when the entry list is empty — and the list still publishes (D-08)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const { log, calls } = spyLogger();

    // Enough tombstones ALONE to push the document over the historical
    // LIST_MAX_BYTES reference figure, with an EMPTY entry list — the
    // scenario IN-01 says the pre-fix diagnostic mis-reported (ignored these
    // bytes, and would have ended with a bare trailing "community=").
    const tombstones = Array.from({ length: 2500 }, (_, i) => ({ community_id: `tomb-${i}`, removed_at: i }));
    await storage.setItem(pubkey, JSON.stringify({ entries: [], tombstones }));

    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      logger: log,
    });
    await client.start();
    await settle();

    await client.saveCommunityList();
    // Match by the facts the trace must carry (byte count, entry count,
    // tombstone-bytes phrase) rather than the full sentence, so a future
    // rewording doesn't break this suite while a missing fact still does.
    const sizeTraceMessage = calls
      .map((c) => format(...(c as [unknown, ...unknown[]])))
      .find((m) => m.includes("community list size trace"));
    expect(sizeTraceMessage).toBeDefined();
    expect(sizeTraceMessage).toMatch(/\d+ bytes/);
    expect(sizeTraceMessage).toMatch(/0 entries/);
    expect(sizeTraceMessage).toMatch(/tombstone bytes/);
    expect(sizeTraceMessage).not.toContain("largest entry community=");
    // D-08: the diagnostic is not a refusal — an over-figure document still publishes.
    expect(listPublishes(published).length).toBe(1);

    client.stop();
  });
});

// ── Gap closure (WIRE-08, D-06; 12-05): the 50-membership protocol constant
// (CORD-02 §8) is now the Community List's ONLY bound (D-07 removed every
// serialized-byte cap). Every "50" below is spec-anchored to the vendored
// transcription `CORD_COMMUNITY_LIST_MEMBERSHIP_CAP` — never to the
// implementation's own membership-cap constant (D-21/TEST-01).
describe("ConcordClient recordJoin — 50-membership cap enforcement (WIRE-08, D-06, 12-05)", () => {
  /** Build `count` real, independently-constructible live memberships for `ownerPubkey`, seeded
   *  through the local mirror shape `loadMirror`/`parseMirror` reads — never by calling
   *  `recordJoin` repeatedly, since the guard under test would refuse the 51st+ call and the
   *  setup would become the assertion. */
  async function mkLiveEntries(ownerPubkey: string, count: number): Promise<CommunityListCommunity[]> {
    const entries: CommunityListCommunity[] = [];
    for (let i = 0; i < count; i++) {
      const genesis = await createCommunity({ ownerPubkey, name: `c${i}`, relays: ["wss://fake"] });
      entries.push({
        community_id: genesis.material.community_id,
        seed: genesis.material,
        current: genesis.material,
        added_at: i,
      });
    }
    return entries;
  }

  /** A minimal, non-constructible-engine `CommunityListCommunity` — used only to populate the
   *  internal list directly (bypassing `mergeCommunities`/`pruneDeadEntries`, see below), never to
   *  start a real `ConcordCommunity`. */
  function mkFakeEntry(id: string, addedAt: number): CommunityListCommunity {
    const material: JoinMaterial = {
      community_id: id,
      owner: "o",
      owner_salt: "s",
      community_root: "r",
      root_epoch: 0,
      channels: [],
      relays: [],
      name: id,
    };
    return { community_id: id, seed: material, current: material, added_at: addedAt };
  }

  it("recordJoin's guard reads the DERIVED live count, not this.list's raw array length — every public mutation path (mergeCommunities' dedup, pruneDeadEntries on every death transition) keeps the two equal by construction, so this pins the implementation choice by directly corrupting the private list past what those invariants would ever let it hold", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage: memoryStorage(),
      relays: ["wss://fake"],
    });
    await client.start();

    // 49 live memberships, each duplicated (raw array length 98) — a shape
    // `mergeCommunities` would never itself produce (it dedupes by
    // community_id on every write path), reachable here only by writing the
    // private field directly.
    const distinct = Array.from({ length: CORD_COMMUNITY_LIST_MEMBERSHIP_CAP - 1 }, (_, i) =>
      mkFakeEntry(`fake-${i}`, i),
    );
    (client as any).list = [...distinct, ...distinct];

    // Under the correct implementation (liveCommunities(this.list, this.tombstones).length), the
    // derived live count is still 49, so the join that would be the cap-th succeeds despite the
    // corrupted raw array holding 98 entries.
    await expect(client.createNewCommunity("boundary", "d", ["wss://fake"])).resolves.toBeDefined();

    client.stop();
  });

  it("refuses the 51st live membership, naming the live count and the cap, and communities$ still holds 50", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const entries = await mkLiveEntries(pubkey, CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);
    await storage.setItem(pubkey, JSON.stringify({ entries, tombstones: [] }));

    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();
    expect(client.communities$.value.length).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);

    await expect(client.createNewCommunity("one-too-many", "d", ["wss://fake"])).rejects.toThrow(
      new RegExp(
        `${CORD_COMMUNITY_LIST_MEMBERSHIP_CAP} live memberships.*${CORD_COMMUNITY_LIST_MEMBERSHIP_CAP}-membership cap`,
      ),
    );
    expect(client.communities$.value.length).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);

    client.stop();
  }, 30_000);

  it("admits the membership that would be the cap-th (the 50th), the boundary the refusal above sits one past", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const entries = await mkLiveEntries(pubkey, CORD_COMMUNITY_LIST_MEMBERSHIP_CAP - 1);
    await storage.setItem(pubkey, JSON.stringify({ entries, tombstones: [] }));

    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();
    expect(client.communities$.value.length).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP - 1);

    const community = await client.createNewCommunity("the-cap-th", "d", ["wss://fake"]);
    expect(client.communities$.value.length).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);
    expect(client.communities$.value.map((c) => c.material.community_id)).toContain(community.communityId);

    client.stop();
  }, 30_000);

  it("D-06: the cap counts LIVE memberships only — neither tombstoned entries nor duplicate raw array entries for an already-counted live community consume the budget, so a document with a raw entry count AT the cap but only 40 DISTINCT live memberships still admits a new join", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    // 40 DISTINCT live communities — well under the cap on its own (40+1 <=
    // 50). Two ways the raw `entries` array can outgrow the true membership
    // count without adding a new membership, both deliberately present so
    // this test is non-vacuous against `this.list.length` as a stand-in for
    // `liveCommunities(...).length` (a raw-length guard would wrongly refuse
    // here): (a) 10 of the 40 carry a SECOND raw entry (a re-join history —
    // `liveCommunities` dedupes by community_id, keeping the newest), and
    // (b) 15 separate communities are tombstoned dead (pruned from `this.list`
    // during `reconcileCommunities` before `recordJoin` is ever reached, but
    // still present in the raw document `loadMirror` first merges).
    const liveEntries = await mkLiveEntries(pubkey, 40);
    const duplicated = liveEntries.slice(0, 10).map((e) => ({ ...e, added_at: e.added_at + 1 }));
    const deadEntries = await mkLiveEntries(pubkey, 15);
    const tombstones = deadEntries.map((e) => ({ community_id: e.community_id, removed_at: Date.now() + 1 }));
    const entries = [...liveEntries, ...duplicated, ...deadEntries];
    await storage.setItem(pubkey, JSON.stringify({ entries, tombstones }));

    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();
    // 40 distinct live engines started; the 10 duplicates collapse to their
    // one community_id each, and the 15 dead communities never get an engine.
    expect(client.communities$.value.length).toBe(40);

    const community = await client.createNewCommunity("still-room", "d", ["wss://fake"]);
    expect(client.communities$.value.map((c) => c.material.community_id)).toContain(community.communityId);

    client.stop();
  }, 30_000);

  it("D-06: merged overflow from another device is TOLERATED — loadMirror merges a document already past the cap, neither throwing nor discarding an entry", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool } = fakePool();
    const storage = memoryStorage();
    const overCapCount = CORD_COMMUNITY_LIST_MEMBERSHIP_CAP + 5;
    const entries = await mkLiveEntries(pubkey, overCapCount);
    await storage.setItem(pubkey, JSON.stringify({ entries, tombstones: [] }));

    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    // start() must not throw and must not silently drop any of the merged, over-cap memberships.
    await expect(client.start()).resolves.toBeUndefined();
    expect(client.communities$.value.length).toBe(overCapCount);

    client.stop();
  }, 30_000);
});

// ── Gap closure (D-07/D-08; 12-05): the Community List's whole-document byte
// figure (LIST_MAX_BYTES) is now a diagnostic reference only — an oversized
// document publishes rather than being withheld.
describe("ConcordClient saveCommunityList — an oversized Community List publishes (D-07/D-08, 12-05)", () => {
  it("a document whose serialized size exceeds the historical reference figure still publishes, with the size trace still emitted", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const { log, calls } = spyLogger();

    // Enough tombstones alone to push the serialized document past LIST_MAX_BYTES — derived from
    // the surviving reference constant, never guessed, and never anchored to a NIP-44 spec value
    // (D-21): LIST_MAX_BYTES is a historical CORD-02 §8 figure, not today's NIP-44 ceiling.
    const baseline = communityListByteSize([], []);
    const perTombstoneBytes = communityListByteSize([], [{ community_id: "x".repeat(64), removed_at: 1 }]) - baseline;
    const tombstoneCount = Math.ceil((LIST_MAX_BYTES - baseline) / perTombstoneBytes) + 10;
    const tombstones = Array.from({ length: tombstoneCount }, (_, i) => ({
      community_id: `${"t".repeat(60)}${i}`,
      removed_at: i,
    }));
    expect(communityListByteSize([], tombstones)).toBeGreaterThan(LIST_MAX_BYTES);
    await storage.setItem(pubkey, JSON.stringify({ entries: [], tombstones }));

    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      logger: log,
    });
    await client.start();
    await settle();
    await client.saveCommunityList();

    expect(listPublishes(published).length).toBe(1);
    const sizeTraceMessage = calls
      .map((c) => format(...(c as [unknown, ...unknown[]])))
      .find((m) => m.includes("community list size trace"));
    expect(sizeTraceMessage).toBeDefined();

    client.stop();
  });
});

// ── Gap closure (WR4-01, 12.3-14): a behavioral test that ConcordClient.handleRemoved's
// prune fires, at that position, on the real onRemoved wiring, rather than being pinned
// only by grep/adjacent coverage (12.3-13-SUMMARY.md's WR-08 note). Reachability
// confirmed by reading the source directly before writing this test: client.ts wires
// `onRemoved: (removed) => this.handleRemoved(removed)` into ConcordCommunity's option
// bag (addCommunity); ConcordCommunity.handleRemoved() is what invokes that callback;
// and both real exclusion paths — start()'s `walk.removed` branch and the live rekey
// fold's "removed" outcome — call that same method. Everything downstream of the
// synthetic trigger below (phase$, dispose(), onRemoved, ConcordClient.handleRemoved,
// pruneDeadEntries, saveMirror) is therefore the unmodified production path.
describe("ConcordClient handleRemoved — an involuntary removal prunes the dead entry's bytes (WR4-01, 12.3-14)", () => {
  it("an engine's own removal handler drives the client's prune: the dead entry's BYTES leave the mirror and the published document, while the surviving membership is untouched", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, published } = fakePool();
    const storage = memoryStorage();
    const client = new ConcordClient({ signer, pool, eventStore: new EventStore(), storage, relays: ["wss://fake"] });
    await client.start();

    const surviving = await client.createNewCommunity("Surviving", "hi", ["wss://fake"]);
    const doomed = await client.createNewCommunity("Doomed", "hi", ["wss://fake"]);
    const survivingCid = surviving.communityId;
    const doomedCid = doomed.communityId;
    await settle();

    // Setup sanity BEFORE the removal, so the test cannot pass by never having
    // wired anything: both lookups are defined, and the last published 13302's
    // decrypted entries map to exactly the two ids the test itself created —
    // derived from the two `communityId` values, never from reading back what
    // the client happens to hold.
    expect(client.getCommunity(survivingCid)).toBeDefined();
    expect(client.getCommunity(doomedCid)).toBeDefined();
    const preDoc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(new Set(preDoc.entries.map((e: { community_id: string }) => e.community_id))).toEqual(
      new Set([survivingCid, doomedCid]),
    );

    const publishCountBefore = listPublishes(published).length;

    // Drive the removal through the real wiring: this is the exact method
    // community.ts:553 (start()'s walk.removed branch) and community.ts:968
    // (the live rekey fold's "removed" outcome) both call.
    const doomedCommunity = client.getCommunity(doomedCid)!;
    (doomedCommunity as unknown as { handleRemoved: () => void }).handleRemoved();

    // handleRemoved flags dirty rather than publishing inline (its own doc
    // comment states this; the auto-save debounce is 200ms) — assert this
    // SYNCHRONOUSLY, before any await, so it cannot race the debounce.
    expect(listPublishes(published).length).toBe(publishCountBefore);

    await settle();

    // Mirror assertion: pins the prune's POSITION (before saveMirror) — the
    // specific property WR4-01 says is untested.
    const mirrorRaw = await storage.getItem(pubkey);
    const mirror = JSON.parse(mirrorRaw!) as {
      entries: Array<{ community_id: string }>;
      tombstones: Array<{ community_id: string }>;
    };
    expect(mirror.entries.map((e) => e.community_id)).toEqual([survivingCid]);
    expect(mirror.tombstones.some((t) => t.community_id === doomedCid)).toBe(true);
    expect(JSON.stringify(mirror.entries)).not.toContain(doomedCid);
    expect(client.getCommunity(doomedCid)).toBeUndefined();
    expect(client.getCommunity(survivingCid)).toBeDefined();

    // After an explicit saveCommunityList(), the published document carries
    // the same three facts.
    await client.saveCommunityList();
    const finalDoc = JSON.parse(await signer.nip44!.decrypt(pubkey, listPublishes(published).at(-1)!.content));
    expect(finalDoc.entries.map((e: { community_id: string }) => e.community_id)).toEqual([survivingCid]);
    expect(JSON.stringify(finalDoc.entries)).not.toContain(doomedCid);
    expect(finalDoc.tombstones.some((t: { community_id: string }) => t.community_id === doomedCid)).toBe(true);

    client.stop();
  });
});
