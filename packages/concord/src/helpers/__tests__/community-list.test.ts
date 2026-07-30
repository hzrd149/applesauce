import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import * as CommunityListModule from "../community-list.js";
import {
  communityListByteSize,
  communityListEntryByteSize,
  COMMUNITY_LIST_KIND,
  COMMUNITY_LIST_MAX_MEMBERSHIPS,
  LIST_MAX_BYTES,
  getCommunityList,
  getLiveCommunities,
  isCommunityListUnlocked,
  isCommunityLive,
  isValidCommunityList,
  mergeCommunities,
  mergeCommunityTombstones,
  unlockCommunityList,
} from "../community-list.js";
import { CommunityListFactory } from "../../factories/community-list.js";
import type { CommunityListCommunity, CommunityTombstone, JoinMaterial } from "../../types.js";
import {
  CORD_COMMUNITY_LIST_CAP_SENTENCE,
  CORD_COMMUNITY_LIST_MEMBERSHIP_CAP,
} from "../../__tests__/cord-wire-fixtures.js";

describe("community-list CRDT", () => {
  const mkCommunity = (id: string, epoch: number, at: number) => ({
    community_id: id,
    seed: {
      community_id: id,
      owner: "o",
      owner_salt: "s",
      community_root: "r",
      root_epoch: epoch,
      channels: [],
      relays: [],
      name: id,
    },
    current: {
      community_id: id,
      owner: "o",
      owner_salt: "s",
      community_root: "r",
      root_epoch: epoch,
      channels: [],
      relays: [],
      name: id,
    },
    added_at: at,
  });

  it("community merge is commutative and idempotent", () => {
    const a = mergeCommunities([], [mkCommunity("x", 1, 100)]);
    const b = mergeCommunities([], [mkCommunity("y", 1, 200)]);
    const ab = mergeCommunities(a, b);
    const ba = mergeCommunities(b, a);
    expect(ab).toEqual(ba);
    expect(mergeCommunities(ab, ab)).toEqual(ab);
  });

  it("tombstone merge keeps the newest removal", () => {
    const a = mergeCommunityTombstones([], [{ community_id: "x", removed_at: 100 }]);
    const b = mergeCommunityTombstones([], [{ community_id: "x", removed_at: 200 }]);
    expect(mergeCommunityTombstones(a, b)).toEqual([{ community_id: "x", removed_at: 200 }]);
  });

  it("liveness: leave kills, later re-join resurrects", () => {
    let communities = mergeCommunities([], [mkCommunity("x", 1, 100)]);
    let tombstones: CommunityTombstone[] = [];
    expect(isCommunityLive(communities, tombstones, "x")).toBe(true);
    tombstones = mergeCommunityTombstones(tombstones, [{ community_id: "x", removed_at: 200 }]);
    expect(isCommunityLive(communities, tombstones, "x")).toBe(false);
    communities = mergeCommunities(communities, [mkCommunity("x", 2, 300)]);
    expect(isCommunityLive(communities, tombstones, "x")).toBe(true);
    // D-07: no serialized-byte cap is enforced anymore — this small fixture is
    // still comfortably under the historical reference figure, which is all
    // that remains to check here.
    expect(communityListByteSize(communities, tombstones)).toBeLessThanOrEqual(LIST_MAX_BYTES);
  });
});

// ── Gap closure (WR-04, D-06, D-07, D-08; 12.3-13 -> 12-05): one shared
// serialized-byte measurement (diagnostic-only, D-08) and the 50-membership
// protocol constant that is now the document's ONLY bound (D-06/D-07).
describe("communityListByteSize / communityListEntryByteSize / COMMUNITY_LIST_MAX_MEMBERSHIPS (12-05)", () => {
  const mkCommunity = (id: string, epoch: number, at: number): CommunityListCommunity => ({
    community_id: id,
    seed: {
      community_id: id,
      owner: "o",
      owner_salt: "s",
      community_root: "r",
      root_epoch: epoch,
      channels: [],
      relays: [],
      name: id,
    },
    current: {
      community_id: id,
      owner: "o",
      owner_salt: "s",
      community_root: "r",
      root_epoch: epoch,
      channels: [],
      relays: [],
      name: id,
    },
    added_at: at,
  });

  it("communityListByteSize returns the exact independently-measured serialized length of the wire document shape", () => {
    const communities = [mkCommunity("x", 1, 100)];
    const tombstones: CommunityTombstone[] = [{ community_id: "y", removed_at: 5 }];
    // Independent measurement of the SAME wire shape — never calling the
    // helper twice (TEST-01).
    const expected = new TextEncoder().encode(JSON.stringify({ entries: communities, tombstones })).length;
    expect(communityListByteSize(communities, tombstones)).toBe(expected);
  });

  // D-07/D-10: the removal must be permanent, not just a passing test suite that
  // happens not to call the deleted symbols. A structural guard over the module's
  // own export key set means a future reader cannot reintroduce a serialized-byte
  // gate by restoring `communityListWithinByteCap` or `COMMUNITY_LIST_MAX_ENTRY_BYTES`
  // without this test failing — and D-08's carve-out (LIST_MAX_BYTES plus both
  // measurement helpers survive, diagnostics only) is pinned in the same assertion.
  it("the module's exports no longer include a within-cap predicate or a per-entry ceiling, but still expose the diagnostic-only measurement helpers", () => {
    const keys = Object.keys(CommunityListModule);
    expect(keys).not.toContain("communityListWithinByteCap");
    expect(keys).not.toContain("COMMUNITY_LIST_MAX_ENTRY_BYTES");
    expect(keys).toContain("communityListByteSize");
    expect(keys).toContain("communityListEntryByteSize");
    expect(keys).toContain("LIST_MAX_BYTES");
    expect(keys).toContain("COMMUNITY_LIST_MAX_MEMBERSHIPS");
  });

  // D-06/D-21/TEST-01: transcribed spec literal, asserted against the vendored
  // fixture transcription — never against the source constant's own expression.
  it("COMMUNITY_LIST_MAX_MEMBERSHIPS equals the vendored CORD-02 §8 transcription", () => {
    // CORD_COMMUNITY_LIST_CAP_SENTENCE is the verbatim spec passage this cap is
    // transcribed from; CORD_COMMUNITY_LIST_MEMBERSHIP_CAP is the `50` parsed
    // back out of it by cord-wire-fixtures.test.ts's own self-test.
    expect(CORD_COMMUNITY_LIST_CAP_SENTENCE).toContain("50 memberships");
    expect(COMMUNITY_LIST_MAX_MEMBERSHIPS).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);
  });

  it("communityListEntryByteSize measures the entry shape including BOTH material copies (seed and current)", () => {
    const entry: CommunityListCommunity = mkCommunity("x", 1, 100);
    const expected = new TextEncoder().encode(JSON.stringify(entry)).length;
    expect(communityListEntryByteSize(entry)).toBe(expected);
    // Non-vacuity: the entry's `seed` and `current` are DISTINCT keys in the
    // serialized shape — an entry-size function that measured only one of
    // them would undercount by roughly half.
    const entryBothCopiesRemoved = { ...entry, seed: {} as JoinMaterial, current: {} as JoinMaterial };
    expect(communityListEntryByteSize(entryBothCopiesRemoved)).toBeLessThan(expected);
  });
});

describe("community-list event helpers", () => {
  const material = (id: string, epoch = 1): JoinMaterial => ({
    community_id: id,
    owner: "o",
    owner_salt: "s",
    community_root: "r",
    root_epoch: epoch,
    channels: [],
    relays: [],
    name: id,
  });

  // Rebuild an event stripped of the in-memory plaintext cache (a wire-fresh, locked copy).
  const relock = (event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }) => ({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  });

  it("isValidCommunityList only matches the community list kind", () => {
    expect(isValidCommunityList({ kind: COMMUNITY_LIST_KIND } as any)).toBe(true);
    expect(isValidCommunityList({ kind: 1 } as any)).toBe(false);
  });

  it("a locked event reads as locked with no parsed list", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await CommunityListFactory.create()
      .join({ community_id: "cid", seed: material("cid"), current: material("cid"), added_at: 1 })
      .sign(signer);

    const locked = relock(event);
    expect(isCommunityListUnlocked(locked)).toBe(false);
    expect(getCommunityList(locked)).toBeUndefined();
    expect(getLiveCommunities(locked)).toBeUndefined();
  });

  it("unlockCommunityList decrypts, parses, and derives live communities", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const created = await CommunityListFactory.create()
      .join({ community_id: "a", seed: material("a"), current: material("a"), added_at: 1 })
      .leave("a", 5)
      .sign(signer);
    const withRejoin = await CommunityListFactory.modify(created)
      .join({ community_id: "a", seed: material("a", 2), current: material("a", 2), added_at: 10 })
      .join({ community_id: "b", seed: material("b"), current: material("b"), added_at: 2 })
      .sign(signer);

    const event = relock(withRejoin);
    expect(isCommunityListUnlocked(event)).toBe(false);
    const parsed = await unlockCommunityList(event, signer);
    expect(isCommunityListUnlocked(event)).toBe(true);
    expect(parsed.communities.map((e) => e.community_id).sort()).toEqual(["a", "b"]);
    expect(parsed.tombstones.map((t) => t.community_id)).toEqual(["a"]);

    // "a" was left then re-joined (resurrects), "b" is a plain join.
    const live = getLiveCommunities(event)!;
    expect(live.map((e) => e.community_id).sort()).toEqual(["a", "b"]);
    // getCommunityList returns the cached parse after unlock.
    expect(getCommunityList(event)).toEqual(parsed);
  });
});
