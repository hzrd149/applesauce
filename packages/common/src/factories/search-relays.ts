import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51RelayListFactory } from "./list.js";

export type SearchRelaysTemplate = KnownEventTemplate<kinds.SearchRelaysList>;

/** A factory class for building kind 10007 search relays list events */
export class SearchRelaysFactory extends NIP51RelayListFactory<kinds.SearchRelaysList, SearchRelaysTemplate> {
  /** Creates a new search relays factory */
  static create(): SearchRelaysFactory {
    return new SearchRelaysFactory((res) => res(blankEventTemplate(kinds.SearchRelaysList)));
  }

  /** Creates a new search relays factory from an existing search relays event */
  static modify(event: NostrEvent | KnownEvent<kinds.SearchRelaysList>): SearchRelaysFactory {
    if (!isKind(event, kinds.SearchRelaysList)) throw new Error("Event is not a search relays event");
    return new SearchRelaysFactory((res) => res(toEventTemplate(event)));
  }
}
