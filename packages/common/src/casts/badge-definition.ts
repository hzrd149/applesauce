import { kinds, NostrEvent, KnownEvent } from "applesauce-core/helpers/event";
import { EventCast, CastRefEventStore } from "./cast.js";
import {
  getBadgeDescription,
  getBadgeIdentifier,
  getBadgeImage,
  getBadgeName,
  getBadgeThumbnails,
} from "../helpers/badges.js";

function assertBadgeDefinition(event: NostrEvent): asserts event is KnownEvent<typeof kinds.BadgeDefinition> {
  if (event.kind !== kinds.BadgeDefinition) throw new Error("Invalid badge definition event");
}

/** Cast for badge definition events (kind 30009) */
export class BadgeDefinition extends EventCast<KnownEvent<typeof kinds.BadgeDefinition>> {
  #identifier: string;

  constructor(event: NostrEvent, store: CastRefEventStore) {
    assertBadgeDefinition(event);
    super(event, store);
    const identifier = getBadgeIdentifier(event);
    if (!identifier) throw new Error("Invalid badge definition payload");
    this.#identifier = identifier;
  }

  get identifier() {
    return this.#identifier;
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
}
