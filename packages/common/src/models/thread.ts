import { EventModels, Model } from "applesauce-core/event-store";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers";
import { getEventUID, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import {
  AddressPointer,
  eventMatchesPointer,
  EventPointer,
  getReplaceableAddressFromPointer,
  isAddressPointer,
} from "applesauce-core/helpers/pointers";
import { type Observable } from "rxjs";
import { map } from "rxjs/operators";
import { COMMENT_KIND, getCommentReplyPointer } from "../helpers/comment.js";
import { getNip10References, ThreadReferences } from "../helpers/threading.js";

export type Thread = {
  root?: ThreadItem;
  all: Map<string, ThreadItem>;
};
export type ThreadItem = {
  /** underlying nostr event */
  event: NostrEvent;
  refs: ThreadReferences;
  /** the thread root, according to this event */
  root?: ThreadItem;
  /** the parent event this is replying to */
  parent?: ThreadItem;
  /** direct child replies */
  replies: Set<ThreadItem>;
};

export type ThreadModelOptions = {
  kinds?: number[];
};

const defaultOptions = {
  kinds: [kinds.ShortTextNote],
};

/** A model that returns a NIP-10 thread of events */
export function ThreadModel(root: string | AddressPointer | EventPointer, opts?: ThreadModelOptions): Model<Thread> {
  const parentReferences = new Map<string, Set<ThreadItem>>();
  const items = new Map<string, ThreadItem>();

  const { kinds } = { ...defaultOptions, ...opts };

  let rootUID = "";
  const rootFilter: Filter = {};
  const replyFilter: Filter = { kinds };

  if (isAddressPointer(root)) {
    rootUID = getReplaceableAddressFromPointer(root);
    rootFilter.kinds = [root.kind];
    rootFilter.authors = [root.pubkey];
    rootFilter["#d"] = [root.identifier];

    replyFilter["#a"] = [rootUID];
  } else if (typeof root === "string") {
    rootUID = root;
    rootFilter.ids = [root];
    replyFilter["#e"] = [root];
  } else {
    rootUID = root.id;
    rootFilter.ids = [root.id];
    replyFilter["#e"] = [root.id];
  }

  return (events) =>
    events.filters([rootFilter, replyFilter]).pipe(
      map((event) => {
        if (!items.has(getEventUID(event))) {
          const refs = getNip10References(event);

          const replies = parentReferences.get(getEventUID(event)) || new Set<ThreadItem>();
          const item: ThreadItem = { event, refs, replies };

          for (const child of replies) {
            child.parent = item;
          }

          // add item to parent
          if (refs.reply?.e || refs.reply?.a) {
            let uid = refs.reply.e ? refs.reply.e.id : getReplaceableAddressFromPointer(refs.reply.a);

            item.parent = items.get(uid);
            if (item.parent) {
              item.parent.replies.add(item);
            } else {
              // parent isn't created yet, store ref for later
              let set = parentReferences.get(uid);
              if (!set) {
                set = new Set();
                parentReferences.set(uid, set);
              }

              set.add(item);
            }
          }

          // add item to map
          items.set(getEventUID(event), item);
        }

        return { root: items.get(rootUID), all: items };
      }),
    );
}

/** A model that gets all legacy and NIP-10, and NIP-22 replies for an event */
export function RepliesModel(event: NostrEvent, overrideKinds?: number[]): Model<NostrEvent[]> {
  return (events) => {
    const filter: Filter = { kinds: overrideKinds || event.kind === 1 ? [1, COMMENT_KIND] : [COMMENT_KIND] };

    return events.timeline(buildCommonEventRelationFilters(filter, event)).pipe(
      map((events) =>
        // Filter for direct replies
        events.filter((reply) => {
          if (reply.kind === kinds.ShortTextNote) {
            // Check if a NIP-10 reply is a direct reply to this event
            const refs = getNip10References(reply);
            const pointer = refs.reply?.a || refs.reply?.e;
            if (!pointer) return false;
            return eventMatchesPointer(event, pointer);
          } else if (reply.kind === COMMENT_KIND) {
            // Check if a NIP-22 reply is a direct reply to this event
            const pointer = getCommentReplyPointer(reply);
            if (!pointer) return false;

            if (pointer.type === "address") return eventMatchesPointer(event, pointer);
            else if (pointer.type === "event") return pointer.id === event.id;
          }
          return false;
        }),
      ),
    );
  };
}

// Register this model with EventModels
EventModels.prototype.thread = function (root: string | EventPointer | AddressPointer) {
  return this.model(ThreadModel, root);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to a thread */
    thread(root: string | EventPointer | AddressPointer): Observable<Thread>;
  }
}
