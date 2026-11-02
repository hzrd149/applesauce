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

/** Options for {@link loadAttachment} */
export type LoadAttachmentOptions = {
  /** Aborts the download */
  signal?: AbortSignal;
  /** The fetch implementation, defaults to the global fetch */
  fetch?: typeof fetch;
};

/**
 * Downloads a message attachment from its URL or fallbacks and decrypts it when it is encrypted
 * @throws if the attachment has no URL, every source fails, or decryption fails
 */
export async function loadAttachment(file: FileMetadataFields, options: LoadAttachmentOptions = {}): Promise<Blob> {
  const sources = [file.url, ...(file.fallback ?? [])].filter((url): url is string => !!url);
  if (sources.length === 0) throw new Error("Attachment has no URL");

  const download = options.fetch ?? fetch;
  let lastError: unknown;

  for (const url of sources) {
    try {
      const response = await download(url, { signal: options.signal });
      if (!response.ok) throw new Error(`${url} responded ${response.status}`);
      const data = await response.arrayBuffer();

      if (!isEncryptedFile(file)) return new Blob([data], { type: file.type });

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
