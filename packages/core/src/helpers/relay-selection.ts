import { ProfilePointer } from "./pointers.js";
import { Filter } from "./filter.js";

export type SelectOptimalRelaysOptions = {
  /** Maximum number of connections (relays) to select */
  maxConnections: number;
  /** Cap the number of relays a user can have */
  maxRelaysPerUser?: number;
  /** Custom priority function for calculating relay scores.*/
  score?: (relay: string, coverage: number, popularity: number) => number;
};

/** Selects the optimal relays for a list of ProfilePointers */
export function selectOptimalRelays(
  users: ProfilePointer[],
  { maxConnections, maxRelaysPerUser, score }: SelectOptimalRelaysOptions,
): ProfilePointer[] {
  const usersWithRelays = users.filter((user) => user.relays && user.relays.length > 0);

  // create map of popular relays
  const popular = new Map<string, number>();
  for (const user of usersWithRelays) {
    if (!user.relays) continue;
    for (const relay of user.relays) popular.set(relay, (popular.get(relay) || 0) + 1);
  }

  // Create a pool of users to calculate relay coverage from
  let selectionPool = Array.from(usersWithRelays);

  // Number of times one of a users relays has been selected
  const selectionCount = new Map<string, number>();

  let selection = new Set<string>();
  while (selectionPool.length > 0 && selection.size < maxConnections) {
    // Create map of number of pool users per relay (relay, count)
    const relayCoverage = new Map<string, number>();
    for (const user of selectionPool) {
      if (!user.relays) continue;
      for (const relay of user.relays) {
        // Skip relays that are already selected
        if (selection.has(relay)) continue;

        // Increment relay user count
        relayCoverage.set(relay, (relayCoverage.get(relay) || 0) + 1);
      }
    }

    // No relays to select, exit loop
    if (relayCoverage.size === 0) break;

    // Sort relays by score
    const sorted = Array.from(relayCoverage.keys()).sort((a, b) => {
      const aCoverageScore = (relayCoverage.get(a) ?? 0) / selectionPool.length;
      const bCoverageScore = (relayCoverage.get(b) ?? 0) / selectionPool.length;

      const aScore = score ? score(a, aCoverageScore, popular.get(a) ?? 0) : aCoverageScore;
      const bScore = score ? score(b, bCoverageScore, popular.get(b) ?? 0) : bCoverageScore;

      return bScore - aScore;
    });

    // Pick the best relay
    const relay = sorted[0];

    // Add relay to selection
    selection.add(relay);

    // Increment user relay count and remove users over the limit
    if (maxRelaysPerUser) {
      selectionPool = selectionPool.filter((user) => {
        // Ignore users that don't have the relay
        if (!user.relays || !user.relays.includes(relay)) return true;

        // Increment user relay count
        let count = selectionCount.get(user.pubkey) || 0;
        selectionCount.set(user.pubkey, count++);

        // Remove the user if their relay has been selected more than maxRelaysPerUser times
        if (count >= maxRelaysPerUser) return false;

        return true;
      });
    }
  }

  // Take the original users and only include relays that where selected
  return users.map((user) => ({
    ...user,
    // TODO: this will have more than maxRelaysPerUser relays
    // but its not a big deal as long as we are taking the maxRelaysPerUser into account above
    relays: user.relays?.filter((relay) => selection.has(relay)),
  }));
}

/** Sets relays for any user that has 0 relays */
export function setFallbackRelays(users: ProfilePointer[], fallbacks: string[]): ProfilePointer[] {
  return users.map((user) => {
    if (!user.relays || user.relays.length === 0) return { ...user, relays: fallbacks };
    else return user;
  });
}

/** Removes blacklisted relays from the user's relays */
export function removeBlacklistedRelays(users: ProfilePointer[], blacklist: string[]): ProfilePointer[] {
  return users.map((user) => {
    if (!user.relays || user.relays.length === 0) return user;
    else return { ...user, relays: user.relays.filter((relay) => !blacklist.includes(relay)) };
  });
}

/** A map of pubkeys by relay */
export type OutboxMap = Record<string, ProfilePointer[]>;

/** A map of filters by relay */
export type FilterMap = Record<string, Filter | Filter[]>;

/** Creates an {@link OutboxMap} for an array of profile points (groups users by relay) */
export function groupPubkeysByRelay(pointers: ProfilePointer[]): OutboxMap {
  const outbox: OutboxMap = {};

  for (const pointer of pointers) {
    if (!pointer.relays) continue;

    for (const relay of pointer.relays) {
      if (!outbox[relay]) outbox[relay] = [];

      outbox[relay]!.push(pointer);
    }
  }

  return outbox;
}

/** Alias for {@link groupPubkeysByRelay} */
export const createOutboxMap = groupPubkeysByRelay;

/** Creates a {@link FilterMap} for an {@link OutboxMap} */
export function createFilterMap(outboxMap: OutboxMap, filter: Omit<Filter, "authors">): FilterMap {
  return Object.fromEntries(
    Array.from(Object.entries(outboxMap)).map(([relay, users]) => [
      relay,
      { authors: users.map((user) => user.pubkey), ...filter },
    ]),
  );
}
