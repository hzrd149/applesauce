import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import "applesauce-common/casts";
import { castUser } from "applesauce-core/casts";

import "../community-list.js";
import { COMMUNITY_LIST_KIND, mergeCommunities } from "../../helpers/community-list.js";
import { material } from "./fixtures.js";

describe("community list cast", () => {
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

  it("exposes a reactive liveCommunities$ chain that emits on unlock", async () => {
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
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: communities, tombstones: [] }));
    const event = await signer.signEvent({ kind: COMMUNITY_LIST_KIND, content, tags: [], created_at: 1 });
    store.add(event);

    const user = castUser(pubkey, store);
    const communityList = await user.concordCommunityList$.$first();

    const emissions: (unknown[] | undefined)[] = [];
    const sub = communityList.liveCommunities$.subscribe((value) => emissions.push(value));

    // Locked: emits undefined until the list is unlocked.
    expect(emissions).toEqual([undefined]);

    await communityList.unlock(signer);

    // Unlock notifies the event, re-emitting the decrypted live memberships.
    expect((emissions.at(-1) as { community_id: string }[])?.map((c) => c.community_id)).toEqual(["community-1"]);
    sub.unsubscribe();
  });
});
