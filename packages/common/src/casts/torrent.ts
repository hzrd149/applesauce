import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getTorrentCategory,
  getTorrentCategoryPath,
  getTorrentExternalIdentifiers,
  getTorrentFiles,
  getTorrentInfoHash,
  getTorrentMagnetLink,
  getTorrentSearchTags,
  getTorrentTitle,
  getTorrentTrackers,
  isValidTorrent,
  TorrentEvent,
} from "../helpers/torrent.js";
import { CommentsModel } from "../models/comments.js";
import { ReactionsModel } from "../models/reactions.js";
import { EventZapsModel } from "../models/zaps.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import { Reaction } from "./reaction.js";
import { Zap } from "./zap.js";

export class Torrent extends EventCast<TorrentEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidTorrent(event)) throw new Error("Invalid torrent");
    super(event, store);
  }

  /** The BitTorrent info hash from the `x` tag */
  get infoHash() {
    return getTorrentInfoHash(this.event)!;
  }

  /** The torrent title from the `title` tag */
  get title() {
    return getTorrentTitle(this.event);
  }

  /** All file entries from `file` tags */
  get files() {
    return getTorrentFiles(this.event);
  }

  /** All tracker URLs from `tracker` tags */
  get trackers() {
    return getTorrentTrackers(this.event);
  }

  /** The newznab category ID from the `i` tag with `newznab:` prefix */
  get category() {
    return getTorrentCategory(this.event);
  }

  /** All search tags (for searchability) from `t` tags */
  get searchTags() {
    return getTorrentSearchTags(this.event);
  }

  /** The category path from the `tcat` identifier in `i` tags (e.g., "video,movie,4k") */
  get categoryPath() {
    return getTorrentCategoryPath(this.event);
  }

  /** All external identifiers from `i` tags (excluding tcat and newznab, which are handled separately) */
  get externalIdentifiers() {
    return getTorrentExternalIdentifiers(this.event);
  }

  /** The magnet link for the torrent, built from the info hash, trackers, and title */
  get magnetLink() {
    return getTorrentMagnetLink(this.event);
  }

  /** Gets the NIP-22 comments to this event */
  get comments$() {
    return this.$$ref("comments$", (store) =>
      store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
    );
  }

  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castTimelineStream(Zap, store)));
  }

  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
}
