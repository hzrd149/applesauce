import { ProfilePointer } from "nostr-tools/nip19";
import { logger } from "../logger.js";

const log = logger.extend("relay-selection");

export type SelectOptimalRelaysOptions = {
  /** Maximum number of connections (relays) to select */
  maxConnections: number;
  /** Maximum coverage percentage a single relay can have (0-100) */
  maxRelayCoverage: number;
  /** Maximum number of relays per user */
  maxRelaysPerUser?: number;
  /** Minimum number of relays per user (ensure coverage) */
  minRelaysPerUser?: number;
};

/** Selects the optimal relays for a list of ProfilePointers */
export function selectOptimalRelays(
  users: ProfilePointer[],
  { maxConnections, maxRelayCoverage, maxRelaysPerUser, minRelaysPerUser }: SelectOptimalRelaysOptions,
): ProfilePointer[] {
  if (!users.length) return [];

  // Initialize result array and tracking structures
  const result: ProfilePointer[] = [];
  const selectedRelays = new Set<string>();
  const relayUserCounts = new Map<string, number>();
  const totalUsers = users.length;
  const maxUsersPerRelay = Math.ceil((totalUsers * maxRelayCoverage) / 100);

  // Process each user to select optimal relays
  for (const user of users) {
    const userRelays: string[] = [];
    const availableRelays = user.relays || [];

    // If user has no relays, add them with empty relays
    if (availableRelays.length === 0) {
      result.push({ ...user, relays: [] });
      continue;
    }

    // Try to select relays for this user, respecting priority order
    let attempts = 0;
    const maxAttempts = availableRelays.length * 2; // Prevent infinite loops

    while (
      userRelays.length < (maxRelaysPerUser || availableRelays.length) &&
      selectedRelays.size < maxConnections &&
      attempts < maxAttempts
    ) {
      attempts++;
      let foundRelay = false;

      // Try each relay in priority order (first = highest priority)
      for (const relay of availableRelays) {
        // Skip if we already selected this relay for this user
        if (userRelays.includes(relay)) continue;

        // Check if this relay would exceed coverage limit
        const currentRelayUsers = relayUserCounts.get(relay) || 0;
        if (currentRelayUsers >= maxUsersPerRelay) continue;

        // Select this relay
        userRelays.push(relay);
        selectedRelays.add(relay);
        relayUserCounts.set(relay, currentRelayUsers + 1);
        foundRelay = true;

        // Stop if we've reached maxRelaysPerUser for this user
        if (maxRelaysPerUser && userRelays.length >= maxRelaysPerUser) break;

        // Stop if we've reached maxConnections globally
        if (selectedRelays.size >= maxConnections) break;
      }

      // If we couldn't find any more suitable relays, break
      if (!foundRelay) break;
    }

    // Ensure minimum relays per user if specified
    if (minRelaysPerUser && userRelays.length < minRelaysPerUser) {
      // Try to add more relays even if they exceed coverage limits
      let minAttempts = 0;
      const maxMinAttempts = availableRelays.length;

      while (userRelays.length < minRelaysPerUser && minAttempts < maxMinAttempts) {
        minAttempts++;

        for (const relay of availableRelays) {
          if (userRelays.includes(relay)) continue;
          if (selectedRelays.size >= maxConnections) break;

          userRelays.push(relay);
          selectedRelays.add(relay);
          relayUserCounts.set(relay, (relayUserCounts.get(relay) || 0) + 1);

          if (userRelays.length >= minRelaysPerUser) break;
        }

        if (selectedRelays.size >= maxConnections) break;
      }
    }

    // Add user with selected relays (maintaining original relay order)
    const finalRelays = availableRelays.filter((relay) => userRelays.includes(relay));
    result.push({ ...user, relays: finalRelays });
  }

  log(`Selected ${selectedRelays.size} relays for ${result.length} users`);
  log(`Relay distribution:`, Array.from(relayUserCounts.entries()));

  return result;
}

/** Sorts each ProfilePointer's relays by popularity */
export function sortRelaysByPopularity(users: ProfilePointer[]): ProfilePointer[] {
  const relayUsageCount = new Map<string, number>();

  // Count the times the relays are used
  for (const user of users) {
    if (!user.relays) continue;

    for (const relay of user.relays) {
      relayUsageCount.set(relay, (relayUsageCount.get(relay) || 0) + 1);
    }
  }

  return users.map((user) => {
    if (!user.relays) return user;

    // Sort the user's relays by popularity
    return {
      ...user,
      relays: user.relays.sort((a, b) => {
        const countA = relayUsageCount.get(a) || 0;
        const countB = relayUsageCount.get(b) || 0;
        return countB - countA;
      }),
    };
  });
}

/** A map of pubkeys by relay */
export type OutboxMap = Record<string, string[]>;

/** RxJS operator that aggregates contacts with outboxes into a relay -> pubkeys map */
export function groupPubkeysByRelay(pointers: ProfilePointer[]): OutboxMap {
  const outbox: OutboxMap = {};

  for (const pointer of pointers) {
    if (!pointer.relays) continue;

    for (const relay of pointer.relays) {
      if (!outbox[relay]) outbox[relay] = [];

      if (!outbox[relay]!.includes(pointer.pubkey)) {
        outbox[relay]!.push(pointer.pubkey);
      }
    }
  }

  return outbox;
}
