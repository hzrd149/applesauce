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
import { ChainableObservable } from "../observable/chainable.js";
import { ref } from "./common.js";
import { castProfile, castZap, createCast, InferCast, Profile } from "./index.js";

function isValidNote(event: NostrEvent): event is KnownEvent<1> {
  return event.kind === kinds.ShortTextNote;
}

export const castNote = createCast(isValidNote, {
  get references() {
    return getNip10References(this);
  },
  get isReply() {
    return !!this.references.reply?.e || !!this.references.reply?.a;
  },
  get isRoot() {
    return !this.references.reply && !this.references.root;
  },

  /** An array of events that this note is quoting */
  get quotePointers(): EventPointer[] {
    return processTags(
      this.tags,
      (t) => (isQTag(t) ? t : undefined),
      (t) => getEventPointerFromQTag(t) ?? undefined,
    );
  },

  get author$(): ChainableObservable<Profile> {
    return ref(this, "author$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEvent(castProfile)),
    );
  },
  get replies$() {
    return ref(this, "replies$", (store) =>
      store.model(RepliesModel, this, [kinds.ShortTextNote]).pipe(castEvents(castNote)),
    );
  },
  get comments$() {
    return ref(this, "comments$", (store) => store.model(CommentsModel, this));
  },
  get zaps$() {
    return ref(this, "zaps$", (store) => store.model(EventZapsModel, this).pipe(castEvents(castZap)));
  },
});

export type Note = InferCast<typeof castNote>;
