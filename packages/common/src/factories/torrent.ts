import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { TORRENT_KIND, TorrentExternalIdentifier, TorrentFile } from "../helpers/torrent.js";
import {
  addTorrentExternalIdentifier,
  addTorrentFile,
  addTorrentSearchTag,
  addTorrentTracker,
  setTorrentCategory,
  setTorrentCategoryPath,
  setTorrentInfoHash,
  setTorrentTitle,
} from "../operations/torrent.js";

export type TorrentTemplate = KnownEventTemplate<typeof TORRENT_KIND>;

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
  /**
   * Creates a new torrent factory
   * @param infoHash - The torrent info hash
   * @param content - Optional description
   * @returns A new torrent factory
   */
  static create(infoHash: string, content?: string): TorrentFactory {
    const factory = new TorrentFactory((res) => res(blankEventTemplate(TORRENT_KIND))).infoHash(infoHash);
    return content ? factory.content(content) : factory;
  }

  /** Sets the torrent info hash */
  infoHash(hash: string) {
    return this.chain((draft) => setTorrentInfoHash(hash)(draft));
  }

  /** Sets the torrent title */
  title(title: string) {
    return this.chain((draft) => setTorrentTitle(title)(draft));
  }

  /** Sets the category path */
  categoryPath(path: string) {
    return this.chain((draft) => setTorrentCategoryPath(path)(draft));
  }

  /** Sets the newznab category */
  category(id: number) {
    return this.chain((draft) => setTorrentCategory(id)(draft));
  }

  /** Adds a file to the torrent */
  addFile(file: TorrentFile) {
    return this.chain((draft) => addTorrentFile(file)(draft));
  }

  /** Adds files to the torrent */
  files(files: TorrentFile[]) {
    return this.chain(async (draft): Promise<TorrentTemplate> => {
      let result: any = draft;
      for (const file of files) {
        result = await addTorrentFile(file)(result);
      }
      return result;
    });
  }

  /** Adds a tracker URL */
  addTracker(url: string) {
    return this.chain((draft) => addTorrentTracker(url)(draft));
  }

  /** Adds tracker URLs */
  trackers(urls: string[]) {
    return this.chain(async (draft): Promise<TorrentTemplate> => {
      let result: any = draft;
      for (const url of urls) {
        result = await addTorrentTracker(url)(result);
      }
      return result;
    });
  }

  /** Adds a search tag */
  addSearchTag(tag: string) {
    return this.chain((draft) => addTorrentSearchTag(tag)(draft));
  }

  /** Adds search tags */
  searchTags(tags: string[]) {
    return this.chain(async (draft): Promise<TorrentTemplate> => {
      let result: any = draft;
      for (const tag of tags) {
        result = await addTorrentSearchTag(tag)(result);
      }
      return result;
    });
  }

  /** Adds an external identifier */
  addExternalId(id: TorrentExternalIdentifier) {
    return this.chain((draft) => addTorrentExternalIdentifier(id)(draft));
  }

  /** Adds external identifiers */
  externalIds(ids: TorrentExternalIdentifier[]) {
    return this.chain(async (draft): Promise<TorrentTemplate> => {
      let result: any = draft;
      for (const id of ids) {
        result = await addTorrentExternalIdentifier(id)(result);
      }
      return result;
    });
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain((draft) => setMetaTags(options)(draft));
  }
}
