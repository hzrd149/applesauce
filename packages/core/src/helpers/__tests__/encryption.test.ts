import { generateSecretKey, getPublicKey, nip04, nip44 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { isNIP04Encrypted } from "../encryption.js";
import { bytesToHex } from "nostr-tools/utils";
import crypto from "node:crypto";

describe("isNIP04Encrypted", () => {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);

  it("should pass fuzz test", () => {
    const data = new Array(100)
      .fill(0)
      .map((_, i) => bytesToHex(crypto.getRandomValues(new Uint8Array(32))))
      .map((hash, index) =>
        // Even indecies are encrypted using nip04 and odd indecies are encrypted using nip44
        index % 2 === 0 ? nip04.encrypt(key, pubkey, hash) : nip44.encrypt(hash, nip44.getConversationKey(key, pubkey)),
      );

    for (let i = 0; i < data.length; i++) {
      // Even indecies should always be nip04
      expect(isNIP04Encrypted(data[i])).toBe(i % 2 === 0);
    }
  });
});

describe("nip44 plaintext ceiling", () => {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);
  const conversationKey = nip44.getConversationKey(key, pubkey);

  // CORD-02 Appendix B states implementations "MUST enforce the cap at every layer" against
  // a 65,535-byte plaintext ceiling -- the sentence applesauce-concord's D-07 overrides. That
  // premise moved upstream: NIP-44 itself now specifies max_plaintext_size = 4294967295, with
  // the old 65536 figure demoted to a mere extended_prefix_threshold (nostr-tools' internal
  // names are maxPlaintextSize/extendedPrefixThreshold). 65,535 is NOT the current NIP-44 spec
  // ceiling -- do not read this test as asserting that it still is. Direct source inspection
  // across published nostr-tools versions shows the maxPlaintextSize change landed in 2.23.4
  // (D-25's correction to D-11's supporting claim that 2.24.0 was the first release carrying
  // the fix); this repo's locked target range is ^2.24, unchanged by that correction.
  //
  // This test lives in packages/core, not packages/concord: concord declares no direct
  // nostr-tools dependency and reaches nip44 only through this module's re-export
  // (../encryption.ts), so this module is where the lifted ceiling is runtime-determining for
  // every PrivateKeySigner-based concord consumer.
  it("round-trips a plaintext over the old 65,535-byte ceiling", () => {
    const plaintext = "a".repeat(70_000);
    const byteLength = new TextEncoder().encode(plaintext).length;
    expect(byteLength).toBeGreaterThan(65_535);

    const ciphertext = nip44.encrypt(plaintext, conversationKey);
    const decrypted = nip44.decrypt(ciphertext, conversationKey);
    expect(decrypted).toBe(plaintext);
  });
});
