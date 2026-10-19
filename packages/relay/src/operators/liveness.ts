import { combineLatestWith, map, MonoTypeOperatorFunction } from "rxjs";

import type { RelayLivenessSource } from "../liveness.js";

// Filter relays and notify the liveness tracker that we've seen this relay
function filterRelays<Tracker extends RelayLivenessSource>(
  relays: string[],
  unhealthy: string[],
  liveness: Tracker,
): string[];
function filterRelays<Tracker extends RelayLivenessSource>(
  relays: string[] | undefined,
  unhealthy: string[],
  liveness: Tracker,
): string[] | undefined;
function filterRelays<Tracker extends RelayLivenessSource>(
  relays: string[] | undefined,
  unhealthy: string[],
  liveness: Tracker,
): string[] | undefined {
  return (
    relays &&
    relays.filter((relay) => {
      // Notify the liveness tracker that we've seen this relay
      liveness.seen?.add(relay);

      // Exclude unhealthy relays
      return !unhealthy.includes(relay);
    })
  );
}

/** Filters out unhealthy relays from an array of pointers */
export function ignoreUnhealthyRelaysOnPointers<T extends { relays?: string[] }, Tracker extends RelayLivenessSource>(
  liveness: Tracker,
): MonoTypeOperatorFunction<T[]> {
  return (source) =>
    source.pipe(
      // Combine with the liveness observable
      combineLatestWith(liveness.unhealthy$),
      // Filters out unhealthy relays from the pointers
      map(([pointers, unhealthy]) =>
        pointers.map((pointer) => {
          if (!pointer.relays) return pointer;

          // Exclude unhealthy relays
          return { ...pointer, relays: filterRelays(pointer.relays, unhealthy, liveness) };
        }),
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
      // Combine with the liveness observable
      combineLatestWith(liveness.unhealthy$),
      // Filters out unhealthy relays from the inboxes and outboxes
      map(([mailboxes, unhealthy]) => {
        if (!mailboxes.inboxes && !mailboxes.outboxes) return mailboxes;

        return {
          ...mailboxes,
          inboxes: filterRelays(mailboxes.inboxes, unhealthy, liveness),
          outboxes: filterRelays(mailboxes.outboxes, unhealthy, liveness),
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
      // Combine with the liveness observable
      combineLatestWith(liveness.unhealthy$),
      // Filters out unhealthy relays from the array
      map(([relays, unhealthy]) => filterRelays(relays, unhealthy, liveness)),
    );
}
