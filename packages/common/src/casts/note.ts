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
import { SharesModel } from "../models/shares.js";
import { RepliesModel } from "../models/thread.js";
import { EventZapsModel } from "../models/zaps.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import { Share } from "./share.js";
import { Zap } from "./zap.js";

function isValidNote(event: NostrEvent): event is KnownEvent<1> {
  return event.kind === kinds.ShortTextNote;
}

export class Note extends EventCast<KnownEvent<1>> {
  constructor(event: NostrEvent) {
    if (!isValidNote(event)) throw new Error("Invalid note");
    super(event);
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

  get replies$() {
    return this.$$ref("replies$", (store) =>
      store.model(RepliesModel, this.event, [kinds.ShortTextNote]).pipe(castTimelineStream(Note)),
    );
  }
  get comments$() {
    return this.$$ref("comments$", (store) => store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment)));
  }
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castTimelineStream(Zap)));
  }
  get shares$() {
    return this.$$ref("shares$", (store) => store.model(SharesModel, this.event).pipe(castTimelineStream(Share)));
  }
}
