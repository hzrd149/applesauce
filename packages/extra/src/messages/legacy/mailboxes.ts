import type { EventStore } from "applesauce-core";
import { castUser } from "applesauce-common/casts";
import { kinds, mergeRelaySets, type Filter } from "applesauce-core/helpers";
import { mapEventsToStore } from "applesauce-core/observable";
import { createSyncLoader, type FilterMap } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  type Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
} from "rxjs";
import { withMessageAuth$ } from "../common/authentication.js";
import { configured$, withFallback$ } from "../common/helpers.js";
import type { LegacyMessageHistoryOptions, LegacyMessagesSyncStatus } from "./types.js";

/** One direction of NIP-04 messages and the relays it is read from */
export type LegacyMailbox = { name: "incoming" | "outgoing"; filter: Filter; relays$: Observable<string[]> };

/** The relay and authentication dependencies used to read mailboxes */
export type LegacyMailboxDependencies = {
  eventStore: EventStore;
  pool: RelayPool;
  authOptions: Parameters<typeof withMessageAuth$>[0];
  fallbackRelays?: string[] | Observable<string[]>;
  timeout: number;
};

/** Selects the advertised relays from several sources, or the fallback relays when none are advertised */
function mailboxRelays$(
  sources: Observable<string[] | undefined>[],
  fallbackRelays?: string[] | Observable<string[]>,
): Observable<string[]> {
  const fallback$ = configured$(fallbackRelays, []).pipe(catchError(() => of([])));

  return combineLatest([...sources.map((source) => source.pipe(startWith(undefined))), fallback$]).pipe(
    map((lists) => {
      const advertised = mergeRelaySets(...lists.slice(0, -1));
      return mergeRelaySets(advertised.length ? advertised : lists[lists.length - 1]).sort();
    }),
    distinctUntilChanged((previous, next) => previous.join() === next.join()),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}

/** Creates the account-wide mailboxes read from the owner's own relays */
export function createInboxMailboxes(
  pubkey: string,
  eventStore: EventStore,
  fallbackRelays?: string[] | Observable<string[]>,
): LegacyMailbox[] {
  const owner = castUser(pubkey, eventStore);

  return [
    {
      name: "incoming",
      filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [pubkey] },
      relays$: mailboxRelays$([owner.inboxes$, owner.directMessageRelays$], fallbackRelays),
    },
    {
      name: "outgoing",
      filter: { kinds: [kinds.EncryptedDirectMessage], authors: [pubkey] },
      relays$: mailboxRelays$([owner.outboxes$], fallbackRelays),
    },
  ];
}

/** Creates the mailboxes of one conversation, read from both participants' relays */
export function createConversationMailboxes(
  pubkey: string,
  correspondent: string,
  eventStore: EventStore,
  fallbackRelays?: string[] | Observable<string[]>,
): LegacyMailbox[] {
  const owner = castUser(pubkey, eventStore);
  const peer = castUser(correspondent, eventStore);

  return [
    {
      name: "incoming",
      filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [pubkey], authors: [correspondent] },
      relays$: mailboxRelays$([owner.inboxes$, owner.directMessageRelays$, peer.outboxes$], fallbackRelays),
    },
    {
      name: "outgoing",
      filter: { kinds: [kinds.EncryptedDirectMessage], authors: [pubkey], "#p": [correspondent] },
      relays$: mailboxRelays$([owner.outboxes$, peer.inboxes$, peer.directMessageRelays$], fallbackRelays),
    },
  ];
}

/** Combines the relays of several mailboxes into one sorted set */
export function combineMailboxRelays$(mailboxes: LegacyMailbox[]): Observable<string[]> {
  return combineLatest(mailboxes.map((mailbox) => mailbox.relays$)).pipe(
    map((lists) => mergeRelaySets(...lists)),
    distinctUntilChanged((previous, next) => previous.join() === next.join()),
  );
}

/** Maps each mailbox relay to the filters it serves, for timeline loaders */
export function mailboxRelayMap$(mailboxes: LegacyMailbox[]): Observable<FilterMap> {
  return combineLatest(mailboxes.map((mailbox) => mailbox.relays$)).pipe(
    map((lists): FilterMap => {
      const routes: Record<string, Filter[]> = {};
      lists.forEach((relays, index) => {
        for (const relay of relays) (routes[relay] ??= []).push(mailboxes[index].filter);
      });

      return routes;
    }),
  );
}

/** Subscribes to new mailbox events on its current relays and adds them to the store */
export function watchMailbox$(
  mailbox: LegacyMailbox,
  since: number,
  dependencies: LegacyMailboxDependencies,
  onError: (error: unknown, relays: string[]) => void,
): Observable<unknown> {
  const { eventStore, pool, authOptions } = dependencies;

  return mailbox.relays$.pipe(
    switchMap((relays) => {
      if (!relays.length) return EMPTY;

      const subscription$ = withMessageAuth$(authOptions, (auth) =>
        pool.subscription(relays, { ...mailbox.filter, since }, { eventStore, reconnect: true, ...auth }),
      );

      return subscription$.pipe(
        mapEventsToStore(eventStore),
        catchError((error) => {
          onError(error, relays);
          return EMPTY;
        }),
      );
    }),
  );
}

/** Returns the history range filter for each mailbox */
export function historyFilters(
  mailboxes: LegacyMailbox[],
  options: Omit<LegacyMessageHistoryOptions, "correspondent">,
) {
  return mailboxes.map((mailbox) => ({
    ...mailbox.filter,
    since: Math.max(0, options.since ?? 0),
    ...(options.until !== undefined ? { until: options.until } : {}),
  }));
}

/** Reconciles a history range for each mailbox and combines their progress */
export function syncMailboxes$(
  mailboxes: LegacyMailbox[],
  filters: Filter[],
  followRelays: boolean | undefined,
  dependencies: LegacyMailboxDependencies,
): Observable<LegacyMessagesSyncStatus> {
  const { eventStore, pool, authOptions, timeout } = dependencies;
  const sync = createSyncLoader({ pool, eventStore });

  // A finite sync uses the first non-empty relay set instead of following relay changes.
  const syncRelays$ = (relays$: Observable<string[]>) => {
    if (followRelays ?? true) return relays$;

    const advertised$ = relays$.pipe(filter((relays) => relays.length > 0));
    return withFallback$(advertised$, [], timeout).pipe(take(1));
  };

  const reconciliation$ = combineLatest(
    mailboxes.map((mailbox, index) =>
      withMessageAuth$(
        authOptions,
        (auth) => sync({ filter: filters[index], relays: syncRelays$(mailbox.relays$), ...auth }).status$,
      ),
    ),
  );

  return reconciliation$.pipe(
    map((statuses) => ({
      mailboxes: statuses,
      done: statuses.every((status) => status.done),
      loaded: statuses.reduce((sum, status) => sum + status.loaded, 0),
    })),
  );
}
