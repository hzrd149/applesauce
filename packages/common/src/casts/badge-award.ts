import { ChainableObservable } from "applesauce-core";
import { castUser, User } from "applesauce-core/casts/user";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import {
  BadgeAwardEvent,
  getBadgeAwardPointer,
  getBadgeAwardRecipients,
  isValidBadgeAward,
} from "../helpers/badge-award.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { Badge } from "./badge.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for badge award events (kind 8) */
export class BadgeAward extends EventCast<BadgeAwardEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidBadgeAward(event)) throw new Error("Invalid badge award event");
    super(event, store);
  }

  /** Returns the address pointer to the badge definition */
  get pointer(): AddressPointer {
    return getBadgeAwardPointer(this.event);
  }

  /** Returns the array of users who received the badge */
  get recipients(): User[] {
    return getBadgeAwardRecipients(this.event).map((pointer) => castUser(pointer, this.store));
  }

  /** Returns the User who issued the badge */
  get issuer(): User {
    return this.author;
  }

  /** Returns the badge definition */
  get badge$(): ChainableObservable<Badge | undefined> {
    return this.$$ref("badge$", (store) => store.event(this.pointer).pipe(castEventStream(Badge, store)));
  }
}

Object.defineProperty(User.prototype, "badgeAwards$", {
  get(this: User) {
    return this.$$ref("badges$", (store) =>
      store
        .timeline({ kinds: [kinds.BadgeAward], "#p": [this.pubkey] })
        .pipe(castTimelineStream(BadgeAward, this.store)),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    get badgeAwards$(): ChainableObservable<BadgeAward[]>;
  }
}
