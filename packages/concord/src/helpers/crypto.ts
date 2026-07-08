// Concord cryptographic derivations — CORD-02 Appendix A (frozen).
//
// Everything Concord addresses on the wire derives from a community secret via
// one of the shapes below. All are byte-exact per the spec; changing any labeled
// byte would re-address every prior event.

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";
import { numberToBytesBE } from "@noble/curves/utils.js";
import { nip44 } from "applesauce-core/helpers/encryption";

/** A 32-byte all-zero id, used where a derivation label has no meaningful id. */
const ZERO_32 = new Uint8Array(32);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SECP_ORDER: bigint = (secp256k1 as any).Point.Fn.ORDER;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** A 32-byte value is a valid secp256k1 scalar iff 0 < v < n. */
function isValidScalar(bytes: Uint8Array): boolean {
  const v = bytesToBigInt(bytes);
  return v > 0n && v < SECP_ORDER;
}

/**
 * A.1 HKDF — HKDF-SHA256 with empty salt and
 *   info = utf8(label) || 0x00 || id[32] || epoch_be[8]?  (|| counter?)
 * The epoch is the only omittable field. `extraInfo` carries the
 * scalar_normalize retry counter, appended after all other fields (A.3).
 */
export function concordHkdf(
  secret: Uint8Array,
  label: string,
  id: Uint8Array = ZERO_32,
  epoch?: number | bigint,
  extraInfo?: Uint8Array,
): Uint8Array {
  if (id.length !== 32) throw new Error("hkdf id must be 32 bytes");
  const parts: Uint8Array[] = [utf8ToBytes(label), new Uint8Array([0x00]), id];
  if (epoch !== undefined) parts.push(numberToBytesBE(epoch, 8));
  if (extraInfo) parts.push(extraInfo);
  const info = concatBytes(...parts);
  return hkdf(sha256, secret, new Uint8Array(0), info, 32);
}

/**
 * A.3 scalar_normalize — the hkdf output is a seed; if it is not a valid
 * secp256k1 scalar, append an incrementing counter byte to the hkdf info and
 * retry (counter from 0). The reject branch is ~2^-128 rare.
 */
function scalarNormalize(
  secret: Uint8Array,
  label: string,
  id: Uint8Array,
  epoch: number | bigint | undefined,
  firstSeed: Uint8Array,
): Uint8Array {
  if (isValidScalar(firstSeed)) return firstSeed;
  for (let counter = 0; counter < 256; counter++) {
    const seed = concordHkdf(secret, label, id, epoch, new Uint8Array([counter]));
    if (isValidScalar(seed)) return seed;
  }
  throw new Error("scalar_normalize exhausted (astronomically unlikely)");
}

export interface GroupKey {
  /** secret key (32 bytes) that signs the plane's giftwraps */
  sk: Uint8Array;
  /** x-only pubkey — the on-wire Stream address (hex) */
  pk: string;
  /** NIP-44 self-ECDH conversation key that encrypts the wrap */
  convKey: Uint8Array;
}

/**
 * A.2 group_key — a pseudonym label's hkdf output normalized into a
 * secp256k1 keypair whose x-only pubkey is the on-wire Stream address.
 */
export function groupKey(
  label: string,
  secret: Uint8Array,
  id: Uint8Array = ZERO_32,
  epoch?: number | bigint,
): GroupKey {
  const seed = concordHkdf(secret, label, id, epoch);
  const sk = scalarNormalize(secret, label, id, epoch, seed);
  const pk = bytesToHex(schnorr.getPublicKey(sk));
  const convKey = nip44.getConversationKey(sk, pk);
  return { sk, pk, convKey };
}

/**
 * A.4 community_id — a plain SHA-256 commitment to the owner:
 *   sha256( utf8("concord/community") || owner_xonly[32] || owner_salt[32] )
 */
export function communityId(ownerXonlyHex: string, ownerSalt: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes("concord/community"), hexToBytes(ownerXonlyHex), ownerSalt));
}

/**
 * A.5 epoch-key commitment (CORD-06):
 *   sha256( utf8("concord/epoch-key-commitment") || prev_epoch_be[8] || prev_key[32] )
 */
export function epochKeyCommitment(prevEpoch: number | bigint, prevKey: Uint8Array): Uint8Array {
  return sha256(concatBytes(utf8ToBytes("concord/epoch-key-commitment"), numberToBytesBE(prevEpoch, 8), prevKey));
}

// ---- Frozen labels (A.6) ---------------------------------------------------

/** Public/Private Channel group key. secret = channel key or community_root. */
export function channelGroupKey(secret: Uint8Array, channelId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/channel", secret, channelId, epoch);
}

/** Control Plane group key. secret = community_root, id = community_id. */
export function controlGroupKey(root: Uint8Array, communityId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/control", root, communityId, epoch);
}

/** Guestbook Plane group key. secret = community_root, id = community_id. */
export function guestbookGroupKey(root: Uint8Array, communityId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/guestbook", root, communityId, epoch);
}

/** Dissolution tombstone address. secret = community_id, id = 0..0, no epoch. */
export function dissolvedGroupKey(communityId: Uint8Array): GroupKey {
  return groupKey("concord/dissolved", communityId, ZERO_32);
}

/** Channel rekey address (CORD-06). secret = prior community_root. */
export function channelRekeyGroupKey(priorRoot: Uint8Array, channelId: Uint8Array, newEpoch: number): GroupKey {
  return groupKey("concord/rekey-pseudonym", priorRoot, channelId, newEpoch);
}

/** Base (community_root) rekey address (CORD-06). */
export function baseRekeyGroupKey(priorRoot: Uint8Array, communityId: Uint8Array, newEpoch: number): GroupKey {
  return groupKey("concord/base-rekey-pseudonym", priorRoot, communityId, newEpoch);
}

// ---- Voice (CORD-07 §1) ----------------------------------------------------

/**
 * A voice Channel's signing keypair (CORD-07 §1). Its x-only `pk` is the SFU
 * **room name** and its `sk` signs token grants (§2); the pk is never a stream
 * address, the `group_key` shape is reused only for its deterministic keypair.
 * `secret`/`epoch` are the same pair that addresses the Channel's Chat Plane —
 * community_root@root_epoch for a Public Channel, the Channel's own key/epoch
 * for a Private one — so the room rolls exactly when the Channel's key does.
 */
export function voiceGroupKey(secret: Uint8Array, channelId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/voice-signer", secret, channelId, epoch);
}

/**
 * A voice Channel's raw 32-byte media-encryption root (CORD-07 §1). Never feeds
 * a cipher directly — every publisher's per-sender frame key derives from it
 * (see {@link voiceSenderKey}).
 */
export function voiceMediaKey(secret: Uint8Array, channelId: Uint8Array, epoch: number): Uint8Array {
  return concordHkdf(secret, "concord/voice-media", channelId, epoch);
}

/**
 * A publisher's per-sender frame-key material (CORD-07 §3):
 * `hkdf(voice_media_key, "concord/voice-sender", sha256(utf8(identity)))` — the
 * epoch field is omitted, `voice_media_key` already carries it. Distinct keys
 * per sender partition the AEAD nonce domains; every member computes every
 * sender's key from the identity the SFU presents, no in-band exchange.
 */
export function voiceSenderKey(mediaKey: Uint8Array, identity: string): Uint8Array {
  return concordHkdf(mediaKey, "concord/voice-sender", sha256(utf8ToBytes(identity)));
}

// ---- Coordinate (eid) derivations — hkdf output used as a 32-byte id -------

/** A member's Grant coordinate. secret = community_id, id = member_xonly. */
export function grantLocator(communityId: Uint8Array, memberXonlyHex: string): string {
  return bytesToHex(concordHkdf(communityId, "concord/grant", hexToBytes(memberXonlyHex)));
}

/** The Banlist coordinate. secret = community_id, id = 0..0. */
export function banlistLocator(communityId: Uint8Array): string {
  return bytesToHex(concordHkdf(communityId, "concord/banlist", ZERO_32));
}

/** A creator's invite Registry coordinate. secret = community_id, id = creator_xonly. */
export function inviteLinksLocator(communityId: Uint8Array, creatorXonlyHex: string): string {
  return bytesToHex(concordHkdf(communityId, "concord/invite-links", hexToBytes(creatorXonlyHex)));
}

/** Public-invite decrypt key. secret = token, id = 0..0. */
export function inviteBundleKey(token: Uint8Array): Uint8Array {
  return concordHkdf(token, "concord/invite-key", ZERO_32);
}

/** A rekey blob locator (CORD-06 §2). */
export function recipientLocator(
  rotatorXonlyHex: string,
  recipientXonlyHex: string,
  scopeId: Uint8Array,
  epoch: number,
): string {
  const secret = concatBytes(hexToBytes(rotatorXonlyHex), hexToBytes(recipientXonlyHex));
  return bytesToHex(concordHkdf(secret, "concord/recipient-pseudonym", scopeId, epoch));
}

// ---- Edition hash (CORD-04 §1) --------------------------------------------

const EDITION_LABEL = "vector-community/v1/edition";

/**
 * edition_hash = sha256(
 *   len64(label) || label || entity_id[32] || version_be[8]
 *   || (prev ? 0x01||prev[32] : 0x00||zero[32]) || len64(content) || content )
 */
export function editionHash(
  entityId: Uint8Array,
  version: number,
  prev: Uint8Array | undefined,
  contentBytes: Uint8Array,
): string {
  const labelBytes = utf8ToBytes(EDITION_LABEL);
  const prevPart = prev
    ? concatBytes(new Uint8Array([0x01]), prev)
    : concatBytes(new Uint8Array([0x00]), ZERO_32);
  const preimage = concatBytes(
    numberToBytesBE(labelBytes.length, 8),
    labelBytes,
    entityId,
    numberToBytesBE(version, 8),
    prevPart,
    numberToBytesBE(contentBytes.length, 8),
    contentBytes,
  );
  return bytesToHex(sha256(preimage));
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}
