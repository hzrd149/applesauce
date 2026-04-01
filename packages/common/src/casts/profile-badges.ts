import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { CastRefEventStore, EventCast } from "./cast.js";
import {
  LEGACY_PROFILE_BADGES_IDENTIFIER,
  PROFILE_BADGES_KIND,
  ProfileBadgeSlot,
  getProfileBadgeSlots,
} from "../helpers/badges.js";
import { ChainableObservable } from "../observable/chainable.js";
import { castEventStream } from "../observable/cast-stream.js";
import { BadgeDefinition } from "./badge-definition.js";
import { BadgeAward } from "./badge-award.js";

function assertProfileBadges(event: NostrEvent): asserts event is NostrEvent {
  const isNew = event.kind === PROFILE_BADGES_KIND;
  const isLegacy =
    event.kind === kinds.ProfileBadges &&
    event.tags.some((tag) => tag[0] === "d" && tag[1] === LEGACY_PROFILE_BADGES_IDENTIFIER);
  if (!isNew && !isLegacy) throw new Error("Invalid profile badges event");
}

export class ProfileBadges extends EventCast {
  #slots: ProfileBadgeSlot[];

  constructor(event: NostrEvent, store: CastRefEventStore) {
    assertProfileBadges(event);
    super(event, store);
    this.#slots = getProfileBadgeSlots(event);
  }

  get slots(): ProfileBadgeSlot[] {
    return this.#slots;
  }

  get count() {
    return this.#slots.length;
  }

  definition$(slot: ProfileBadgeSlot): ChainableObservable<BadgeDefinition | undefined> {
    const key = `definition:${slot.definition.kind}:${slot.definition.pubkey}:${slot.definition.identifier ?? ""}`;
    return this.$$ref(key, (store) => store.event(slot.definition).pipe(castEventStream(BadgeDefinition, store)));
  }

  award$(slot: ProfileBadgeSlot): ChainableObservable<BadgeAward | undefined> {
    const key = `award:${slot.award.id}`;
    return this.$$ref(key, (store) => store.event(slot.award).pipe(castEventStream(BadgeAward, store)));
  }
}
