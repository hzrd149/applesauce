import type { TorrentExternalIdentifier, TorrentFile } from "applesauce-common/helpers/torrent";
import { TORRENT_KIND } from "applesauce-common/helpers/torrent";

import { blueprint } from "../event-factory.js";
import { eventPipe } from "../helpers/pipeline.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setContent } from "../operations/content.js";
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

/**
 * NIP-35 Torrent event (kind 2003) blueprint
 * Creates a torrent event with info hash and optional metadata
 */
export function TorrentBlueprint(infoHash: string, content: string, options?: TorrentBlueprintOptions) {
  return blueprint(
    TORRENT_KIND,
    setTorrentInfoHash(infoHash),
    setContent(content),
    options?.title ? setTorrentTitle(options.title) : undefined,
    options?.categoryPath ? setTorrentCategoryPath(options.categoryPath) : undefined,
    // Add files
    options?.files ? eventPipe(...options.files.map((file) => addTorrentFile(file))) : undefined,
    // Add trackers
    options?.trackers ? eventPipe(...options.trackers.map((tracker) => addTorrentTracker(tracker))) : undefined,
    // Set newznab category
    options?.category !== undefined ? setTorrentCategory(options.category) : undefined,
    // Add search tags
    options?.searchTags ? eventPipe(...options.searchTags.map((tag) => addTorrentSearchTag(tag))) : undefined,
    // Add external identifiers
    options?.externalIdentifiers
      ? eventPipe(...options.externalIdentifiers.map((id) => addTorrentExternalIdentifier(id)))
      : undefined,
    setMetaTags({ ...options, alt: options?.alt ?? `Torrent: ${options?.title ?? infoHash}` }),
  );
}
