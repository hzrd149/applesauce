import { describe, expect, it } from "vitest";
import { EventStore } from "applesauce-core";
import { castEvent } from "applesauce-core/casts";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { unlockGiftWrap } from "applesauce-common/helpers/gift-wrap";
import { PrivateKeySigner } from "applesauce-signers";

import { createCommunity } from "../../helpers/community.js";
import { buildInviteBundle } from "../../helpers/invite-bundle.js";
import { DirectInviteFactory } from "../../factories/direct-invite.js";
import { ConcordDirectInvite } from "../direct-invite.js";

async function directInviteRumor(opts?: { expires_at?: number }) {
  const inviterSk = generateSecretKey();
  const inviter = new PrivateKeySigner(inviterSk);
  const inviterPub = getPublicKey(inviterSk);
  const recipient = new PrivateKeySigner(generateSecretKey());

  const { material } = await createCommunity({ ownerPubkey: inviterPub, name: "T", relays: ["wss://r"] });
  const bundle = buildInviteBundle(material, { creator_npub: inviterPub, ...opts });
  const wrap = await DirectInviteFactory.create(bundle, await recipient.getPublicKey(), inviter, opts);
  const rumor = await unlockGiftWrap(wrap, recipient);
  return { rumor, inviterPub, communityId: material.community_id };
}

describe("direct invite cast", () => {
  it("casts an unwrapped 3313 rumor and exposes the inviter + validated bundle", async () => {
    const { rumor, inviterPub, communityId } = await directInviteRumor();
    const invite = castEvent(rumor, ConcordDirectInvite, new EventStore());

    expect(invite).toBeInstanceOf(ConcordDirectInvite);
    expect(invite.kind).toBe(3313);
    expect(invite.inviter).toBe(inviterPub); // the cryptographically-proven seal author
    expect(invite.author.pubkey).toBe(inviterPub); // inherited EventCast accessor, resolvable to a profile
    expect(invite.valid).toBe(true);
    expect(invite.communityId).toBe(communityId);
    expect(invite.bundle?.creator_npub).toBe(inviterPub);
    expect(invite.createdAt).toBeInstanceOf(Date);
  });

  it("memoizes the cast instance on the rumor", async () => {
    const { rumor } = await directInviteRumor();
    const store = new EventStore();
    expect(castEvent(rumor, ConcordDirectInvite, store)).toBe(castEvent(rumor, ConcordDirectInvite, store));
  });

  it("reports expiry against a clock", async () => {
    const expires_at = 1_000_000; // unix ms in the far past
    const { rumor } = await directInviteRumor({ expires_at });
    const invite = castEvent(rumor, ConcordDirectInvite, new EventStore());
    expect(invite.expiresAt).toBe(expires_at);
    expect(invite.expired(500_000)).toBe(false);
    expect(invite.expired(2_000_000)).toBe(true);
  });

  it("throws when the rumor is not a direct invite", () => {
    const rumor = { id: "a".repeat(64), pubkey: "b".repeat(64), kind: 1, content: "", tags: [], created_at: 0 };
    expect(() => castEvent(rumor as any, ConcordDirectInvite, new EventStore())).toThrow();
  });

  it("is invalid when the bundle fails its owner proof", async () => {
    const { rumor } = await directInviteRumor();
    // Corrupt the bundle so community_id no longer matches owner||salt.
    const forged = { ...rumor, content: JSON.stringify({ ...JSON.parse(rumor.content), owner: "ff".repeat(32) }) };
    const invite = castEvent(forged as any, ConcordDirectInvite, new EventStore());
    expect(invite.valid).toBe(false);
    expect(invite.bundle).toBeUndefined();
  });
});
