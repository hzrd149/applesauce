import { EventStore } from "applesauce-core";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// NIP-C0 Code Snippet Kind
export const CODE_SNIPPET_KIND = 1337;

// NIP-22 Comment Kind
export const COMMENT_KIND = 1111;

// Default relays for the application
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://nostr.land",
  "wss://relay.snort.social",
  "wss://relay.nostr.band",
];

// Lookup relays for profile resolution
export const LOOKUP_RELAYS = ["wss://purplepag.es", "wss://index.hzrd149.com"];

// Create an event store for all events
export const eventStore = new EventStore();

// Create a relay pool to make relay connections
export const pool = new RelayPool();

// Create an address loader to load user profiles
export const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: LOOKUP_RELAYS,
});

// Add loaders to event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

/**
 * Utility function to check if a string is a valid nevent
 * @param str - String to check
 * @returns boolean
 */
export function isNevent(str: string): boolean {
  return str.startsWith("nevent1");
}

/**
 * Utility function to check if a string is a valid hex event ID
 * @param str - String to check
 * @returns boolean
 */
export function isHexEventId(str: string): boolean {
  return /^[a-f0-9]{64}$/.test(str);
}

/**
 * Utility function to check if a hash represents a valid event identifier
 * @param hash - Hash string to check
 * @returns boolean
 */
export function isValidEventId(hash: string): boolean {
  return isNevent(hash) || isHexEventId(hash);
}
