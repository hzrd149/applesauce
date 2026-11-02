import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** The file encryption algorithm used by NIP-17 file messages */
export const ENCRYPTED_FILE_ALGORITHM = "aes-gcm";

/** Raw file data accepted by {@link encryptFile} and {@link decryptFile} */
export type FileData = Blob | ArrayBuffer | Uint8Array;

/** The result of encrypting a file */
export type EncryptedFile = {
  /** The encrypted bytes to upload */
  ciphertext: Uint8Array;
  /** The encryption algorithm, always {@link ENCRYPTED_FILE_ALGORITHM} */
  algorithm: typeof ENCRYPTED_FILE_ALGORITHM;
  /** The hex encoded AES key */
  key: string;
  /** The hex encoded AES-GCM nonce */
  nonce: string;
  /** The sha256 of the encrypted bytes */
  sha256: string;
  /** The sha256 of the original bytes */
  originalSha256: string;
  /** The size of the encrypted bytes */
  size: number;
};

/** The fields needed to decrypt a file */
export type FileDecryptionFields = {
  /** The encryption algorithm, defaults to {@link ENCRYPTED_FILE_ALGORITHM} */
  encryptionAlgorithm?: string;
  /** The hex encoded AES key */
  decryptionKey?: string;
  /** The hex encoded AES-GCM nonce */
  decryptionNonce?: string;
  /** The expected sha256 of the encrypted bytes */
  sha256?: string;
  /** The expected sha256 of the decrypted bytes */
  originalSha256?: string;
};

async function toBytes(data: FileData): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

/** Returns the hex encoded sha256 of some bytes */
function hashHex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Copies bytes into a fresh ArrayBuffer, which Web Crypto requires */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Encrypts a file with a random AES-GCM key and nonce for upload to a public file server */
export async function encryptFile(data: FileData): Promise<EncryptedFile> {
  const plaintext = await toBytes(data);

  const key = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey("raw", buffer(key), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: buffer(nonce) }, cryptoKey, buffer(plaintext));
  const ciphertext = new Uint8Array(encrypted);

  return {
    ciphertext,
    algorithm: ENCRYPTED_FILE_ALGORITHM,
    key: bytesToHex(key),
    nonce: bytesToHex(nonce),
    sha256: hashHex(ciphertext),
    originalSha256: hashHex(plaintext),
    size: ciphertext.length,
  };
}

/**
 * Decrypts a file encrypted with {@link encryptFile} or another NIP-17 client
 * @throws if the algorithm is unsupported, the key or nonce is missing, a hash does not match, or decryption fails
 */
export async function decryptFile(data: FileData, fields: FileDecryptionFields): Promise<Uint8Array> {
  const algorithm = fields.encryptionAlgorithm ?? ENCRYPTED_FILE_ALGORITHM;
  if (algorithm.toLowerCase() !== ENCRYPTED_FILE_ALGORITHM)
    throw new Error(`Unsupported encryption algorithm ${algorithm}`);
  if (!fields.decryptionKey || !fields.decryptionNonce) throw new Error("Missing decryption key or nonce");

  const ciphertext = await toBytes(data);
  if (fields.sha256 && hashHex(ciphertext) !== fields.sha256.toLowerCase())
    throw new Error("Encrypted file hash does not match");

  // Clients disagree on the nonce length (12 or 16 bytes), and AES-GCM accepts both.
  const key = hexToBytes(fields.decryptionKey);
  const nonce = hexToBytes(fields.decryptionNonce);

  const cryptoKey = await crypto.subtle.importKey("raw", buffer(key), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle
    .decrypt({ name: "AES-GCM", iv: buffer(nonce) }, cryptoKey, buffer(ciphertext))
    .catch(() => {
      throw new Error("Failed to decrypt file");
    });
  const plaintext = new Uint8Array(decrypted);

  if (fields.originalSha256 && hashHex(plaintext) !== fields.originalSha256.toLowerCase())
    throw new Error("Decrypted file hash does not match");

  return plaintext;
}
