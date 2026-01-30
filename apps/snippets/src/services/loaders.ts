import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { DEFAULT_RELAYS, LOOKUP_RELAYS } from "../helpers/nostr";
import { cacheRequest } from "./cache";
import { eventStore } from "./event-store";
import { pool } from "./pool";

// Create and export event loader for the event store
export const eventLoader = createEventLoaderForStore(eventStore, pool, {
  extraRelays: DEFAULT_RELAYS,
  lookupRelays: LOOKUP_RELAYS,
  cacheRequest,
});

if (import.meta.env.DEV) {
  // @ts-ignore
  window.eventLoader = eventLoader;
}
