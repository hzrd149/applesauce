import { NostrEvent } from "./event.js";
import { ensureWebSocketURL, normalizeURL } from "./url.js";

export const SeenRelaysSymbol = Symbol.for("seen-relays");

/** Normalizes a relay URL by using {@link normalizeURL} and {@link ensureWebSocketURL} */
export function normalizeRelayUrl(input: string): string {
  return normalizeURL(ensureWebSocketURL(input));
}

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
export function isSafeRelayURL(relay: string): boolean {
  // anything smaller than 8 is not a URL
  return relay.length >= 8 && WEBSOCKET_URL_CHECK.test(relay);
}

/** Merge multiple sets of relays and remove duplicates (ignores invalid URLs) */
export function mergeRelaySets(...sources: (Iterable<string> | string | undefined | null)[]): string[] {
  const set = new Set<string>();

  for (const src of sources) {
    if (!src) continue;

    if (typeof src === "string") {
      try {
        set.add(normalizeRelayUrl(src));
      } catch (error) {
        // failed to parse URL, ignore
      }
    } else if (Reflect.has(src, Symbol.iterator)) {
      for (const url of src) {
        try {
          set.add(normalizeRelayUrl(url));
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
