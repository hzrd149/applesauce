// CORD-01 Private Streams — the wrap / seal / rumor envelope.
//
// A durable plane event is a kind 1059 wrap (signed by the plane's derived
// stream key) around a seal (signed by the author's real key) around an
// unsigned rumor (the functional event). The wrap and the inner rumor (for
// encrypted seals) are both NIP-44-encrypted under the plane's self-ECDH
// conversation key, so any keyholder can read but outsiders see only noise.
//
// The envelope is built in ../operations/gift-wrap.js (rumor -> seal -> wrap)
// and read back in ../helpers/gift-wrap.js (wrap -> seal -> rumor). This module
// keeps only the shared millisecond-time helpers both halves depend on.

import { Rumor } from "applesauce-core/helpers/event";

/** Split a JS millisecond timestamp into (created_at seconds, ms remainder). */
export function splitTime(nowMs: number = Date.now()): { created_at: number; ms: number } {
  return { created_at: Math.floor(nowMs / 1000), ms: nowMs % 1000 };
}

/**
 * The single predicate for whether a string is a valid `ms` tag value (CORD-02
 * §5: an integer `0..999`). Returns the parsed number, or `null` if `tag` is
 * `undefined` or is not the canonical base-10 string of such an integer. The
 * `String(n) === tag` round-trip is what rejects non-canonical forms that
 * `Number()` alone would silently accept or misparse: `"007"` (leading zero),
 * `"0x10"` (hex, `Number` yields `16` but `String(16) !== "0x10"`), `" 5"`
 * (whitespace), and `"+1"` (explicit sign). Both {@link rumorMs} and
 * {@link hasMalformedMs} route through this one definition so ordering and
 * fold-drop can never disagree about the same tag.
 */
export function parseMs(tag: string | undefined): number | null {
  if (tag === undefined) return null;
  const n = Number(tag);
  return Number.isInteger(n) && n >= 0 && n <= 999 && String(n) === tag ? n : null;
}

/** The full millisecond-resolution time of a rumor (CORD-02 §4). */
export function rumorMs(rumor: Rumor): number {
  const tag = rumor.tags.find((t) => t[0] === "ms")?.[1];
  return rumor.created_at * 1000 + (parseMs(tag) ?? 0);
}

/**
 * Whether a rumor carries an `ms` tag outside the valid `0..999` range (CORD-02
 * §5). Such an entry is *malformed* and must be dropped, not interpreted — the
 * display-ordering fallback in {@link rumorMs} keeps the value sane, but a fold
 * that decides membership must discard the event outright. An absent `ms` tag
 * is not malformed (it simply orders at the second boundary).
 */
export function hasMalformedMs(rumor: Rumor): boolean {
  const tag = rumor.tags.find((t) => t[0] === "ms")?.[1];
  return tag !== undefined && parseMs(tag) === null;
}
