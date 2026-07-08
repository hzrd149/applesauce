import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { COMMUNITY_LIST_KIND } from "../../helpers/community-list.js";
import type { JoinMaterial } from "../../types.js";
import { CommunityListFactory } from "../community-list.js";
import { joinCommunity, leaveCommunity } from "../../operations/community-list.js";

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

describe("CommunityListFactory", () => {
  it("create with a join encrypts the list to self and round-trips", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const event = await CommunityListFactory.create()
      .join({ community_id: "cid", seed: material("cid"), current: material("cid"), added_at: 1 })
      .sign(signer);

    expect(event.kind).toBe(COMMUNITY_LIST_KIND);
    expect(event.tags).toEqual([]);
    const plaintext = await signer.nip44!.decrypt(pubkey, event.content);
    const doc = JSON.parse(plaintext);
    expect(doc.entries.map((e: { community_id: string }) => e.community_id)).toEqual(["cid"]);
    expect(doc.tombstones).toEqual([]);
  });

  it("modify merges an atomic join into the existing document without a full object", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const first = await CommunityListFactory.create()
      .join({ community_id: "a", seed: material("a"), current: material("a"), added_at: 1 })
      .sign(signer);

    const updated = await CommunityListFactory.modify(first)
      .join({ community_id: "b", seed: material("b"), current: material("b"), added_at: 2 })
      .sign(signer);

    const plaintext = await signer.nip44!.decrypt(pubkey, updated.content);
    const doc = JSON.parse(plaintext);
    expect(doc.entries.map((e: { community_id: string }) => e.community_id)).toEqual(["a", "b"]);
  });

  it("leave tombstones a membership, keeping the entry in the document", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const first = await CommunityListFactory.create()
      .join({ community_id: "a", seed: material("a"), current: material("a"), added_at: 1 })
      .sign(signer);

    const left = await CommunityListFactory.modify(first).leave("a", 5).sign(signer);
    const plaintext = await signer.nip44!.decrypt(pubkey, left.content);
    const doc = JSON.parse(plaintext);
    expect(doc.entries.map((e: { community_id: string }) => e.community_id)).toEqual(["a"]);
    expect(doc.tombstones).toEqual([{ community_id: "a", removed_at: 5 }]);
  });

  it("pipe chains multiple operations in a single decrypt-merge-re-encrypt", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const event = await CommunityListFactory.create()
      .pipe(
        joinCommunity({ community_id: "a", seed: material("a"), current: material("a"), added_at: 1 }),
        joinCommunity({ community_id: "b", seed: material("b"), current: material("b"), added_at: 2 }),
        leaveCommunity("a", 5),
      )
      .sign(signer);

    const doc = JSON.parse(await signer.nip44!.decrypt(pubkey, event.content));
    expect(doc.entries.map((e: { community_id: string }) => e.community_id)).toEqual(["a", "b"]);
    expect(doc.tombstones).toEqual([{ community_id: "a", removed_at: 5 }]);
  });

  it("requires a signer to encrypt", async () => {
    await expect(CommunityListFactory.create().join({
      community_id: "cid",
      seed: material("cid"),
      current: material("cid"),
      added_at: 1,
    })).rejects.toThrow(/signer/i);
  });
});
