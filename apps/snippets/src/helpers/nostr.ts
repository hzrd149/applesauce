import { ApplesauceApp, getPoolWorkerUrl } from "applesauce-threads";
// When using Vite, import the worker script directly
import WorkerPool from "applesauce-threads/worker/pool?worker";

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

// Create worker - use Vite's worker import in production, fallback to URL in dev
const worker = import.meta.env?.DEV ? new Worker(getPoolWorkerUrl(), { type: "module" }) : new WorkerPool();

// Create app instance
const app = new ApplesauceApp(worker);

// Wait for workers to be ready
await app.ready;

// @ts-expect-error
window.applesauce = app;

// Create an event store for all events
export const eventStore = app.eventStore;

// Create a relay pool to make relay connections
export const pool = app.pool;

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
