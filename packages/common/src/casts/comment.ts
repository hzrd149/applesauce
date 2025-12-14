import { NostrEvent } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import { CommentEvent, getCommentReplyPointer, getCommentRootPointer, isValidComment } from "../helpers/comment.js";
import { CommentsModel } from "../models/comments.js";
import { EventZapsModel } from "../models/zaps.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { EventCast } from "./cast.js";
import { Zap } from "./zap.js";

/** Cast a kind 1111 event to a Comment */
export class Comment extends EventCast<CommentEvent> {
  constructor(event: NostrEvent) {
    if (!isValidComment(event)) throw new Error("Invalid comment");
    super(event);
  }

  get rootPointer() {
    return getCommentRootPointer(this.event);
  }
  get replyPointer() {
    return getCommentReplyPointer(this.event);
  }

  /** Get the event at the root of this thread */
  get root$() {
    return this.$$ref("root$", (store) => {
      const pointer = this.rootPointer;
      if (pointer.type === "event" || pointer.type === "address") return store.event(pointer);
      else return of(undefined);
    });
  }

  /** Get the event that this comment is replying to */
  get parent$() {
    return this.$$ref("parent$", (store) => {
      const pointer = this.replyPointer;

      if (!pointer) return of(undefined);
      else if (pointer.type === "event" || pointer.type === "address") return store.event(pointer);
      else return of(undefined);
    });
  }

  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castTimelineStream(Zap)));
  }
  get replies$() {
    return this.$$ref("replies$", (store) => store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment)));
  }
}
