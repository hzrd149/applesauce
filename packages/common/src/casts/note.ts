import {
  EventPointer,
  getEventPointerFromQTag,
  isQTag,
  kinds,
  KnownEvent,
  NostrEvent,
  processTags,
} from "applesauce-core/helpers";
import { Observable } from "rxjs";
import { getNip10References } from "../helpers/threading.js";
import { RepliesModel } from "../models/thread.js";
import { EventZapsModel } from "../models/zaps.js";
import { castEvent, castEvents } from "../observable/cast-event.js";
import { getStore } from "./common.js";
import { castProfile, castZap, createCast, InferCast, Zap } from "./index.js";

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

  /** An observable of the note author */
  get author$() {
    return getStore(this).replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEvent(castProfile));
  },

  /** An array of events that this note is quoting */
  get quotePointers(): EventPointer[] {
    return processTags(
      this.tags,
      (t) => (isQTag(t) ? t : undefined),
      (t) => getEventPointerFromQTag(t) ?? undefined,
    );
  },

  /** An observable of the replies to this note */
  get replies$(): Observable<Note[]> {
    return getStore(this).model(RepliesModel, this).pipe(castEvents(castNote));
  },
  get zaps$(): Observable<Zap[]> {
    return getStore(this).model(EventZapsModel, this).pipe(castEvents(castZap));
  },
});

export type Note = InferCast<typeof castNote>;
