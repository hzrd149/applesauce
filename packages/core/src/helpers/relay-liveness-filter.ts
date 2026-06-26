import { ProfilePointer } from "./pointers.js";

export interface RelayLivenessFilterOptions {
  /** Max fraction of a user's relays that can be removed (0-1). Default: 0.8.
   *  If filtering would remove MORE than this fraction, skip that user. */
  maxFilterRatio?: number;
  /** Minimum alive set size to activate filtering. Default: 100.
   *  If the alive set has fewer entries, filtering is skipped entirely.
   *  Catches rogue/misconfigured monitors with tiny datasets. */
  minAliveSetSize?: number;
  /** Preserve .onion / .i2p relays that monitors can't check. Default: true */
  preserveOnion?: boolean;
  /** Full scope of monitored relays (alive + dead). If provided, only relays
   *  in monitoredRelays but NOT in aliveRelays are removed. Unmonitored relays
   *  (not in monitoredRelays) are kept. If not provided, all relays not in
   *  aliveRelays are treated as dead (aggressive bench behavior). */
  monitoredRelays?: ReadonlySet<string>;
}

export interface RelayClassification {
  alive: Set<string>;
  dead: string[];
  unmonitored: string[];
  onionPreserved: number;
  malformedPreserved: number;
}

/** Normalize a relay URL for comparison: lowercase hostname, strip trailing slash, ensure wss:// */
export function normalizeRelayUrl(url: string): string {
  try {
    const u = new URL(url);
    // Ensure wss:// scheme
    if (u.protocol === "http:" || u.protocol === "https:") u.protocol = "wss:";
    else if (u.protocol === "ws:") u.protocol = "wss:";
    // Lowercase hostname (URL constructor already does this, but be explicit)
    u.hostname = u.hostname.toLowerCase();
    let result = u.toString();
    // Strip trailing slash (only if path is just "/")
    if (u.pathname === "/") result = result.replace(/\/$/, "");
    return result;
  } catch {
    return url;
  }
}

/** Classify relay URLs against known-alive and optionally monitored sets. */
export function classifyRelays(
  candidates: Iterable<string>,
  aliveRelays: ReadonlySet<string>,
  opts?: RelayLivenessFilterOptions,
): RelayClassification {
  const preserveOnion = opts?.preserveOnion ?? true;
  const monitoredRelays = opts?.monitoredRelays;

  const alive = new Set<string>();
  const dead: string[] = [];
  const unmonitored: string[] = [];
  let onionPreserved = 0;
  let malformedPreserved = 0;

  // Empty alive set = no filtering, classify everything as alive
  if (aliveRelays.size === 0) {
    for (const url of candidates) alive.add(url);
    return { alive, dead, unmonitored, onionPreserved, malformedPreserved };
  }

  for (const url of candidates) {
    const normalized = normalizeRelayUrl(url);

    // Check if known alive
    if (aliveRelays.has(normalized) || aliveRelays.has(url)) {
      alive.add(url);
      continue;
    }

    // Preserve .onion / .i2p relays — can't validate without Tor/I2P
    if (preserveOnion) {
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        // Malformed URL — preserve to avoid silently dropping
        alive.add(url);
        malformedPreserved++;
        continue;
      }

      if (hostname.endsWith(".onion") || hostname.endsWith(".i2p")) {
        alive.add(url);
        onionPreserved++;
        continue;
      }
    }

    // If monitoredRelays provided, only remove relays that were actually monitored
    if (monitoredRelays) {
      if (monitoredRelays.has(normalized) || monitoredRelays.has(url)) {
        // Monitored but not alive = dead
        dead.push(url);
      } else {
        // Not monitored = benefit of the doubt
        unmonitored.push(url);
      }
    } else {
      // No monitoredRelays = bench behavior: not in alive = dead
      dead.push(url);
    }
  }

  return { alive, dead, unmonitored, onionPreserved, malformedPreserved };
}

/** Remove dead relays from ProfilePointer arrays with safety guardrails.
 *  Graceful degradation: empty aliveRelays = no filtering.
 *  Per-user guardrail: maxFilterRatio prevents excessive removal.
 *  Global guardrail: minAliveSetSize prevents rogue monitor data. */
export function removeDeadRelays(
  users: ProfilePointer[],
  aliveRelays: ReadonlySet<string>,
  opts?: RelayLivenessFilterOptions,
): ProfilePointer[] {
  const maxFilterRatio = opts?.maxFilterRatio ?? 0.8;
  const minAliveSetSize = opts?.minAliveSetSize ?? 100;

  // Global guardrail: empty alive set = no-op (spec requirement 1)
  if (aliveRelays.size === 0) return users;

  // Global guardrail: tiny alive set = rogue monitor, skip entirely
  if (aliveRelays.size < minAliveSetSize) return users;

  return users.map((user) => {
    if (!user.relays || user.relays.length === 0) return user;

    const classification = classifyRelays(user.relays, aliveRelays, opts);
    const kept = [...classification.alive, ...classification.unmonitored];
    const removedCount = user.relays.length - kept.length;

    // Per-user guardrail: if removing MORE than maxFilterRatio, skip this user
    if (removedCount > 0 && removedCount / user.relays.length > maxFilterRatio) {
      return user;
    }

    return { ...user, relays: kept };
  });
}
