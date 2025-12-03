import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { beforeEach, describe, expect, it } from "vitest";
import { ReadonlySigner } from "../readonly-signer.js";

describe("ReadonlySigner", () => {
  const testPubkey = getPublicKey(generateSecretKey());
  let signer: ReadonlySigner;

  beforeEach(() => {
    signer = new ReadonlySigner(testPubkey);
  });

  describe("getPublicKey", () => {
    it("should return the public key provided in constructor", async () => {
      await expect(signer.getPublicKey()).resolves.toBe(testPubkey);
    });
  });

  describe("signEvent", () => {
    it("should throw an error when attempting to sign events", async () => {
      await expect(signer.signEvent()).rejects.toThrow("Cant sign events with readonly");
    });
  });

  describe("nip04 encryption/decryption", () => {
    it("should throw an error when attempting to encrypt via nip04.encrypt", async () => {
      await expect(signer.nip04.encrypt("pubkey", "plaintext")).rejects.toThrow("Cant encrypt with readonly");
    });

    it("should throw an error when attempting to decrypt via nip04.decrypt", async () => {
      await expect(signer.nip04.decrypt("pubkey", "ciphertext")).rejects.toThrow("Cant decrypt with readonly");
    });
  });

  describe("nip44 encryption/decryption", () => {
    it("should throw an error when attempting to encrypt via nip44.encrypt", async () => {
      await expect(signer.nip44.encrypt("pubkey", "plaintext")).rejects.toThrow("Cant encrypt with readonly");
    });

    it("should throw an error when attempting to decrypt via nip44.decrypt", async () => {
      await expect(signer.nip44.decrypt("pubkey", "ciphertext")).rejects.toThrow("Cant decrypt with readonly");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string as public key", () => {
      expect(() => new ReadonlySigner("")).toThrow("Invalid public key");
    });

    it("should handle special characters in public key", () => {
      expect(() => new ReadonlySigner("test-key-with-special-chars!@#$%")).toThrow("Invalid public key");
    });
  });
});
