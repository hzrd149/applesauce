import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

/** The NIP-35 torrent event kind */
export const TORRENT_KIND = 2003;

/** Type for validated torrent events */
export type TorrentEvent = KnownEvent<typeof TORRENT_KIND>;

/** A file entry inside a torrent */
export type TorrentFile = {
  /** Full path of the file, e.g., "info/example.txt" */
  name: string;
  /** Size of the file in bytes (optional) */
  size?: number;
};

/** Supported external identifier prefixes for torrents (excluding tcat and newznab, which are handled separately) */
export type TorrentExternalIdentifierPrefix = "tmdb" | "ttvdb" | "imdb" | "mal" | "anilist";

/** External identifier for a torrent */
export type TorrentExternalIdentifier = {
  /** The prefix type */
  prefix: TorrentExternalIdentifierPrefix;
  /** The full identifier string (e.g., "tmdb:movie:693134") */
  identifier: string;
  /** For second-level prefixes, the media type (e.g., "movie", "anime", "manga") */
  mediaType?: string;
  /** The ID part of the identifier */
  id: string;
};

const TorrentInfoHashSymbol = Symbol.for("torrent-info-hash");
const TorrentTitleSymbol = Symbol.for("torrent-title");
const TorrentFilesSymbol = Symbol.for("torrent-files");
const TorrentTrackersSymbol = Symbol.for("torrent-trackers");
const TorrentCategorySymbol = Symbol.for("torrent-category");
const TorrentSearchTagsSymbol = Symbol.for("torrent-search-tags");
const TorrentCategoryPathSymbol = Symbol.for("torrent-category-path");
const TorrentExternalIdentifiersSymbol = Symbol.for("torrent-external-identifiers");
const TorrentMagnetLinkSymbol = Symbol.for("torrent-magnet-link");

/** Returns the BitTorrent info hash from the `x` tag */
export function getTorrentInfoHash(torrent: TorrentEvent): string;
export function getTorrentInfoHash(torrent: NostrEvent): string | undefined;
export function getTorrentInfoHash(torrent: NostrEvent): string | undefined {
  if (torrent.kind !== TORRENT_KIND) return undefined;

  return getOrComputeCachedValue(torrent, TorrentInfoHashSymbol, () => {
    return getTagValue(torrent, "x");
  });
}

/** Returns the torrent title from the `title` tag */
export function getTorrentTitle(torrent: TorrentEvent): string | undefined;
export function getTorrentTitle(torrent: NostrEvent): string | undefined;
export function getTorrentTitle(torrent: NostrEvent): string | undefined {
  if (torrent.kind !== TORRENT_KIND) return undefined;

  return getOrComputeCachedValue(torrent, TorrentTitleSymbol, () => {
    return getTagValue(torrent, "title");
  });
}

/** Returns all file entries from `file` tags */
export function getTorrentFiles(torrent: NostrEvent): TorrentFile[] {
  if (torrent.kind !== TORRENT_KIND) return [];

  return getOrComputeCachedValue(torrent, TorrentFilesSymbol, () => {
    const files: TorrentFile[] = [];

    for (const tag of torrent.tags) {
      if (tag[0] === "file" && tag[1]) {
        const file: TorrentFile = {
          name: tag[1],
        };

        // Optional size in bytes (tag[2])
        if (tag[2]) {
          const size = parseInt(tag[2], 10);
          if (!Number.isNaN(size)) {
            file.size = size;
          }
        }

        files.push(file);
      }
    }

    return files;
  });
}

/** Returns all tracker URLs from `tracker` tags */
export function getTorrentTrackers(torrent: NostrEvent): string[] {
  if (torrent.kind !== TORRENT_KIND) return [];

  return getOrComputeCachedValue(torrent, TorrentTrackersSymbol, () => {
    const trackers: string[] = [];

    for (const tag of torrent.tags) {
      if (tag[0] === "tracker" && tag[1]) trackers.push(tag[1]);
    }

    return trackers;
  });
}

/** Returns the newznab category ID from the `i` tag with `newznab:` prefix */
export function getTorrentCategory(torrent: NostrEvent): number | undefined {
  if (torrent.kind !== TORRENT_KIND) return undefined;

  return getOrComputeCachedValue(torrent, TorrentCategorySymbol, () => {
    for (const tag of torrent.tags) {
      if (tag[0] === "i" && tag[1]?.startsWith("newznab:")) {
        const categoryId = parseInt(tag[1].slice(8), 10); // Return the ID after "newznab:"
        if (!Number.isNaN(categoryId)) {
          return categoryId;
        }
      }
    }
    return undefined;
  });
}

/** Returns all search tags (for searchability) from `t` tags */
export function getTorrentSearchTags(torrent: NostrEvent): string[] {
  if (torrent.kind !== TORRENT_KIND) return [];

  return getOrComputeCachedValue(torrent, TorrentSearchTagsSymbol, () => {
    const tags: string[] = [];

    for (const tag of torrent.tags) {
      if (tag[0] === "t" && tag[1]) tags.push(tag[1]);
    }

    return tags;
  });
}

/** Returns the category path from the `tcat` identifier in `i` tags (e.g., "video,movie,4k") */
export function getTorrentCategoryPath(torrent: NostrEvent): string | undefined {
  if (torrent.kind !== TORRENT_KIND) return undefined;

  return getOrComputeCachedValue(torrent, TorrentCategoryPathSymbol, () => {
    for (const tag of torrent.tags) {
      if (tag[0] === "i" && tag[1]?.startsWith("tcat:")) {
        return tag[1].slice(5); // Return the path after "tcat:"
      }
    }
    return undefined;
  });
}

/** Returns the `tcat` category path split into its parts (e.g., ["video", "movie", "4k"]) */
export function getTorrentCategoryPathParts(torrent: NostrEvent): string[] {
  const path = getTorrentCategoryPath(torrent);
  if (!path) return [];

  return path
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Parses tmdb, ttvdb, imdb, mal and anilist identifiers; tcat and newznab are handled by their own getters
function parseTorrentExternalIdentifier(value: string): TorrentExternalIdentifier | null {
  // Skip tcat - it's handled separately as a category path
  if (value.startsWith("tcat:")) return null;
  // Skip newznab - it's handled separately as categories
  if (value.startsWith("newznab:")) return null;

  // tmdb:movie:693134 or tmdb:693134
  if (value.startsWith("tmdb:")) {
    const rest = value.slice(5);
    const parts = rest.split(":");
    if (parts.length === 2) {
      return {
        prefix: "tmdb",
        identifier: value,
        mediaType: parts[0],
        id: parts[1],
      };
    } else {
      return {
        prefix: "tmdb",
        identifier: value,
        id: rest,
      };
    }
  }

  // ttvdb:movie:290272 or ttvdb:290272
  if (value.startsWith("ttvdb:")) {
    const rest = value.slice(6);
    const parts = rest.split(":");
    if (parts.length === 2) {
      return {
        prefix: "ttvdb",
        identifier: value,
        mediaType: parts[0],
        id: parts[1],
      };
    } else {
      return {
        prefix: "ttvdb",
        identifier: value,
        id: rest,
      };
    }
  }

  // imdb:tt15239678
  if (value.startsWith("imdb:")) {
    return {
      prefix: "imdb",
      identifier: value,
      id: value.slice(5),
    };
  }

  // mal:anime:9253 or mal:manga:17517 or mal:9253
  if (value.startsWith("mal:")) {
    const rest = value.slice(4);
    const parts = rest.split(":");
    if (parts.length === 2) {
      return {
        prefix: "mal",
        identifier: value,
        mediaType: parts[0],
        id: parts[1],
      };
    } else {
      return {
        prefix: "mal",
        identifier: value,
        id: rest,
      };
    }
  }

  // anilist:12345
  if (value.startsWith("anilist:")) {
    return {
      prefix: "anilist",
      identifier: value,
      id: value.slice(8),
    };
  }

  return null;
}

/** Returns all external identifiers from `i` tags (excluding tcat and newznab, which are handled separately) */
export function getTorrentExternalIdentifiers(torrent: NostrEvent): TorrentExternalIdentifier[] {
  if (torrent.kind !== TORRENT_KIND) return [];

  return getOrComputeCachedValue(torrent, TorrentExternalIdentifiersSymbol, () => {
    const identifiers: TorrentExternalIdentifier[] = [];

    for (const tag of torrent.tags) {
      if (tag[0] === "i" && tag[1]) {
        const parsed = parseTorrentExternalIdentifier(tag[1]);
        if (parsed) {
          identifiers.push(parsed);
        }
      }
    }

    return identifiers;
  });
}

/** Creates a TorrentExternalIdentifier and builds its full identifier string */
export function createTorrentExternalIdentifier(
  prefix: TorrentExternalIdentifierPrefix,
  id: string,
  mediaType?: string,
): TorrentExternalIdentifier {
  let identifier: string;

  // Build identifier string based on prefix and whether mediaType is provided
  if (mediaType) {
    // For prefixes that support mediaType: tmdb, ttvdb, mal
    identifier = `${prefix}:${mediaType}:${id}`;
  } else {
    // Simple format: prefix:id
    identifier = `${prefix}:${id}`;
  }

  return {
    prefix,
    identifier,
    mediaType,
    id,
  };
}

/**
 * Builds a magnet link from an info hash, optional trackers, and optional name
 * @see https://www.bittorrent.org/beps/bep_0053.html
 */
export function buildTorrentMagnetLink(infoHash: string, trackers?: string[], name?: string): string {
  const parts = [`magnet:?xt=urn:btih:${infoHash}`];

  if (trackers && trackers.length > 0) {
    for (const tracker of trackers) {
      parts.push(`&tr=${encodeURIComponent(tracker)}`);
    }
  }

  if (name) {
    parts.push(`&dn=${encodeURIComponent(name)}`);
  }

  return parts.join("");
}

/** Returns the magnet link for a torrent, building it from the event if needed */
export function getTorrentMagnetLink(torrent: NostrEvent): string | undefined {
  if (torrent.kind !== TORRENT_KIND) return undefined;

  return getOrComputeCachedValue(torrent, TorrentMagnetLinkSymbol, () => {
    const infoHash = getTorrentInfoHash(torrent);
    if (!infoHash) return undefined;

    const trackers = getTorrentTrackers(torrent);
    const title = getTorrentTitle(torrent);

    return buildTorrentMagnetLink(infoHash, trackers.length > 0 ? trackers : undefined, title);
  });
}

/** Checks if a string is a hex encoded V1 BitTorrent info hash */
export function isTorrentInfoHash(hash: string): boolean {
  return /^[0-9a-f]{40}$/i.test(hash);
}

/** Checks if an event is a valid torrent event (kind 2003 with a V1 info hash in the `x` tag) */
export function isValidTorrent(torrent: NostrEvent): torrent is TorrentEvent {
  if (torrent.kind !== TORRENT_KIND) return false;

  const infoHash = getTorrentInfoHash(torrent);
  return infoHash !== undefined && isTorrentInfoHash(infoHash);
}
