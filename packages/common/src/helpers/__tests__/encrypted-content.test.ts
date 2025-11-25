import { describe, it, expect } from "vitest";
import { kinds } from "nostr-tools";
import { getEncryptedContentEncryptionMethods, EncryptedContentSigner } from "../encrypted-content.js";

describe("getEncryptedContentEncryptionMethods", () => {
  const mockSigner: EncryptedContentSigner = {
    nip04: {
      encrypt: async (pubkey: string, plaintext: string) => "encrypted-nip04",
      decrypt: async (pubkey: string, ciphertext: string) => "decrypted-nip04",
    },
    nip44: {
      encrypt: async (pubkey: string, plaintext: string) => "encrypted-nip44",
      decrypt: async (pubkey: string, ciphertext: string) => "decrypted-nip44",
    },
  };

  it("should return nip04 encryption methods for EncryptedDirectMessage", () => {
    const methods = getEncryptedContentEncryptionMethods(kinds.EncryptedDirectMessage, mockSigner);
    expect(methods).toBe(mockSigner.nip04);
  });

  it("should return nip44 encryption methods for Seal", () => {
    const methods = getEncryptedContentEncryptionMethods(kinds.Seal, mockSigner);
    expect(methods).toBe(mockSigner.nip44);
  });

  it("should return nip44 encryption methods for GiftWrap", () => {
    const methods = getEncryptedContentEncryptionMethods(kinds.GiftWrap, mockSigner);
    expect(methods).toBe(mockSigner.nip44);
  });

  it("should throw error for unsupported event kind", () => {
    expect(() => {
      getEncryptedContentEncryptionMethods(1, mockSigner);
    }).toThrow("Event kind 1 does not support encrypted content");
  });

  it("should throw error when signer does not support required encryption method", () => {
    const signerWithoutNip04: EncryptedContentSigner = {
      nip44: mockSigner.nip44,
    };

    expect(() => {
      getEncryptedContentEncryptionMethods(kinds.EncryptedDirectMessage, signerWithoutNip04);
    }).toThrow("Signer does not support nip04 encryption");
  });

  it("should throw error when signer does not support nip44", () => {
    const signerWithoutNip44: EncryptedContentSigner = {
      nip04: mockSigner.nip04,
    };

    expect(() => {
      getEncryptedContentEncryptionMethods(kinds.Seal, signerWithoutNip44);
    }).toThrow("Signer does not support nip44 encryption");
  });
});
