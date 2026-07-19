// CORD-06 Rekeys & Refoundings — the 3303 rekey-blob wire codec + rotation fold.
//
// Post-removal secrecy without ratchets: a rotation mints a fresh key at the
// next epoch and delivers it as per-recipient "rekey blobs" (kind 3303, up to
// 120 per event, chunked) at an address derived from the PRIOR secret — so
// every current holder can find it, and a removed member finding no blob for
// their locator across ALL chunks of a COMPLETE rotation knows they're out.
//
// The wrapped plaintext is fixed-width — scope_id[32] || epoch_be[8] ||
// new_key[32] — NIP-44-encrypted under the Rotator<->recipient pairwise key
// (one ECDH either side can compute, so a NIP-46 bunker opens its blob with a
// single nip44_decrypt). The 72 bytes ride as standard base64 inside the NIP-44
// plaintext, because signer nip44 interfaces carry strings. Mirrors armada
// concord-v2/lib/rekey.ts byte-for-byte (interop-verified in scripts/interop.ts).

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { blankEventTemplate } from "applesauce-core/factories";
import type { EventTemplate } from "applesauce-core/helpers/event";
import { epochKeyCommitment, recipientLocator } from "./crypto.js";
import { includeRekeyChunk } from "../operations/rekey.js";
import type { DecodedEvent } from "../types.js";

/** Concord rekey blob kind (CORD-06). */
export const REKEY_KIND = 3303;

/** Per-recipient blobs per rekey event (CORD-06 §1). */
export const REKEY_BLOBS_PER_EVENT = 120;

const ZERO32 = new Uint8Array(32);
/** The root-rotation scope id (a Refounding): all-zeroes, never a channel id. */
export const ROOT_SCOPE_HEX = "0".repeat(64);

const HEX64 = /^[0-9a-f]{64}$/i;
const DEC = /^\d+$/;

/** A rotation's scope: one Private Channel, or the community_root (a Refounding). */
export type RekeyScope = { kind: "channel"; channelId: Uint8Array } | { kind: "root" };

/** The 32-byte scope id: the channel id, or all-zeroes for the root. */
export function rekeyScopeId(scope: RekeyScope): Uint8Array {
  return scope.kind === "channel" ? scope.channelId : ZERO32;
}

// ── The 72-byte wrapped plaintext ────────────────────────────────────────────

/** scope_id[32] || epoch_be[8] || new_key[32] — scope and epoch live INSIDE the ciphertext. */
export function encodeWrappedKey(scopeId: Uint8Array, newEpoch: bigint, newKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(72);
  out.set(scopeId, 0);
  new DataView(out.buffer).setBigUint64(32, newEpoch, false);
  out.set(newKey, 40);
  return out;
}

/**
 * Parse + verify a decrypted 72-byte blob against the event's tags: a recipient
 * accepts the key only when the INNER scope and epoch match, which is what makes
 * a blob unspliceable across channels/epochs (CORD-06 §1).
 */
export function decodeWrappedKey(plain: Uint8Array, expectedScopeId: Uint8Array, expectedEpoch: bigint): Uint8Array {
  if (plain.length !== 72) throw new Error(`wrapped key must be 72 bytes, got ${plain.length}`);
  const scopeId = plain.slice(0, 32);
  const epoch = new DataView(plain.buffer, plain.byteOffset).getBigUint64(32, false);
  if (bytesToHex(scopeId) !== bytesToHex(expectedScopeId)) throw new Error("wrapped key scope mismatch");
  if (epoch !== expectedEpoch) throw new Error("wrapped key epoch mismatch");
  return plain.slice(40, 72);
}

// ── base64 (STANDARD, not url-safe) for string-only nip44 signers ────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── The 3303 rumor ───────────────────────────────────────────────────────────

/** One located, wrapped key. */
export interface RekeyBlob {
  /** Where its recipient finds it (hex of {@link recipientLocator}). */
  locator: string;
  /** NIP-44 ciphertext under the Rotator<->recipient pairwise key (base64(72 bytes) inside). */
  wrapped: string;
}

export interface RekeyRotation {
  scope: RekeyScope;
  newEpoch: bigint;
  prevEpoch: bigint;
  /** The epoch-key commitment over the key being replaced (continuity check). */
  prevCommit: string;
}

/**
 * Build the chunked kind 3303 rekey rumors for one rotation (CORD-06 §1): the
 * blobs are split into events of at most {@link REKEY_BLOBS_PER_EVENT}, each
 * stamped with the rotation-machinery tags via {@link includeRekeyChunk}. An
 * empty blob set still yields one (empty) chunk so a COMPLETE rotation is always
 * publishable. Returns unsigned rumor templates for the caller to seal + wrap at
 * the rekey address (../operations/gift-wrap.js) — building rekey events is
 * plane-agnostic, so it is a plain helper rather than an exposed factory.
 */
export function buildRekeyRumors(
  rotation: RekeyRotation,
  blobs: RekeyBlob[],
  ms: number = Date.now(),
): Promise<EventTemplate>[] {
  const chunks: RekeyBlob[][] = [];
  for (let i = 0; i < blobs.length; i += REKEY_BLOBS_PER_EVENT) chunks.push(blobs.slice(i, i + REKEY_BLOBS_PER_EVENT));
  if (chunks.length === 0) chunks.push([]);
  const n = chunks.length;
  return chunks.map((chunk, i) =>
    Promise.resolve(includeRekeyChunk(rotation, chunk, i + 1, n, ms)(blankEventTemplate(REKEY_KIND))),
  );
}

export interface ParsedRekey {
  /** The rotator's real pubkey (the seal's signer). */
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkIndex: number;
  chunkCount: number;
  blobs: RekeyBlob[];
  ms: number;
  wrapId: string;
}

/** Parse a decoded rekey stream event into its rotation fields (returns null on malformed). */
export function parseRekey(d: DecodedEvent): ParsedRekey | null {
  const r = d.rumor;
  if (r.kind !== REKEY_KIND) return null;
  const get = (name: string) => r.tags.find((t) => t[0] === name);
  const scope = get("scope")?.[1];
  const newEpoch = get("newepoch")?.[1];
  const prevEpoch = get("prevepoch")?.[1];
  const prevCommit = get("prevcommit")?.[1];
  const chunk = get("chunk");
  if (!scope || !HEX64.test(scope)) return null;
  if (!newEpoch || !DEC.test(newEpoch)) return null;
  if (!prevEpoch || !DEC.test(prevEpoch)) return null;
  if (!prevCommit || !HEX64.test(prevCommit)) return null;
  const chunkIndex = chunk ? Number(chunk[1]) : 1;
  const chunkCount = chunk ? Number(chunk[2]) : 1;
  if (
    !Number.isInteger(chunkIndex) ||
    !Number.isInteger(chunkCount) ||
    chunkIndex < 1 ||
    chunkCount < 1 ||
    chunkIndex > chunkCount
  ) {
    return null;
  }
  let blobs: RekeyBlob[];
  try {
    const parsed = JSON.parse(r.content) as RekeyBlob[];
    blobs = Array.isArray(parsed)
      ? parsed.filter((b) => b && typeof b.locator === "string" && typeof b.wrapped === "string")
      : [];
  } catch {
    return null;
  }
  return {
    rotator: d.author,
    scopeIdHex: scope.toLowerCase(),
    newEpoch: BigInt(newEpoch),
    prevEpoch: BigInt(prevEpoch),
    prevCommit: prevCommit.toLowerCase(),
    chunkIndex,
    chunkCount,
    blobs,
    ms: d.ms,
    wrapId: d.wrapId,
  };
}

/**
 * Group parsed rekey chunks into complete rotations. Chunks correlate by
 * (rotator, scope, newepoch, prevcommit) so two Rotators concurrently rekeying
 * the same epoch never merge (CORD-06 §2). A rotation is COMPLETE only when all
 * `n` chunks are held — a missing chunk is never a removal.
 */
export interface RekeyRotationSet {
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkCount: number;
  /** chunkIndex → chunk. */
  chunks: Map<number, ParsedRekey>;
  /**
   * False when chunks correlated into this bucket disagree on `chunkCount` (n)
   * or `prevEpoch` — a resumed rotation minting a different keep-list (and thus
   * a different n) correlates on the SAME (rotator, scope, newEpoch, prevCommit)
   * key (D-02, unchanged), so agreement must be checked across all chunks
   * instead of trusting whichever chunk arrived first (ROTATE-10/11).
   */
  consistent: boolean;
  complete: boolean;
}

export function groupRotations(parsed: ParsedRekey[]): RekeyRotationSet[] {
  const byKey = new Map<string, RekeyRotationSet>();
  const chunkCounts = new Map<string, Set<number>>();
  const prevEpochs = new Map<string, Set<bigint>>();
  for (const p of parsed) {
    const key = `${p.rotator}:${p.scopeIdHex}:${p.newEpoch}:${p.prevCommit}`;
    let set = byKey.get(key);
    if (!set) {
      byKey.set(
        key,
        (set = {
          rotator: p.rotator,
          scopeIdHex: p.scopeIdHex,
          newEpoch: p.newEpoch,
          prevEpoch: p.prevEpoch,
          prevCommit: p.prevCommit,
          chunkCount: p.chunkCount,
          chunks: new Map(),
          consistent: true,
          complete: false,
        }),
      );
      chunkCounts.set(key, new Set());
      prevEpochs.set(key, new Set());
    }
    chunkCounts.get(key)!.add(p.chunkCount);
    prevEpochs.get(key)!.add(p.prevEpoch);
    // Keep every chunk — even one from a disagreeing generation — so the
    // disagreement is detectable below. Silently dropping a disagreeing chunk
    // (the old `if (p.chunkCount === set.chunkCount)` guard) is exactly what let
    // a stale first-arriving generation complete on its own.
    set.chunks.set(p.chunkIndex, p);
  }
  for (const [key, set] of byKey) {
    set.consistent = chunkCounts.get(key)!.size === 1 && prevEpochs.get(key)!.size === 1;
    set.complete = set.consistent && set.chunks.size >= set.chunkCount;
  }
  return [...byKey.values()];
}

/**
 * Verify a rotation's CONTINUITY against the key we currently hold: the
 * commitment over (prevEpoch, heldKey) must equal the event's `prevcommit`.
 * A mismatch with a HIGHER prevepoch means we missed a rotation (fetch the gap
 * first); any other mismatch is a fork or garbage — reject (CORD-06 §2).
 */
export function checkContinuity(
  set: { prevEpoch: bigint; prevCommit: string },
  heldEpoch: bigint,
  heldKey: Uint8Array,
): { ok: true } | { ok: false; reason: "gap" | "fork" } {
  if (set.prevEpoch === heldEpoch) {
    const commit = bytesToHex(epochKeyCommitment(heldEpoch, heldKey));
    return commit === set.prevCommit ? { ok: true } : { ok: false, reason: "fork" };
  }
  return { ok: false, reason: set.prevEpoch > heldEpoch ? "gap" : "fork" };
}

/** Find my blob across a complete rotation's chunks by my locator. */
export function findBlob(set: RekeyRotationSet, locatorHex: string): RekeyBlob | undefined {
  for (const chunk of set.chunks.values()) {
    const hit = chunk.blobs.find((b) => b.locator === locatorHex);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Race convergence (CORD-06 §3): among authorized candidates at the same
 * continuity point, the lexicographically lowest NEW KEY wins.
 */
export function lowerKeyWins(a: Uint8Array, b: Uint8Array): Uint8Array {
  return bytesToHex(a) <= bytesToHex(b) ? a : b;
}

/**
 * D-04's down-only anti-refork test: is `candidate` STRICTLY lower than
 * `existing` (never equal, never higher)? Built from {@link lowerKeyWins} plus
 * a byte-inequality check, so a settled epoch's latch can only ever move down,
 * never sideways or up. Shared by both the root (community.ts) and channel
 * (private-channel.ts) `checkRekey` latches, and the sync-walk re-read cascade,
 * so all three agree on exactly the same ordering.
 */
export function isStrictlyLowerKey(existing: Uint8Array, candidate: Uint8Array): boolean {
  return lowerKeyWins(existing, candidate) === candidate && bytesToHex(existing) !== bytesToHex(candidate);
}

/** Compute a rotation locator from PUBLIC inputs only (bunker-friendly). */
export function rekeyLocator(rotatorHex: string, recipientHex: string, scopeIdHex: string, newEpoch: bigint): string {
  return recipientLocator(rotatorHex, recipientHex, hexToBytes(scopeIdHex), Number(newEpoch));
}
