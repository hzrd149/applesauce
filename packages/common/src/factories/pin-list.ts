import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, isReplaceable, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51ItemListFactory } from "./list.js";

export type PinListTemplate = KnownEventTemplate<kinds.Pinlist>;

/** A factory class for building kind 10001 pin list events */
export class PinListFactory extends NIP51ItemListFactory<kinds.Pinlist, PinListTemplate> {
  /** Creates a new pin list factory */
  static create(): PinListFactory {
    return new PinListFactory((res) => res(blankEventTemplate(kinds.Pinlist)));
  }

  /** Creates a new pin list factory from an existing pin list event */
  static modify(event: NostrEvent | KnownEvent<kinds.Pinlist>): PinListFactory {
    if (!isKind(event, kinds.Pinlist)) throw new Error("Event is not a pin list event");
    return new PinListFactory((res) => res(toEventTemplate(event)));
  }

  /** Pins an event — uses an "a" tag for replaceable events, "e" tag for others */
  pinEvent(event: NostrEvent, hidden = false) {
    return isReplaceable(event.kind) ? this.addAddressItem(event, hidden) : this.addEventItem(event, hidden);
  }

  /** Unpins an event — uses an "a" tag for replaceable events, "e" tag for others */
  unpinEvent(event: NostrEvent, hidden = false) {
    return isReplaceable(event.kind) ? this.removeAddressItem(event, hidden) : this.removeEventItem(event.id, hidden);
  }
}
