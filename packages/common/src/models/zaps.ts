import { Model } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers";
import { kinds, KnownEvent } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";
import { AddressPointer, EventPointer } from "applesauce-core/helpers/pointers";
import { map } from "rxjs";
import { isValidZap } from "../helpers/zap.js";

/** A model that gets all zap events for an event */
export function EventZapsModel(
  pointer: string | EventPointer | AddressPointer | NostrEvent,
): Model<KnownEvent<kinds.Zap>[]> {
  return (events) =>
    events
      .timeline(buildCommonEventRelationFilters({ kinds: [kinds.Zap] }, pointer))
      .pipe(map((events) => events.filter(isValidZap)));
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
