import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { TORRENT_KIND, TorrentExternalIdentifier, TorrentFile } from "../helpers/torrent.js";
import {
  addTorrentExternalIdentifier,
  addTorrentFile,
  addTorrentSearchTag,
  addTorrentTracker,
  removeTorrentCategory,
  removeTorrentCategoryPath,
  removeTorrentExternalIdentifier,
  removeTorrentFile,
  removeTorrentSearchTag,
  removeTorrentTracker,
  setTorrentCategory,
  setTorrentCategoryPath,
  setTorrentInfoHash,
  setTorrentTitle,
} from "../operations/torrent.js";

/** An unsigned NIP-35 torrent event template */
export type TorrentTemplate = KnownEventTemplate<typeof TORRENT_KIND>;

/** @deprecated Use the TorrentFactory builder methods instead */
export type TorrentBlueprintOptions = MetaTagOptions & {
  /** Torrent title */
  title?: string;
  /** File entries in the torrent */
  files?: TorrentFile[];
  /** Tracker URLs */
  trackers?: string[];
  /** Newznab category ID */
  category?: number;
  /** Search tags for searchability (t tags) */
  searchTags?: string[];
  /** Category path (tcat) */
  categoryPath?: string;
  /** External identifiers */
  externalIdentifiers?: TorrentExternalIdentifier[];
};

/** A factory class for building NIP-35 torrent events (kind 2003) */
export class TorrentFactory extends EventFactory<typeof TORRENT_KIND, TorrentTemplate> {
  /** Creates a new torrent factory with an info hash and optional description */
  static create(infoHash: string, content?: string): TorrentFactory {
    const factory = new TorrentFactory((res) => res(blankEventTemplate(TORRENT_KIND))).infoHash(infoHash);
    return content ? factory.content(content) : factory;
  }

  /**
   * Creates a factory for modifying an existing torrent event
   * @throws if the event is not a kind 2003 torrent
   */
  static modify(event: NostrEvent): TorrentFactory {
    if (event.kind !== TORRENT_KIND) throw new Error("Expected a torrent event");
    return new TorrentFactory((res) => res(toEventTemplate(event) as TorrentTemplate));
  }

  /** Sets the torrent info hash */
  infoHash(hash: string) {
    return this.chain(setTorrentInfoHash(hash));
  }

  /** Sets the torrent title */
  title(title: string) {
    return this.chain(setTorrentTitle(title));
  }

  /** Sets the category path */
  categoryPath(path: string) {
    return this.chain(setTorrentCategoryPath(path));
  }

  /** Removes the category path */
  clearCategoryPath() {
    return this.chain(removeTorrentCategoryPath());
  }

  /** Sets the newznab category */
  category(id: number) {
    return this.chain(setTorrentCategory(id));
  }

  /** Removes the newznab category */
  clearCategory() {
    return this.chain(removeTorrentCategory());
  }

  /** Adds a file to the torrent */
  addFile(file: TorrentFile) {
    return this.chain(addTorrentFile(file));
  }

  /** Removes a file from the torrent by name */
  removeFile(name: string) {
    return this.chain(removeTorrentFile(name));
  }

  /** Adds files to the torrent */
  files(files: TorrentFile[]) {
    return files.reduce<TorrentFactory>((factory, file) => factory.addFile(file), this);
  }

  /** Adds a tracker URL */
  addTracker(url: string) {
    return this.chain(addTorrentTracker(url));
  }

  /** Removes a tracker URL */
  removeTracker(url: string) {
    return this.chain(removeTorrentTracker(url));
  }

  /** Adds tracker URLs */
  trackers(urls: string[]) {
    return urls.reduce<TorrentFactory>((factory, url) => factory.addTracker(url), this);
  }

  /** Adds a search tag */
  addSearchTag(tag: string) {
    return this.chain(addTorrentSearchTag(tag));
  }

  /** Removes a search tag */
  removeSearchTag(tag: string) {
    return this.chain(removeTorrentSearchTag(tag));
  }

  /** Adds search tags */
  searchTags(tags: string[]) {
    return tags.reduce<TorrentFactory>((factory, tag) => factory.addSearchTag(tag), this);
  }

  /** Adds an external identifier */
  addExternalId(id: TorrentExternalIdentifier) {
    return this.chain(addTorrentExternalIdentifier(id));
  }

  /** Removes an external identifier by its full identifier string (e.g., "imdb:tt15239678") */
  removeExternalId(identifier: string) {
    return this.chain(removeTorrentExternalIdentifier(identifier));
  }

  /** Adds external identifiers */
  externalIds(ids: TorrentExternalIdentifier[]) {
    return ids.reduce<TorrentFactory>((factory, id) => factory.addExternalId(id), this);
  }
}
