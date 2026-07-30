// CORD-02 §6 metadata byte caps — the one shared UTF-8 byte-cap check.
//
// Verbatim (CORD-02 §6): "The `name` caps at 64 bytes and the `description` at
// 10000 bytes, counted as UTF-8. The 64-byte name cap is uniform across the
// protocol (Channels and Roles carry the same one)." The two constants below
// are TRANSCRIBED spec literals, not derived values — the
// derived-constants-carry-a-rationale convention `community-list.ts` follows
// for its arithmetic ceilings does not apply here (D-05, D-21).
//
// D-04: these caps are a WRITE-SIDE contract only. The read path (the fold in
// `./control.js`) accepts an over-cap `name`/`description` verbatim — this is
// a deliberate override of WIRE-06's "and defensively on read" clause and of
// ROADMAP Phase 12 success criterion 1. A future reader must not "complete"
// this work by adding a read-side guard: the fold's only rejection idiom is
// `continue`, and applying it to an over-cap name would convert a caps bug
// into a channel-availability bug, since the fold is the sole source of
// channel state.
//
// This module sits at the bottom of the dependency graph (it pulls in nothing
// else at all) so both `./community.js` and `../client/admin.ts` can reach it
// without crossing the helpers → client one-way dependency boundary.

/** The uniform 64-byte name cap (CORD-02 §6) — communities, channels, and roles all share it. */
export const NAME_MAX_BYTES = 64;

/** The 10000-byte description cap (CORD-02 §6). */
export const DESCRIPTION_MAX_BYTES = 10000;

/**
 * UTF-8 byte length of `value`. This is the single reason this module exists:
 * JavaScript's `String.length` counts UTF-16 code units, not bytes, and the
 * spec's caps are stated in bytes — that mismatch is audit finding M17. A
 * 17-character astral string is 68 UTF-8 bytes while its `.length` is 34, so
 * measuring with `.length` would silently admit an over-cap value. There is
 * deliberately no code-unit variant of this function.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Throw when `value`'s UTF-8 byte length exceeds `maxBytes`. The comparison
 * is strictly greater-than, never greater-than-or-equal: a value of exactly
 * `maxBytes` bytes is legal, because the spec says the field "caps at" that
 * figure — the boundary is exclusive.
 *
 * `field` is a human-readable subject supplied by the caller (e.g. the
 * community name, the community description, the channel name) — the thrown
 * message never carries the offending string itself.
 */
export function assertByteCap(value: string, maxBytes: number, field: string): void {
  const bytes = utf8ByteLength(value);
  if (bytes > maxBytes) throw new Error(`${field} is too large (${bytes} bytes > ${maxBytes}-byte cap)`);
}
