import { describe, expect, it } from "vitest";

import {
  InvalidMediaAttachmentEncryptionError,
  MediaAttachmentError,
  UnsupportedMediaAttachmentAlgorithmError,
  parseImeta,
} from "../imeta.js";

const url = "https://x/1";
const key = "A".repeat(64);
const nonce = "B".repeat(32);
const parse = (...entries: string[]) => parseImeta([["imeta", `url ${url}`, ...entries]]).get(url)!;

describe("parseImeta", () => {
  it("preserves valid encryption behavior", () => {
    const attachment = parse(
      "encryption-algorithm AES-GCM",
      `decryption-key ${key}`,
      `decryption-nonce ${nonce}`,
    );

    expect(attachment.encryption).toEqual({ algorithm: "aes-gcm", key: key.toLowerCase(), nonce: nonce.toLowerCase() });
    expect(attachment.encryptionError).toBeUndefined();
  });

  it.each([
    ["one-byte", "00"],
    ["15-byte", "A".repeat(30)],
    ["17-byte", "C".repeat(34)],
  ])("rejects a %s hexadecimal nonce without exposing its value", (_name, invalidNonce) => {
    const rawImeta = [
      "imeta",
      `url ${url}`,
      "encryption-algorithm aes-gcm",
      `decryption-key ${key}`,
      `decryption-nonce ${invalidNonce}`,
    ];
    const attachment = parseImeta([rawImeta]).get(url)!;

    expect(attachment).toBeDefined();
    expect(attachment.rawImeta).toEqual(rawImeta);
    expect(attachment.encryption).toBeUndefined();
    expect(attachment.encryptionError).toBeInstanceOf(InvalidMediaAttachmentEncryptionError);
    expect(attachment.encryptionError!.issues).toEqual([
      { field: "decryption-nonce", message: "Nonce must be 16-byte hexadecimal" },
    ]);
    expect(attachment.encryptionError!.message).not.toContain(invalidNonce);
    expect(JSON.stringify(attachment.encryptionError)).not.toContain(invalidNonce);
  });

  it("accepts exactly 16 nonce bytes and normalizes uppercase hexadecimal", () => {
    const supportedNonce = "B".repeat(32);
    const attachment = parse(
      "encryption-algorithm AES-GCM",
      `decryption-key ${key}`,
      `decryption-nonce ${supportedNonce}`,
    );

    expect(attachment.encryption).toEqual({
      algorithm: "aes-gcm",
      key: key.toLowerCase(),
      nonce: supportedNonce.toLowerCase(),
    });
    expect(attachment.encryptionError).toBeUndefined();
  });

  it("treats zero recognized fields as an unencrypted attachment", () => {
    const attachment = parse("m image/png", "unknown value");
    expect(attachment.encryption).toBeUndefined();
    expect(attachment.encryptionError).toBeUndefined();
  });

  it.each([
    ["partial metadata", ["encryption-algorithm aes-gcm"], ["decryption-key", "decryption-nonce"]],
    ["invalid key", ["encryption-algorithm aes-gcm", "decryption-key secret", `decryption-nonce ${nonce}`], ["decryption-key"]],
    ["invalid nonce", ["encryption-algorithm aes-gcm", `decryption-key ${key}`, "decryption-nonce xyz"], ["decryption-nonce"]],
  ])("retains attachments with %s and reports safe field issues", (_name, entries, fields) => {
    const attachment = parse(...entries);
    expect(attachment.encryption).toBeUndefined();
    expect(attachment.encryptionError).toBeInstanceOf(InvalidMediaAttachmentEncryptionError);
    expect(attachment.encryptionError).toBeInstanceOf(MediaAttachmentError);
    expect(attachment.encryptionError!.issues.map((issue) => issue.field)).toEqual(fields);
    expect(JSON.stringify(attachment.encryptionError)).not.toContain("secret");
    expect(attachment.encryptionError!.message).not.toContain(key);
    expect(attachment.encryptionError!.message).not.toContain(nonce);
  });

  it("reports a present unsupported algorithm separately", () => {
    const attachment = parse("encryption-algorithm chacha20", `decryption-key ${key}`, `decryption-nonce ${nonce}`);
    expect(attachment.encryption).toBeUndefined();
    expect(attachment.encryptionError).toBeInstanceOf(UnsupportedMediaAttachmentAlgorithmError);
    expect(attachment.encryptionError!.issues.map((issue) => issue.field)).toEqual(["encryption-algorithm"]);
    expect(attachment.encryptionError!.message).not.toContain("chacha20");
  });

  it("captures a shallow copy of the complete original tag", () => {
    const tag = ["imeta", `url ${url}`, "unknown one", "decryption-key first", `decryption-key ${key}`];
    const attachment = parseImeta([tag]).get(url)!;
    expect(attachment.rawImeta).toEqual(tag);
    expect(attachment.rawImeta).not.toBe(tag);
    tag[2] = "changed";
    tag.push("later value");
    expect(attachment.rawImeta).toEqual([
      "imeta",
      `url ${url}`,
      "unknown one",
      "decryption-key first",
      `decryption-key ${key}`,
    ]);
  });
});
