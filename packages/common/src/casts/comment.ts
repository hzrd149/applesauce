import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { CommentEvent, getCommentReplyPointer, getCommentRootPointer, isValidComment } from "../helpers/comment.js";
import { CommentsModel } from "../models/comments.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEvent, castEvents } from "../observable/cast-event.js";
import { Cast } from "./cast.js";
import { Profile } from "./profile.js";
import { Zap } from "./zap.js";

/** Cast a kind 1111 event to a Comment */
export class Comment extends Cast<CommentEvent> {
  constructor(event: NostrEvent) {
    if (!isValidComment(event)) throw new Error("Invalid comment");
    super(event);
  }

  rootPointer() {
    return getCommentRootPointer(this.event);
  }
  replyPointer() {
    return getCommentReplyPointer(this.event);
  }

  get author$() {
    return this.$$ref("author$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.event.pubkey }).pipe(castEvent(Profile)),
    );
  }
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castEvents(Zap)));
  }
  get replies$() {
    return this.$$ref("replies$", (store) => store.model(CommentsModel, this.event).pipe(castEvents(Comment)));
  }
}
