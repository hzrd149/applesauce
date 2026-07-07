// CORD-01 Private Streams — the wrap / seal / rumor envelope.
//
// A durable plane event is a kind 1059 wrap (signed by the plane's derived
// stream key) around a seal (signed by the author's real key) around an
// unsigned rumor (the functional event). The wrap and the inner rumor (for
// encrypted seals) are both NIP-44-encrypted under the plane's self-ECDH
// conversation key, so any keyholder can read but outsiders see only noise.

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  getEventHash,
  verifyEvent,
  nip44,
} from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { KIND } from "./types.js";
import type { DecodedEvent, RawEvent, Rumor, RumorTemplate } from "./types.js";

/** Split a JS millisecond timestamp into (created_at seconds, ms remainder). */
export function splitTime(nowMs: number = Date.now()): { created_at: number; ms: number } {
  return { created_at: Math.floor(nowMs / 1000), ms: nowMs % 1000 };
}

/** The full millisecond-resolution time of a rumor (CORD-02 §4). */
export function rumorMs(rumor: Rumor): number {
  const tag = rumor.tags.find((t) => t[0] === "ms");
  const ms = tag ? parseInt(tag[1], 10) : 0;
  const remainder = Number.isFinite(ms) && ms >= 0 && ms <= 999 ? ms : 0;
  return rumor.created_at * 1000 + remainder;
}

/**
 * Build a signed durable Stream event (kind 1059 wrap) at `streamPk`.
 *
 * @param plaintextSeal use kind 20014 (Control Plane); otherwise kind 20013.
 * @param ephemeral use the ephemeral wrap (kind 21059) for transient pings.
 */
export async function createStreamEvent(opts: {
  streamSk: Uint8Array;
  convKey: Uint8Array;
  author: ISigner;
  rumor: RumorTemplate;
  plaintextSeal?: boolean;
  ephemeral?: boolean;
}): Promise<{ wrap: NostrEvent; rumorId: string }> {
  const authorPubkey = await opts.author.getPublicKey();
  const time = opts.rumor.created_at ?? Math.floor(Date.now() / 1000);

  // 1. Rumor — unsigned, id computed.
  const rumorEvent = {
    pubkey: authorPubkey,
    created_at: time,
    kind: opts.rumor.kind,
    tags: opts.rumor.tags,
    content: opts.rumor.content,
  };
  const rumorId = getEventHash(rumorEvent);
  const rumor: Rumor = { id: rumorId, ...rumorEvent };
  const rumorJson = JSON.stringify(rumor);

  // 2. Seal — signed by the author's real key.
  const sealKind = opts.plaintextSeal ? KIND.SEAL_PLAINTEXT : KIND.SEAL_ENCRYPTED;
  const sealContent = opts.plaintextSeal ? rumorJson : nip44.encrypt(rumorJson, opts.convKey);
  const seal = await opts.author.signEvent({
    kind: sealKind,
    content: sealContent,
    tags: [],
    created_at: time,
  });

  // 3. Wrap — signed by the plane's stream key, encrypted under convKey.
  const ephemeralPubkey = getPublicKey(generateSecretKey());
  const wrap = finalizeEvent(
    {
      kind: opts.ephemeral ? KIND.WRAP_EPHEMERAL : KIND.WRAP,
      content: nip44.encrypt(JSON.stringify(seal), opts.convKey),
      tags: [["p", ephemeralPubkey]],
      created_at: time,
    },
    opts.streamSk,
  );

  return { wrap, rumorId };
}

// A wrap's plaintext is derived with the plane's symmetric group key (NIP-44
// self-ECDH under `convKey`), not the user's signer, so applesauce's built-in
// EncryptedContentSymbol cache (which is signer + counterparty-pubkey based via
// `unlockEncryptedContent`) can't hold it. We mirror applesauce's pattern with
// our own symbol so a wrap re-served by a relay, echoed back after our own
// publish, or delivered by an overlapping subscription is decrypted exactly
// once — every later sighting is a symbol lookup, not another NIP-44 decrypt +
// signature verify + JSON parse.
const DecodedStreamSymbol = Symbol.for("concord-decoded-stream");

/** The memoised decode for a wrap, if one has been attempted on this instance. */
export function getDecodedStream(event: RawEvent): DecodedEvent | null | undefined {
  return Reflect.get(event, DecodedStreamSymbol) as DecodedEvent | null | undefined;
}

/**
 * Decode a wrap, memoising the result (success *or* the null failure) on the
 * event instance's symbol. Pass the canonical instance returned by
 * `eventStore.add(...)` so the cache is shared across every re-delivery of the
 * same wrap. The stored `null` also short-circuits repeated decrypt attempts on
 * undecryptable events.
 */
export function decodeStreamEventCached(event: RawEvent, convKey: Uint8Array): DecodedEvent | null {
  const cached = Reflect.get(event, DecodedStreamSymbol) as DecodedEvent | null | undefined;
  if (cached !== undefined) return cached;
  const decoded = decodeStreamEvent(event, convKey);
  Reflect.set(event, DecodedStreamSymbol, decoded);
  return decoded;
}

/**
 * Decode a Stream wrap back to its rumor + verified real author.
 * Returns null when the event is malformed, the seal signature is invalid, or
 * the author binding fails (CORD-01).
 */
export function decodeStreamEvent(wrap: RawEvent, convKey: Uint8Array): DecodedEvent | null {
  if (wrap.kind !== KIND.WRAP && wrap.kind !== KIND.WRAP_EPHEMERAL) return null;
  try {
    const seal = JSON.parse(nip44.decrypt(wrap.content, convKey)) as NostrEvent;
    if (seal.kind !== KIND.SEAL_ENCRYPTED && seal.kind !== KIND.SEAL_PLAINTEXT) return null;
    // The seal must be a valid, author-signed event.
    if (!verifyEvent(seal)) return null;

    const rumorJson =
      seal.kind === KIND.SEAL_PLAINTEXT ? seal.content : nip44.decrypt(seal.content, convKey);
    const rumor = JSON.parse(rumorJson) as Rumor;

    // Author binding: the rumor must be authored by the same key that sealed it.
    if (rumor.pubkey !== seal.pubkey) return null;

    return {
      rumor,
      author: seal.pubkey,
      wrapId: wrap.id,
      sealKind: seal.kind,
      ms: rumorMs(rumor),
      seal,
    };
  } catch {
    return null;
  }
}

/**
 * Re-wrap an already-verified PLAINTEXT seal into another stream (a compaction,
 * CORD-06 §3): only plaintext seals (kind 20014) survive a re-wrap, because
 * their signature is over the rumor JSON verbatim and doesn't depend on the
 * outer stream key. Used by a Refounding to re-anchor each Control-Plane head
 * edition under the new epoch without re-signing (the original author's proof
 * is carried forward intact).
 */
export function rewrapSeal(seal: NostrEvent, targetStreamSk: Uint8Array, targetConvKey: Uint8Array): NostrEvent {
  if (seal.kind !== KIND.SEAL_PLAINTEXT) throw new Error("only plaintext seals survive a re-wrap");
  const ephemeralPubkey = getPublicKey(generateSecretKey());
  return finalizeEvent(
    {
      kind: KIND.WRAP,
      content: nip44.encrypt(JSON.stringify(seal), targetConvKey),
      tags: [["p", ephemeralPubkey]],
      created_at: Math.floor(Date.now() / 1000),
    },
    targetStreamSk,
  );
}
