import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51RelayListFactory } from "./list.js";

export type BlockedRelaysTemplate = KnownEventTemplate<kinds.BlockedRelaysList>;

/** A factory class for building kind 10006 blocked relays list events */
export class BlockedRelaysFactory extends NIP51RelayListFactory<kinds.BlockedRelaysList, BlockedRelaysTemplate> {
  /** Creates a new blocked relays factory */
  static create(): BlockedRelaysFactory {
    return new BlockedRelaysFactory((res) => res(blankEventTemplate(kinds.BlockedRelaysList)));
  }

  /** Creates a new blocked relays factory from an existing blocked relays event */
  static modify(event: NostrEvent | KnownEvent<kinds.BlockedRelaysList>): BlockedRelaysFactory {
    if (!isKind(event, kinds.BlockedRelaysList)) throw new Error("Event is not a blocked relays event");
    return new BlockedRelaysFactory((res) => res(toEventTemplate(event)));
  }
}
