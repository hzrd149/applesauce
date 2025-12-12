import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { COMMENT_KIND, getCommentReplyPointer, getCommentRootPointer, isValidComment } from "../helpers/comment.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEvent, castEvents } from "../observable/cast-event.js";
import { BaseCast, ref } from "./common.js";
import { Profile } from "./profile.js";
import { Zap } from "./zap.js";
import { CommentsModel } from "../models/comments.js";

/** Cast a kind 1111 event to a Comment */
export class Comment extends BaseCast<typeof COMMENT_KIND> {
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
    return ref(this, "author$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEvent(Profile)),
    );
  }
  get zaps$() {
    return ref(this, "zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castEvents(Zap)));
  }
  get replies$() {
    return ref(this, "replies$", (store) => store.model(CommentsModel, this.event).pipe(castEvents(Comment)));
  }
}
