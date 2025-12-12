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
import { RepliesModel } from "../models/thread.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEvent, castEvents } from "../observable/cast-event.js";
import { Cast } from "./cast.js";
import { Comment } from "./comment.js";
import { Profile } from "./profile.js";
import { Zap } from "./zap.js";

function isValidNote(event: NostrEvent): event is KnownEvent<1> {
  return event.kind === kinds.ShortTextNote;
}

export class Note extends Cast<KnownEvent<1>> {
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

  get author$() {
    return this.$$ref("author$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.event.pubkey }).pipe(castEvent(Profile)),
    );
  }
  get replies$() {
    return this.$$ref("replies$", (store) =>
      store.model(RepliesModel, this.event, [kinds.ShortTextNote]).pipe(castEvents(Note)),
    );
  }
  get comments$() {
    return this.$$ref("comments$", (store) => store.model(CommentsModel, this.event).pipe(castEvents(Comment)));
  }
  get zaps$() {
    return this.$$ref("zaps$", (store) => store.model(EventZapsModel, this.event).pipe(castEvents(Zap)));
  }
}
