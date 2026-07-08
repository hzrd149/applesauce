// Full envelope round-trip over the extracted Concord core (CORD-01..05):
// genesis → wrap/seal → decode → fold → chat → invite → tamper detection.
// Ported from the app's scripts/selftest.ts (§1-7); §8 stream-auth and §9 voice
// are covered later / deferred with their phases.

import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { createCommunity, deriveKeys, verifyOwner } from "../helpers/community.js";
import { foldControl } from "../helpers/control.js";
import { foldMembers } from "../helpers/guestbook.js";
import { resolveStanding } from "../helpers/permissions.js";
import { giftWrap, sealRumor, toRumor, wrapSeal } from "../operations/gift-wrap.js";
import { decodeWrap } from "../helpers/gift-wrap.js";
import { ChatMessageFactory } from "applesauce-common/factories";
import { bindToChannel } from "../operations/channel.js";
import { buildInviteLink, decryptBundle, encryptBundle, newInviteToken, parseInviteLink } from "../helpers/invite.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { DecodedEvent, InviteBundle, Role } from "../types.js";

describe("concord envelope round-trip", () => {
  it("genesis → decode → fold → chat → invite → tamper", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();

    // 1. Create community + owner proof.
    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "Test", description: "hi", relays: ["wss://x"] });
    expect(verifyOwner(genesis.material)).toBe(true);
    const keys = deriveKeys(genesis.material, []);

    // 2. Publish genesis control editions (plaintext seal) and round-trip decode.
    const controlDecoded: DecodedEvent[] = [];
    for (const rumor of genesis.controlRumors) {
      const wrap = await giftWrap(keys.control.sk, keys.control.convKey, owner, { plaintext: true })(rumor);
      expect(wrap.kind).toBe(1059);
      expect(wrap.pubkey).toBe(keys.control.pk);
      const dec = decodeWrap(wrap, keys.control.convKey);
      expect(dec).not.toBeNull();
      expect(dec!.author).toBe(ownerPub);
      expect(dec!.sealKind).toBe(20014); // plaintext seal
      controlDecoded.push(dec!);
    }

    // 3. Fold the control plane.
    const state = foldControl(controlDecoded, genesis.material);
    expect(state.metadata?.name).toBe("Test");
    expect(state.channels).toHaveLength(1);
    expect(state.channels[0].name).toBe("general");

    // 4. Guestbook: owner join, encrypted seal.
    const gbDecoded: DecodedEvent[] = [];
    for (const rumor of genesis.guestbookRumors) {
      const wrap = await giftWrap(keys.guestbook.sk, keys.guestbook.convKey, owner)(rumor);
      const dec = decodeWrap(wrap, keys.guestbook.convKey);
      expect(dec!.sealKind).toBe(20013); // encrypted seal
      gbDecoded.push(dec!);
    }
    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    const members = foldMembers(gbDecoded, new Map([[ownerPub, Date.now()]]), state.banlist, (m) =>
      resolveStanding(m, genesis.material.owner, rolesMap, state.grants),
    );
    expect(members.has(ownerPub)).toBe(true);

    // 5. Chat: a message to #general decodes for a second member re-deriving the key.
    const chId = genesis.generalChannelId;
    const chKey = deriveKeys(genesis.material, state.channels).channels.get(chId)!;
    const member = new PrivateKeySigner(generateSecretKey());
    const memberPub = await member.getPublicKey();
    const msgRumor = await toRumor(member)(await bindToChannel(chId, 0)(await ChatMessageFactory.create("Hey chat!")));
    const msgWrap = await wrapSeal(chKey.sk, chKey.convKey)(await sealRumor(chKey.convKey, member)(msgRumor));
    const memberChKey = deriveKeys(genesis.material, state.channels).channels.get(chId)!;
    expect(memberChKey.pk).toBe(chKey.pk); // both derive the same channel address
    const msgDec = decodeWrap(msgWrap, memberChKey.convKey);
    expect(msgDec).not.toBeNull();
    expect(msgDec!.rumor.content).toBe("Hey chat!");
    expect(msgDec!.author).toBe(memberPub);
    expect(msgDec!.rumor.id).toBe(msgRumor.id);

    // 6. Invite link round-trip.
    const token = newInviteToken();
    const linkPub = getPublicKey(generateSecretKey());
    const bundle: InviteBundle = {
      community_id: genesis.material.community_id,
      owner: ownerPub,
      owner_salt: genesis.material.owner_salt,
      community_root: genesis.material.community_root,
      root_epoch: 0,
      channels: [],
      relays: ["wss://jskitty.com/nostr"],
      name: "Test",
      creator_npub: ownerPub,
    };
    expect(decryptBundle(encryptBundle(bundle, token), token).community_id).toBe(bundle.community_id);
    const link = buildInviteLink("https://app.example", linkPub, token, ["wss://jskitty.com/nostr"]);
    const parsed = parseInviteLink(link);
    expect(parsed.linkSigner).toBe(linkPub);
    expect(bytesToHex(parsed.token)).toBe(bytesToHex(token));

    // 7. Tamper detection: a wrong conv key sees only noise.
    const wrongKey = deriveKeys({ ...genesis.material, community_root: bytesToHex(generateSecretKey()) }, []).control.convKey;
    expect(decodeWrap(msgWrap, wrongKey)).toBeNull();
  });
});
