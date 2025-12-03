import { NostrEvent } from "./event.js";
import { getOrComputeCachedValue } from "./cache.js";
import { unixNow } from "./time.js";

export const ExpirationTimestampSymbol = Symbol("expiration-timestamp");

/** Returns the NIP-40 expiration timestamp for an event */
export function getExpirationTimestamp(event: NostrEvent): number | undefined {
  return getOrComputeCachedValue(event, ExpirationTimestampSymbol, () => {
    const expiration = event.tags.find((t) => t[0] === "expiration")?.[1];
    return expiration ? parseInt(expiration) : undefined;
  });
}

/** Checks if an event has expired based on the NIP-40 expiration timestamp */
export function isExpired(event: NostrEvent): boolean {
  const expiration = getExpirationTimestamp(event);
  return expiration ? unixNow() > expiration : false;
}
