// The single Concord key-state object and the functional operations over it.
//
// All of a community's cryptographic material for an epoch lives in one
// `ConcordKeys` value, derived purely from its `JoinMaterial` plus the folded
// channel set. Wrapping an event and rotating keys (Refounding) are pure
// functions over that value — the signer is always a *separate* argument
// (mirroring stream.ts's `author`), so the crypto never needs the client class.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { unixNow } from "applesauce-core/helpers/time";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { ISigner } from "applesauce-signers";

import {
  baseRekeyGroupKey,
  controlGroupKey,
  dissolvedGroupKey,
  epochKeyCommitment,
  guestbookGroupKey,
} from "./crypto.js";
import type { GroupKey } from "./crypto.js";
import { channelKeyFor } from "./community.js";
import {
  base64ToBytes,
  bytesToBase64,
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  parseRekey,
  rekeyLocator,
  ROOT_SCOPE_HEX,
} from "./rekey.js";
import { giftWrap, rewrapSeal, sealRumor, toRumor, wrapSeal } from "../operations/gift-wrap.js";
import { buildRekeyFactories } from "../factories/rekey.js";
import { buildSnapshotFactories } from "../factories/guestbook.js";
import { PLAINTEXT_SEAL_KIND } from "./gift-wrap.js";
import type { ChannelMetadata, DecodedEvent, JoinMaterial, RumorTemplate } from "../types.js";

/** A decrypt-side descriptor: which plane a stream pubkey addresses, and the
 *  NIP-44 conversation key that opens its wraps. */
export interface PlaneInfo {
  type: "control" | "guestbook" | "channel" | "dissolved" | "rekey";
  convKey: Uint8Array;
  channelId?: string;
  epoch?: number;
}

/**
 * Every cryptographic key a member holds for a community at its current epoch —
 * the single state object. Derived purely from {@link JoinMaterial} + the folded
 * channels via {@link deriveConcordKeys}; `material` is the persisted source of
 * truth the rest is a function of.
 */
export interface ConcordKeys {
  /** The persisted membership/key material this derives from. */
  material: JoinMaterial;
  control: GroupKey;
  guestbook: GroupKey;
  dissolved: GroupKey;
  /** The NEXT epoch's base-rekey listen address (CORD-06 §2): a Refounding
   *  publishes the new community_root here, keyed by the PRIOR root. */
  nextBaseRekey: { key: GroupKey; epoch: number };
  /** channel_id -> group key (public derived from root; private from its key). */
  channels: Map<string, GroupKey>;
  /** channel_id -> the epoch its key derives at (for the CORD-03 receive binding). */
  channelEpochs: Map<string, number>;
  /** Decrypt-side lookup: stream pubkey -> plane info, spanning every plane and
   *  (after a Refounding) retained prior-epoch addresses so history still decodes. */
  planes: Map<string, PlaneInfo>;
}

/** The epoch a channel's chat key derives at: its own for a private channel, the
 *  community root epoch for a public one. */
export function channelEpochOf(keys: ConcordKeys, channelId: string): number {
  return keys.channelEpochs.get(channelId) ?? keys.material.root_epoch;
}

/**
 * Derive the full key state for `material` at its current epoch. Pass `prior` to
 * retain its (prior-epoch) plane addresses in the returned `planes` map — a
 * Refounding rolls the current epoch forward but already-fetched history must
 * still decode at the addresses it was wrapped under.
 */
export function deriveConcordKeys(
  material: JoinMaterial,
  channels: ChannelMetadata[],
  prior?: ConcordKeys,
): ConcordKeys {
  const cid = hexToBytes(material.community_id);
  const root = hexToBytes(material.community_root);

  const control = controlGroupKey(root, cid, material.root_epoch);
  const guestbook = guestbookGroupKey(root, cid, material.root_epoch);
  const dissolved = dissolvedGroupKey(cid);
  const nextEpoch = material.root_epoch + 1;
  const nextBaseRekey = { key: baseRekeyGroupKey(root, cid, nextEpoch), epoch: nextEpoch };

  const channelKeys = new Map<string, GroupKey>();
  const channelEpochs = new Map<string, number>();
  for (const ch of channels) {
    channelKeys.set(ch.channel_id, channelKeyFor(material, ch));
    channelEpochs.set(ch.channel_id, ch.private ? (ch.epoch ?? 1) : material.root_epoch);
  }

  const planes = new Map<string, PlaneInfo>(prior?.planes);
  planes.set(control.pk, { type: "control", convKey: control.convKey });
  planes.set(guestbook.pk, { type: "guestbook", convKey: guestbook.convKey });
  planes.set(dissolved.pk, { type: "dissolved", convKey: dissolved.convKey });
  planes.set(nextBaseRekey.key.pk, { type: "rekey", convKey: nextBaseRekey.key.convKey, epoch: nextEpoch });
  for (const [channelId, key] of channelKeys) {
    planes.set(key.pk, { type: "channel", convKey: key.convKey, channelId, epoch: channelEpochs.get(channelId) });
  }

  return { material, control, guestbook, dissolved, nextBaseRekey, channels: channelKeys, channelEpochs, planes };
}

// ---- wrapping --------------------------------------------------------------

/** Which plane to wrap an event for. */
export type WrapTarget = { plane: "control" | "guestbook" | "dissolved" } | { plane: "channel"; channelId: string };

/** Resolve a {@link WrapTarget} to the stream {@link GroupKey} that addresses it. */
export function planeKeyFor(keys: ConcordKeys, target: WrapTarget): GroupKey {
  switch (target.plane) {
    case "control":
      return keys.control;
    case "guestbook":
      return keys.guestbook;
    case "dissolved":
      return keys.dissolved;
    case "channel": {
      const key = keys.channels.get(target.channelId);
      if (!key) throw new Error("unknown channel");
      return key;
    }
  }
}

/**
 * Seal + gift-wrap a rumor for a plane, purely from the key state + a signer.
 * Any build-time `created_at` is dropped so the envelope stamps the rumor at
 * wrap time (CORD-02). Returns the kind-1059 wrap and the inner rumor id.
 */
export async function wrapForTarget(
  keys: ConcordKeys,
  target: WrapTarget,
  author: ISigner,
  rumor: RumorTemplate,
  opts: { plaintext?: boolean; ephemeral?: boolean } = {},
): Promise<{ wrap: NostrEvent; rumorId: string }> {
  const key = planeKeyFor(keys, target);
  // Drop any build-time created_at and re-stamp at wrap time (CORD-02). Build the
  // rumor first so we can return its id, then seal + wrap it onto the plane.
  const { created_at: _publishTime, ...template } = rumor;
  const stamped = await toRumor(author)({ ...template, created_at: unixNow() });
  const seal = await sealRumor(key.convKey, author, { plaintext: opts.plaintext })(stamped);
  const wrap = await wrapSeal(key.sk, key.convKey, { ephemeral: opts.ephemeral })(seal);
  return { wrap, rumorId: stamped.id };
}

/**
 * Mint a fresh private-channel key and return a new key state with it appended
 * to `material.channels` (immutably — the input is unchanged). The channel's
 * stream key only surfaces once its CHANNEL edition folds, since the derived
 * addresses come from the folded channel set; this only records the secret so it
 * can be persisted and shared in invites.
 */
export function addChannelKey(keys: ConcordKeys, channelId: string, name: string): ConcordKeys {
  const key = bytesToHex(generateSecretKey());
  const material: JoinMaterial = {
    ...keys.material,
    channels: [...keys.material.channels, { id: channelId, key, epoch: 1, name }],
  };
  return { ...keys, material };
}

// ---- rekey / Refounding (CORD-06) ------------------------------------------

/**
 * Roll the key state forward to a new community_root/epoch: keep the prior root
 * in `held_roots` so past history stays decodable, then re-derive every address
 * while retaining the prior planes (so already-fetched wraps still decode).
 */
export function rollForward(
  keys: ConcordKeys,
  newRoot: Uint8Array,
  newEpoch: number,
  refounder: string,
  channels: ChannelMetadata[],
): ConcordKeys {
  const priorRoots = Array.isArray(keys.material.held_roots) ? keys.material.held_roots : [];
  const material: JoinMaterial = {
    ...keys.material,
    community_root: bytesToHex(newRoot),
    root_epoch: newEpoch,
    refounder,
    held_roots: [{ epoch: keys.material.root_epoch, key: keys.material.community_root }, ...priorRoots],
  };
  return deriveConcordKeys(material, channels, keys);
}

/** The wraps a Refounding must publish, plus the rolled-forward key state. */
export interface RefoundingPlan {
  /** Per-recipient rekey blobs at the base-rekey address — publish (await) first. */
  rekeyWraps: NostrEvent[];
  /** Control-plane heads re-wrapped into the new epoch (best-effort). */
  compactionWraps: NostrEvent[];
  /** New-guestbook snapshot rumors (best-effort, non-gating). */
  snapshotWraps: NostrEvent[];
  /** The key state to adopt once the rekey blobs are published. */
  next: ConcordKeys;
  newEpoch: number;
}

/**
 * Build a Refounding (CORD-06 §3): mint a new community_root, deliver it to
 * `recipients` as per-recipient rekey blobs at the base-rekey address (under the
 * PRIOR root), compact the Control Plane by re-wrapping each head's plaintext
 * seal into the new epoch, and seed the new Guestbook with a snapshot. Pure over
 * `(keys, signer)`; the caller publishes the returned wraps and adopts `next`.
 * Requires a NIP-44 signer (pairwise wrapping is an ECDH either side computes).
 */
export async function buildRefounding(
  keys: ConcordKeys,
  signer: ISigner,
  opts: {
    /** The npubs that keep access (must include `self`). */
    recipients: string[];
    /** The rotator (our) hex pubkey. */
    self: string;
    /** The Control-Plane winning heads, for compaction. */
    heads: Iterable<DecodedEvent>;
    /** The current folded channels, for re-deriving the rolled key state. */
    channels: ChannelMetadata[];
    /** Injectable new root (tests); defaults to a fresh random key. */
    newRoot?: Uint8Array;
  },
): Promise<RefoundingPlan> {
  if (!signer.nip44) throw new Error("this signer can't rotate keys (NIP-44 unsupported)");
  const { material } = keys;
  const oldRoot = hexToBytes(material.community_root);
  const oldEpoch = material.root_epoch;
  const newEpoch = oldEpoch + 1;
  const cidBytes = hexToBytes(material.community_id);
  const newRoot = opts.newRoot ?? generateSecretKey();
  const prevCommit = bytesToHex(epochKeyCommitment(oldEpoch, oldRoot));

  // 1. The root roll: per-recipient rekey blobs at the base-rekey address (keyed
  //    by the PRIOR root, so every current holder converges).
  const plain = bytesToBase64(encodeWrappedKey(new Uint8Array(32), BigInt(newEpoch), newRoot));
  const blobs = [];
  for (const pk of opts.recipients) {
    const wrapped = await signer.nip44.encrypt(pk, plain);
    blobs.push({ locator: rekeyLocator(opts.self, pk, ROOT_SCOPE_HEX, BigInt(newEpoch)), wrapped });
  }
  const rekeyAddr = baseRekeyGroupKey(oldRoot, cidBytes, newEpoch);
  const rekeyWraps: NostrEvent[] = [];
  for (const factory of buildRekeyFactories(
    { scope: { kind: "root" }, newEpoch: BigInt(newEpoch), prevEpoch: BigInt(oldEpoch), prevCommit },
    blobs,
  )) {
    const wrap = await giftWrap(rekeyAddr.sk, rekeyAddr.convKey, signer)(await factory);
    rekeyWraps.push(wrap);
  }

  // 2. Compaction: re-wrap each Control-Plane head's plaintext seal into the new
  //    epoch so members read current state without re-syncing from genesis.
  const newControl = controlGroupKey(newRoot, cidBytes, newEpoch);
  const compactionWraps: NostrEvent[] = [];
  for (const head of opts.heads) {
    if (!head.seal || head.sealKind !== PLAINTEXT_SEAL_KIND) continue;
    try {
      compactionWraps.push(rewrapSeal(head.seal, newControl.sk, newControl.convKey));
    } catch {
      /* an encrypted-seal head can't re-wrap; control heads are plaintext by construction */
    }
  }

  // 3. Guestbook snapshot (best-effort, non-gating — CORD-02 §5).
  const newGuestbook = guestbookGroupKey(newRoot, cidBytes, newEpoch);
  const snapshotWraps: NostrEvent[] = [];
  for (const factory of buildSnapshotFactories(opts.recipients, bytesToHex(generateSecretKey()))) {
    const wrap = await giftWrap(newGuestbook.sk, newGuestbook.convKey, signer)(await factory);
    snapshotWraps.push(wrap);
  }

  const next = rollForward(keys, newRoot, newEpoch, opts.self, opts.channels);
  return { rekeyWraps, compactionWraps, snapshotWraps, next, newEpoch };
}

/** The outcome of folding the rekey blobs at the next-epoch base-rekey address. */
export type RekeyOutcome =
  | { kind: "adopt"; next: ConcordKeys; rotator: string; epoch: number }
  | { kind: "removed"; epoch: number }
  | { kind: "none" };

/**
 * Fold the rekey blobs at the next-epoch base-rekey address (CORD-06 §2/§3): a
 * complete, AUTHORIZED, continuity-checked root rotation carrying our blob means
 * adopt the new root (racing rotations converge on the lowest key); a complete
 * rotation with NO blob for us means we've been removed. Authority is the roster
 * (`isAuthorized`), never key possession. Pure over `(keys, signer)`; the caller
 * decides what to do with the outcome. Requires a NIP-44 signer.
 */
export async function readRekey(
  keys: ConcordKeys,
  rekeyEvents: Iterable<DecodedEvent>,
  isAuthorized: (rotator: string) => boolean,
  self: string,
  signer: ISigner,
  channels: ChannelMetadata[],
): Promise<RekeyOutcome> {
  if (!signer.nip44) return { kind: "none" };
  const heldEpoch = BigInt(keys.material.root_epoch);
  const heldKey = hexToBytes(keys.material.community_root);

  const parsed = [...rekeyEvents].map((d) => parseRekey(d)).filter((p): p is NonNullable<typeof p> => p !== null);
  const rotations = groupRotations(parsed).filter(
    (set) =>
      set.scopeIdHex === ROOT_SCOPE_HEX &&
      set.newEpoch === heldEpoch + 1n &&
      isAuthorized(set.rotator) &&
      checkContinuity(set, heldEpoch, heldKey).ok,
  );
  if (rotations.length === 0) return { kind: "none" };

  const targetEpoch = keys.material.root_epoch + 1;
  let adopted: { key: Uint8Array; rotator: string } | undefined;
  let sawComplete = false;
  for (const set of rotations) {
    if (!set.complete) continue;
    sawComplete = true;
    const blob = findBlob(set, rekeyLocator(set.rotator, self, ROOT_SCOPE_HEX, set.newEpoch));
    if (!blob) continue;
    try {
      const plain = await signer.nip44.decrypt(set.rotator, blob.wrapped);
      const newKey = decodeWrappedKey(base64ToBytes(plain), new Uint8Array(32), set.newEpoch);
      if (!adopted || lowerKeyWins(adopted.key, newKey) === newKey) adopted = { key: newKey, rotator: set.rotator };
    } catch {
      // undecryptable blob at our locator — treat as absent
    }
  }

  if (adopted) {
    return {
      kind: "adopt",
      next: rollForward(keys, adopted.key, targetEpoch, adopted.rotator, channels),
      rotator: adopted.rotator,
      epoch: targetEpoch,
    };
  }
  if (sawComplete) return { kind: "removed", epoch: targetEpoch };
  return { kind: "none" };
}
