import { logger } from "applesauce-core";
import { ProfilePointer } from "nostr-tools/nip19";

interface RelayScore {
  relay: string;
  userCount: number;
  users: Set<string>;
}

const log = logger.extend("outbox-selection");

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

export function selectOptimalRelays(
  users: ProfilePointer[],
  { maxConnections, maxRelayCoverage, maxRelaysPerUser, minRelaysPerUser }: SelectOptimalRelaysOptions,
): ProfilePointer[] {
  // Validation: Ensure minRelaysPerUser doesn't exceed maxRelaysPerUser
  if (minRelaysPerUser && maxRelaysPerUser && minRelaysPerUser > maxRelaysPerUser) {
    log(
      `Warning: minRelaysPerUser (${minRelaysPerUser}) is greater than maxRelaysPerUser (${maxRelaysPerUser}). Using maxRelaysPerUser as the minimum.`,
    );
    minRelaysPerUser = maxRelaysPerUser;
  }

  // Step 1: Limit relays per user first (if specified) to avoid overloading the selection algorithm
  let processedUsers = users;

  if (maxRelaysPerUser) {
    processedUsers = users.map((user) => {
      if (!user.relays || user.relays.length <= maxRelaysPerUser) {
        return user;
      }

      // For users with too many relays, take the first ones (preserving custom sort order)
      const selectedRelays = user.relays.slice(0, maxRelaysPerUser);

      // Optional: Add logging to verify the selection is working
      if (user.relays.length > maxRelaysPerUser)
        log(
          `User ${user.pubkey.slice(0, 8)}... had ${user.relays.length} relays, limited to ${maxRelaysPerUser} preserving original order`,
        );

      return {
        pubkey: user.pubkey,
        relays: selectedRelays,
      };
    });
  }

  // Step 2: Count how many users use each relay
  const relayUserMap = new Map<string, Set<string>>();

  processedUsers.forEach((user) => {
    user.relays?.forEach((relay) => {
      if (!relayUserMap.has(relay)) {
        relayUserMap.set(relay, new Set());
      }
      relayUserMap.get(relay)!.add(user.pubkey);
    });
  });

  // Step 3: Create relay scores and filter out relays that exceed coverage limit
  const totalUsers = processedUsers.length;
  const maxUsersPerRelay = Math.ceil((maxRelayCoverage / 100) * totalUsers);

  const relayScores: RelayScore[] = Array.from(relayUserMap.entries())
    .map(([relay, userSet]) => ({
      relay,
      userCount: userSet.size,
      users: userSet,
    }))
    .filter((score) => score.userCount <= maxUsersPerRelay)
    .sort((a, b) => b.userCount - a.userCount); // Sort by user count descending

  // Step 4: Greedy selection algorithm
  const selectedRelays: string[] = [];
  const coveredUsers = new Set<string>();

  // First pass: Select relays that cover the most uncovered users
  while (selectedRelays.length < maxConnections && selectedRelays.length < relayScores.length) {
    let bestRelay: RelayScore | null = null;
    let bestNewUserCount = 0;

    for (const relayScore of relayScores) {
      if (selectedRelays.includes(relayScore.relay)) continue;

      // Count how many new users this relay would cover
      const newUsers = Array.from(relayScore.users).filter((user) => !coveredUsers.has(user));

      if (newUsers.length > bestNewUserCount) {
        bestNewUserCount = newUsers.length;
        bestRelay = relayScore;
      }
    }

    if (!bestRelay || bestNewUserCount === 0) break;

    selectedRelays.push(bestRelay.relay);
    bestRelay.users.forEach((user) => coveredUsers.add(user));
  }

  // Step 5: Check coverage and try to cover remaining users
  const uncoveredUsers = processedUsers.filter((user) => !coveredUsers.has(user.pubkey));

  if (uncoveredUsers.length > 0 && selectedRelays.length < maxConnections) {
    console.warn(
      `${uncoveredUsers.length} users may not be fully covered with max coverage limit of ${maxRelayCoverage}% per relay (max ${maxUsersPerRelay} users per relay)`,
    );

    // For remaining connections, try to cover uncovered users even if above coverage limit
    const remainingRelayScores = Array.from(relayUserMap.entries())
      .map(([relay, userSet]) => ({
        relay,
        userCount: userSet.size,
        users: userSet,
      }))
      .filter((score) => !selectedRelays.includes(score.relay))
      .sort((a, b) => b.userCount - a.userCount);

    for (const relayScore of remainingRelayScores) {
      if (selectedRelays.length >= maxConnections) break;

      const newUsers = Array.from(relayScore.users).filter((user) => !coveredUsers.has(user));
      if (newUsers.length > 0) {
        selectedRelays.push(relayScore.relay);
        relayScore.users.forEach((user) => coveredUsers.add(user));
      }
    }
  }

  // Step 6: Create new user array with filtered relays
  const selectedRelaySet = new Set(selectedRelays);

  let finalUsers = processedUsers.map((user) => ({
    pubkey: user.pubkey,
    relays: user.relays?.filter((relay) => selectedRelaySet.has(relay)),
  }));

  // Step 7: Ensure minimum relays per user (if specified)
  if (minRelaysPerUser) {
    finalUsers = finalUsers.map((user) => {
      if (!user.relays || user.relays.length >= minRelaysPerUser) {
        return user;
      }

      // User has fewer relays than minimum, try to add more from selected relays
      const currentRelays = new Set(user.relays);
      const additionalRelays: string[] = [];

      // Find relays from the selected set that this user could potentially use
      // We'll look at the original user data to see what relays they had available
      const originalUser = processedUsers.find((u) => u.pubkey === user.pubkey);
      if (originalUser?.relays) {
        for (const relay of originalUser.relays) {
          if (!currentRelays.has(relay) && selectedRelaySet.has(relay)) {
            additionalRelays.push(relay);
            if (user.relays.length + additionalRelays.length >= minRelaysPerUser) {
              break;
            }
          }
        }
      }

      // If we still don't have enough relays, add any remaining selected relays
      if (user.relays.length + additionalRelays.length < minRelaysPerUser) {
        for (const relay of selectedRelays) {
          if (!currentRelays.has(relay) && !additionalRelays.includes(relay)) {
            additionalRelays.push(relay);
            if (user.relays.length + additionalRelays.length >= minRelaysPerUser) {
              break;
            }
          }
        }
      }

      const finalRelays = [...user.relays, ...additionalRelays];

      // Log when we've added relays to meet minimum requirement
      if (additionalRelays.length > 0) {
        log(
          `User ${user.pubkey.slice(0, 8)}... had ${user.relays.length} relays, added ${additionalRelays.length} to meet minimum of ${minRelaysPerUser}`,
        );
      }

      return {
        pubkey: user.pubkey,
        relays: finalRelays,
      };
    });
  }

  return finalUsers;
}
