// The single ConcordKeys state object + its functional operations, exercised
// with no ConcordClient: derive → wrap → decode-via-planes → refound → readRekey
// (a kept member adopts the new root; an excluded member detects removal).

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { createCommunity } from "../community.js";
import {
  addChannelKey,
  buildRefounding,
  channelEpochOf,
  deriveChannelKeys,
  deriveConcordKeys,
  planeKeyFor,
  readRekey,
  rollForward,
  wrapForTarget,
} from "../keys.js";
import { baseRekeyGroupKey, channelGroupKey, controlGroupKey, grantLocator, guestbookGroupKey } from "../crypto.js";
import { decodeWrap, PLAINTEXT_SEAL_KIND } from "../gift-wrap.js";
import type { ChannelKey, ChannelMetadata, DecodedEvent, JoinMaterial } from "../../types.js";

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
    const keptOutcome = await readRekey(keptKeys, decodeRekey(keptKeys, plan.rekeyWraps), isOwner, keptPub, kept, []);
    expect(keptOutcome.kind).toBe("adopt");
    if (keptOutcome.kind === "adopt") {
      expect(keptOutcome.epoch).toBe(1);
      expect(keptOutcome.rotator).toBe(ownerPub);
      expect(keptOutcome.next.material.community_root).toBe(bytesToHex(newRoot));
    }

    // The excluded member sees a complete, authorized rotation with no blob for
    // them → removed. The owner strictly outranks everyone, so `canRemoveSelf`
    // (fail-closed by default, D-07) truthfully permits the removal here.
    const droppedOutcome = await readRekey(
      droppedKeys,
      decodeRekey(droppedKeys, plan.rekeyWraps),
      isOwner,
      droppedPub,
      dropped,
      [],
      isOwner,
    );
    expect(droppedOutcome.kind).toBe("removed");
  });

  it("buildRefounding aborts BEFORE publishing when a Control head can't be re-wrapped (ROTATE-13/D-01)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const ownerKeys = deriveConcordKeys(material, []);

    // A head sealed ENCRYPTED (kind != PLAINTEXT_SEAL_KIND) — CORD-06 §3: "If the
    // Refounder cannot reliably fold all Control events, the Refounding must be
    // aborted." rewrapSeal only survives plaintext seals; an encrypted-seal head
    // can't be re-wrapped into the new epoch.
    const { wrap: encryptedWrap } = await wrapForTarget(
      ownerKeys,
      { plane: "control" },
      owner,
      { kind: 3302, content: "hi", tags: [] },
      { plaintext: false },
    );
    const encInfo = ownerKeys.planes.get(encryptedWrap.pubkey)!;
    const unfoldableHead = decodeWrap(encryptedWrap, encInfo.convKey)!;
    expect(unfoldableHead.sealKind).not.toBe(PLAINTEXT_SEAL_KIND); // sanity: genuinely non-plaintext

    await expect(
      buildRefounding(ownerKeys, owner, {
        recipients: [ownerPub],
        self: ownerPub,
        heads: [unfoldableHead],
        channels: [],
        newRoot: generateSecretKey(),
      }),
    ).rejects.toThrow(/refounding aborted/);

    // Positive control: an all-foldable (plaintext) head set compacts cleanly —
    // proves the abort above is triggered BY the unfoldable head, not by some
    // other defect in the compaction loop.
    const { wrap: plaintextWrap } = await wrapForTarget(
      ownerKeys,
      { plane: "control" },
      owner,
      { kind: 3302, content: "hi", tags: [] },
      { plaintext: true },
    );
    const plainInfo = ownerKeys.planes.get(plaintextWrap.pubkey)!;
    const foldableHead = decodeWrap(plaintextWrap, plainInfo.convKey)!;
    expect(foldableHead.sealKind).toBe(PLAINTEXT_SEAL_KIND);

    const plan = await buildRefounding(ownerKeys, owner, {
      recipients: [ownerPub],
      self: ownerPub,
      heads: [foldableHead],
      channels: [],
      newRoot: generateSecretKey(),
    });
    expect(plan.compactionWraps).toHaveLength(1);
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

  // AUTH-01 (CORD-04 / CORD-06 §3 "in both"): the root path must mirror the
  // channel path's outrank guard (channel-rekey.test.ts:206-237). Also proves
  // D-07's fail-closed-on-absence: omitting `canRemoveSelf` entirely must deny
  // the removal, not default-permit it.
  it("readRekey's root path honors removal only from an outranking rotator, and denies it when canRemoveSelf is absent (AUTH-01)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();
    const droppedKeys = deriveConcordKeys(material, []);

    // Owner rotates, excluding `dropped` — a complete, authorized rotation with
    // no blob for the victim.
    const plan = await buildRefounding(deriveConcordKeys(material, []), owner, {
      recipients: [ownerPub],
      self: ownerPub,
      heads: [],
      channels: [],
    });
    const events = () => decodeRekey(droppedKeys, plan.rekeyWraps);

    // (a) Fail-closed: a rotator who does NOT outrank the victim → not removed.
    const ignored = await readRekey(droppedKeys, events(), () => true, droppedPub, dropped, [], () => false);
    expect(ignored.kind).not.toBe("removed");

    // (b) The same rotation, from a rotator who DOES outrank the victim → removed.
    const honored = await readRekey(droppedKeys, events(), () => true, droppedPub, dropped, [], () => true);
    expect(honored.kind).toBe("removed");

    // (c) Fail-closed-on-absence: no `canRemoveSelf` argument at all → not
    // removed, matching the channel path's guard rather than defaulting to permit.
    const absent = await readRekey(droppedKeys, events(), () => true, droppedPub, dropped, []);
    expect(absent.kind).not.toBe("removed");
  });

  // H01(a) (CORD-02 §4): "Rotating the epoch rotates the pk, keeping a plane's
  // traffic unlinkable across epochs." The expected value below comes ONLY from
  // `controlGroupKey` in crypto.ts (D-18) — never from `deriveConcordKeys`,
  // `baseKeysFor`, or `rollForward` themselves — so this cannot be a
  // self-referential (implementation-compares-to-itself) assertion.
  it("rollForward's control address matches the CORD-02 §4 formula over the new root", async () => {
    const { material, ownerPub } = await genesis();

    // ARM THE MEMO: deriving keys from `material` writes BaseKeysSymbol onto it.
    // Without this step, rollForward's `{ ...keys.material, ... }` spread has no
    // memo to carry forward, and this assertion would pass even against the
    // pre-05-01 broken code (vacuous test) — see D-18/non-vacuity note in the plan.
    const keys = deriveConcordKeys(material, []);

    const newRoot = generateSecretKey();
    const newEpoch = material.root_epoch + 1;

    // EXPECTED, independently derived from the spec formula (never via rollForward
    // / deriveConcordKeys / baseKeysFor).
    const expected = controlGroupKey(newRoot, hexToBytes(material.community_id), newEpoch);

    const rolled = rollForward(keys, newRoot, newEpoch, ownerPub, []);

    expect(rolled.control.pk).toBe(expected.pk);
    // The rotation actually happened — the defect this closes is a Refounding
    // that silently keeps serving the OLD control address.
    expect(rolled.control.pk).not.toBe(keys.control.pk);
  });

  // ROTATE-01 (CORD-02 §5): "The Guestbook rides the epoch" — its address
  // rotates with the root exactly like the control plane. The expected value
  // below comes ONLY from `guestbookGroupKey` in crypto.ts — never from
  // `deriveConcordKeys`, `baseKeysFor`, or `rollForward` themselves — so this
  // cannot be a self-referential (implementation-compares-to-itself) assertion.
  it("rollForward's guestbook address matches the CORD-02 §5 formula over the new root", async () => {
    const { material, ownerPub } = await genesis();

    // ARM THE MEMO: deriving keys from `material` writes BaseKeysSymbol onto it.
    // Without this step, rollForward's `{ ...keys.material, ... }` spread has no
    // memo to carry forward, and this assertion would pass even against the
    // pre-05-01 broken code (vacuous test) — see the plan's non-vacuity note.
    const keys = deriveConcordKeys(material, []);

    // EXPECTED (current epoch, over the current root), independently derived
    // from the spec formula (never via deriveConcordKeys / baseKeysFor).
    const currentExpected = guestbookGroupKey(
      hexToBytes(material.community_root),
      hexToBytes(material.community_id),
      material.root_epoch,
    );
    expect(keys.guestbook.pk).toBe(currentExpected.pk);

    const newRoot = generateSecretKey();
    const newEpoch = material.root_epoch + 1;

    // EXPECTED (new epoch, over the new root), independently derived from the
    // spec formula (never via rollForward / deriveConcordKeys / baseKeysFor).
    const expected = guestbookGroupKey(newRoot, hexToBytes(material.community_id), newEpoch);

    const rolled = rollForward(keys, newRoot, newEpoch, ownerPub, []);

    expect(rolled.guestbook.pk).toBe(expected.pk);
    // The rotation actually happened — the defect this closes is a Refounding
    // that silently keeps serving the OLD guestbook address, letting a removed
    // member read current traffic.
    expect(rolled.guestbook.pk).not.toBe(keys.guestbook.pk);
  });

  // ROTATE-02 (CORD-06 §2): the base-rekey listen address is deliberately
  // asymmetric — it addresses the PRIOR root at heldEpoch+1 (so every current
  // holder converges), NOT the new root like control/guestbook. The expected
  // values below come ONLY from `baseRekeyGroupKey` in crypto.ts — never from
  // `deriveConcordKeys`, `baseKeysFor`, or `rollForward` themselves.
  it("the base-rekey listen address matches the CORD-06 §2 formula over the prior root, and rollForward re-derives it over the new root", async () => {
    const { material, ownerPub } = await genesis();

    // ARM THE MEMO (same rationale as the guestbook probe above).
    const keys = deriveConcordKeys(material, []);

    // EXPECTED listen address: over the CURRENT/PRIOR root, at root_epoch + 1 —
    // Pitfall 1 (06-RESEARCH.md): do NOT derive this over a new root.
    const expectedListen = baseRekeyGroupKey(
      hexToBytes(material.community_root),
      hexToBytes(material.community_id),
      material.root_epoch + 1,
    );
    expect(keys.nextBaseRekey.key.pk).toBe(expectedListen.pk);
    expect(keys.nextBaseRekey.epoch).toBe(material.root_epoch + 1);

    const newRoot = generateSecretKey();
    const newEpoch = material.root_epoch + 1;
    const rolled = rollForward(keys, newRoot, newEpoch, ownerPub, []);

    // EXPECTED rolled next-listen address: over the NEW root, at newEpoch + 1 —
    // the rolled object's own next-epoch base-rekey listen address, one epoch
    // further on than the roll itself (never copy the prior-root expected value
    // here — that's the exact vacuous mistake Pitfall 1 warns against).
    const expectedRolled = baseRekeyGroupKey(newRoot, hexToBytes(material.community_id), newEpoch + 1);
    expect(rolled.nextBaseRekey.key.pk).toBe(expectedRolled.pk);
    expect(rolled.nextBaseRekey.epoch).toBe(newEpoch + 1);
    // The rotation actually happened — the listen address moved off the old
    // (prior-root) address a removed member could otherwise still derive.
    expect(rolled.nextBaseRekey.key.pk).not.toBe(keys.nextBaseRekey.key.pk);
  });
});

// readRekeyScoped convergence — ROTATE-05/06/07 (D-06/D-10). Each expected
// outcome below is computed by hand from CORD-06 §2 ("a missing chunk is never
// a removal — the client refetches until the set is complete before concluding
// anything") and §3 ("the lexicographically lowest new key wins") plus the
// D-06/D-10 rulings — never read back from readRekeyScoped/readRekey.
describe("readRekeyScoped convergence — ROTATE-05/06/07 (D-06/D-10)", () => {
  /** A signer whose nip44.decrypt always throws (simulates a NIP-46 bunker
   *  blip) — encrypt/signEvent/getPublicKey still delegate to the real signer. */
  function withThrowingDecrypt(signer: PrivateKeySigner): ISigner {
    return {
      getPublicKey: () => signer.getPublicKey(),
      signEvent: (t) => signer.signEvent(t),
      nip44: {
        encrypt: (pk, plaintext) => signer.nip44!.encrypt(pk, plaintext),
        decrypt: async () => {
          throw new Error("bunker timeout");
        },
      },
    };
  }

  // ROTATE-05 / D-06: CORD-06 §2 — "a missing chunk is never a removal — the
  // client refetches until the set is complete before concluding anything."
  // A caught decrypt error at OUR OWN locator is positive evidence of
  // inclusion, undetermined — it must NOT fall through to removal.
  it("a transient decrypt failure at our own locator yields none, never removed (ROTATE-05, D-06)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const victim = new PrivateKeySigner(generateSecretKey());
    const victimPub = await victim.getPublicKey();
    const victimKeys = deriveConcordKeys(material, []);

    // Owner rotates, keeping the victim (a blob exists at their locator).
    const plan = await buildRefounding(deriveConcordKeys(material, []), owner, {
      recipients: [ownerPub, victimPub],
      self: ownerPub,
      heads: [],
      channels: [],
    });
    const events = decodeRekey(victimKeys, plan.rekeyWraps);

    // EXPECTED: {kind: "none"} — CORD-06 §2's refetch-until-complete text plus
    // D-06's "never absence, never removal" ruling; hand-derived, not read
    // back from the function under test.
    const outcome = await readRekey(
      victimKeys,
      events,
      () => true,
      victimPub,
      withThrowingDecrypt(victim),
      [],
      () => true, // even an outranking rotator must not trigger removal here
    );
    expect(outcome.kind).toBe("none");
  });

  // ROTATE-07 / D-10: two authorized, complete, continuity-matched rotations
  // race to the same epoch. We can decrypt fork A (we're a recipient) but hold
  // no blob at all for fork B (a competing fork we cannot rank). Per D-10 we
  // must defer — neither adopt fork A's key (can't prove it's the true
  // global-lowest) nor self-evict.
  it("a decryptable candidate coexisting with an opaque competing fork defers (none), never adopts (ROTATE-07, D-10)", async () => {
    const { material } = await genesis();
    const rotatorA = new PrivateKeySigner(generateSecretKey());
    const rotatorAPub = await rotatorA.getPublicKey();
    const rotatorB = new PrivateKeySigner(generateSecretKey());
    const rotatorBPub = await rotatorB.getPublicKey();
    const victim = new PrivateKeySigner(generateSecretKey());
    const victimPub = await victim.getPublicKey();
    const victimKeys = deriveConcordKeys(material, []);

    // Fork A includes the victim — decryptable.
    const planA = await buildRefounding(deriveConcordKeys(material, []), rotatorA, {
      recipients: [rotatorAPub, victimPub],
      self: rotatorAPub,
      heads: [],
      channels: [],
    });
    // Fork B excludes the victim entirely — no blob, opaque.
    const planB = await buildRefounding(deriveConcordKeys(material, []), rotatorB, {
      recipients: [rotatorBPub],
      self: rotatorBPub,
      heads: [],
      channels: [],
    });
    const isAuthorized = (rotator: string) => rotator === rotatorAPub || rotator === rotatorBPub;
    const events = decodeRekey(victimKeys, [...planA.rekeyWraps, ...planB.rekeyWraps]);

    // EXPECTED: {kind: "none"} — D-10's deliberate deferral, not adopt(A) and
    // not removed.
    const outcome = await readRekey(victimKeys, events, isAuthorized, victimPub, victim, []);
    expect(outcome.kind).toBe("none");
  });

  // ROTATE-06/07 / D-03: two decryptable authorized forks with no opaque
  // competitor — the lexicographically LOWEST new key wins (CORD-06 §3),
  // independent of arrival/array order.
  it("among two decryptable candidates, the lexicographically lowest new key wins (ROTATE-06/07, D-03)", async () => {
    const { material } = await genesis();
    const rotatorA = new PrivateKeySigner(generateSecretKey());
    const rotatorAPub = await rotatorA.getPublicKey();
    const rotatorB = new PrivateKeySigner(generateSecretKey());
    const rotatorBPub = await rotatorB.getPublicKey();
    const victim = new PrivateKeySigner(generateSecretKey());
    const victimPub = await victim.getPublicKey();
    const victimKeys = deriveConcordKeys(material, []);

    const keyOne = generateSecretKey();
    const keyTwo = generateSecretKey();
    // EXPECTED, independently derived from CORD-06 §3's literal text ("the
    // lexicographically lowest new key wins") via plain hex comparison — never
    // via lowerKeyWins/readRekeyScoped themselves.
    const expectedWinner = bytesToHex(keyOne) <= bytesToHex(keyTwo) ? keyOne : keyTwo;

    const planA = await buildRefounding(deriveConcordKeys(material, []), rotatorA, {
      recipients: [rotatorAPub, victimPub],
      self: rotatorAPub,
      heads: [],
      channels: [],
      newRoot: keyOne,
    });
    const planB = await buildRefounding(deriveConcordKeys(material, []), rotatorB, {
      recipients: [rotatorBPub, victimPub],
      self: rotatorBPub,
      heads: [],
      channels: [],
      newRoot: keyTwo,
    });
    const isAuthorized = (rotator: string) => rotator === rotatorAPub || rotator === rotatorBPub;
    const events = decodeRekey(victimKeys, [...planA.rekeyWraps, ...planB.rekeyWraps]);

    const outcome = await readRekey(victimKeys, events, isAuthorized, victimPub, victim, []);
    expect(outcome.kind).toBe("adopt");
    if (outcome.kind === "adopt") expect(outcome.next.material.community_root).toBe(bytesToHex(expectedWinner));
  });

  // Spec-strict removal control (D-03, unchanged by D-10): when the winner IS
  // fully decryptable (by other holders) and excludes us — the single
  // authorized, complete, continuity-matched fork in play, no opaque
  // competitor to defer against — a caller with an outranking canRemoveSelf
  // still gets removed. D-10 only widens deferral to the genuinely-ambiguous
  // opaque-competitor case; it never loosens this case.
  it("a single complete authorized fork excluding us still removes (spec-strict removal control, D-03)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();
    const droppedKeys = deriveConcordKeys(material, []);

    const plan = await buildRefounding(deriveConcordKeys(material, []), owner, {
      recipients: [ownerPub], // dropped excluded — no blob for them anywhere
      self: ownerPub,
      heads: [],
      channels: [],
    });
    const events = decodeRekey(droppedKeys, plan.rekeyWraps);

    // EXPECTED: {kind: "removed"} — CORD-06 §2's removal rule, unmodified by
    // D-10 since no opaque competitor exists here.
    const outcome = await readRekey(droppedKeys, events, () => true, droppedPub, dropped, [], () => true);
    expect(outcome.kind).toBe("removed");
  });

  // CR-01 (ROTATE-05 / D-06): a keep-set whose blob decrypt THREW (transient
  // signer blip) coexisting with a competing no-blob removal set from an
  // outranking authorized rotator must STILL defer. The decrypt-throw is
  // positive keep-evidence and outranks an unproven removal — regression for
  // the false-eviction gap where the removal path ignored the decrypt-throw
  // signal and honored the no-blob remover.
  it("a transient decrypt failure defers even when a competing no-blob removal set exists (ROTATE-05, D-06)", async () => {
    const { material } = await genesis();
    const keeper = new PrivateKeySigner(generateSecretKey());
    const keeperPub = await keeper.getPublicKey();
    const remover = new PrivateKeySigner(generateSecretKey());
    const removerPub = await remover.getPublicKey();
    const victim = new PrivateKeySigner(generateSecretKey());
    const victimPub = await victim.getPublicKey();
    const victimKeys = deriveConcordKeys(material, []);

    // Keep-set: keeper rotates and KEEPS the victim → a blob exists at the
    // victim's locator (its decrypt throws under withThrowingDecrypt).
    const planKeep = await buildRefounding(deriveConcordKeys(material, []), keeper, {
      recipients: [keeperPub, victimPub],
      self: keeperPub,
      heads: [],
      channels: [],
    });
    // Removal-set: remover rotates and EXCLUDES the victim → no blob, opaque.
    const planRemove = await buildRefounding(deriveConcordKeys(material, []), remover, {
      recipients: [removerPub],
      self: removerPub,
      heads: [],
      channels: [],
    });
    const isAuthorized = (rotator: string) => rotator === keeperPub || rotator === removerPub;
    const events = decodeRekey(victimKeys, [...planKeep.rekeyWraps, ...planRemove.rekeyWraps]);

    // EXPECTED: {kind: "none"} — D-06's "a decrypt failure is never absence,
    // never removal" applied across BOTH sets: the throw at our keep-locator
    // defers the whole epoch, so the outranking remover's no-blob set cannot
    // evict us. Hand-derived from the D-06 ruling, never read back from the fold.
    const outcome = await readRekey(
      victimKeys,
      events,
      isAuthorized,
      victimPub,
      withThrowingDecrypt(victim),
      [],
      () => true, // remover outranks the victim — must STILL not remove
    );
    expect(outcome.kind).toBe("none");
  });
});

// D-08/D-12 (ROTATE-08): the receive-side vac gate is a SEPARATE, independent
// check from `isAuthorized`/`canRemoveSelf` — a rotation the roster-bit check
// alone would honor is still excluded from candidacy (both adopt and removed)
// when its vac citation is missing or doesn't structurally resolve. Every
// `verifyVac` predicate below is hand-rolled in the test (never imported from
// `helpers/permissions.ts`'s `vacVerifier`), and every expected eid is
// hand-derived from `grantLocator` — CORD-04 §3's "a rotation cites the Grant
// it acts under" plus the D-08/D-12 rulings, never read back from the fold
// under test.
describe("readRekeyScoped vac verification (D-08/D-12)", () => {
  /** The hand-rolled vac verifier every test in this block uses: owner exempt,
   *  otherwise the citation's eid must equal grantLocator(community_id, rotator)
   *  — a purely structural check, matching D-12 (no live edition re-fetch). */
  function handRolledVerifyVac(material: JoinMaterial) {
    const cidBytes = hexToBytes(material.community_id);
    return (rotator: string, vac: [string, string, string] | undefined): boolean => {
      if (rotator === material.owner) return true;
      if (!vac) return false;
      return vac[0] === grantLocator(cidBytes, rotator);
    };
  }

  it("a non-owner rotation whose vac eid does not resolve to grantLocator is rejected — excluded from both adopt and removed", async () => {
    const { material } = await genesis();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();
    const droppedKeys = deriveConcordKeys(material, []);
    const rotator = new PrivateKeySigner(generateSecretKey());
    const rotatorPub = await rotator.getPublicKey();

    // A complete rotation the test's OWN isAuthorized/canRemoveSelf predicates
    // (both hardcoded true) would otherwise honor as a removal — but its vac
    // eid is hand-derived to NOT match grantLocator(cid, rotatorPub).
    const plan = await buildRefounding(deriveConcordKeys(material, []), rotator, {
      recipients: [rotatorPub],
      self: rotatorPub,
      heads: [],
      channels: [],
      vac: ["00".repeat(32), "1", "11".repeat(32)],
    });
    const events = decodeRekey(droppedKeys, plan.rekeyWraps);

    const outcome = await readRekey(
      droppedKeys,
      events,
      () => true, // isAuthorized: independent of vac, deliberately permissive here
      droppedPub,
      dropped,
      [],
      () => true, // canRemoveSelf: would honor the removal absent the vac gate
      handRolledVerifyVac(material),
    );
    // EXPECTED: {kind: "none"} — the vac gate excludes this set from candidacy
    // entirely (D-08), so it contributes to NEITHER removal nor adoption, even
    // though isAuthorized/canRemoveSelf alone would have honored it.
    expect(outcome.kind).toBe("none");
  });

  it("a non-owner rotation whose vac correctly resolves is honored (positive control)", async () => {
    const { material } = await genesis();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();
    const droppedKeys = deriveConcordKeys(material, []);
    const rotator = new PrivateKeySigner(generateSecretKey());
    const rotatorPub = await rotator.getPublicKey();

    // EXPECTED eid, hand-derived ONLY from grantLocator — never read back from
    // buildRefounding/vacVerifier.
    const expectedEid = grantLocator(hexToBytes(material.community_id), rotatorPub);
    const plan = await buildRefounding(deriveConcordKeys(material, []), rotator, {
      recipients: [rotatorPub],
      self: rotatorPub,
      heads: [],
      channels: [],
      vac: [expectedEid, "1", "22".repeat(32)],
    });
    const events = decodeRekey(droppedKeys, plan.rekeyWraps);

    const outcome = await readRekey(
      droppedKeys,
      events,
      () => true,
      droppedPub,
      dropped,
      [],
      () => true,
      handRolledVerifyVac(material),
    );
    expect(outcome.kind).toBe("removed");
  });

  it("the owner's rotation is honored with no vac at all (owner exemption, D-08)", async () => {
    const { owner, ownerPub, material } = await genesis();
    const dropped = new PrivateKeySigner(generateSecretKey());
    const droppedPub = await dropped.getPublicKey();
    const droppedKeys = deriveConcordKeys(material, []);

    // The owner rotates without a vac at all — buildRefounding/refound never
    // cite one for the owner (vacFor returns undefined for actor === owner).
    const plan = await buildRefounding(deriveConcordKeys(material, []), owner, {
      recipients: [ownerPub],
      self: ownerPub,
      heads: [],
      channels: [],
    });
    const events = decodeRekey(droppedKeys, plan.rekeyWraps);

    const outcome = await readRekey(
      droppedKeys,
      events,
      () => true,
      droppedPub,
      dropped,
      [],
      () => true,
      handRolledVerifyVac(material),
    );
    // EXPECTED: {kind: "removed"} — the owner needs no vac at all (CORD-04/D-08:
    // inherent authority, not a delegated Grant), matching refoundAuthority/
    // vacFor's existing ownership model.
    expect(outcome.kind).toBe("removed");
  });
});

// D-01/D-02/D-03 (CHAN-01/CHAN-03/TEST-01): material.channels is the SOLE source
// of a private channel's key. Every expected value below comes ONLY from
// channelGroupKey (crypto.ts) — never from channelKeyFor/deriveConcordKeys/
// channelKeyMemo — so these are not self-referential (implementation-compares-
// to-itself) assertions.
describe("channel-plane derivation (CORD-03 §1) — CHAN-01 / CHAN-03 / TEST-01", () => {
  it("keyless private channel metadata derives no key, no channelEpochs entry, no plane (CHAN-01)", async () => {
    const { material } = await genesis();
    const channelId = "11".repeat(32);
    const channel: ChannelMetadata = { channel_id: channelId, name: "secret", private: true };

    // material.channels holds no entry for this id — a routine, expected state
    // (every member sees channel metadata before being granted access).
    const keys = deriveConcordKeys(material, [channel]);

    expect(keys.channels.has(channelId)).toBe(false);
    expect(keys.channelEpochs.has(channelId)).toBe(false);

    // Non-aliasing (H07): the independently-derived PUBLIC pk for this same id
    // must NOT be present as a plane key either — a keyless private channel must
    // derive NOTHING, never silently fall through to the public formula.
    const publicExpected = channelGroupKey(
      hexToBytes(material.community_root),
      hexToBytes(channelId),
      material.root_epoch,
    );
    expect(keys.planes.has(publicExpected.pk)).toBe(false);
  });

  it("public channel derives channel_pk from community_root at root_epoch — CORD-03 §1 public branch, hand-derived (TEST-01)", async () => {
    const { material } = await genesis();
    const channelId = "22".repeat(32);
    const channel: ChannelMetadata = { channel_id: channelId, name: "general2", private: false };

    // EXPECTED, independently derived from CORD-03 §1's public formula:
    // group_key("concord/channel", community_root, channel_id, root_epoch).
    const expected = channelGroupKey(hexToBytes(material.community_root), hexToBytes(channelId), material.root_epoch);

    const keys = deriveConcordKeys(material, [channel]);
    expect(keys.channels.get(channelId)?.pk).toBe(expected.pk);
  });

  it("keyed private channel derives channel_pk from its own key at its own epoch — CORD-03 §1 private branch, hand-derived (TEST-01)", async () => {
    const { material } = await genesis();
    const channelId = "33".repeat(32);
    const channelKey = bytesToHex(generateSecretKey());
    const heldEpoch = 3; // a distinct, non-1 epoch — proves the held epoch flows through, not a hardcoded default
    const withKey: JoinMaterial = {
      ...material,
      channels: [...material.channels, { id: channelId, key: channelKey, epoch: heldEpoch, name: "secret-room" }],
    };
    const channel: ChannelMetadata = { channel_id: channelId, name: "secret-room", private: true };

    // EXPECTED, independently derived from CORD-03 §1's private branch:
    // group_key("concord/channel", channel_key, channel_id, channel_epoch).
    const expected = channelGroupKey(hexToBytes(channelKey), hexToBytes(channelId), heldEpoch);
    // Non-vacuity (H07): must differ from the independently-derived PUBLIC address
    // for the same id — a keyed private channel is not the public collision either.
    const publicExpected = channelGroupKey(
      hexToBytes(withKey.community_root),
      hexToBytes(channelId),
      withKey.root_epoch,
    );

    const keys = deriveConcordKeys(withKey, [channel]);
    expect(keys.channels.get(channelId)?.pk).toBe(expected.pk);
    expect(keys.channels.get(channelId)?.pk).not.toBe(publicExpected.pk);
  });

  it("channelEpochs records the held key's epoch, not the edition epoch (CHAN-03)", async () => {
    const { material } = await genesis();
    const channelId = "44".repeat(32);
    const channelKey = bytesToHex(generateSecretKey());
    const heldEpoch = 5; // the epoch the held key actually derived at
    const withKey: JoinMaterial = {
      ...material,
      channels: [...material.channels, { id: channelId, key: channelKey, epoch: heldEpoch, name: "room" }],
    };
    // The edition carries only display fields post-D-01 — ChannelMetadata no
    // longer has an `epoch` field at all, so there is no edition-side number to
    // read even by accident; channelEpochs MUST come from the held entry.
    const channel: ChannelMetadata = { channel_id: channelId, name: "room", private: true };

    const keys = deriveConcordKeys(withKey, [channel]);
    expect(keys.channelEpochs.get(channelId)).toBe(heldEpoch);
  });
});

describe("group-key memoization", () => {
  it("reuses the base keys across derivations that share the same material object", async () => {
    const { material } = await genesis();
    const a = deriveConcordKeys(material, []);
    const b = deriveConcordKeys(material, []);
    // Same material object → the expensive group keys are the SAME instances (memo hit).
    expect(b.control).toBe(a.control);
    expect(b.guestbook).toBe(a.guestbook);
    expect(b.dissolved).toBe(a.dissolved);
    expect(b.nextBaseRekey.key).toBe(a.nextBaseRekey.key);
  });

  it("re-derives byte-identical keys for a different material object (correctness, not identity)", async () => {
    const { material } = await genesis();
    const a = deriveConcordKeys(material, []);
    // A structurally-identical but distinct object must miss the memo and recompute.
    const clone = JSON.parse(JSON.stringify(material)) as typeof material;
    const b = deriveConcordKeys(clone, []);
    expect(b.control).not.toBe(a.control); // distinct instance (recomputed)
    expect(b.control.pk).toBe(a.control.pk); // …but identical derivation
    expect(b.control.sk).toEqual(a.control.sk);
    expect(b.control.convKey).toEqual(a.control.convKey);
  });

  it("reuses prior channels' keys and derives only the newly added one", async () => {
    const { material } = await genesis();
    const chA: ChannelMetadata = { channel_id: "ab".repeat(32), name: "a", private: false };
    const chB: ChannelMetadata = { channel_id: "cd".repeat(32), name: "b", private: false };

    const first = deriveConcordKeys(material, [chA]);
    const second = deriveConcordKeys(material, [chA, chB]);
    // chA's key is served from the material's memo; chB is freshly derived.
    expect(second.channels.get(chA.channel_id)).toBe(first.channels.get(chA.channel_id));
    expect(second.channels.get(chB.channel_id)).toBeDefined();
    expect(second.channels.get(chB.channel_id)).not.toBe(second.channels.get(chA.channel_id));
  });

  it("memoizes a private channel's message-plane keys on its ChannelKey object", async () => {
    const { material } = await genesis();
    const channel: ChannelKey = {
      id: "ef".repeat(32),
      key: bytesToHex(generateSecretKey()),
      epoch: 1,
      name: "room",
    };
    const a = deriveChannelKeys(material, channel);
    const b = deriveChannelKeys(material, channel);
    expect(b.current).toBe(a.current); // same channel object → memo hit

    // A distinct clone recomputes an identical current key.
    const clone = JSON.parse(JSON.stringify(channel)) as ChannelKey;
    const c = deriveChannelKeys(material, clone);
    expect(c.current).not.toBe(a.current);
    expect(c.current.pk).toBe(a.current.pk);
  });

  it("does not serialize derived secret keys onto the material", async () => {
    const { material } = await genesis();
    const keys = deriveConcordKeys(material, []);
    // Symbol-keyed memo props are skipped by JSON.stringify — no sk leaks to storage.
    expect(JSON.stringify(material)).not.toContain(bytesToHex(keys.control.sk));
  });
});
