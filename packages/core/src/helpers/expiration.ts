import { NostrEvent, StoreEvent } from "./event.js";
import { getOrComputeCachedValue } from "./cache.js";
import { unixNow } from "./time.js";

export const ExpirationTimestampSymbol = Symbol("expiration-timestamp");

/** Returns nonnegative safe-integer Unix seconds from a decimal NIP-40 expiration tag, or undefined if missing or invalid */
export function getExpirationTimestamp<E extends StoreEvent = NostrEvent>(event: E): number | undefined {
  return getOrComputeCachedValue(event, ExpirationTimestampSymbol, () => {
    const expiration = event.tags.find((t) => t[0] === "expiration")?.[1];
    if (!expiration || /[^0-9]/.test(expiration)) return undefined;

    const timestamp = Number(expiration);
    return Number.isSafeInteger(timestamp) ? timestamp : undefined;
  });
}

/** Checks if an event has expired based on the NIP-40 expiration timestamp */
export function isExpired(event: NostrEvent): boolean {
  const expiration = getExpirationTimestamp(event);
  return expiration !== undefined ? unixNow() > expiration : false;
}
