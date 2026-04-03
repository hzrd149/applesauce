import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { FileMetadataFields } from "../helpers/file-metadata.js";
import {
  addFallbackURL,
  clearFallbackURLs,
  removeFallbackURL,
  setFallbackURLs,
  setFileAlt,
  setFileBlurhash,
  setFileDimensions,
  setFileImage,
  setFileInfohash,
  setFileMagnet,
  setFileMetadata,
  setOriginalFileSHA256,
  setFileSHA256,
  setFileSize,
  setFileSummary,
  setFileThumbnail,
  setFileType,
  setFileURL,
} from "../operations/file-metadata.js";

export type FileMetadataTemplate = KnownEventTemplate<1063>;

export type FileMetadataUploadResult = {
  url: string;
  sha256: string;
  size?: number;
  type?: string;
};

export type FileMetadataUploader = (file: File) => Promise<FileMetadataUploadResult> | FileMetadataUploadResult;

/** A factory class for building kind 1063 file metadata events */
export class FileMetadataFactory extends EventFactory<1063, FileMetadataTemplate> {
  /** Creates a new file metadata factory */
  static create(metadata?: FileMetadataFields): FileMetadataFactory {
    const factory = new FileMetadataFactory((res) => res(blankEventTemplate(1063) as FileMetadataTemplate));
    return metadata ? factory.metadata(metadata) : factory;
  }

  /** Uploads a file and creates a kind 1063 template from the result */
  static async fromUpload(file: File, uploader: FileMetadataUploader): Promise<FileMetadataTemplate> {
    const uploaded = await uploader(file);

    return FileMetadataFactory.create({
      url: uploaded.url,
      sha256: uploaded.sha256,
      size: uploaded.size ?? file.size,
      type: (uploaded.type ?? file.type) || undefined,
    });
  }

  /** Sets multiple file metadata fields */
  metadata(fields: FileMetadataFields) {
    return this.chain(setFileMetadata(fields));
  }

  /** Sets or removes the file URL */
  url(value: string | null) {
    return this.chain(setFileURL(value));
  }

  /** Sets or removes the MIME type */
  type(value: string | null) {
    return this.chain(setFileType(value));
  }

  /** Sets or removes the SHA-256 hash */
  sha256(value: string | null) {
    return this.chain(setFileSHA256(value));
  }

  /** Sets or removes the original SHA-256 hash */
  originalSha256(value: string | null) {
    return this.chain(setOriginalFileSHA256(value));
  }

  /** Sets or removes the file size */
  size(value: number | null) {
    return this.chain(setFileSize(value));
  }

  /** Sets or removes the dimensions */
  dimensions(value: string | null) {
    return this.chain(setFileDimensions(value));
  }

  /** Sets or removes the magnet URI */
  magnet(value: string | null) {
    return this.chain(setFileMagnet(value));
  }

  /** Sets or removes the infohash */
  infohash(value: string | null) {
    return this.chain(setFileInfohash(value));
  }

  /** Sets or removes the thumbnail URL */
  thumbnail(value: string | null) {
    return this.chain(setFileThumbnail(value));
  }

  /** Sets or removes the preview image URL */
  image(value: string | null) {
    return this.chain(setFileImage(value));
  }

  /** Sets or removes the summary */
  summary(value: string | null) {
    return this.chain(setFileSummary(value));
  }

  /** Sets or removes the alt text */
  alt(value: string | null) {
    return this.chain(setFileAlt(value));
  }

  /** Sets or removes the blurhash */
  blurhash(value: string | null) {
    return this.chain(setFileBlurhash(value));
  }

  /** Adds a fallback URL */
  addFallbackURL(url: string, replace = true) {
    return this.chain(addFallbackURL(url, replace));
  }

  /** Removes a fallback URL */
  removeFallbackURL(url: string) {
    return this.chain(removeFallbackURL(url));
  }

  /** Removes all fallback URLs */
  clearFallbackURLs() {
    return this.chain(clearFallbackURLs());
  }

  /** Replaces all fallback URLs */
  fallbackURLs(urls: string[]) {
    return this.chain(setFallbackURLs(urls));
  }
}
