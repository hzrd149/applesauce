import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { EventCast, CastRefEventStore } from "./cast.js";
import { getBadgeAwardDefinitionPointer, getBadgeAwardRecipients } from "../helpers/badges.js";

function assertBadgeAward(event: NostrEvent): asserts event is KnownEvent<typeof kinds.BadgeAward> {
  if (event.kind !== kinds.BadgeAward) throw new Error("Invalid badge award event");
}

/** Cast for badge award events (kind 8) */
export class BadgeAward extends EventCast<KnownEvent<typeof kinds.BadgeAward>> {
  #definition: AddressPointer;
  #recipients: string[];

  constructor(event: NostrEvent, store: CastRefEventStore) {
    assertBadgeAward(event);
    super(event, store);
    const definition = getBadgeAwardDefinitionPointer(event);
    const recipients = getBadgeAwardRecipients(event);
    if (!definition || recipients.length === 0) throw new Error("Invalid badge award payload");
    this.#definition = definition;
    this.#recipients = recipients;
  }

  get definition() {
    return this.#definition;
  }

  get recipients() {
    return this.#recipients;
  }

  get issuer() {
    return this.event.pubkey;
  }
}
