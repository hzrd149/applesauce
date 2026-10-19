import { LRU } from "./lru.js";
import { setCachedValue } from "./cache.js";
import type { NostrEvent, StoreEvent } from "./event.js";
import { ensureWebSocketURL, normalizeURL } from "./url.js";

export const SeenRelaysSymbol = Symbol.for("seen-relays");

const relayURLs = new LRU<string>(1024);

/**
 * Normalizes a relay URL by using {@link normalizeURL} and {@link ensureWebSocketURL}
 * @throws if the input is not a single WebSocket URL
 */
export function normalizeRelayUrl(input: string): string {
  const cached = relayURLs.get(input);
  if (cached !== undefined) return cached;
  const trimmed = input.trim();
  // URL parsing percent-encodes or strips inner whitespace, which would merge joined lists into one URL
  if (/[\s\x00-\x1f\x7f]/.test(trimmed)) throw new Error("Relay URL contains whitespace");

  const url = normalizeURL(ensureWebSocketURL(trimmed));
  // ensureWebSocketURL cannot change non-special schemes like javascript: or nostr:
  // normalizeURL has already validated the absolute URL, including the required WebSocket hostname.
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) throw new Error("Not a WebSocket URL");

  if (input.length <= 4096) relayURLs.set(input, url);
  return url;
}

/** Marks an event as being seen on a relay */
export function addSeenRelay<E extends StoreEvent = NostrEvent>(event: E, relay: string): Set<string> {
  let seen = Reflect.get(event, SeenRelaysSymbol) as Set<string> | undefined;
  if (!seen) {
    seen = new Set([relay]);
    // SeenRelaysSymbol is propagated across duplicate events via the element-wise seen-relays
    // merge in EventStore.copySymbolsToDuplicateEvent (a separate branch from that function's
    // symbol merge list), not via object spread — accumulated state (see cache.ts taxonomy).
    setCachedValue(event, SeenRelaysSymbol, seen);
    return seen;
  } else {
    seen.add(relay);
    return seen;
  }
}

/** Returns the set of relays this event was seen on */
export function getSeenRelays<E extends StoreEvent = NostrEvent>(event: E): Set<string> | undefined {
  return Reflect.get(event, SeenRelaysSymbol) as Set<string> | undefined;
}

/** Checks if an event was received from a specific relay */
export function isFromRelay<E extends StoreEvent = NostrEvent>(event: E, relay: string): boolean {
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
  const attempted = new Set<string>();
  const add = (url: string) => {
    if (set.has(url) || attempted.has(url)) return;
    attempted.add(url);
    try {
      set.add(normalizeRelayUrl(url));
    } catch {
      // Ignore invalid URLs, including repeated invalid inputs.
    }
  };

  for (const src of sources) {
    if (!src) continue;

    if (typeof src === "string") add(src);
    else if (Reflect.has(src, Symbol.iterator)) for (const url of src) add(url);
  }

  return Array.from(set);
}

/** Alias for {@link mergeRelaySets} */
export const relaySet = mergeRelaySets;
