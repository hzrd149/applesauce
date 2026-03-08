import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51RelayListFactory } from "./list.js";

export type RelaySetTemplate = KnownEventTemplate<kinds.Relaysets>;

/** A factory class for building kind 30002 relay set events */
export class RelaySetFactory extends NIP51RelayListFactory<kinds.Relaysets, RelaySetTemplate> {
  /** Creates a new relay set factory */
  static create(): RelaySetFactory {
    return new RelaySetFactory((res) => res(blankEventTemplate(kinds.Relaysets)));
  }

  /** Creates a new relay set factory from an existing relay set event */
  static modify(event: NostrEvent | KnownEvent<kinds.Relaysets>): RelaySetFactory {
    if (!isKind(event, kinds.Relaysets)) throw new Error("Event is not a relay set event");
    return new RelaySetFactory((res) => res(toEventTemplate(event)));
  }
}
