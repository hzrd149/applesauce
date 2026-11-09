import { decryptFile, encryptFile, ENCRYPTED_FILE_ALGORITHM } from "applesauce-common/helpers/encrypted-file";
import { FileMetadataFields, isEncryptedFile } from "applesauce-common/helpers/file-metadata";

/** The URLs a {@link MessageFileUploader} stored a blob at */
export type UploadedFile = {
  /** The primary URL of the uploaded blob */
  url: string;
  /** Mirror URLs of the same blob */
  fallback?: string[];
};

/** A method that uploads an already encrypted blob to a file server, such as a Blossom server */
export type MessageFileUploader = (blob: Blob, options: { signal?: AbortSignal }) => Promise<UploadedFile>;

/** Options for {@link uploadEncryptedFile} */
export type UploadEncryptedFileOptions = {
  /** Aborts the upload */
  signal?: AbortSignal;
  /** Extra metadata to include, such as dimensions or alt text */
  metadata?: Pick<FileMetadataFields, "dimensions" | "alt" | "blurhash">;
};

/**
 * Encrypts a file, uploads only the ciphertext, and returns the metadata a message needs to decrypt it
 * @throws if encryption or the upload fails
 */
export async function uploadEncryptedFile(
  file: Blob,
  upload: MessageFileUploader,
  options: UploadEncryptedFileOptions = {},
): Promise<FileMetadataFields> {
  const encrypted = await encryptFile(file);

  // The file server only sees opaque bytes, so the real type stays inside the encrypted message.
  const blob = new Blob([encrypted.ciphertext as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" });
  const uploaded = await upload(blob, { signal: options.signal });

  return {
    ...options.metadata,
    url: uploaded.url,
    fallback: uploaded.fallback?.length ? uploaded.fallback : undefined,
    type: file.type || "application/octet-stream",
    size: encrypted.size,
    sha256: encrypted.sha256,
    originalSha256: encrypted.originalSha256,
    encryptionAlgorithm: ENCRYPTED_FILE_ALGORITHM,
    decryptionKey: encrypted.key,
    decryptionNonce: encrypted.nonce,
  };
}

/** The default limit on the bytes {@link loadAttachment} downloads from one source */
export const DEFAULT_MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;

// AES-GCM appends a 16-byte tag, and clients disagree on whether an encrypted file's size counts it.
const GCM_TAG_SIZE = 16;

/** Options for {@link loadAttachment} */
export type LoadAttachmentOptions = {
  /** Aborts the download */
  signal?: AbortSignal;
  /** The fetch implementation, defaults to the global fetch */
  fetch?: typeof fetch;
  /** The most bytes to download from one source, defaults to {@link DEFAULT_MAX_ATTACHMENT_SIZE} */
  maxSize?: number;
};

/**
 * Reads a response body, failing as soon as it grows past `limit` bytes
 * @throws if the body is larger than the limit
 */
async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > limit) throw new Error(`Attachment is ${length} bytes, more than the ${limit} byte limit`);

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length > limit) throw new Error(`Attachment is larger than the ${limit} byte limit`);
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.length;
    if (size > limit) {
      // Cancelling stops the download rather than buffering a body that will be thrown away.
      await reader.cancel().catch(() => {});
      throw new Error(`Attachment is larger than the ${limit} byte limit`);
    }
    chunks.push(value);
  }

  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/**
 * Downloads a message attachment from its URL or fallbacks and decrypts it when it is encrypted
 * @throws if the attachment has no URL, is larger than `maxSize`, every source fails, or decryption fails
 */
export async function loadAttachment(file: FileMetadataFields, options: LoadAttachmentOptions = {}): Promise<Blob> {
  const sources = [file.url, ...(file.fallback ?? [])].filter((url): url is string => !!url);
  if (sources.length === 0) throw new Error("Attachment has no URL");

  const maxSize = options.maxSize ?? DEFAULT_MAX_ATTACHMENT_SIZE;
  const declared = Number.isSafeInteger(file.size) && file.size! >= 0 ? file.size! : undefined;
  if (declared !== undefined && declared > maxSize)
    throw new Error(`Attachment is ${declared} bytes, more than the ${maxSize} byte limit`);

  // A source serving more bytes than the sender declared is serving the wrong file.
  const limit =
    declared === undefined ? maxSize : Math.min(maxSize, declared + (isEncryptedFile(file) ? GCM_TAG_SIZE : 0));

  const download = options.fetch ?? fetch;
  let lastError: unknown;

  for (const url of sources) {
    try {
      const response = await download(url, { signal: options.signal });
      if (!response.ok) throw new Error(`${url} responded ${response.status}`);
      const data = await readLimited(response, limit);

      if (!isEncryptedFile(file)) return new Blob([data as Uint8Array<ArrayBuffer>], { type: file.type });

      // A hash or authentication failure means this mirror served the wrong bytes, so try the next one.
      const plaintext = await decryptFile(data, file);
      return new Blob([plaintext as Uint8Array<ArrayBuffer>], { type: file.type });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to load attachment");
}
