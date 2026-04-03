import { NostrEvent } from "applesauce-core/helpers/event";
import { FileMetadataEvent, getFileMetadata, isValidFileMetadata } from "../helpers/file-metadata.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast a kind 1063 event to parsed file metadata */
export class FileMetadata extends EventCast<FileMetadataEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidFileMetadata(event)) throw new Error("Invalid file metadata event");
    super(event, store);
  }

  get metadata() {
    return getFileMetadata(this.event)!;
  }
  get url() {
    return this.metadata.url;
  }
  get type() {
    return this.metadata.type;
  }
  get sha256() {
    return this.metadata.sha256;
  }
  get originalSha256() {
    return this.metadata.originalSha256;
  }
  get size() {
    return this.metadata.size;
  }
  get dimensions() {
    return this.metadata.dimensions;
  }
  get magnet() {
    return this.metadata.magnet;
  }
  get infohash() {
    return this.metadata.infohash;
  }
  get thumbnail() {
    return this.metadata.thumbnail;
  }
  get image() {
    return this.metadata.image;
  }
  get summary() {
    return this.metadata.summary;
  }
  get alt() {
    return this.metadata.alt;
  }
  get blurhash() {
    return this.metadata.blurhash;
  }
  get fallback() {
    return this.metadata.fallback;
  }
}
