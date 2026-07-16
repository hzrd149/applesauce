// Wave 0 gap: concord's decodeWrapCached had zero test coverage before this file. These
// tests exercise the setCachedValue migration (05.1-11): the memoized DecodedEvent bundle
// must be non-enumerable (dropped by a plain spread), and the `null` failure sentinel must
// still short-circuit a repeated decode attempt on the same wrap instance.

import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import type { NostrEvent } from "applesauce-core/helpers/event";

import { giftWrap } from "../../operations/gift-wrap.js";
import { decodeWrapCached, getDecodedWrap } from "../gift-wrap.js";

// DecodedWrapSymbol is not exported from gift-wrap.ts, but it's registered via
// Symbol.for, so the same symbol is retrievable from the global registry.
const DecodedWrapSymbol = Symbol.for("concord-decoded-wrap");

async function buildWrap(convKey: Uint8Array, content = "hello plane"): Promise<NostrEvent> {
  const streamSk = generateSecretKey();
  const signer = new PrivateKeySigner(generateSecretKey());
  return giftWrap(streamSk, convKey, signer)({
    kind: 3313,
    content,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });
}

describe("decodeWrapCached", () => {
  it("memoizes the decoded bundle non-enumerably and drops it on a plain spread", async () => {
    const convKey = generateSecretKey();
    const wrap = await buildWrap(convKey);

    // Unattempted before any decode: undefined, not null.
    expect(getDecodedWrap(wrap)).toBeUndefined();

    const decoded = decodeWrapCached(wrap, convKey);
    expect(decoded).not.toBeNull();
    expect(decoded!.rumor.content).toBe("hello plane");

    // Non-enumerable: Reflect.ownKeys still sees the symbol, but its descriptor is
    // non-enumerable and a plain spread drops it entirely.
    expect(Reflect.ownKeys(wrap)).toContain(DecodedWrapSymbol);
    expect(Object.getOwnPropertyDescriptor(wrap, DecodedWrapSymbol)?.enumerable).toBe(false);

    const spread = { ...wrap };
    expect(Reflect.ownKeys(spread)).not.toContain(DecodedWrapSymbol);
    expect(getDecodedWrap(spread as NostrEvent)).toBeUndefined();

    // A second call short-circuits and returns the exact same memoized object.
    const decodedAgain = decodeWrapCached(wrap, convKey);
    expect(decodedAgain).toBe(decoded);
  });

  it("keeps the null failure-sentinel and short-circuits a repeated decode attempt", async () => {
    const convKey = generateSecretKey();
    const wrongKey = generateSecretKey();
    const wrap = await buildWrap(convKey);

    // Unattempted: undefined, distinguishable from an attempted-but-failed `null`.
    expect(getDecodedWrap(wrap)).toBeUndefined();

    // Decode under the WRONG key first: fails, and the `null` sentinel is cached.
    const first = decodeWrapCached(wrap, wrongKey);
    expect(first).toBeNull();
    expect(getDecodedWrap(wrap)).toBeNull();

    // A second call -- even with the CORRECT key -- short-circuits on the cached
    // `null` instead of re-attempting the decode.
    const second = decodeWrapCached(wrap, convKey);
    expect(second).toBeNull();

    // Prove the correct key would have decoded successfully had it actually been
    // attempted, by decoding a fresh (never-decoded) instance of the same wrap shape.
    const freshWrap = await buildWrap(convKey);
    expect(decodeWrapCached(freshWrap, convKey)).not.toBeNull();
  });
});
