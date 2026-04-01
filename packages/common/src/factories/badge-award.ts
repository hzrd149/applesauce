import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import type { ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  addRecipient,
  clearBadgePointer,
  clearRecipients,
  removeRecipient,
  setBadgePointer,
  setRecipients,
} from "../operations/badge-award.js";

export type BadgeAwardTemplate = KnownEventTemplate<typeof kinds.BadgeAward>;

/** Factory for badge award events (kind 8) */
export class BadgeAwardFactory extends EventFactory<typeof kinds.BadgeAward, BadgeAwardTemplate> {
  /** Creates a badge award factory */
  static create(): BadgeAwardFactory {
    return new BadgeAwardFactory((res) => res(blankEventTemplate(kinds.BadgeAward)));
  }

  /** Creates a factory configured to modify an existing award */
  static modify(event: NostrEvent): BadgeAwardFactory {
    if (event.kind !== kinds.BadgeAward) throw new Error("Expected a badge award event");
    return new BadgeAwardFactory((res) => res(toEventTemplate(event) as BadgeAwardTemplate));
  }

  /** Sets the badge definition pointer */
  badge(address: Parameters<typeof setBadgePointer>[0], relayHint?: Parameters<typeof setBadgePointer>[1]) {
    return this.chain(setBadgePointer(address, relayHint));
  }

  /** Removes the badge definition pointer */
  clearBadge() {
    return this.chain(clearBadgePointer());
  }

  /** Replaces recipients with the provided list */
  recipients(recipients: Array<string | ProfilePointer>) {
    return this.chain(setRecipients(recipients));
  }

  /** Adds a recipient */
  addRecipient(recipient: string | ProfilePointer, relayHint?: Parameters<typeof addRecipient>[1]) {
    const hint = relayHint ?? (typeof recipient === "string" ? undefined : recipient.relays?.[0]);
    return this.chain(addRecipient(recipient, hint));
  }

  /** Removes a specific recipient */
  removeRecipient(recipient: string | ProfilePointer) {
    return this.chain(removeRecipient(recipient));
  }

  /** Clears all recipients */
  clearRecipients() {
    return this.chain(clearRecipients());
  }
}
