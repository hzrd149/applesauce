import { persistEventsToCache, type Filter } from "applesauce-core/helpers";
import "window.nostrdb.js";
import { eventStore } from "./event-store";

export function cacheRequest(filters: Filter[]) {
  return window.nostrdb.filters(filters);
}

// Save all new events to the cache
persistEventsToCache(eventStore, async (events) => {
  await Promise.allSettled(events.map((event) => window.nostrdb.add(event)));
});
