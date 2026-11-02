import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { decryptFile, encryptFile } from "../encrypted-file.js";
import { createImetaTagForAttachment, getFileMetadataFromImetaTag, isEncryptedFile } from "../file-metadata.js";

const plaintext = new TextEncoder().encode("hello encrypted file");

describe("encryptFile", () => {
  it("round trips with decryptFile", async () => {
    const encrypted = await encryptFile(plaintext);

    expect(encrypted.algorithm).toBe("aes-gcm");
    expect(encrypted.key).toMatch(/^[0-9a-f]{64}$/);
    expect(encrypted.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(encrypted.size).toBe(encrypted.ciphertext.length);
    expect(bytesToHex(encrypted.ciphertext)).not.toContain(bytesToHex(plaintext));

    const decrypted = await decryptFile(encrypted.ciphertext, {
      decryptionKey: encrypted.key,
      decryptionNonce: encrypted.nonce,
      sha256: encrypted.sha256,
      originalSha256: encrypted.originalSha256,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("hello encrypted file");
  });

  it("accepts a Blob", async () => {
    const encrypted = await encryptFile(new Blob([plaintext]));
    const decrypted = await decryptFile(new Blob([encrypted.ciphertext]), {
      decryptionKey: encrypted.key,
      decryptionNonce: encrypted.nonce,
    });
    expect(decrypted).toEqual(plaintext);
  });
});

describe("decryptFile", () => {
  it("decrypts a file encrypted with a 16 byte nonce", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, plaintext),
    );

    const decrypted = await decryptFile(ciphertext, {
      decryptionKey: bytesToHex(key),
      decryptionNonce: bytesToHex(nonce),
    });
    expect(decrypted).toEqual(plaintext);
  });

  it("throws on tampered ciphertext", async () => {
    const encrypted = await encryptFile(plaintext);
    encrypted.ciphertext[0] ^= 1;

    await expect(
      decryptFile(encrypted.ciphertext, { decryptionKey: encrypted.key, decryptionNonce: encrypted.nonce }),
    ).rejects.toThrow("Failed to decrypt file");
  });

  it("throws when the encrypted hash does not match", async () => {
    const encrypted = await encryptFile(plaintext);

    await expect(
      decryptFile(encrypted.ciphertext, {
        decryptionKey: encrypted.key,
        decryptionNonce: encrypted.nonce,
        sha256: "00".repeat(32),
      }),
    ).rejects.toThrow("Encrypted file hash does not match");
  });

  it("throws for unsupported algorithms and missing keys", async () => {
    await expect(decryptFile(plaintext, { encryptionAlgorithm: "chacha20" })).rejects.toThrow("Unsupported");
    await expect(decryptFile(plaintext, {})).rejects.toThrow("Missing decryption key or nonce");
  });
});

describe("imeta decryption fields", () => {
  it("round trips through an imeta tag", () => {
    const file = {
      url: "https://blossom.example/abc",
      type: "image/png",
      encryptionAlgorithm: "aes-gcm",
      decryptionKey: "aa".repeat(32),
      decryptionNonce: "bb".repeat(12),
    };

    const tag = createImetaTagForAttachment(file);
    expect(tag).toContain("decryption-key " + file.decryptionKey);

    const parsed = getFileMetadataFromImetaTag(tag);
    expect(parsed).toMatchObject(file);
    expect(isEncryptedFile(parsed)).toBe(true);
    expect(isEncryptedFile({ url: file.url })).toBe(false);
  });
});
