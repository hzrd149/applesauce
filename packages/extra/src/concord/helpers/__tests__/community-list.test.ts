import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import {
  communityListWithinByteCap,
  COMMUNITY_LIST_KIND,
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
import type { CommunityTombstone, JoinMaterial } from "../../types.js";

describe("community-list CRDT", () => {
  const mkCommunity = (id: string, epoch: number, at: number) => ({
    community_id: id,
    seed: { community_id: id, owner: "o", owner_salt: "s", community_root: "r", root_epoch: epoch, channels: [], relays: [], name: id },
    current: { community_id: id, owner: "o", owner_salt: "s", community_root: "r", root_epoch: epoch, channels: [], relays: [], name: id },
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
    expect(communityListWithinByteCap(communities, tombstones)).toBe(true);
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
  const relock = (event: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }) => ({
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
