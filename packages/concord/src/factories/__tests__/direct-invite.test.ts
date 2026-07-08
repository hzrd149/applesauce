import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { getGiftWrapSeal, unlockGiftWrap } from "applesauce-common/helpers/gift-wrap";
import { PrivateKeySigner } from "applesauce-signers";

import { createCommunity } from "../../helpers/community.js";
import { buildInviteBundle } from "../../helpers/invite-bundle.js";
import { getDirectInviteBundle, DIRECT_INVITE_INDEX } from "../../helpers/direct-invite.js";
import { GIFT_WRAP_KIND } from "../../helpers/gift-wrap.js";
import { DirectInviteFactory } from "../direct-invite.js";

describe("DirectInviteFactory", () => {
  it("round-trips: standard NIP-59 wrap → inviter-sealed 3313 rumor → validated bundle", async () => {
    const inviterSk = generateSecretKey();
    const inviter = new PrivateKeySigner(inviterSk);
    const inviterPub = getPublicKey(inviterSk);

    const recipientSk = generateSecretKey();
    const recipient = new PrivateKeySigner(recipientSk);
    const recipientPub = getPublicKey(recipientSk);

    const { material } = await createCommunity({ ownerPubkey: inviterPub, name: "T", relays: ["wss://r"] });
    const bundle = buildInviteBundle(material, { creator_npub: inviterPub });

    const wrap = await DirectInviteFactory.create(bundle, recipientPub, inviter);

    // Outer wrap: standard gift wrap (1059), recipient p-tag + k index tag (§6).
    expect(wrap.kind).toBe(GIFT_WRAP_KIND);
    expect(wrap.tags).toContainEqual(["p", recipientPub]);
    expect(wrap.tags).toContainEqual(["k", DIRECT_INVITE_INDEX]);

    // The recipient unwraps it with a standard NIP-59 decode (kind 13 seal).
    const rumor = await unlockGiftWrap(wrap, recipient);
    const seal = getGiftWrapSeal(wrap)!;
    expect(seal.kind).toBe(13); // NIP-59 seal, NOT CORD-01's 20013/20014
    expect(seal.pubkey).toBe(inviterPub); // the inviter's real key proves who invited

    // The rumor is a 3313 whose bundle round-trips and self-certifies.
    expect(rumor.kind).toBe(3313);
    const parsed = getDirectInviteBundle(rumor);
    expect(parsed?.community_id).toBe(material.community_id);
    expect(parsed?.creator_npub).toBe(inviterPub);
  });

  it("carries a NIP-40 expiration when requested", async () => {
    const inviter = new PrivateKeySigner(generateSecretKey());
    const recipientPub = getPublicKey(generateSecretKey());
    const { material } = await createCommunity({
      ownerPubkey: await inviter.getPublicKey(),
      name: "T",
      relays: ["wss://r"],
    });
    const wrap = await DirectInviteFactory.create(buildInviteBundle(material), recipientPub, inviter, {
      expiration: 1_800_000_000,
    });
    expect(wrap.tags).toContainEqual(["expiration", "1800000000"]);
  });
});
