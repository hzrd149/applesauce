import { kinds } from "nostr-tools";
import { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { map } from "rxjs";

import { Model } from "../event-store/interface.js";
import { KnownEvent } from "../helpers/index.js";
import { getCoordinateFromAddressPointer, isAddressPointer } from "../helpers/pointers.js";
import { isValidZap } from "../helpers/zap.js";

/** A model that gets all zap events for an event */
export function EventZapsModel(id: string | EventPointer | AddressPointer): Model<KnownEvent<kinds.Zap>[]> {
  return (events) => {
    if (isAddressPointer(id)) {
      return events
        .timeline([{ kinds: [kinds.Zap], "#a": [getCoordinateFromAddressPointer(id)] }])
        .pipe(map((events) => events.filter(isValidZap)));
    } else {
      id = typeof id === "string" ? id : id.id;
      return events.timeline([{ kinds: [kinds.Zap], "#e": [id] }]).pipe(map((events) => events.filter(isValidZap)));
    }
  };
}

/** A model that returns all zaps sent by a user */
export function SentZapsModel(pubkey: string): Model<KnownEvent<kinds.Zap>[]> {
  return (events) =>
    events.timeline([{ kinds: [kinds.Zap], authors: [pubkey] }]).pipe(map((events) => events.filter(isValidZap)));
}

/** A model that returns all zaps received by a user */
export function ReceivedZapsModel(pubkey: string): Model<KnownEvent<kinds.Zap>[]> {
  return (events) =>
    events.timeline([{ kinds: [kinds.Zap], "#p": [pubkey] }]).pipe(map((events) => events.filter(isValidZap)));
}
