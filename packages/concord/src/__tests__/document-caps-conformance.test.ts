// Cross-cutting document-caps conformance suite (WIRE-09/D-23).
//
// Every other round-trip test in this package proves the wire discipline at
// the parse/factory/operations tier — a self-encrypted document parses open
// (`ParsedCommunityList`/`ParsedInviteList` both carry an index signature) and
// a factory-level edit spreads the parsed root before assigning known fields.
// None of that machinery has a call site under `client/*.ts`. `ConcordClient`
// and `ConcordInviteManager` each hold a reduced in-memory projection (two
// merged arrays) and re-serialize the wire document from that projection at
// publish time — a round trip driven only through the factory/operations
// chain never exercises either shipped publish path, so it would pass even if
// that publish path stayed lossy. `concord-audit.md`'s L07 already named both
// client sites; D-12's decision prose under-enumerated them, which is why
// D-23 makes the client tier explicitly in-scope for WIRE-09, and why this
// suite exists as a sibling to (not a merge with) `cord-citations.test.ts`.
//
// CORD_ROUND_TRIP_SENTENCE / CORD-02 §6 states the round-trip MUST for the
// Community List; CORD-05 §4 restates it for the Invite List. Every
// assertion below reads the DECRYPTED, `JSON.parse`d published plaintext —
// never through this package's own document-parsing helpers, which would
// apply the identical open-object transformation on both the write and the
// read side and could hide a regression at the publish site behind an
// equally-lossy read.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { RelayPool } from "applesauce-relay";
import type { NostrEvent } from "applesauce-core/helpers/event";

import { ConcordClient } from "../client/client.js";
import { memoryStorage, type ConcordStorage } from "../client/storage.js";
import { COMMUNITY_LIST_KIND, mergeCommunities } from "../helpers/community-list.js";
import { INVITE_LIST_KIND } from "../helpers/invite-list.js";
import { createCommunity } from "../helpers/community.js";
import { CORD_ROUND_TRIP_SENTENCE } from "./cord-wire-fixtures.js";
import type { InviteListInvite, JoinMaterial } from "../types.js";

const settle = () => new Promise((r) => setTimeout(r, 200));

// A RelayPool stand-in whose per-relay methods are inert (no sockets) — every fetch
// (`request`) completes empty, and `publish` records every event so the suite can decrypt
// whatever ConcordClient/ConcordInviteManager actually put on the wire. Replicated from
// `client/__tests__/client.test.ts`'s own `fakePool` (not exported, so minimally reproduced
// here rather than reached into with a relative import across test directories).
function fakePool(): { pool: RelayPool; published: NostrEvent[] } {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => true,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  const published: NostrEvent[] = [];
  const pool = {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    },
  } as unknown as RelayPool;
  return { pool, published };
}

const listPublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === COMMUNITY_LIST_KIND);
const invitePublishes = (published: NostrEvent[]) => published.filter((e) => e.kind === INVITE_LIST_KIND);

/** A future-protocol-reading scalar key, plus a nested `custom` object — CORD-02 §6 reserves
 *  top-level fields outside `custom` for the protocol itself (so an unknown top-level scalar
 *  reads as forward compatibility), while `custom` is explicitly where another client's own
 *  extension data lives (D-13's spec nuance) — both survive, for different reasons. */
function unknownDocumentFields() {
  return {
    protocol_next_revision: 7,
    custom: { app: "acme-concord-client", note: "unrecognized nested payload", tags: ["a", "b"] },
  };
}

async function buildGenesisEntry(ownerPubkey: string) {
  const genesis = await createCommunity({
    ownerPubkey,
    name: "Conformance Test Community",
    description: "seed",
    relays: ["wss://fake"],
  });
  const cid = genesis.material.community_id;
  // Mirror the normalized material shape the community engine derives, matching the
  // established client.test.ts convention.
  const material: JoinMaterial = { ...genesis.material, held_roots: genesis.material.held_roots ?? [] };
  const entry = { community_id: cid, seed: material, current: material, added_at: 1 };
  return { cid, entry };
}

/** Seeds a relay-copy Community List document (entries + tombstones + two unrecognized
 *  top-level keys), starts a client against it with autoUnlock, waits for the merge, then
 *  performs a real membership mutation (`createNewCommunity`) through the client's own public
 *  API — which itself calls `saveCommunityList` — and returns the decrypted, `JSON.parse`d
 *  published plaintext plus the ids involved. */
async function seedRelayCopyAndMutate() {
  const signer = new PrivateKeySigner(generateSecretKey());
  const pubkey = await signer.getPublicKey();
  const { cid: seededCid, entry } = await buildGenesisEntry(pubkey);
  const communities = mergeCommunities([], [entry]);
  const unknownFields = unknownDocumentFields();
  const seededDocument = { entries: communities, tombstones: [], ...unknownFields };
  const content = await signer.nip44!.encrypt(pubkey, JSON.stringify(seededDocument));
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
    watchDirectInvites: false,
  });

  await client.start();
  store.add(listEvent as NostrEvent);
  await settle(); // watchLists merges + captures documentExtras from the seeded document

  const mutated = await client.createNewCommunity("New Conformance Community", "mutated", ["wss://fake"]);
  await settle();

  const publishedEvent = listPublishes(published).at(-1);
  expect(publishedEvent).toBeDefined();
  const plaintext = await signer.nip44!.decrypt(pubkey, publishedEvent!.content);
  const parsed = JSON.parse(plaintext) as Record<string, unknown>;

  client.stop();
  return { parsed, seededCid, mutatedCid: mutated.communityId, unknownFields };
}

describe("document round-trip conformance through ConcordClient (WIRE-09/D-23)", () => {
  it("Test A: unrecognized top-level keys survive a full read -> merge -> mutate -> publish cycle", async () => {
    const { parsed, unknownFields } = await seedRelayCopyAndMutate();

    expect(parsed.protocol_next_revision).toBe(unknownFields.protocol_next_revision);
    // Deep equality on the nested `custom` object catches a shallow-copy bug that flattens
    // nested structure rather than preserving it verbatim.
    expect(parsed.custom).toEqual(unknownFields.custom);
  });

  it("Test B: the membership mutation actually landed in the published plaintext", async () => {
    const { parsed, mutatedCid } = await seedRelayCopyAndMutate();

    const entries = parsed.entries as Array<{ community_id: string }>;
    expect(entries.some((e) => e.community_id === mutatedCid)).toBe(true);
  });

  it("Test C: preserved keys cannot shadow the client's merged entries", async () => {
    // The seeded relay copy's `entries` field (one community) is exactly what got captured
    // into the client's snapshot at read time. After the mutation below, the client's OWN
    // merged state grows by one more community — genuinely inconsistent with that captured
    // snapshot's stale, single-entry `entries` value (a different community id set, not
    // merely a different array ordering). The published `entries` must reflect the CURRENT
    // merged state, never the stale captured snapshot — this pins the spread-first ordering
    // at ConcordClient.saveCommunityList's write site.
    const { parsed, seededCid, mutatedCid } = await seedRelayCopyAndMutate();

    const entries = parsed.entries as Array<{ community_id: string }>;
    const ids = entries.map((e) => e.community_id).sort();
    expect(ids).toEqual([seededCid, mutatedCid].sort());
  });

  it("Test D: a mirror-only publish (no relay copy ever fetched this session) still preserves an unrecognized key", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { entry } = await buildGenesisEntry(pubkey);
    const communities = mergeCommunities([], [entry]);
    const unknownFields = unknownDocumentFields();

    const storage: ConcordStorage = memoryStorage();
    // Seed the LOCAL MIRROR directly (D-25) — the relay never serves anything this session
    // (fakePool's `request` always resolves empty), so `saveCommunityList`'s only source for
    // this unrecognized key is what `loadMirror` captured at startup.
    await storage.setItem(pubkey, JSON.stringify({ entries: communities, tombstones: [], ...unknownFields }));

    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: new EventStore(),
      storage,
      relays: ["wss://fake"],
      autoUnlock: true,
      watchDirectInvites: false,
    });

    await client.start();
    await settle();

    const mutated = await client.createNewCommunity("Mirror-only Mutation", "mutated", ["wss://fake"]);
    await settle();

    const publishedEvent = listPublishes(published).at(-1);
    expect(publishedEvent).toBeDefined();
    const plaintext = await signer.nip44!.decrypt(pubkey, publishedEvent!.content);
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;

    expect(parsed.protocol_next_revision).toBe(unknownFields.protocol_next_revision);
    expect(parsed.custom).toEqual(unknownFields.custom);
    const entries = parsed.entries as Array<{ community_id: string }>;
    expect(entries.some((e) => e.community_id === mutated.communityId)).toBe(true);

    client.stop();
  });

  it("Test E: the Invite List round-trips unrecognized keys through ConcordInviteManager's own read-and-save cycle", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();

    const seededInvite: InviteListInvite = {
      token: "a".repeat(32),
      signer_sk: bytesToHex(generateSecretKey()),
      community_id: "seeded-community",
      url: "https://example.com/invite#seeded",
      created_at: 1,
    };
    const unknownFields = unknownDocumentFields();
    const seededDocument = { entries: [seededInvite], tombstones: [], ...unknownFields };
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify(seededDocument));
    const listEvent = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });

    const store = new EventStore();
    const { pool, published } = fakePool();
    const client = new ConcordClient({
      signer,
      pool,
      eventStore: store,
      storage: memoryStorage(),
      relays: ["wss://fake"],
      autoUnlock: true,
      watchDirectInvites: false,
    });

    await client.start();
    store.add(listEvent as NostrEvent);
    await settle(); // ConcordInviteManager.reconcile merges + captures documentExtras

    // A real mutation through the invite manager's own public API — mints a new record and
    // publishes, mirroring `record()`'s role for the Invite List the way `createNewCommunity`
    // does for the Community List.
    const mintedInvite: InviteListInvite = {
      token: "b".repeat(32),
      signer_sk: bytesToHex(generateSecretKey()),
      community_id: "minted-community",
      url: "https://example.com/invite#minted",
      created_at: 2,
    };
    await client.invites.record(mintedInvite);
    await settle();

    const publishedEvent = invitePublishes(published).at(-1);
    expect(publishedEvent).toBeDefined();
    const plaintext = await signer.nip44!.decrypt(pubkey, publishedEvent!.content);
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;

    expect(parsed.protocol_next_revision).toBe(unknownFields.protocol_next_revision);
    expect(parsed.custom).toEqual(unknownFields.custom);
    const entries = parsed.entries as Array<{ token: string }>;
    expect(entries.some((e) => e.token === mintedInvite.token)).toBe(true);
    expect(entries.some((e) => e.token === seededInvite.token)).toBe(true);

    client.stop();
  });

  it("Test F: the wire key set is right — entries/tombstones present, no renamed alias", async () => {
    const { parsed } = await seedRelayCopyAndMutate();

    const keys = Object.keys(parsed);
    expect(keys).toContain("entries");
    expect(keys).toContain("tombstones");
    // Pre-D-12 in-memory vocabulary named this array `communities`; the wire document has
    // never used that name, and this pins that no client-tier code accidentally publishes it.
    expect(keys).not.toContain("communities");
  });

  it("cites CORD-02 §6's round-trip MUST as the authority for this suite's premise", () => {
    expect(CORD_ROUND_TRIP_SENTENCE).toContain("round-trip");
  });
});
