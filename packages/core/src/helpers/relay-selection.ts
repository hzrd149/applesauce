import { ProfilePointer } from "nostr-tools/nip19";

export type SelectOptimalRelaysOptions = {
  /** Maximum number of connections (relays) to select */
  maxConnections: number;
  /** Cap the number of relays a user can have */
  maxRelaysPerUser?: number;
};

/** Selects the optimal relays for a list of ProfilePointers */
export function selectOptimalRelays(
  users: ProfilePointer[],
  { maxConnections, maxRelaysPerUser }: SelectOptimalRelaysOptions,
): ProfilePointer[] {
  const usersWithRelays = users.filter((user) => user.relays && user.relays.length > 0);

  // create map of popular relays
  const popular = new Map<string, number>();
  for (const user of usersWithRelays) {
    if (!user.relays) continue;
    for (const relay of user.relays) popular.set(relay, (popular.get(relay) || 0) + 1);
  }

  // sort users relays by popularity
  for (const user of usersWithRelays) {
    if (!user.relays) continue;
    user.relays = Array.from(user.relays).sort((a, b) => popular.get(b)! - popular.get(a)!);
  }

  // Create a pool of users to calculate relay coverage from
  let selectionPool = Array.from(usersWithRelays);

  // Create map of times a users relay has been selected
  const selectionCount = new Map<string, number>();

  let selection = new Set<string>();
  while (selectionPool.length > 0 && selection.size < maxConnections) {
    // Create map of number of pool users per relay
    const relayUserCount = new Map<string, number>();
    for (const user of selectionPool) {
      if (!user.relays) continue;
      for (const relay of user.relays) {
        // Skip relays that are already selected
        if (selection.has(relay)) continue;

        // Increment relay user count
        relayUserCount.set(relay, (relayUserCount.get(relay) || 0) + 1);
      }
    }

    // Sort relays by coverage
    const byCoverage = Array.from(relayUserCount.entries()).sort((a, b) => b[1] - a[1]);

    // No more relays to select, exit loop
    if (byCoverage.length === 0) break;

    // Pick the most popular relay
    const relay = byCoverage[0][0];

    // Add relay to selection
    selection.add(relay);

    // Increment user relay count and remove users over the limit
    selectionPool = selectionPool.filter((user) => {
      // Ignore users that don't have the relay
      if (!user.relays || !user.relays.includes(relay)) return true;

      // Increment user relay count
      let count = selectionCount.get(relay) || 0;
      selectionCount.set(relay, count++);

      // Remove user if they their relay has been selected more than minRelaysPerUser times
      if (count >= 1) return false;

      return true;
    });
  }

  // Take the original users and only include relays that where selected
  return users.map((user) => ({
    ...user,
    relays: maxRelaysPerUser
      ? user.relays
          ?.filter((relay) => selection.has(relay))
          .sort((a, b) => (popular.get(a) ?? 0) - (popular.get(b) ?? 0))
          .slice(0, maxRelaysPerUser)
      : user.relays?.filter((relay) => selection.has(relay)),
  }));
}

/** A map of pubkeys by relay */
export type OutboxMap = Record<string, ProfilePointer[]>;

/** RxJS operator that aggregates contacts with outboxes into a relay -> pubkeys map */
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
