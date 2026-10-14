// Wave 0 gap: concord's decodeWrapCached had zero test coverage before this file. These
// tests exercise the setCachedValue migration (05.1-11): the memoized DecodedEvent bundle
// must be non-enumerable (dropped by a plain spread), and the `null` failure sentinel must
// still short-circuit a repeated decode attempt on the same wrap instance.

import { describe, expect, it } from "vitest";
import { nip44 } from "applesauce-core/helpers/encryption";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { finalizeEvent, getEventHash, type NostrEvent } from "applesauce-core/helpers/event";
import { PrivateKeySigner } from "applesauce-signers";

import { giftWrap } from "../../operations/gift-wrap.js";
import {
  decodeWrap,
  decodeWrapCached,
  getDecodedWrap,
  getWrapSeal,
  ENCRYPTED_SEAL_KIND,
  EPHEMERAL_GIFT_WRAP_KIND,
} from "../gift-wrap.js";

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

describe("rumor id integrity", () => {
  // decodeWrap treats the rumor's `id` as its identity (dedupe, references, deletion), and the
  // rumor is unsigned, so the only thing binding that id to the payload is a hash recomputation.
  function makeRumor(streamSk: Uint8Array, content: string) {
    const base = {
      pubkey: getPublicKey(streamSk),
      created_at: 1700000000,
      kind: 3313,
      tags: [] as string[][],
      content,
    };
    return { ...base, id: getEventHash(base) };
  }

  // Builds a wrap by hand (bypassing the giftWrap operation) so the seal's plaintext payload
  // can carry an arbitrary rumor shape.
  function handBuiltWrap(convKey: Uint8Array, streamSk: Uint8Array, rumor: Record<string, unknown>): NostrEvent {
    const seal = finalizeEvent(
      {
        kind: ENCRYPTED_SEAL_KIND,
        created_at: 1700000000,
        tags: [],
        content: nip44.v2.encrypt(JSON.stringify(rumor), convKey),
      },
      streamSk,
    );
    return finalizeEvent(
      {
        kind: EPHEMERAL_GIFT_WRAP_KIND,
        created_at: 1700000000,
        tags: [["p", getPublicKey(generateSecretKey())]],
        content: nip44.v2.encrypt(JSON.stringify(seal), convKey),
      },
      streamSk,
    );
  }

  it("decodes a hand-built wrap whose rumor id hashes its contents (control)", () => {
    const convKey = generateSecretKey();
    const streamSk = generateSecretKey();
    const wrap = handBuiltWrap(convKey, streamSk, makeRumor(streamSk, "hello"));

    expect(decodeWrap(wrap, convKey)?.rumor.content).toBe("hello");
  });

  it("rejects a sealed rumor whose id does not hash its contents", () => {
    const convKey = generateSecretKey();
    const streamSk = generateSecretKey();
    const forged = { ...makeRumor(streamSk, "real contents"), id: "a".repeat(64) };
    const wrap = handBuiltWrap(convKey, streamSk, forged);

    // The seal layer verifies fine — it is the rumor layer that rejects
    expect(getWrapSeal(wrap, convKey)).not.toBeNull();
    expect(decodeWrap(wrap, convKey)).toBeNull();
  });
});
