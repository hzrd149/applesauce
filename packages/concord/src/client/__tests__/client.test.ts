// ConcordClient over a dependency-injected EventStore/RelayPool — no network.
// Exercises the Community List (kind 13302) cast wiring: the client exposes
// `communityList$`, and `autoUnlock` decides whether the user-signer decryption is
// issued automatically or left for the app to trigger via the cast's `.unlock()`.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, filter, firstValueFrom } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import "applesauce-common/casts";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "applesauce-core/helpers/event";

import { ConcordClient } from "../client.js";
import type { ConcordCommunityList } from "../../casts/index.js";
import { memoryStorage } from "../storage.js";
import { COMMUNITY_LIST_KIND, mergeCommunities } from "../../helpers/community-list.js";
import { createCommunity } from "../../helpers/community.js";
import type { ConcordClientStatus, JoinMaterial } from "../../types.js";

const settle = () => new Promise((r) => setTimeout(r, 200));

// A RelayPool stand-in whose per-relay methods are inert (no sockets) — the client's
// list fetch (`request`) completes empty; we feed the 13302 into the store by hand.
// `publish` records every event so tests can count kind-13302 republishes.
function fakePool(
  opts: { challenge?: string } = {},
): { pool: RelayPool; published: NostrEvent[]; authenticatedPubkeys: string[] } {
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

  const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", description: "hi", relays: ["wss://fake"] });
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
  const client = new ConcordClient({ signer, pool, eventStore: store, storage: memoryStorage(), relays: ["wss://fake"] });
  return { signer, pubkey, decrypt, genesis, cid, listEvent, store, client, pool, published };
}

const firstList = (client: ConcordClient) =>
  firstValueFrom(client.communityList$.pipe(filter((c): c is ConcordCommunityList => !!c)));

const listPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === COMMUNITY_LIST_KIND);

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
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", description: "hi", relays: ["wss://fake"] });
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

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", description: "hi", relays: ["wss://fake"] });
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
    const client = new ConcordClient({ signer, pool, eventStore: store, storage, relays: ["wss://fake"], autoUnlock: true });

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
