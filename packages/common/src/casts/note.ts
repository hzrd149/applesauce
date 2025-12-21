import {
  EventPointer,
  getEventPointerFromQTag,
  isQTag,
  kinds,
  KnownEvent,
  NostrEvent,
  processTags,
} from "applesauce-core/helpers";
import { getNip10References } from "../helpers/threading.js";
import { CommentsModel } from "../models/comments.js";
import { ReactionsModel } from "../models/reactions.js";
import { SharesModel } from "../models/shares.js";
import { RepliesModel } from "../models/thread.js";
import { EventZapsModel } from "../models/zaps.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import { Reaction } from "./reaction.js";
import { Share } from "./share.js";
import { Zap } from "./zap.js";
import { of } from "rxjs";

function isValidNote(event: NostrEvent): event is KnownEvent<1> {
  return event.kind === kinds.ShortTextNote;
}

export class Note extends EventCast<KnownEvent<1>> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidNote(event)) throw new Error("Invalid note");
    super(event, store);
  }
  get references() {
    return getNip10References(this.event);
  }
  get isReply() {
    return !!this.references.reply?.e || !!this.references.reply?.a;
  }
  get isRoot() {
    return !this.references.reply && !this.references.root;
  }

  /** An array of events that this note is quoting */
  get quotePointers(): EventPointer[] {
    return processTags(
      this.event.tags,
      (t) => (isQTag(t) ? t : undefined),
      (t) => getEventPointerFromQTag(t) ?? undefined,
    );
  }

  /** Gets the NIP-10 root event */
  get threadRoot$() {
    return this.$$ref("threadRoot$", (store) => {
      const pointer = this.references.root;
      // Return undefined if no root reference
      if (pointer === undefined) return of(undefined);

      // Get the event by either the address or event pointer
      return store.event(pointer.a ?? pointer.e);
    });
  }
  /** Gets the NIP-10 reply event */
  get replyingTo$() {
    return this.$$ref("replyingTo$", (store) => {
      const pointer = this.references.reply;
      // Return undefined if no reply reference
      if (pointer === undefined) return of(undefined);

      // Get the event by either the address or event pointer
      return store.event(pointer.a ?? pointer.e);
    });
  }

  /** Gets the NIP-10 replies to this event */
  get replies$() {
    return this.$$ref("replies$", (store) =>
      store.model(RepliesModel, this.event, [kinds.ShortTextNote]).pipe(castTimelineStream(Note, store)),
    );
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
  get shares$() {
    return this.$$ref("shares$", (store) =>
      store.model(SharesModel, this.event).pipe(castTimelineStream(Share, store)),
    );
  }
  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
}
