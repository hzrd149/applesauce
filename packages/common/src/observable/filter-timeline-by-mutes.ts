import { IAsyncEventStore, IEventModelMixin, IEventStore } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { combineLatest, map, MonoTypeOperatorFunction } from "rxjs";
import { matchMutes } from "../helpers/mute.js";
import { MuteModel } from "../models/mutes.js";

/** Filters a timeline of events by a users mutes */
export function filterTimelineByMutes<T extends NostrEvent>(
  eventStore: IEventModelMixin<IEventStore | IAsyncEventStore>,
  user: string | ProfilePointer,
): MonoTypeOperatorFunction<T[]> {
  return (source) =>
    combineLatest([source, eventStore.model(MuteModel, user)]).pipe(
      map(([source, mutes]) => (mutes ? source.filter((event) => matchMutes(mutes, event)) : source)),
    );
}
