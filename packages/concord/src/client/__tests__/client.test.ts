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
import type { JoinMaterial } from "../../types.js";

const settle = () => new Promise((r) => setTimeout(r, 200));

// A RelayPool stand-in whose per-relay methods are inert (no sockets) — the client's
// list fetch (`request`) completes empty; we feed the 13302 into the store by hand.
function fakePool(): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: async () => [],
  } as unknown as RelayPool;
}

// A real genesis community + the self-encrypted 13302 that lists it as a live membership.
async function setup() {
  const signer = new PrivateKeySigner(generateSecretKey());
  const pubkey = await signer.getPublicKey();
  const decrypt = vi.spyOn(signer.nip44!, "decrypt");

  const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", description: "hi", relays: ["wss://fake"] });
  const cid = genesis.material.community_id;
  const communities = mergeCommunities([], [{ community_id: cid, seed: genesis.material, current: genesis.material, added_at: 1 }]);
  // Wire document keys the array as `entries`; the parsed cast exposes `communities`.
  const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
  const listEvent = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });

  const store = new EventStore();
  const pool = fakePool();
  const client = new ConcordClient({ signer, pubkey, pool, eventStore: store, storage: memoryStorage(), relays: ["wss://fake"] });
  return { signer, pubkey, decrypt, genesis, cid, listEvent, store, client };
}

const firstList = (client: ConcordClient) =>
  firstValueFrom(client.communityList$.pipe(filter((c): c is ConcordCommunityList => !!c)));

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
    const pool = fakePool();
    const client = new ConcordClient({
      signer,
      pubkey,
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
});
