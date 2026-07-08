import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import "applesauce-common/casts";
import { castUser } from "applesauce-core/casts";

import "../casts/community-list.js";
import "../casts/invite-list.js";
import { COMMUNITY_LIST_KIND, mergeCommunities } from "../helpers/community-list.js";
import { INVITE_LIST_KIND, mergeInvites } from "../helpers/invite-list.js";
import type { JoinMaterial } from "../types.js";

function material(id: string): JoinMaterial {
  return {
    community_id: id,
    owner: "owner",
    owner_salt: "salt",
    community_root: "root",
    root_epoch: 1,
    channels: [],
    relays: ["wss://relay.example"],
    name: "Test Community",
  };
}

describe("Concord casts", () => {
  it("adds a user concordCommunityList$ getter that can unlock live memberships", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const store = new EventStore();
    const communities = mergeCommunities(
      [],
      [
        {
          community_id: "community-1",
          seed: material("community-1"),
          current: material("community-1"),
          added_at: 1,
        },
      ],
    );
    // The wire document keys the array as `entries`; the parsed result exposes `communities`.
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
    const event = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });

    store.add(event);

    const user = castUser(pubkey, store);
    const communityList = await user.concordCommunityList$.$first();

    expect(communityList.unlocked).toBe(false);
    await expect(communityList.unlock(signer)).resolves.toEqual({ communities, tombstones: [] });
    expect(communityList.unlocked).toBe(true);
    expect(communityList.communities?.map((community) => community.community_id)).toEqual(["community-1"]);
    expect(communityList.tombstones).toEqual([]);
    expect(communityList.liveCommunities?.map((community) => community.community_id)).toEqual(["community-1"]);
  });

  it("adds a user concordInviteList$ getter that can unlock live invite links", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const store = new EventStore();
    const invites = mergeInvites(
      [],
      [
        {
          token: "token-1",
          signer_sk: "sk-1",
          community_id: "community-1",
          url: "https://example.com/invite/token-1",
          created_at: 1,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: invites, tombstones: [] }));
    const event = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });

    store.add(event);

    const user = castUser(pubkey, store);
    const inviteList = await user.concordInviteList$.$first();

    expect(inviteList.unlocked).toBe(false);
    await expect(inviteList.unlock(signer)).resolves.toEqual({ invites, tombstones: [] });
    expect(inviteList.unlocked).toBe(true);
    expect(inviteList.invites?.map((entry) => entry.token)).toEqual(["token-1"]);
    expect(inviteList.tombstones).toEqual([]);
    expect(inviteList.liveInvites?.map((entry) => entry.token)).toEqual(["token-1"]);
  });
});
