import { NostrEvent } from "./event.js";
import { normalizeURL } from "./url.js";

export const SeenRelaysSymbol = Symbol.for("seen-relays");

/** Marks an event as being seen on a relay */
export function addSeenRelay(event: NostrEvent, relay: string): Set<string> {
  let seen = Reflect.get(event, SeenRelaysSymbol);
  if (!seen) {
    seen = new Set([relay]);
    Reflect.set(event, SeenRelaysSymbol, seen);
    return seen;
  } else {
    seen.add(relay);
    return seen;
  }
}

/** Returns the set of relays this event was seen on */
export function getSeenRelays(event: NostrEvent): Set<string> | undefined {
  return Reflect.get(event, SeenRelaysSymbol);
}

/** Checks if an event was received from a specific relay */
export function isFromRelay(event: NostrEvent, relay: string): boolean {
  return getSeenRelays(event)?.has(relay) === true;
}

const WEBSOCKET_URL_CHECK =
  /^wss?:\/\/([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}|localhost)\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)$/;

/** A fast check to make sure relay hints are safe to connect to */
export function isSafeRelayURL(relay: string) {
  // anything smaller than 8 is not a URL
  return relay.length >= 8 && WEBSOCKET_URL_CHECK.test(relay);
}

/** Merge multiple sets of relays and remove duplicates (ignores invalid URLs) */
export function mergeRelaySets(...sources: (Iterable<string> | string | undefined)[]) {
  const set = new Set<string>();

  for (const src of sources) {
    if (!src) continue;

    if (typeof src === "string") {
      // Source is a string
      try {
        const safe = normalizeURL(src).toString();
        if (safe) set.add(safe);
      } catch (error) {
        // failed to parse URL, ignore
      }
    } else {
      // Source is iterable
      for (const url of src) {
        try {
          const safe = normalizeURL(url).toString();
          if (safe) set.add(safe);
        } catch (error) {
          // failed to parse URL, ignore
        }
      }
    }
  }

  return Array.from(set);
}

/** Alias for {@link mergeRelaySets} */
export const relaySet = mergeRelaySets;
