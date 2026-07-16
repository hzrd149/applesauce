// Channel-scoped Rekey (CORD-06): a Private Channel is a sub-community keyed
// independently of the community_root, so it can be rotated alone. Exercises
// deriveChannelKeys → buildChannelRekey → readChannelRekey with no client (a kept
// member adopts the new channel key; an excluded member detects removal), plus
// held-epoch retention so prior-epoch messages stay decodable.

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { createCommunity } from "../community.js";
import {
  buildChannelRekey,
  buildRefounding,
  deriveChannelKeys,
  deriveConcordKeys,
  readChannelRekey,
  rollForwardChannel,
} from "../keys.js";
import { channelGroupKey } from "../crypto.js";
import { decodeWrap } from "../gift-wrap.js";
import type { ChannelKey, DecodedEvent, JoinMaterial } from "../../types.js";

async function member() {
  const signer = new PrivateKeySigner(generateSecretKey());
  return { signer, pub: await signer.getPublicKey() };
}

function privateChannel(name = "secret-room"): ChannelKey {
  return { id: bytesToHex(generateSecretKey()), key: bytesToHex(generateSecretKey()), epoch: 1, name };
}

/** Decode the channel-rekey wraps at the address a channel holder listens on. */
function decodeChannelRekey(material: JoinMaterial, channel: ChannelKey, wraps: { pubkey: string }[]): DecodedEvent[] {
  const keys = deriveChannelKeys(material, channel);
  const out: DecodedEvent[] = [];
  for (const wrap of wraps) {
    const info = keys.planes.get(wrap.pubkey);
    expect(info?.type).toBe("rekey");
    const dec = decodeWrap(wrap as never, info!.convKey);
    if (dec) out.push(dec);
  }
  return out;
}

async function genesis() {
  const owner = new PrivateKeySigner(generateSecretKey());
  const ownerPub = await owner.getPublicKey();
  const g = await createCommunity({ ownerPubkey: ownerPub, name: "Test", relays: ["wss://x"] });
  return { owner, ownerPub, material: g.material };
}

describe("channel-scoped rekey", () => {
  it("deriveChannelKeys builds the message plane, held planes, and the next-rekey address", async () => {
    const { material } = await genesis();
    const channel = privateChannel();
    const keys = deriveChannelKeys(material, channel);

    // The current message plane addresses back to its convKey…
    expect(keys.planes.get(keys.current.pk)).toMatchObject({ type: "channel", channelId: channel.id, epoch: 1 });
    // …and the next channel-epoch's rekey address is listed (under the current root).
    expect(keys.nextRekey[0]).toMatchObject({ epoch: 2 });
    expect(keys.planes.get(keys.nextRekey[0].key.pk)).toMatchObject({ type: "rekey", channelId: channel.id });
    // No held keys yet.
    expect(keys.held).toHaveLength(0);
  });

  it("rollForwardChannel retains the prior key (newest-first) so old epochs still derive", async () => {
    const { material } = await genesis();
    const channel = privateChannel();
    const rolled = rollForwardChannel(channel, bytesToHex(generateSecretKey()), 2);

    expect(rolled.epoch).toBe(2);
    expect(rolled.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });
    // The input is untouched (pure).
    expect(channel.held).toBeUndefined();

    // The rolled key still derives an address for the prior epoch's messages.
    const keys = deriveChannelKeys(material, rolled);
    expect(keys.held).toHaveLength(1);
    expect(keys.held[0].epoch).toBe(1);
    expect(keys.planes.get(keys.held[0].key.pk)).toMatchObject({ type: "channel", epoch: 1 });
  });

  // H01(c) (CORD-03 §1), also H08's second root cause: rollForwardChannel's plane
  // address must match the private-channel branch of the spec formula. The
  // expected value below comes ONLY from `channelGroupKey` in crypto.ts (D-18) —
  // never from `deriveChannelKeys`/`rollForwardChannel` — so this is not
  // self-referential. Proving the memo half dead here lets Phase 7 focus purely
  // on H08's metadata-threading half.
  it("rollForwardChannel's plane address matches the CORD-03 §1 private formula over the new key/epoch", async () => {
    const { material } = await genesis();
    const channel = privateChannel();

    // ARM THE MEMO: unlike rollForward/deriveConcordKeys above, this does NOT
    // happen naturally here — deriveChannelKeys must be called explicitly on the
    // ORIGINAL channel to write ChannelPlaneKeysSymbol onto it. Skipping this call
    // means rollForwardChannel's spread has no memo to carry, and the assertion
    // below would pass even against the pre-05-01 broken code (vacuous test).
    const before = deriveChannelKeys(material, channel);

    const newKey = bytesToHex(generateSecretKey());
    const newEpoch = channel.epoch + 1;

    // EXPECTED, independently derived from the spec formula's PRIVATE branch:
    // secret = the channel's own (new) key, id = channel.id, epoch = the
    // channel's own new epoch — NOT community_root/root_epoch (the public branch).
    const expected = channelGroupKey(hexToBytes(newKey), hexToBytes(channel.id), newEpoch);

    const rolled = rollForwardChannel(channel, newKey, newEpoch);
    const after = deriveChannelKeys(material, rolled);

    expect(after.current.pk).toBe(expected.pk);
    // The message plane actually rotated — a Rekey that doesn't rotate the plane
    // means the rotated-out member's key still opens the channel's traffic.
    expect(after.current.pk).not.toBe(before.current.pk);
  });

  it("a kept member adopts the new channel key; an excluded member is removed", async () => {
    const { owner, ownerPub, material } = await genesis();
    const kept = await member();
    const dropped = await member();
    const channel = privateChannel();

    // Owner rekeys the channel, keeping `kept` and excluding `dropped`.
    const newKey = generateSecretKey();
    const plan = await buildChannelRekey(material, channel, owner, {
      recipients: [ownerPub, kept.pub],
      self: ownerPub,
      newKey,
    });
    expect(plan.newEpoch).toBe(2);
    expect(plan.next.epoch).toBe(2);
    expect(plan.next.key).toBe(bytesToHex(newKey));
    expect(plan.next.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });

    const isOwner = (rotator: string) => rotator === ownerPub;

    const keptOutcome = await readChannelRekey(
      channel,
      decodeChannelRekey(material, channel, plan.rekeyWraps),
      isOwner,
      kept.pub,
      kept.signer,
    );
    expect(keptOutcome.kind).toBe("adopt");
    if (keptOutcome.kind === "adopt") {
      expect(keptOutcome.epoch).toBe(2);
      expect(keptOutcome.rotator).toBe(ownerPub);
      expect(keptOutcome.next.key).toBe(bytesToHex(newKey));
      expect(keptOutcome.next.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });
    }

    const droppedOutcome = await readChannelRekey(
      channel,
      decodeChannelRekey(material, channel, plan.rekeyWraps),
      isOwner,
      dropped.pub,
      dropped.signer,
    );
    expect(droppedOutcome.kind).toBe("removed");
  });

  it("a Refounding bundles a channel Rekey sealed under the prior root (§94)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const kept = await member();
    const dropped = await member();
    const channel = privateChannel();

    // Owner refounds — keeping `kept`, excluding `dropped` — and bundles a rekey
    // for the private channel, delivered to the keep set.
    const plan = await buildRefounding(deriveConcordKeys(material, []), owner, {
      recipients: [ownerPub, kept.pub],
      self: ownerPub,
      heads: [],
      channels: [],
      channelRekeys: [{ channel, recipients: [ownerPub, kept.pub] }],
    });
    expect(plan.channelRekeyWraps.length).toBeGreaterThan(0);

    // After adopting the new root, the kept member reads the bundled channel rekey
    // at the OLD-root address (retained in held_roots) and adopts the new key.
    const postMaterial = plan.next.material; // new root, held_roots = [old]
    const isOwner = (r: string) => r === ownerPub;
    const keptOutcome = await readChannelRekey(
      channel,
      decodeChannelRekey(postMaterial, channel, plan.channelRekeyWraps),
      isOwner,
      kept.pub,
      kept.signer,
    );
    expect(keptOutcome.kind).toBe("adopt");

    // The excluded member is severed from the private channel too.
    const droppedOutcome = await readChannelRekey(
      channel,
      decodeChannelRekey(postMaterial, channel, plan.channelRekeyWraps),
      isOwner,
      dropped.pub,
      dropped.signer,
    );
    expect(droppedOutcome.kind).toBe("removed");
  });

  it("ignores a removal from a rotator who does not outrank the removed member (CORD-04)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const dropped = await member();
    const channel = privateChannel();

    // The rotator holds MANAGE_CHANNELS and rekeys the channel excluding `dropped`.
    const plan = await buildChannelRekey(material, channel, owner, { recipients: [ownerPub], self: ownerPub });
    const events = () => decodeChannelRekey(material, channel, plan.rekeyWraps);

    // Authorized to rotate, but NOT authorized to remove US → the removal is
    // ignored (we keep our current key) rather than honored.
    const ignored = await readChannelRekey(
      channel,
      events(),
      () => true,
      dropped.pub,
      dropped.signer,
      () => false,
    );
    expect(ignored.kind).toBe("none");

    // The same rotation, from a rotator who DOES outrank us, is honored.
    const honored = await readChannelRekey(
      channel,
      events(),
      () => true,
      dropped.pub,
      dropped.signer,
      () => true,
    );
    expect(honored.kind).toBe("removed");
  });

  it("ignores an unauthorized rotator (a removed member forging a rotation)", async () => {
    const { material } = await genesis();
    const attacker = await member();
    const victim = await member();
    const channel = privateChannel();

    // The attacker still holds the channel key and forges a perfect rotation…
    const plan = await buildChannelRekey(material, channel, attacker.signer, {
      recipients: [attacker.pub, victim.pub],
      self: attacker.pub,
    });
    // …but MANAGE_CHANNELS authority says no → no adoption, no removal.
    const outcome = await readChannelRekey(
      channel,
      decodeChannelRekey(material, channel, plan.rekeyWraps),
      () => false,
      victim.pub,
      victim.signer,
    );
    expect(outcome.kind).toBe("none");
  });
});
