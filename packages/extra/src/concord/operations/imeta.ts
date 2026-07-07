// NIP-92 `imeta` tags for chat-message attachments.
//
// Concord chat media is encrypted client-side before upload (see image.ts): the
// blob at `url` is AES-256-GCM ciphertext and the per-file key/nonce ride in the
// message's `imeta` tag, readable only by members who can open the sealed kind-9
// rumor. This mirrors the Vector / 0xChat convention (`encryption-algorithm` /
// `decryption-key` / `decryption-nonce`) so attachments interoperate.

/** AES-GCM blob-encryption parameters carried in an imeta tag. */
export interface AttachmentEncryption {
  /** Only "aes-gcm" is supported. */
  algorithm: string;
  /** AES-256 key, lowercase hex (64 chars). */
  key: string;
  /** AES-GCM nonce/IV, lowercase hex (we use a 16-byte, 0xChat-compatible nonce). */
  nonce: string;
}

/** A parsed imeta attachment (keyed by its `url`). */
export interface MediaAttachment {
  url: string;
  /** MIME from the `m` field, e.g. "image/png". */
  mime?: string;
  /** NIP-94 `x`: sha256 of the blob at the URL (the ciphertext). */
  hash?: string;
  /** NIP-94 `ox`: sha256 of the original plaintext, for fail-closed verification. */
  originalHash?: string;
  /** Present only when the blob is client-encrypted. */
  encryption?: AttachmentEncryption;
}

/** Lowercase-hex validator (even length, hex digits only; optional exact length). */
function isHex(s: string | undefined, len?: number): s is string {
  if (!s) return false;
  if (len !== undefined && s.length !== len) return false;
  return s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);
}

function parseEncryption(entry: Record<string, string>): AttachmentEncryption | undefined {
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
    const entry: Record<string, string> = {};
    for (let i = 1; i < tag.length; i++) {
      const sp = tag[i].indexOf(" ");
      if (sp === -1) continue;
      entry[tag[i].slice(0, sp)] = tag[i].slice(sp + 1);
    }
    if (!entry.url) continue;
    map.set(entry.url, {
      url: entry.url,
      mime: entry.m,
      hash: isHex(entry.x) ? entry.x.toLowerCase() : undefined,
      originalHash: isHex(entry.ox) ? entry.ox.toLowerCase() : undefined,
      encryption: parseEncryption(entry),
    });
  }
  return map;
}

/** Build a NIP-92 `imeta` tag from an attachment. */
export function buildImetaTag(a: MediaAttachment): string[] {
  const parts = [`url ${a.url}`];
  if (a.mime) parts.push(`m ${a.mime}`);
  if (a.hash) parts.push(`x ${a.hash}`);
  if (a.originalHash) parts.push(`ox ${a.originalHash}`);
  if (a.encryption) {
    parts.push(
      `encryption-algorithm ${a.encryption.algorithm}`,
      `decryption-key ${a.encryption.key}`,
      `decryption-nonce ${a.encryption.nonce}`,
    );
  }
  return ["imeta", ...parts];
}
