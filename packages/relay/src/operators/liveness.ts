import { LRU } from "applesauce-core/helpers/lru";
import { normalizeURL } from "applesauce-core/helpers/url";
import { combineLatestWith, map, type MonoTypeOperatorFunction } from "rxjs";

import type { RelayLivenessSource } from "../liveness.js";

function canonicalRelay(url: string): string {
  try {
    return normalizeURL(url);
  } catch {
    return url;
  }
}

function createRelayFilter(unhealthy: string[], liveness: RelayLivenessSource) {
  // Build exclusions only when unhealthy$ emits, rather than once per pointer or mailbox.
  const excluded = new Set(unhealthy.map(canonicalRelay));
  const eligibility = new LRU<boolean>(1024);

  function filterRelays(relays: string[]): string[];
  function filterRelays(relays: string[] | undefined): string[] | undefined;
  function filterRelays(relays: string[] | undefined): string[] | undefined {
    if (!relays) return undefined;
    const result: string[] = [];
    for (const relay of relays) {
      // Keep reporting raw hints, including excluded relays and cached eligibility results.
      liveness.seen?.add(relay);
      if (excluded.size === 0) {
        result.push(relay);
        continue;
      }
      let allowed = eligibility.get(relay);
      if (allowed === undefined) {
        allowed = !excluded.has(canonicalRelay(relay));
        if (relay.length <= 4096) eligibility.set(relay, allowed);
      }
      if (allowed) result.push(relay);
    }
    return result;
  }

  return filterRelays;
}

/** Filters out unhealthy relays from an array of pointers */
export function ignoreUnhealthyRelaysOnPointers<T extends { relays?: string[] }, Tracker extends RelayLivenessSource>(
  liveness: Tracker,
): MonoTypeOperatorFunction<T[]> {
  return (source) =>
    source.pipe(
      combineLatestWith(liveness.unhealthy$.pipe(map((unhealthy) => createRelayFilter(unhealthy, liveness)))),
      map(([pointers, filterRelays]) =>
        pointers.map((pointer) => (pointer.relays ? { ...pointer, relays: filterRelays(pointer.relays) } : pointer)),
      ),
    );
}

/** Filters out unhealthy relays from the inboxes and outboxes */
export function ignoreUnhealthyMailboxes<
  T extends { inboxes?: string[]; outboxes?: string[] },
  Tracker extends RelayLivenessSource,
>(liveness: Tracker): MonoTypeOperatorFunction<T> {
  return (source) =>
    source.pipe(
      combineLatestWith(liveness.unhealthy$.pipe(map((unhealthy) => createRelayFilter(unhealthy, liveness)))),
      map(([mailboxes, filterRelays]) => {
        if (!mailboxes.inboxes && !mailboxes.outboxes) return mailboxes;
        return {
          ...mailboxes,
          inboxes: filterRelays(mailboxes.inboxes),
          outboxes: filterRelays(mailboxes.outboxes),
        };
      }),
    );
}

/** Filters out unhealthy relays from an array of relays */
export function ignoreUnhealthyRelays<Tracker extends RelayLivenessSource>(
  liveness: Tracker,
): MonoTypeOperatorFunction<string[]> {
  return (source) =>
    source.pipe(
      combineLatestWith(liveness.unhealthy$.pipe(map((unhealthy) => createRelayFilter(unhealthy, liveness)))),
      map(([relays, filterRelays]) => filterRelays(relays)),
    );
}
