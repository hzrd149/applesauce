import { withImmediateValueOrDefault } from "applesauce-core";
import { User } from "applesauce-core/casts";
import { NostrEvent } from "applesauce-core/helpers/event";
import { combineLatest, map } from "rxjs";
import {
  compareProfileBadgeEvents,
  getProfileBadgeSlots,
  isValidProfileBadges,
  LEGACY_PROFILE_BADGES_IDENTIFIER,
  LEGACY_PROFILE_BADGES_KIND,
  PROFILE_BADGES_KIND,
  ProfileBadgeSlot,
} from "../helpers/profile-badges.js";
import { castEventStream } from "../observable/cast-stream.js";
import { ChainableObservable } from "../observable/chainable.js";
import { BadgeAward } from "./badge-award.js";
import { Badge } from "./badge.js";
import { CastRefEventStore, EventCast } from "./cast.js";

type ProfileBadgesSlot = {
  badge: Badge | undefined;
  award: BadgeAward | undefined;
};

export class ProfileBadges extends EventCast {
  #slots: ProfileBadgeSlot[];

  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidProfileBadges(event)) throw new Error("Invalid profile badges event");
    super(event, store);
    this.#slots = getProfileBadgeSlots(event);
  }

  /** Returns the array of all slot pointers */
  get slots(): ProfileBadgeSlot[] {
    return this.#slots;
  }

  /** returns number of slots */
  get count() {
    return this.#slots.length;
  }

  /** Gets and array of all badges in all slots */
  get badges$(): ChainableObservable<ProfileBadgesSlot[]> {
    return this.$$ref("badges$", () => {
      return combineLatest(
        // For each slot, fetch badge event
        this.#slots.map((_slot, index) => this.slot$(index)),
      );
    });
  }

  /** Gets the badge and award at a given slot index */
  slot$(index = 0): ChainableObservable<ProfileBadgesSlot> {
    return this.$$ref(`slot:${index}`, (store) => {
      const badge$ = store
        .event(this.#slots[index].badge)
        .pipe(castEventStream(Badge, store), withImmediateValueOrDefault(undefined));
      const award$ = store
        .event(this.#slots[index].award)
        .pipe(castEventStream(BadgeAward, store), withImmediateValueOrDefault(undefined));

      return combineLatest([badge$, award$]).pipe(map(([badge, award]) => ({ badge, award })));
    });
  }
}

Object.defineProperty(User.prototype, "profileBadges$", {
  get(this: User) {
    return this.$$ref("profileBadges$", (store) =>
      combineLatest([
        store.replaceable({ kind: PROFILE_BADGES_KIND, pubkey: this.pubkey }),
        store.replaceable({
          kind: LEGACY_PROFILE_BADGES_KIND,
          pubkey: this.pubkey,
          identifier: LEGACY_PROFILE_BADGES_IDENTIFIER,
        }),
      ]).pipe(
        map(([modern, legacy]) => compareProfileBadgeEvents(modern, legacy)),
        castEventStream(ProfileBadges, store),
      ),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    get profileBadges$(): ChainableObservable<ProfileBadges | undefined>;
  }
}
