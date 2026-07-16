import { describe, it, expect } from "vitest";
import { includeAltTag } from "../../operations/event.js";
import {
  EncryptedContentSigner,
  EncryptedContentSymbol,
  getEncryptedContent,
  getEncryptedContentEncryptionMethods,
  setEncryptedContentCache,
} from "../encrypted-content.js";
import { kinds } from "../event.js";
import { eventPipe } from "../pipeline.js";
import { unixNow } from "../time.js";

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

describe("setEncryptedContentCache", () => {
  it("writes EncryptedContentSymbol non-enumerable and a plain spread copy drops it", () => {
    const draft = { kind: kinds.EncryptedDirectMessage, content: "ciphertext", tags: [], created_at: unixNow() };
    setEncryptedContentCache(draft, "plaintext");

    const descriptor = Object.getOwnPropertyDescriptor(draft, EncryptedContentSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...draft };
    expect(Object.prototype.hasOwnProperty.call(copy, EncryptedContentSymbol)).toBe(false);
  });

  it("re-entry integration: plaintext survives modifyPublicTags's spread across a real eventPipe via carry-forward", async () => {
    // An unlocked event (EncryptedContentSymbol already cached via setEncryptedContentCache)
    // re-enters a factory pipe whose first step is a public-tag operation (includeAltTag ->
    // modifyPublicTags's `{ ...draft, tags }` spread). Once the write is non-enumerable, this
    // spread alone would drop the symbol -- it survives only because pipeFromAsyncArray's
    // carry-forward loop restores every PRESERVE_EVENT_SYMBOLS member (EncryptedContentSymbol is
    // already a permanent member) from the step's input onto its output.
    const draft = { kind: kinds.EncryptedDirectMessage, content: "ciphertext", tags: [], created_at: unixNow() };
    setEncryptedContentCache(draft, "decrypted-plaintext");

    const result = await eventPipe(includeAltTag("carry-forward probe"))(draft);

    // The intervening operation actually ran (proves the spread executed, not a no-op).
    expect(result.tags).toContainEqual(["alt", "carry-forward probe"]);
    // The plaintext survived that spread via carry-forward, not write-site enumerability.
    expect(getEncryptedContent(result)).toBe("decrypted-plaintext");
  });
});
