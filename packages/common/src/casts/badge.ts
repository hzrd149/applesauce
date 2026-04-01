import { ChainableObservable } from "applesauce-core";
import { AddressPointer, getAddressPointerForEvent, getReplaceableAddressFromPointer } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  BadgeEvent,
  getBadgeDescription,
  getBadgeIdentifier,
  getBadgeImage,
  getBadgeName,
  getBadgeThumbnails,
} from "../helpers/badges.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { BadgeAward } from "./badge-award.js";
import { CastRefEventStore, EventCast } from "./cast.js";

function isBadge(event: NostrEvent): asserts event is BadgeEvent {
  if (event.kind !== kinds.BadgeDefinition) throw new Error("Invalid badge definition event");
}

/** Cast for badge definition events (kind 30009) */
export class Badge extends EventCast<BadgeEvent> {
  #identifier: string;

  constructor(event: NostrEvent, store: CastRefEventStore) {
    isBadge(event);
    super(event, store);
    const identifier = getBadgeIdentifier(event);
    if (!identifier) throw new Error("Invalid badge definition payload");
    this.#identifier = identifier;
  }

  get identifier() {
    return this.#identifier;
  }
  get pointer(): AddressPointer {
    return getAddressPointerForEvent(this.event)!;
  }
  get name() {
    return getBadgeName(this.event);
  }
  get description() {
    return getBadgeDescription(this.event);
  }
  get image() {
    return getBadgeImage(this.event);
  }
  get thumbnails() {
    return getBadgeThumbnails(this.event);
  }

  /** Returns a timeline of all badge awards for this badge */
  get awards$(): ChainableObservable<BadgeAward[]> {
    return this.$$ref("awards$", (store) => {
      return store
        .timeline({ kinds: [kinds.BadgeAward], "#a": [getReplaceableAddressFromPointer(this.pointer)] })
        .pipe(castTimelineStream(BadgeAward, store));
    });
  }
}
