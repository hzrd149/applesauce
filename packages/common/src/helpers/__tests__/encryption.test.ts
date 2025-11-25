import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey, nip04, nip44 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { isNIP04Encrypted } from "../encryption.js";

describe("isNIP04Encrypted", () => {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);

  it("should pass fuzz test", () => {
    const data = new Array(100)
      .fill(0)
      .map((_, i) => bytesToHex(sha256(i.toString())))
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
