import { hex } from "@scure/base";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as spanish } from "@scure/bip39/wordlists/spanish.js";
import { verifyEvent } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { SeedWordsSigner } from "../seed-words-signer.js";

const words = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

describe("SeedWordsSigner", () => {
  it("restores a derived key as the correct signer class", () => {
    const signer = SeedWordsSigner.fromWords(words, { wordlist });
    const restored = SeedWordsSigner.fromKey(hex.encode(signer.key));
    expect(restored).toBeInstanceOf(SeedWordsSigner);
    expect(restored.key).toEqual(signer.key);
    expect(() => SeedWordsSigner.fromKey("invalid")).toThrow("Invalid private key");
  });
  it("matches the NIP-06 test vector", async () => {
    const signer = SeedWordsSigner.fromWords(
      "leader monkey parrot ring guide accident before fence cannon height naive bean",
      { wordlist },
    );
    expect(hex.encode(signer.key)).toBe("7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a");
    expect(await signer.getPublicKey()).toBe("17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917");
    const event = await signer.signEvent({ kind: 1, content: "hello", tags: [], created_at: 1 });
    expect(verifyEvent(event)).toBe(true);
  });

  it.each([
    [{}, "ed6b4c4479c2a9a74dc2fb0757163e25dc0a4e13407263952bfc6c56525f5cfd"],
    [{ account: 1 }, "83581a0215fb60d08683d2dabecf29ef2a3e69e65103fb5808014ebb6dc74e35"],
    [{ passphrase: "123" }, "5d4a75ce5049f3b024f039d3b3e6aee6d6b5abb41452cb141cf37c2edfa54d26"],
  ])("derives the expected account with %j", async (options, pubkey) => {
    expect(await SeedWordsSigner.fromWords(words, { ...options, wordlist }).getPublicKey()).toBe(pubkey);
  });

  it.each(["hello there", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo"])("rejects invalid words: %s", (value) => {
    expect(() => SeedWordsSigner.fromWords(value, { wordlist })).toThrow("Invalid mnemonic");
  });

  it.each([-1, 0.5, 0x80000000, NaN, Infinity])("rejects invalid account %s", (account) => {
    expect(() => SeedWordsSigner.fromWords(words, { account, wordlist })).toThrow("Invalid account index");
  });

  it("supports a custom wordlist", () => {
    const mnemonic = entropyToMnemonic(new Uint8Array(16), spanish);
    expect(() => SeedWordsSigner.fromWords(mnemonic, { wordlist })).toThrow("Invalid mnemonic");
    expect(SeedWordsSigner.fromWords(mnemonic, { wordlist: spanish }).key).toHaveLength(32);
  });

  it("inherits NIP-04 and NIP-44 encryption", async () => {
    const alice = SeedWordsSigner.fromWords(words, { wordlist });
    const bob = SeedWordsSigner.fromWords(words, { account: 1, wordlist });
    for (const protocol of ["nip04", "nip44"] as const) {
      const ciphertext = await alice[protocol].encrypt(await bob.getPublicKey(), "hello");
      expect(await bob[protocol].decrypt(await alice.getPublicKey(), ciphertext)).toBe("hello");
    }
  });
});
