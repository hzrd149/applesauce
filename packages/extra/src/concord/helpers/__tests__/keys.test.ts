// The single ConcordKeys state object + its functional operations, exercised
// with no ConcordClient: derive → wrap → decode-via-planes → refound → readRekey
// (a kept member adopts the new root; an excluded member detects removal).

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { bytesToHex } from "@noble/hashes/utils.js";

import { createCommunity } from "../community.js";
import {
  addChannelKey,
  buildRefounding,
  channelEpochOf,
  deriveConcordKeys,
  planeKeyFor,
  readRekey,
  wrapForTarget,
} from "../keys.js";
import { decodeWrap } from "../gift-wrap.js";
import type { DecodedEvent } from "../../types.js";

async function genesis(name = "Test") {
  const owner = new PrivateKeySigner(generateSecretKey());
  const ownerPub = await owner.getPublicKey();
  const g = await createCommunity({ ownerPubkey: ownerPub, name, relays: ["wss://x"] });
  return { owner, ownerPub, material: g.material, generalChannelId: g.generalChannelId };
}

/** Decode the rekey wraps at the next-base-rekey address a member listens on. */
function decodeRekey(keys: ReturnType<typeof deriveConcordKeys>, wraps: { pubkey: string }[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const wrap of wraps) {
    const info = keys.planes.get(wrap.pubkey);
    expect(info?.type).toBe("rekey");
    const dec = decodeWrap(wrap as never, info!.convKey);
    if (dec) out.push(dec);
  }
  return out;
}

describe("ConcordKeys", () => {
  it("deriveConcordKeys builds every plane address + a decrypt lookup", async () => {
    const { material } = await genesis();
    const keys = deriveConcordKeys(material, []);

    // The planes map covers control, guestbook, dissolved, and the next-epoch
    // base-rekey listen address — every derived address maps back to its convKey.
    expect(keys.planes.get(keys.control.pk)).toMatchObject({ type: "control", convKey: keys.control.convKey });
    expect(keys.planes.get(keys.guestbook.pk)?.type).toBe("guestbook");
    expect(keys.planes.get(keys.dissolved.pk)?.type).toBe("dissolved");
    expect(keys.planes.get(keys.nextBaseRekey.key.pk)).toMatchObject({ type: "rekey", epoch: 1 });
    expect(keys.material).toBe(material);
  });

  it("wrapForTarget seals a rumor that decodes at the plane's address", async () => {
    const { owner, ownerPub, material } = await genesis();
    const keys = deriveConcordKeys(material, []);

    const { wrap, rumorId } = await wrapForTarget(
      keys,
      { plane: "control" },
      owner,
      { kind: 3302, content: "hi", tags: [] },
      { plaintext: true },
    );
    expect(wrap.pubkey).toBe(keys.control.pk); // addressed at the control plane

    // Decode purely via the decrypt-side plane lookup (no key threaded by hand).
    const info = keys.planes.get(wrap.pubkey)!;
    const dec = decodeWrap(wrap, info.convKey);
    expect(dec).not.toBeNull();
    expect(dec!.author).toBe(ownerPub);
    expect(dec!.rumor.id).toBe(rumorId);

    // A wrong plane can't open it.
    expect(decodeWrap(wrap, planeKeyFor(keys, { plane: "guestbook" }).convKey)).toBeNull();
  });

  it("addChannelKey appends a private-channel key immutably", async () => {
    const { material } = await genesis();
    const keys = deriveConcordKeys(material, []);
    const channelId = "ab".repeat(32);

    const next = addChannelKey(keys, channelId, "secret-room");
    const added = next.material.channels.find((c) => c.id === channelId);
    expect(added).toMatchObject({ id: channelId, name: "secret-room", epoch: 1 });
    expect(added!.key).toHaveLength(64); // a fresh 32-byte hex key

    // The input state is untouched (no in-place mutation).
    expect(keys.material.channels.find((c) => c.id === channelId)).toBeUndefined();
    expect(next.material).not.toBe(keys.material);
  });

  it("channelEpochOf falls back to the root epoch for unknown channels", async () => {
    const { material } = await genesis();
    const keys = deriveConcordKeys(material, []);
    expect(channelEpochOf(keys, "deadbeef")).toBe(material.root_epoch);
  });

  it("buildRefounding: a kept member adopts the new root, an excluded member is removed", async () => {
    const { owner, ownerPub, material } = await genesis();

    // Two members join with the same material (as if via invite).
    const kept = new PrivateKeySigner(generateSecretKey());
    const keptPub = await kept.getPublicKey();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();

    const ownerKeys = deriveConcordKeys(material, []);
    const keptKeys = deriveConcordKeys(material, []);
    const droppedKeys = deriveConcordKeys(material, []);

    // Owner refounds, keeping `kept` and excluding `dropped`.
    const newRoot = generateSecretKey();
    const plan = await buildRefounding(ownerKeys, owner, {
      recipients: [ownerPub, keptPub],
      self: ownerPub,
      heads: [],
      channels: [],
      newRoot,
    });
    expect(plan.newEpoch).toBe(1);
    expect(plan.next.material.root_epoch).toBe(1);
    expect(plan.next.material.community_root).toBe(bytesToHex(newRoot));
    // The rolled state retains the prior root so old history stays decodable.
    expect(plan.next.material.held_roots?.[0]).toMatchObject({ epoch: 0, key: material.community_root });
    expect(plan.next.planes.get(ownerKeys.control.pk)?.type).toBe("control"); // prior address retained

    const isOwner = (rotator: string) => rotator === ownerPub;

    // The kept member folds the rekey blobs and adopts the exact new root.
    const keptOutcome = await readRekey(
      keptKeys,
      decodeRekey(keptKeys, plan.rekeyWraps),
      isOwner,
      keptPub,
      kept,
      [],
    );
    expect(keptOutcome.kind).toBe("adopt");
    if (keptOutcome.kind === "adopt") {
      expect(keptOutcome.epoch).toBe(1);
      expect(keptOutcome.rotator).toBe(ownerPub);
      expect(keptOutcome.next.material.community_root).toBe(bytesToHex(newRoot));
    }

    // The excluded member sees a complete, authorized rotation with no blob for
    // them → removed.
    const droppedOutcome = await readRekey(
      droppedKeys,
      decodeRekey(droppedKeys, plan.rekeyWraps),
      isOwner,
      droppedPub,
      dropped,
      [],
    );
    expect(droppedOutcome.kind).toBe("removed");
  });

  it("readRekey ignores an unauthorized rotator", async () => {
    const { material } = await genesis();
    const attacker = new PrivateKeySigner(generateSecretKey());
    const attackerPub = await attacker.getPublicKey();
    const victim = new PrivateKeySigner(generateSecretKey());
    const victimPub = await victim.getPublicKey();

    const attackerKeys = deriveConcordKeys(material, []);
    const victimKeys = deriveConcordKeys(material, []);

    // An attacker still holding the prior root forges a perfect rotation…
    const plan = await buildRefounding(attackerKeys, attacker, {
      recipients: [attackerPub, victimPub],
      self: attackerPub,
      heads: [],
      channels: [],
    });
    // …but the roster says only the owner may rotate → no adoption, no removal.
    const outcome = await readRekey(
      victimKeys,
      decodeRekey(victimKeys, plan.rekeyWraps),
      () => false,
      victimPub,
      victim,
      [],
    );
    expect(outcome.kind).toBe("none");
  });
});
