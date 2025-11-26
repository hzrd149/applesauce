import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

// NIP-66 Relay Discovery Kinds
export const RELAY_DISCOVERY_KIND = 30166;
export const RELAY_MONITOR_ANNOUNCEMENT_KIND = 10166;

// Type definitions
export type RelayDiscoveryEvent = KnownEvent<typeof RELAY_DISCOVERY_KIND>;
export type RelayMonitorAnnouncementEvent = KnownEvent<typeof RELAY_MONITOR_ANNOUNCEMENT_KIND>;

/**
 * Gets the relay URL from a relay discovery event (from the `d` tag)
 * This is the normalized relay URL or hex-encoded pubkey for non-URL relays
 */
export function getRelayDiscoveryURL(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Gets the round-trip time (RTT) for a specific operation type
 * @param event - The relay discovery event
 * @param type - The RTT type: 'open', 'read', or 'write'
 * @returns The RTT in milliseconds, or undefined if not found
 */
export function getRelayDiscoveryRTT(event: NostrEvent, type: "open" | "read" | "write"): number | undefined {
  const value = getTagValue(event, `rtt-${type}`);
  return value ? parseInt(value, 10) : undefined;
}

/**
 * Gets the network type from a relay discovery event (from the `n` tag)
 * Should be one of: clearnet, tor, i2p, loki
 */
export function getRelayDiscoveryNetworkType(event: NostrEvent): string | undefined {
  return getTagValue(event, "n");
}

/**
 * Gets all relay attributes from a relay discovery event (from `W` tags)
 * Attributes describe the relay type/characteristics
 */
export function getRelayDiscoveryAttributes(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "W" && t[1]).map((t) => t[1]);
}

/**
 * Gets all supported NIPs from a relay discovery event (from `N` tags)
 * Returns an array of NIP numbers as strings
 */
export function getRelayDiscoverySupportedNIPs(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "N" && t[1]).map((t) => t[1]);
}

/**
 * Gets all requirements from a relay discovery event (from `R` tags)
 * False values are prefixed with `!` (e.g., `!payment`, `!auth`)
 * Returns an array of requirement strings
 */
export function getRelayDiscoveryRequirements(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "R" && t[1]).map((t) => t[1]);
}

/**
 * Gets all topics from a relay discovery event (from `t` tags)
 */
export function getRelayDiscoveryTopics(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]);
}

/**
 * Gets all accepted and unaccepted kinds from a relay discovery event (from `k` tags)
 * Unaccepted kinds are prefixed with `!`
 * Returns an array of kind strings
 */
export function getRelayDiscoveryAcceptedKinds(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "k" && t[1]).map((t) => t[1]);
}

/**
 * Gets the geohash from a relay discovery event (from the `g` tag)
 * This is a NIP-52 geohash
 */
export function getRelayDiscoveryGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Validates that an event is a proper relay discovery event
 * Checks that the event is kind 30166 and has the required `d` tag
 */
export function isValidRelayDiscovery(event?: NostrEvent): event is RelayDiscoveryEvent {
  if (!event) return false;
  if (event.kind !== RELAY_DISCOVERY_KIND) return false;
  return !!getRelayDiscoveryURL(event);
}

/**
 * Gets the frequency at which a monitor publishes events (from the `frequency` tag)
 * Returns the frequency in seconds
 */
export function getMonitorFrequency(event: NostrEvent): number | undefined {
  const value = getTagValue(event, "frequency");
  return value ? parseInt(value, 10) : undefined;
}

/**
 * Gets all timeout values from a relay monitor announcement (from `timeout` tags)
 * Returns an array of objects with optional test type and timeout value
 * Index 1 is the timeout in milliseconds, index 2 (optional) is the test type
 */
export function getMonitorTimeouts(event: NostrEvent): Array<{ test?: string; timeout: number }> {
  return event.tags
    .filter((t) => t[0] === "timeout" && t[1])
    .map((t) => ({
      timeout: parseInt(t[1], 10),
      test: t[2] || undefined,
    }));
}

/**
 * Gets all checks conducted by a monitor (from `c` tags)
 * Examples include: open, read, write, auth, nip11, dns, geo
 */
export function getMonitorChecks(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "c" && t[1]).map((t) => t[1]);
}

/**
 * Gets the geohash from a relay monitor announcement (from the `g` tag)
 * This is a NIP-52 geohash
 */
export function getMonitorGeohash(event: NostrEvent): string | undefined {
  return getTagValue(event, "g");
}

/**
 * Validates that an event is a proper relay monitor announcement
 * Checks that the event is kind 10166
 */
export function isValidRelayMonitorAnnouncement(event?: NostrEvent): event is RelayMonitorAnnouncementEvent {
  if (!event) return false;
  return event.kind === RELAY_MONITOR_ANNOUNCEMENT_KIND;
}
