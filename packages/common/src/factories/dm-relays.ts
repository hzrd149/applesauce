import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51RelayListFactory } from "./list.js";

export type DmRelaysTemplate = KnownEventTemplate<kinds.DirectMessageRelaysList>;

/** A factory class for building kind 10050 direct message relays list events */
export class DmRelaysFactory extends NIP51RelayListFactory<kinds.DirectMessageRelaysList, DmRelaysTemplate> {
  /** Creates a new DM relays factory */
  static create(): DmRelaysFactory {
    return new DmRelaysFactory((res) => res(blankEventTemplate(kinds.DirectMessageRelaysList)));
  }

  /** Creates a new DM relays factory from an existing DM relays event */
  static modify(event: NostrEvent | KnownEvent<kinds.DirectMessageRelaysList>): DmRelaysFactory {
    if (!isKind(event, kinds.DirectMessageRelaysList)) throw new Error("Event is not a DM relays event");
    return new DmRelaysFactory((res) => res(toEventTemplate(event)));
  }
}
