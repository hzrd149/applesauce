import { NostrEvent } from "applesauce-core/helpers/event";
import { ForumThreadEvent, getForumThreadTitle, isValidForumThread } from "../helpers/forum-thread.js";
import { CommentsModel } from "../models/comments.js";
import { ReactionsModel } from "../models/reactions.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Comment } from "./comment.js";
import { Reaction } from "./reaction.js";

/** Cast a kind 11 event to a NIP-7D forum thread */
export class ForumThread extends EventCast<ForumThreadEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidForumThread(event)) throw new Error("Invalid forum thread");
    super(event, store);
  }

  /** The thread title, if it has one */
  get title() {
    return getForumThreadTitle(this.event);
  }

  /** The thread body */
  get content() {
    return this.event.content;
  }

  /** The NIP-22 kind 1111 comments replying to this thread */
  get replies$() {
    return this.$$ref("replies$", (store) =>
      store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
    );
  }

  /** The reactions to this thread */
  get reactions$() {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
}
