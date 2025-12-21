import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import { getReactionEmoji } from "../helpers/emoji.js";
import { getReactionAddressPointer, getReactionEventPointer } from "../helpers/reaction.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { addRelayHintsToPointer } from "applesauce-core/helpers";

function isValidReaction(event: NostrEvent): event is KnownEvent<7> {
  return event.kind === kinds.Reaction;
}

export class Reaction extends EventCast<KnownEvent<7>> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidReaction(event)) throw new Error("Invalid reaction");
    super(event, store);
  }

  /** Get the emoji content of the reaction (defaults to "+" if empty) */
  get content() {
    return this.event.content || "+";
  }

  /** Get the custom emoji if this reaction uses a custom emoji */
  get emoji() {
    return getReactionEmoji(this.event);
  }

  /** Get the event pointer for the event being reacted to */
  get eventPointer() {
    return getReactionEventPointer(this.event);
  }

  /** Get the address pointer for the event being reacted to (for replaceable events) */
  get addressPointer() {
    return getReactionAddressPointer(this.event);
  }

  /** Get the pointer (event or address) for the event being reacted to */
  get pointer() {
    return this.addressPointer || this.eventPointer;
  }

  /** Get the event that this reaction is reacting to */
  get reactedTo$() {
    return this.$$ref("reactedTo$", (store) => {
      const pointer = this.pointer;
      if (!pointer) return of(undefined);
      else return store.event(addRelayHintsToPointer(pointer, this.seen));
    });
  }
}
