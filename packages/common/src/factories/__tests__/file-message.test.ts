import { getEventHash, kinds, Rumor } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { getFileMessageMetadata, getMessageAttachments, isValidFileMessage } from "../../helpers/file-message.js";
import { createImetaTagForAttachment } from "../../helpers/file-metadata.js";
import { isWrappedMessage } from "../../helpers/wrapped-messages.js";
import { FileMessageFactory } from "../file-message.js";

const alice = "a".repeat(64);
const bob = "b".repeat(64);

const file = {
  url: "https://blossom.example/" + "c".repeat(64),
  type: "image/jpeg",
  encryptionAlgorithm: "aes-gcm",
  decryptionKey: "11".repeat(32),
  decryptionNonce: "22".repeat(12),
  sha256: "c".repeat(64),
  originalSha256: "d".repeat(64),
  size: 1024,
  dimensions: "640x480",
  fallback: ["https://mirror.example/" + "c".repeat(64)],
};

function toRumor(template: { kind: number; content: string; tags: string[][]; created_at: number }): Rumor {
  const unsigned = { ...template, pubkey: alice };
  return { ...unsigned, id: getEventHash(unsigned) };
}

describe("FileMessageFactory", () => {
  it("creates a kind 15 file message", async () => {
    const template = await FileMessageFactory.create(bob, file).replyTo("e".repeat(64));

    expect(template.kind).toBe(kinds.FileMessage);
    expect(template.content).toBe(file.url);
    expect(template.tags).toEqual(
      expect.arrayContaining([
        ["p", bob],
        ["e", "e".repeat(64)],
        ["file-type", "image/jpeg"],
        ["encryption-algorithm", "aes-gcm"],
        ["decryption-key", file.decryptionKey],
        ["decryption-nonce", file.decryptionNonce],
        ["x", file.sha256],
        ["ox", file.originalSha256],
        ["size", "1024"],
        ["dim", "640x480"],
        ["fallback", file.fallback[0]],
      ]),
    );
  });

  it("throws without a URL", () => {
    expect(() => FileMessageFactory.create(bob, { type: "image/png" })).toThrow("requires a URL");
  });

  it("round trips through getFileMessageMetadata", async () => {
    const rumor = toRumor(await FileMessageFactory.create(bob, file));

    expect(isValidFileMessage(rumor)).toBe(true);
    expect(isWrappedMessage(rumor)).toBe(true);
    expect(getFileMessageMetadata(rumor)).toMatchObject(file);
    expect(getMessageAttachments(rumor)).toEqual([getFileMessageMetadata(rumor)]);
  });
});

describe("file message helpers", () => {
  it("does not treat a double-ratchet receipt as a file", () => {
    const receipt = toRumor({ kind: 15, content: "seen", tags: [["e", "f".repeat(64)]], created_at: 1 });

    expect(isValidFileMessage(receipt)).toBe(false);
    expect(isWrappedMessage(receipt)).toBe(false);
    expect(getMessageAttachments(receipt)).toEqual([]);
  });

  it("reads imeta attachments from a kind 14 message", () => {
    const message = toRumor({
      kind: 14,
      content: `look\n${file.url}`,
      tags: [["p", bob], createImetaTagForAttachment(file)],
      created_at: 1,
    });

    expect(getMessageAttachments(message)).toEqual([
      expect.objectContaining({ url: file.url, decryptionKey: file.decryptionKey }),
    ]);
  });
});
