import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { includeReplaceableIdentifier } from "applesauce-core/operations/index";
import { nanoid } from "nanoid";
import { NIP51RelayListFactory } from "./list.js";

export type RelaySetTemplate = KnownEventTemplate<kinds.Relaysets>;

/** A factory class for building kind 30002 relay set events */
export class RelaySetFactory extends NIP51RelayListFactory<kinds.Relaysets, RelaySetTemplate> {
  /** Creates a new relay set factory with an auto-generated identifier */
  static create(): RelaySetFactory {
    return new RelaySetFactory((res) => res(blankEventTemplate(kinds.Relaysets))).identifier(nanoid());
  }

  /** Sets the "d" identifier tag */
  identifier(id: string) {
    return this.chain(includeReplaceableIdentifier(id));
  }

  /** Creates a new relay set factory from an existing relay set event */
  static modify(event: NostrEvent | KnownEvent<kinds.Relaysets>): RelaySetFactory {
    if (!isKind(event, kinds.Relaysets)) throw new Error("Event is not a relay set event");
    return new RelaySetFactory((res) => res(toEventTemplate(event)));
  }
}
