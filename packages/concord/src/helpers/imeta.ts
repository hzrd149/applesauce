// NIP-92 `imeta` tags for chat-message attachments.
//
// Concord chat media is encrypted client-side before upload: the blob at `url`
// is AES-256-GCM ciphertext and the per-file key/nonce ride in the message's
// `imeta` tag, readable only by members who can open the sealed kind-9 rumor.
// This mirrors the Vector / 0xChat convention (`encryption-algorithm` /
// `decryption-key` / `decryption-nonce`) so attachments interoperate.
//
// The base imeta fields (url/m/x/ox/…) are the applesauce-common
// {@link FileMetadataFields}; only the client-encryption fields are Concord's,
// applied on top of the common `imeta` tag by `includeMediaEncryption`
// (../operations/channel.js) and read back here by `parseImeta`.

import { getFileMetadataFromImetaTag, type FileMetadataFields } from "applesauce-common/helpers";

/** AES-GCM blob-encryption parameters carried in an imeta tag. */
export interface AttachmentEncryption {
  /** Only "aes-gcm" is supported. */
  algorithm: string;
  /** AES-256 key, lowercase hex (64 chars). */
  key: string;
  /** AES-GCM nonce/IV, lowercase hex (we use a 16-byte, 0xChat-compatible nonce). */
  nonce: string;
}

/** A parsed imeta attachment: the common file-metadata fields plus optional client-encryption. */
export type MediaAttachment = FileMetadataFields & {
  /** Present only when the blob is client-encrypted. */
  encryption?: AttachmentEncryption;
};

/** Lowercase-hex validator (even length, hex digits only; optional exact length). */
function isHex(s: string | undefined, len?: number): s is string {
  if (!s) return false;
  if (len !== undefined && s.length !== len) return false;
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);
}

/** Parse the Concord client-encryption fields (if any) from an imeta tag's entries. */
function parseEncryption(tag: string[]): AttachmentEncryption | undefined {
  const entry: Record<string, string> = {};
  for (let i = 1; i < tag.length; i++) {
    const sp = tag[i].indexOf(" ");
    if (sp === -1) continue;
    entry[tag[i].slice(0, sp)] = tag[i].slice(sp + 1);
  }

  const algorithm = entry["encryption-algorithm"];
  const key = entry["decryption-key"];
  const nonce = entry["decryption-nonce"];
  if (!algorithm || algorithm.toLowerCase() !== "aes-gcm") return undefined;
  if (!isHex(key, 64) || !isHex(nonce)) return undefined;
  return { algorithm: "aes-gcm", key: key.toLowerCase(), nonce: nonce.toLowerCase() };
}

/** Parse every `imeta` tag on an event into a map keyed by URL. */
export function parseImeta(tags: string[][]): Map<string, MediaAttachment> {
  const map = new Map<string, MediaAttachment>();
  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    const base = getFileMetadataFromImetaTag(tag);
    if (!base.url) continue;
    map.set(base.url, { ...base, encryption: parseEncryption(tag) });
  }
  return map;
}
