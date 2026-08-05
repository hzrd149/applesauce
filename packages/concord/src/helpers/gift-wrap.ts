// CORD-01 Private Streams — the decode half of the wrap / seal / rumor envelope.
//
// Mirrors applesauce-common's helpers/gift-wrap.ts, but with Concord's
// symmetric crypto: a wrap and its (encrypted) seal are NIP-44-encrypted under
// the plane's self-ECDH conversation key (`convKey`), so *any* keyholder can
// decode without a signer, and a seal may be plaintext (kind 20014) or
// encrypted (kind 20013). Decoding walks the envelope in two composable steps —
// wrap -> seal, seal -> rumor — that compose into `decodeWrap`.
//
// The composable getters and `decodeWrap` are pure functions of (event,
// convKey): they take no shortcut, so the *same* wrap can be probed under
// different keys (only its own plane's key opens it). `decodeWrapCached`
// memoises the finished bundle on the wrap instance — a wrap is only ever
// decoded under its plane's one convKey, so caching the result there is safe.

import { safeParse, setCachedValue } from "applesauce-core/helpers";
import { kinds, type NostrEvent, verifyWrappedEvent } from "applesauce-core/helpers/event";
import { nip44 } from "applesauce-core/helpers/encryption";
import { rumorMs } from "./stream.js";
import type { DecodedEvent, RawEvent, Rumor } from "../types.js";

/** NIP-59 gift wrap kind (1059), sourced from applesauce-core. */
export const GIFT_WRAP_KIND = kinds.GiftWrap;
/** Concord ephemeral gift wrap kind (CORD-01). */
export const EPHEMERAL_GIFT_WRAP_KIND = 21059;
/** Concord encrypted seal kind (CORD-01). */
export const ENCRYPTED_SEAL_KIND = 20013;
/** Concord plaintext seal kind (CORD-01). */
export const PLAINTEXT_SEAL_KIND = 20014;

/**
 * The kinds a historical backfill filter should request. Ephemeral wraps
 * (`EPHEMERAL_GIFT_WRAP_KIND`, 21059) are never retained by relays under
 * NIP-01, so a backfill filter for them can only ever return nothing —
 * wasting a round-trip and producing a misleading "synced" signal. Backfill
 * (`syncAuthors`) intentionally requests only the retained kind; the two live
 * subscription sites (`community.ts`, `private-channel.ts`) intentionally
 * keep requesting both kinds, since ephemeral wraps only ever arrive live.
 */
export const BACKFILL_KINDS = [GIFT_WRAP_KIND];

/**
 * Decrypt and verify the seal inside a wrap. Returns `null` when the event is
 * not a wrap, is undecryptable under `convKey`, or carries an invalidly-signed
 * seal. Pure — no memoisation, so a wrap can be probed under multiple keys.
 */
export function getWrapSeal(wrap: RawEvent, convKey: Uint8Array): NostrEvent | null {
  if (wrap.kind !== GIFT_WRAP_KIND && wrap.kind !== EPHEMERAL_GIFT_WRAP_KIND) return null;
  try {
    const seal = safeParse<NostrEvent>(nip44.decrypt(wrap.content, convKey));
    if (!seal) return null;
    if (seal.kind !== ENCRYPTED_SEAL_KIND && seal.kind !== PLAINTEXT_SEAL_KIND) return null;
    // The seal must be a valid, author-signed event. Verify through the swappable
    // wrapped-event method (like applesauce-core's own gift-wrap/zap helpers) so a
    // client can route it to a faster verifier (e.g. nostr-wasm) — this runs on
    // every wrap decode across every plane, so it dominates a Concord client's CPU.
    if (!verifyWrappedEvent(seal)) return null;
    return seal;
  } catch {
    return null;
  }
}

/**
 * Read the rumor out of a seal — plaintext seals carry the rumor JSON verbatim,
 * encrypted seals hide it under `convKey`. Returns `null` on a parse failure or
 * when the rumor's author does not match the key that signed the seal (CORD-01
 * author binding).
 */
export function getSealRumor(seal: NostrEvent, convKey: Uint8Array): Rumor | null {
  if (seal.kind !== ENCRYPTED_SEAL_KIND && seal.kind !== PLAINTEXT_SEAL_KIND) return null;
  try {
    const json = seal.kind === PLAINTEXT_SEAL_KIND ? seal.content : nip44.decrypt(seal.content, convKey);
    const rumor = safeParse<Rumor>(json);
    if (!rumor) return null;
    // Author binding: the rumor must be authored by the same key that sealed it.
    if (rumor.pubkey !== seal.pubkey) return null;
    return rumor;
  } catch {
    return null;
  }
}

/** Walk a wrap all the way down to its rumor (wrap -> seal -> rumor). */
export function getWrapRumor(wrap: RawEvent, convKey: Uint8Array): Rumor | null {
  const seal = getWrapSeal(wrap, convKey);
  if (!seal) return null;
  return getSealRumor(seal, convKey);
}

/**
 * Decode a Stream wrap back to its rumor + verified real author, returning the
 * full {@link DecodedEvent} bundle. Returns `null` when the event is malformed,
 * the seal signature is invalid, or the author binding fails (CORD-01).
 */
export function decodeWrap(wrap: RawEvent, convKey: Uint8Array): DecodedEvent | null {
  const seal = getWrapSeal(wrap, convKey);
  if (!seal) return null;
  const rumor = getSealRumor(seal, convKey);
  if (!rumor) return null;
  return {
    rumor,
    author: seal.pubkey,
    wrapId: wrap.id,
    sealKind: seal.kind,
    ms: rumorMs(rumor),
    seal,
  };
}

// A wrap's plaintext is derived with the plane's symmetric group key (NIP-44
// self-ECDH under `convKey`), not the user's signer, so applesauce's built-in
// EncryptedContentSymbol cache (which is signer + counterparty-pubkey based)
// can't hold it. We mirror applesauce's pattern with our own symbol so a wrap
// re-served by a relay, echoed back after our own publish, or delivered by an
// overlapping subscription is decoded exactly once. The stored `null` also
// short-circuits repeated decrypt attempts on undecryptable events.
const DecodedWrapSymbol = Symbol.for("concord-decoded-wrap");

/**
 * Decode a wrap, memoising the whole {@link DecodedEvent} bundle (success *or*
 * the `null` failure) on the wrap instance's symbol. Pass the canonical instance
 * returned by `eventStore.add(...)` so the cache is shared across every
 * re-delivery of the same wrap.
 */
export function decodeWrapCached(wrap: RawEvent, convKey: Uint8Array): DecodedEvent | null {
  const cached = Reflect.get(wrap, DecodedWrapSymbol) as DecodedEvent | null | undefined;
  if (cached !== undefined) return cached;
  const decoded = decodeWrap(wrap, convKey);
  // Identity memo (cache.ts taxonomy): non-enumerable so a spread drops it and a copy with
  // changed fields recomputes. setCachedValue writes `null` non-enumerably too, so the
  // attempted-but-failed sentinel above (`cached !== undefined`) is unaffected.
  setCachedValue(wrap, DecodedWrapSymbol, decoded);
  return decoded;
}

/** The memoised decode for a wrap, if one has been attempted on this instance. */
export function getDecodedWrap(wrap: RawEvent): DecodedEvent | null | undefined {
  return Reflect.get(wrap, DecodedWrapSymbol) as DecodedEvent | null | undefined;
}
