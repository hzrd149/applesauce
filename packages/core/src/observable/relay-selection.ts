import {
  combineLatest,
  combineLatestWith,
  isObservable,
  map,
  of,
  pipe,
  startWith,
  switchMap,
  type MonoTypeOperatorFunction,
  type Observable,
  type OperatorFunction,
} from "rxjs";
import { IEventSubscriptions } from "../event-store/interface.js";
import { getInboxes, getOutboxes } from "../helpers/mailboxes.js";
import { addRelayHintsToPointer, ProfilePointer } from "../helpers/pointers.js";
import { removeDeadRelays, type RelayLivenessFilterOptions } from "../helpers/relay-liveness-filter.js";
import { removeBlacklistedRelays, selectOptimalRelays, setFallbackRelays } from "../helpers/relay-selection.js";

/** RxJS operator that fetches outboxes for profile pointers from the event store */
export function includeMailboxes(
  store: IEventSubscriptions,
  type: "inbox" | "outbox" = "outbox",
): OperatorFunction<ProfilePointer[], ProfilePointer[]> {
  // Get the outboxes for all contacts
  return switchMap((contacts) =>
    combineLatest(
      contacts.map((user) =>
        // Subscribe to the outboxes for the user
        store
          .replaceable({
            kind: 10002,
            pubkey: user.pubkey,
          })
          .pipe(
            // Add the relays to the user
            map((event) => {
              if (!event) return user;

              // Get the relays from the event
              const relays = type === "outbox" ? getOutboxes(event) : getInboxes(event);
              if (!relays) return user;

              // Add the relays to the user
              return addRelayHintsToPointer(user, relays);
            }),
          ),
      ),
    ),
  );
}

/** Removes blacklisted relays from the user's relays */
export function ignoreBlacklistedRelays(
  blacklist: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the blacklist changes
    combineLatestWith(isObservable(blacklist) ? blacklist : of(blacklist)),
    // Filter the relays for the user
    map(([users, blacklist]) => removeBlacklistedRelays(users, blacklist)),
  );
}

/** Removes dead relays using NIP-66 monitor data with safety guardrails.
 *  Empty alive set = no-op (spec requirement 1). Observable inputs are
 *  wrapped with startWith(emptySet) so relay selection is never blocked. */
export function ignoreDeadRelays(
  aliveRelays: ReadonlySet<string> | Observable<ReadonlySet<string>>,
  opts?: RelayLivenessFilterOptions,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  const emptySet = new Set<string>() as ReadonlySet<string>;
  return pipe(
    combineLatestWith(
      isObservable(aliveRelays) ? aliveRelays.pipe(startWith(emptySet)) : of(aliveRelays),
    ),
    map(([users, alive]) => removeDeadRelays(users, alive, opts)),
  );
}

/** Sets fallback relays for any user that has 0 relays */
export function includeFallbackRelays(
  fallbacks: string[] | Observable<string[]>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Get the fallbacks from the observable
    combineLatestWith(isObservable(fallbacks) ? fallbacks : of(fallbacks)),
    // Set the fallback relays for the users
    map(([users, fallbacks]) => setFallbackRelays(users, fallbacks)),
  );
}

/** A operator calls {@link selectOptimalRelays} and filters the relays for the user */
export function filterOptimalRelays(
  maxConnections: number | Observable<number>,
  maxRelaysPerUser: number | Observable<number>,
): MonoTypeOperatorFunction<ProfilePointer[]> {
  return pipe(
    // Combine with the observable so it re-emits when the max connections and max relays per user change
    combineLatestWith(
      isObservable(maxConnections) ? maxConnections : of(maxConnections),
      isObservable(maxRelaysPerUser) ? maxRelaysPerUser : of(maxRelaysPerUser),
    ),
    // Filter the relays for the user
    map(([users, maxConnections, maxRelaysPerUser]) =>
      selectOptimalRelays(users, { maxConnections, maxRelaysPerUser }),
    ),
  );
}
