import type { EventStore } from "applesauce-core";
import { getEventUID, type Filter, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { combineLatest, defer, map, materialize, of, scan, startWith, tap } from "rxjs";

type RelayState = { status: "loading" | "live" | "closed"; seen: Set<string>; error?: string };

/** Loads a revision-aware timeline scoped to the selected relays */
export function relayTimeline(store: EventStore, pool: RelayPool, relays: string[], filters: Filter | Filter[]) {
  const requests = [...new Set(relays)].map((url) =>
    defer(() => {
      const initial: RelayState = { status: "loading", seen: new Set() };
      return pool
        .relay(url)
        .subscription(filters)
        .pipe(
          tap((message) => {
            if (message !== "EOSE") store.add(message);
          }),
          materialize(),
          scan((state: RelayState, notification): RelayState => {
            if (notification.kind === "E")
              return { ...state, status: "closed", error: String(notification.error?.message ?? notification.error) };
            if (notification.kind === "C") return { ...state, status: "closed" };
            if (notification.value === "EOSE") return { ...state, status: "live" };
            return { ...state, seen: new Set([...state.seen, getEventUID(notification.value)]) };
          }, initial),
          startWith(initial),
        );
    }),
  );
  return combineLatest([
    requests.length ? combineLatest(requests) : of([] as RelayState[]),
    store.timeline(filters),
  ]).pipe(
    map(([states, timeline]) => {
      const seen = new Set(states.flatMap((state) => [...state.seen]));
      return {
        events: timeline.filter((event: NostrEvent) => seen.has(getEventUID(event))),
        status: states.some((state) => state.status === "loading")
          ? ("loading" as const)
          : states.some((state) => state.status === "live")
            ? ("live" as const)
            : ("closed" as const),
        errors: states.flatMap((state) => (state.error ? [state.error] : [])),
      };
    }),
  );
}
