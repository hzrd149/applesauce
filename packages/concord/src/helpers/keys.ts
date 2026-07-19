// The single Concord key-state object and the functional operations over it.
//
// All of a community's cryptographic material for an epoch lives in one
// `ConcordKeys` value, derived purely from its `JoinMaterial` plus the folded
// channel set. Wrapping an event and rotating keys (Refounding) are pure
// functions over that value — the signer is always a *separate* argument
// (mirroring stream.ts's `author`), so the crypto never needs the client class.

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { unixNow } from "applesauce-core/helpers/time";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { ISigner } from "applesauce-signers";

import {
  baseRekeyGroupKey,
  channelGroupKey,
  channelRekeyGroupKey,
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
  buildRekeyRumors,
} from "./rekey.js";
import { giftWrap, rewrapSeal, sealRumor, toRumor, wrapSeal } from "../operations/gift-wrap.js";
import { buildSnapshotFactories } from "../factories/guestbook.js";
import { PLAINTEXT_SEAL_KIND } from "./gift-wrap.js";
import type { ChannelKey, ChannelMetadata, DecodedEvent, JoinMaterial, RumorTemplate } from "../types.js";

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

/** The base (channel-independent) group keys, a pure function of `material`.
 *  Memoized on the material object (see {@link baseKeysFor}). */
interface BaseKeys {
  control: GroupKey;
  guestbook: GroupKey;
  dissolved: GroupKey;
  nextBaseRekey: { key: GroupKey; epoch: number };
}

/**
 * Every group key derives from `material` (community_root / root_epoch /
 * community_id / channels), which is a STABLE object on the hot path —
 * `deriveConcordKeys` returns the same `material` it was handed, and
 * `reconcileLive` threads that one object through every state emission. So we
 * memoize the expensive secp256k1 derivations directly on it (the repo's
 * `getOrComputeCachedValue` symbol pattern), computed once and reused until a
 * rekey/Refounding mints a fresh `material` — exactly when the keys must change.
 *
 * That claim is true NOW, and only because `applesauce-core`'s cache helper writes the
 * memo non-enumerable (see `cache.ts`'s identity-memo taxonomy): object spread only
 * copies enumerable own properties, so a non-enumerable memo is dropped instead of riding
 * along stale when `rollForward`'s spread mints fresh material via `{ ...keys.material,
 * community_root: newRoot, ... }`.
 *
 * It was NOT true before that fix — this is CONCORD-H01. Until then, `getOrComputeCachedValue`
 * ITSELF wrote enumerable — `baseKeysFor` has always called it; the write was inside the
 * shared helper, never hand-rolled here — so the PRIOR epoch's cached keys rode along on
 * `rollForward`'s spread and `baseKeysFor` silently kept returning the old epoch's keys
 * after every Refounding.
 *
 * `JSON.stringify` and object spread treat symbol-keyed properties in exactly OPPOSITE
 * ways, and that asymmetry was the entire bug. Symbol-keyed props ARE skipped by
 * `JSON.stringify`, so the cached secret keys never leak into persisted material — this
 * half of the original reasoning was always true, and it's why a process restart silently
 * healed the bug instead of it surfacing as a repro. But spread copies enumerable
 * symbol-keyed props, and the original comment never considered spread.
 */
const BaseKeysSymbol = Symbol.for("concord-base-keys");
const ChannelKeysSymbol = Symbol.for("concord-channel-keys");
/** Memoizes a Private Channel's current + held message-plane keys on its
 *  {@link ChannelKey} object (see {@link deriveChannelKeys}). */
const ChannelPlaneKeysSymbol = Symbol.for("concord-channel-plane-keys");

/** The base keys for `material`, derived once and memoized on it. */
function baseKeysFor(material: JoinMaterial): BaseKeys {
  return getOrComputeCachedValue(material, BaseKeysSymbol, () => {
    const cid = hexToBytes(material.community_id);
    const root = hexToBytes(material.community_root);
    const nextEpoch = material.root_epoch + 1;
    return {
      control: controlGroupKey(root, cid, material.root_epoch),
      guestbook: guestbookGroupKey(root, cid, material.root_epoch),
      dissolved: dissolvedGroupKey(cid),
      nextBaseRekey: { key: baseRekeyGroupKey(root, cid, nextEpoch), epoch: nextEpoch },
    };
  });
}

/** A channel's Chat-Plane group key for `material`, memoized on `material` keyed
 *  by a per-channel signature (public keys derive from the material's root/epoch,
 *  so `channel_id` disambiguates within a material; the private key/epoch are
 *  sourced from `material.channels` — the single source of truth post-D-01 —
 *  and folded in for safety since a private channel derives from its own secret).
 *  Returns `null` when a private channel has no held key (CHAN-01: derives
 *  nothing); the `null` itself is memoized (`cache.has`, not truthiness) so a
 *  cached "no key" result isn't recomputed every call. */
function channelKeyMemo(material: JoinMaterial, channel: ChannelMetadata): GroupKey | null {
  const cache = getOrComputeCachedValue(material, ChannelKeysSymbol, () => new Map<string, GroupKey | null>());
  const held = channel.private ? material.channels.find((c) => c.id === channel.channel_id) : undefined;
  const sig = channel.private
    ? held
      ? `p|${channel.channel_id}|${held.key}|${held.epoch}`
      : `p0|${channel.channel_id}`
    : `c|${channel.channel_id}`;
  if (cache.has(sig)) return cache.get(sig)!;
  const gk = channelKeyFor(material, channel);
  cache.set(sig, gk);
  return gk;
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
  const { control, guestbook, dissolved, nextBaseRekey } = baseKeysFor(material);
  const nextEpoch = nextBaseRekey.epoch;

  const channelKeys = new Map<string, GroupKey>();
  const channelEpochs = new Map<string, number>();
  for (const ch of channels) {
    const gk = channelKeyMemo(material, ch);
    if (!gk) continue; // CHAN-01: keyless private channel — no entry, no epoch, no plane
    const held = ch.private ? material.channels.find((c) => c.id === ch.channel_id) : undefined;
    channelKeys.set(ch.channel_id, gk);
    // CHAN-03: the epoch the held key actually derived at, never ch.epoch ?? 1
    // off the edition (that field no longer exists post-D-01).
    channelEpochs.set(ch.channel_id, ch.private ? held!.epoch : material.root_epoch);
  }

  const planes = new Map<string, PlaneInfo>(prior?.planes);
  planes.set(control.pk, { type: "control", convKey: control.convKey });
  // The Guestbook rides the epoch (CORD-02 §5): stamp it so `planeStoreKey`
  // (client/sync.ts) can key its store per epoch, unlike control/dissolved.
  planes.set(guestbook.pk, { type: "guestbook", convKey: guestbook.convKey, epoch: material.root_epoch });
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
  /** Channel-scoped rekey blobs for the bundled private channels (CORD-06 §94),
   *  sealed under the PRIOR root — publish (await) alongside `rekeyWraps`. Empty
   *  unless `channelRekeys` was passed. */
  channelRekeyWraps: NostrEvent[];
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
    /** Private channels to ALSO rekey (CORD-06 §94), each to its own recipients —
     *  sealed under the prior root so the blob is openable on either base fork. */
    channelRekeys?: Array<{ channel: ChannelKey; recipients: string[] }>;
    /** Injectable new root (tests); defaults to a fresh random key. */
    newRoot?: Uint8Array;
    /** The rotator's own Grant citation (CORD-04 `vac`, D-08) — omitted for the
     *  owner. Rides both the root-roll rumors and any bundled channel rekeys
     *  (same rotator, same citation). */
    vac?: [string, string, string];
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
  for (const rumor of buildRekeyRumors(
    { scope: { kind: "root" }, newEpoch: BigInt(newEpoch), prevEpoch: BigInt(oldEpoch), prevCommit, vac: opts.vac },
    blobs,
  )) {
    const wrap = await giftWrap(rekeyAddr.sk, rekeyAddr.convKey, signer)(await rumor);
    rekeyWraps.push(wrap);
  }

  // 1b. Channel rekeys (CORD-06 §94): rotate each named Private Channel, delivering
  //     its new key only to that channel's kept members. Sealed under the PRIOR
  //     root (buildChannelRekey's default) so the blob stays openable on either
  //     base fork under a racing Refounding. The rolled channel keys are NOT baked
  //     into `next` — each channel's sub-engine reads its own rekey and persists.
  const channelRekeyWraps: NostrEvent[] = [];
  for (const { channel, recipients } of opts.channelRekeys ?? []) {
    const cr = await buildChannelRekey(material, channel, signer, { recipients, self: opts.self, vac: opts.vac });
    channelRekeyWraps.push(...cr.rekeyWraps);
  }

  // 2. Compaction: re-wrap each Control-Plane head's plaintext seal into the new
  //    epoch so members read current state without re-syncing from genesis.
  const newControl = controlGroupKey(newRoot, cidBytes, newEpoch);
  const compactionWraps: NostrEvent[] = [];
  for (const head of opts.heads) {
    // CORD-06 §3: "If the Refounder cannot reliably fold all Control events, the
    // Refounding must be aborted." A non-plaintext or un-rewrappable head can't be
    // safely compacted into the new epoch — abort (throw) BEFORE any wraps are
    // returned, rather than silently skipping it and shipping a partial
    // compactionWraps set. buildRefounding is awaited before refound() publishes
    // anything, so this throw aborts the whole Refounding atomically.
    if (!head.seal || head.sealKind !== PLAINTEXT_SEAL_KIND)
      throw new Error("refounding aborted: control head cannot be folded into the new epoch");
    try {
      compactionWraps.push(rewrapSeal(head.seal, newControl.sk, newControl.convKey));
    } catch {
      throw new Error("refounding aborted: control head cannot be folded into the new epoch");
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
  return { rekeyWraps, channelRekeyWraps, compactionWraps, snapshotWraps, next, newEpoch };
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
  canRemoveSelf?: (rotator: string) => boolean,
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean,
): Promise<RekeyOutcome> {
  if (!signer.nip44) return { kind: "none" };
  const scoped = await readRekeyScoped(
    {
      scopeIdHex: ROOT_SCOPE_HEX,
      scopeId: new Uint8Array(32),
      heldEpoch: keys.material.root_epoch,
      heldKey: hexToBytes(keys.material.community_root),
      canRemoveSelf,
      verifyVac,
    },
    rekeyEvents,
    isAuthorized,
    self,
    signer,
  );
  if (scoped.kind === "adopt")
    return {
      kind: "adopt",
      next: rollForward(keys, scoped.newKey, scoped.epoch, scoped.rotator, channels),
      rotator: scoped.rotator,
      epoch: scoped.epoch,
    };
  if (scoped.kind === "removed") return { kind: "removed", epoch: scoped.epoch };
  return { kind: "none" };
}

// ---- channel-scoped rekey (CORD-06) ----------------------------------------
//
// A Private Channel is a sub-community: independently keyed (unrelated to the
// community_root, CORD-03) at its OWN epoch, so it can be rekeyed alone. The
// scope-generic wire codec + convergence machinery (rekey.ts) are shared with
// the root Refounding via `readRekeyScoped`; only the held key/epoch and the
// listen address differ.

/** The held key + scope a rekey read is evaluated against. */
interface ScopedHeld {
  /** Lowercased 32-byte scope id hex: `ROOT_SCOPE_HEX` or the channel id. */
  scopeIdHex: string;
  /** The scope id bytes (zeros for root, channel id for a channel). */
  scopeId: Uint8Array;
  /** The epoch of the key we currently hold for this scope. */
  heldEpoch: number;
  /** The key we currently hold for this scope. */
  heldKey: Uint8Array;
  /**
   * Whether `rotator` is authorized to remove US specifically (CORD-04: holds the
   * bit AND strictly outranks us). Gates ONLY the `removed` outcome, never
   * adoption — so a lower-ranked manager can't sever a higher-ranked member by
   * rotating them out, but legitimate convergence among peers is unaffected.
   * REQUIRED to honor a removal: CORD-06 §3 requires the outrank check "in both"
   * the root and channel paths, so an omitted predicate fails closed — a removal
   * is denied, not permitted, when this is absent.
   */
  canRemoveSelf?: (rotator: string) => boolean;
  /**
   * vac verification against the folded Roster (CORD-04 D-08/D-12) — the
   * receive-side sibling of `canRemoveSelf`, gating whether a rotator is
   * honored AT ALL (both adopt and removed), independent of the `isAuthorized`
   * roster-bit check already applied above. Built by {@link vacVerifier}. When
   * ABSENT, no vac gating happens (opt-in, unlike `canRemoveSelf`'s
   * fail-closed-on-absence) — every real call site supplies one; tests may omit
   * it.
   */
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean;
}

type ScopedRekeyOutcome =
  | { kind: "adopt"; newKey: Uint8Array; rotator: string; epoch: number }
  | { kind: "removed"; epoch: number }
  | { kind: "none" };

/**
 * The scope-generic core of the rekey read (CORD-06 §2/§3, D-06/D-10): among
 * AUTHORIZED, continuity-checked, COMPLETE rotations to `heldEpoch + 1` for this
 * scope, partition into DECRYPTABLE candidates (blob found at our locator and
 * decrypted) vs opaque sets we cannot rank — either we hold no blob at all for a
 * set (a competing fork we cannot rank), or a blob exists at our locator but
 * decrypting it threw (D-06: positive evidence we ARE in that set, outcome
 * undetermined — never absence, never removal on its own). The lowest key among
 * decryptable candidates wins (`lowerKeyWins`), but if ANY opaque set also
 * exists we cannot prove that candidate is the true global-lowest, so we defer
 * (`none`, D-10) rather than blindly adopt. With zero decryptable candidates,
 * a genuine no-blob set means we're excluded from every candidate that exists —
 * removed, gated by `canRemoveSelf` against that set's rotator (fail-closed, as
 * before); a decrypt-threw set alone never reaches this branch (D-06).
 * `signer.nip44` must be present (callers guard).
 */
async function readRekeyScoped(
  held: ScopedHeld,
  rekeyEvents: Iterable<DecodedEvent>,
  isAuthorized: (rotator: string) => boolean,
  self: string,
  signer: ISigner,
): Promise<ScopedRekeyOutcome> {
  const heldEpoch = BigInt(held.heldEpoch);
  const parsed = [...rekeyEvents].map((d) => parseRekey(d)).filter((p): p is NonNullable<typeof p> => p !== null);
  const rotations = groupRotations(parsed).filter(
    (set) =>
      set.scopeIdHex === held.scopeIdHex &&
      set.newEpoch === heldEpoch + 1n &&
      isAuthorized(set.rotator) &&
      checkContinuity(set, heldEpoch, held.heldKey).ok &&
      // D-08/D-12: a non-owner set whose vac citation fails to verify against
      // the folded Roster is excluded from candidacy entirely — treated as
      // unauthorized, so it contributes to neither adopt nor removed.
      (held.verifyVac === undefined || held.verifyVac(set.rotator, set.vac) === true),
  );
  if (rotations.length === 0) return { kind: "none" };

  const targetEpoch = held.heldEpoch + 1;
  const decryptable: { key: Uint8Array; rotator: string }[] = [];
  const noBlobRotators: string[] = []; // genuinely excluded from these sets — removal candidates
  let opaqueCompetitor = false; // no-blob OR decrypt-threw set: cannot be ranked

  for (const set of rotations) {
    if (!set.complete) continue;
    const blob = findBlob(set, rekeyLocator(set.rotator, self, held.scopeIdHex, set.newEpoch));
    if (!blob) {
      // No blob for us anywhere in this complete authorized+continuity set: a
      // competing fork we cannot rank, and — if it turns out to be the only
      // kind of set in play — the classic removal case.
      opaqueCompetitor = true;
      noBlobRotators.push(set.rotator);
      continue;
    }
    try {
      const plain = await signer.nip44!.decrypt(set.rotator, blob.wrapped);
      const newKey = decodeWrappedKey(base64ToBytes(plain), held.scopeId, set.newEpoch);
      decryptable.push({ key: newKey, rotator: set.rotator });
    } catch {
      // Blob found at our own locator but decrypt threw (D-06): positive
      // evidence we're IN this set, outcome undetermined. Contributes ONLY to
      // the ambiguity check below — never to removal, never to adoption.
      opaqueCompetitor = true;
    }
  }

  if (decryptable.length > 0) {
    let winner = decryptable[0];
    for (const candidate of decryptable.slice(1)) {
      if (lowerKeyWins(winner.key, candidate.key) === candidate.key) winner = candidate;
    }
    // D-10: an opaque competing fork means we cannot prove our decryptable
    // winner is the true global-lowest — defer rather than adopt a candidate
    // that might not be the winner.
    if (opaqueCompetitor) return { kind: "none" };
    return { kind: "adopt", newKey: winner.key, rotator: winner.rotator, epoch: targetEpoch };
  }

  // No decryptable candidate at all. A decrypt-threw-only situation is
  // undetermined (D-06), never removal — only a genuine no-blob set can honor
  // removal, and only from a rotator authorized to remove US (CORD-04). An
  // absent/false predicate denies the removal (fail-closed): we keep our
  // current key either way.
  for (const rotator of noBlobRotators) {
    if (held.canRemoveSelf?.(rotator) === true) return { kind: "removed", epoch: targetEpoch };
  }
  return { kind: "none" };
}

/** The outcome of folding a channel's rekey blobs at its next-epoch address. */
export type ChannelRekeyOutcome =
  | { kind: "adopt"; next: ChannelKey; rotator: string; epoch: number }
  | { kind: "removed"; epoch: number }
  | { kind: "none" };

/**
 * Roll a single {@link ChannelKey} forward to a new key/epoch, retaining the
 * prior key in `held` (newest-first) so messages under prior channel epochs
 * still decode. Pure; the input is unchanged. Analog of {@link rollForward}.
 */
export function rollForwardChannel(channel: ChannelKey, newKey: string, newEpoch: number): ChannelKey {
  return {
    ...channel,
    key: newKey,
    epoch: newEpoch,
    held: [{ epoch: channel.epoch, key: channel.key }, ...(channel.held ?? [])],
  };
}

/** Every stream address a Private Channel holder listens on: its message plane at
 *  the current + held epochs, plus the next-epoch channel-rekey address(es). */
export interface ChannelKeys {
  channelId: string;
  epoch: number;
  /** Current-epoch channel message-plane key. */
  current: GroupKey;
  /** Prior-epoch message-plane keys (held), so old messages still decode. */
  held: Array<{ epoch: number; key: GroupKey }>;
  /** The next channel-epoch's rekey listen address, derived once per community
   *  root we hold — the current root (a standalone Rekey) and each held root (a
   *  Refounding-bundled channel rekey is sealed under the PRIOR root, CORD-06 §94). */
  nextRekey: Array<{ key: GroupKey; epoch: number }>;
  /** Decrypt-side lookup: stream pubkey → plane info (message planes + rekey addresses). */
  planes: Map<string, PlaneInfo>;
}

/**
 * Derive every stream address a holder of `channel` listens on, given the
 * community `material` (for the root(s) the channel-rekey address keys on). The
 * message plane derives from the channel's OWN secret/epoch — independent of the
 * community root — so it is stable across Refoundings.
 */
export function deriveChannelKeys(material: JoinMaterial, channel: ChannelKey): ChannelKeys {
  const channelId = hexToBytes(channel.id);
  // The current + held message-plane keys derive purely from `channel` (its own
  // secret/epoch, independent of the community root), so memoize this (dominant)
  // derivation on it. This is safe only because applesauce-core's cache helper writes the
  // memo non-enumerable (see cache.ts's identity-memo taxonomy) — so it is dropped, not
  // carried forward stale, when `rollForwardChannel` mints a fresh `ChannelKey` via
  // `{ ...channel, key: newKey, epoch: newEpoch, held: [...] }`. Before that
  // fix this was the identical reasoning error as CONCORD-H01: assuming a fresh `channel`
  // object (replaced only when it rolls forward) meant a fresh cache, when the replacement
  // is performed by spread and spread copies enumerable symbol-keyed properties. The rekey
  // addresses below key on `material`'s roots, so they stay per-call.
  const { current, held } = getOrComputeCachedValue(channel, ChannelPlaneKeysSymbol, () => ({
    current: channelGroupKey(hexToBytes(channel.key), channelId, channel.epoch),
    held: (channel.held ?? []).map((h) => ({
      epoch: h.epoch,
      key: channelGroupKey(hexToBytes(h.key), channelId, h.epoch),
    })),
  }));

  const newEpoch = channel.epoch + 1;
  const roots = [material.community_root, ...(material.held_roots ?? []).map((r) => r.key)];
  const seenRoot = new Set<string>();
  const nextRekey = roots
    .filter((r) => (seenRoot.has(r) ? false : (seenRoot.add(r), true)))
    .map((r) => ({ key: channelRekeyGroupKey(hexToBytes(r), channelId, newEpoch), epoch: newEpoch }));

  const planes = new Map<string, PlaneInfo>();
  planes.set(current.pk, { type: "channel", convKey: current.convKey, channelId: channel.id, epoch: channel.epoch });
  for (const h of held)
    planes.set(h.key.pk, { type: "channel", convKey: h.key.convKey, channelId: channel.id, epoch: h.epoch });
  for (const rk of nextRekey)
    planes.set(rk.key.pk, { type: "rekey", convKey: rk.key.convKey, channelId: channel.id, epoch: newEpoch });

  return { channelId: channel.id, epoch: channel.epoch, current, held, nextRekey, planes };
}

/**
 * Build a channel-scoped Rekey (CORD-06): mint a fresh channel key at the next
 * channel epoch and deliver it to `recipients` as per-recipient channel-scoped
 * blobs at the channel-rekey address. Sealed under `priorRoot` (default: the
 * current community_root — a standalone Rekey; a Refounding passes the prior root
 * so the blob is openable on either base fork, CORD-06 §94). No compaction: a
 * channel is just chat, so prior messages stay readable under the held key.
 * Returns the wraps + the rolled-forward channel key. Requires a NIP-44 signer.
 */
export async function buildChannelRekey(
  material: JoinMaterial,
  channel: ChannelKey,
  signer: ISigner,
  opts: {
    recipients: string[];
    self: string;
    newKey?: Uint8Array;
    priorRoot?: string;
    /** The rotator's own Grant citation (CORD-04 `vac`, D-08) — omitted for the owner. */
    vac?: [string, string, string];
  },
): Promise<{ rekeyWraps: NostrEvent[]; next: ChannelKey; newEpoch: number }> {
  if (!signer.nip44) throw new Error("this signer can't rotate keys (NIP-44 unsupported)");
  const channelId = hexToBytes(channel.id);
  const oldEpoch = channel.epoch;
  const newEpoch = oldEpoch + 1;
  const newKey = opts.newKey ?? generateSecretKey();
  const prevCommit = bytesToHex(epochKeyCommitment(oldEpoch, hexToBytes(channel.key)));

  const plain = bytesToBase64(encodeWrappedKey(channelId, BigInt(newEpoch), newKey));
  const blobs = [];
  for (const pk of opts.recipients) {
    const wrapped = await signer.nip44.encrypt(pk, plain);
    blobs.push({ locator: rekeyLocator(opts.self, pk, channel.id, BigInt(newEpoch)), wrapped });
  }

  const rekeyAddr = channelRekeyGroupKey(hexToBytes(opts.priorRoot ?? material.community_root), channelId, newEpoch);
  const rekeyWraps: NostrEvent[] = [];
  for (const rumor of buildRekeyRumors(
    {
      scope: { kind: "channel", channelId },
      newEpoch: BigInt(newEpoch),
      prevEpoch: BigInt(oldEpoch),
      prevCommit,
      vac: opts.vac,
    },
    blobs,
  )) {
    rekeyWraps.push(await giftWrap(rekeyAddr.sk, rekeyAddr.convKey, signer)(await rumor));
  }

  return { rekeyWraps, next: rollForwardChannel(channel, bytesToHex(newKey), newEpoch), newEpoch };
}

/**
 * Fold a channel's rekey blobs (CORD-06): a complete, AUTHORIZED,
 * continuity-checked channel rotation carrying our blob means adopt the new
 * channel key; a complete rotation with no blob for us means we've been removed
 * from the channel. Authority is `MANAGE_CHANNELS` + outranking the targets (the
 * caller's predicate), never key possession. Requires a NIP-44 signer.
 */
export async function readChannelRekey(
  channel: ChannelKey,
  rekeyEvents: Iterable<DecodedEvent>,
  isAuthorized: (rotator: string) => boolean,
  self: string,
  signer: ISigner,
  canRemoveSelf?: (rotator: string) => boolean,
  verifyVac?: (rotator: string, vac: [string, string, string] | undefined) => boolean,
): Promise<ChannelRekeyOutcome> {
  if (!signer.nip44) return { kind: "none" };
  const scoped = await readRekeyScoped(
    {
      scopeIdHex: channel.id.toLowerCase(),
      scopeId: hexToBytes(channel.id),
      heldEpoch: channel.epoch,
      heldKey: hexToBytes(channel.key),
      canRemoveSelf,
      verifyVac,
    },
    rekeyEvents,
    isAuthorized,
    self,
    signer,
  );
  if (scoped.kind === "adopt")
    return {
      kind: "adopt",
      next: rollForwardChannel(channel, bytesToHex(scoped.newKey), scoped.epoch),
      rotator: scoped.rotator,
      epoch: scoped.epoch,
    };
  if (scoped.kind === "removed") return { kind: "removed", epoch: scoped.epoch };
  return { kind: "none" };
}
