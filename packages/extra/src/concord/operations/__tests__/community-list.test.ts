import { describe, expect, it } from "vitest";

import { joinCommunity, leaveCommunity, refreshCommunity } from "../community-list.js";
import type { CommunityListCommunity, JoinMaterial } from "../../types.js";

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

const mkCommunity = (id: string, epoch = 1, at = 1): CommunityListCommunity => ({
  community_id: id,
  seed: material(id, epoch),
  current: material(id, epoch),
  added_at: at,
});

describe("community list operations", () => {
  it("joinCommunity merges a membership, leaving tombstones untouched", () => {
    const next = joinCommunity(mkCommunity("a"))([], []);
    expect(next.communities.map((c) => c.community_id)).toEqual(["a"]);
    expect(next.tombstones).toEqual([]);
  });

  it("leaveCommunity unions a tombstone, leaving communities untouched", () => {
    const communities = joinCommunity(mkCommunity("a"))([], []).communities;
    const next = leaveCommunity("a", 5)(communities, []);
    expect(next.communities.map((c) => c.community_id)).toEqual(["a"]);
    expect(next.tombstones).toEqual([{ community_id: "a", removed_at: 5 }]);
  });

  it("refreshCommunity replaces the current snapshot in place, ignoring absent memberships", () => {
    const communities = [mkCommunity("a", 1, 1)];
    const refreshed = refreshCommunity(material("a", 2))(communities, []);
    expect(refreshed.communities[0].current.root_epoch).toBe(2);
    // seed is left alone (still the earliest epoch).
    expect(refreshed.communities[0].seed.root_epoch).toBe(1);
    // An unknown community is a no-op.
    expect(refreshCommunity(material("missing"))(communities, []).communities).toEqual(communities);
  });
});
