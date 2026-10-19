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

  // Number of pool users for each relay that is not selected yet, kept up to date as users leave the pool
  const coverage = new Map<string, number>();
  // The pool users for each relay in pool order, and the position of each relay's first appearance in the pool
  const relayUsers = new Map<string, number[]>();
  const order = new Map<string, number>();
  let poolSize = usersWithRelays.length;
  const inPool = usersWithRelays.map(() => true);
  // Orders are encoded as user index * stride + relay position, so they compare as (user, position)
  const stride = usersWithRelays.reduce((max, user) => Math.max(max, user.relays!.length), 0);

  usersWithRelays.forEach((user, index) => {
    user.relays!.forEach((relay, position) => {
      coverage.set(relay, (coverage.get(relay) || 0) + 1);
      if (!order.has(relay)) order.set(relay, index * stride + position);

      const list = relayUsers.get(relay);
      if (!list) relayUsers.set(relay, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    });
  });

  // Recomputes where a relay first appears among the users left in the pool, used to break ties
  const updateOrder = (relay: string) => {
    for (const index of relayUsers.get(relay)!) {
      if (!inPool[index]) continue;
      order.set(relay, index * stride + usersWithRelays[index].relays!.indexOf(relay));
      return;
    }
  };

  // Number of times one of a users relays has been selected
  const selectionCount = new Map<string, number>();

  const selection = new Set<string>();
  while (poolSize > 0 && selection.size < maxConnections) {
    // No relays to select, exit loop
    if (coverage.size === 0) break;

    // Pick the relay with the best score, ties go to the relay that appears first in the pool
    let relay = "";
    let best = -Infinity;
    for (const [candidate, count] of coverage) {
      const value = score ? score(candidate, count / poolSize, popular.get(candidate) ?? 0) : count / poolSize;
      if (value > best || (value === best && order.get(candidate)! < order.get(relay)!)) {
        best = value;
        relay = candidate;
      }
    }

    // Add relay to selection
    selection.add(relay);
    coverage.delete(relay);

    // Increment user relay count and remove users over the limit
    if (maxRelaysPerUser) {
      for (const index of relayUsers.get(relay)!) {
        if (!inPool[index]) continue;
        const user = usersWithRelays[index];

        // Remove the user if their relay has been selected more than maxRelaysPerUser times
        const count = (selectionCount.get(user.pubkey) || 0) + 1;
        selectionCount.set(user.pubkey, count);
        if (count < maxRelaysPerUser) continue;

        inPool[index] = false;
        poolSize--;
        for (const other of user.relays!) {
          if (selection.has(other)) continue;
          const left = coverage.get(other)! - 1;
          if (left === 0) coverage.delete(other);
          else {
            coverage.set(other, left);
            if (Math.floor(order.get(other)! / stride) === index) updateOrder(other);
          }
        }
      }
    }
  }

  // Take the original users and only include relays that where selected
  const selected = Array.from(selection);
  return users.map((user) => {
    if (!user.relays) return { ...user };

    // Keep relays in selection order so the cap keeps the relays that were selected for this user first
    const relays = selected.filter((relay) => user.relays!.includes(relay));
    return { ...user, relays: maxRelaysPerUser ? relays.slice(0, maxRelaysPerUser) : relays };
  });
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
