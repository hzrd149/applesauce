import { castUser } from "applesauce-common/casts";
import { mergeRelaySets, type Filter } from "applesauce-core/helpers";
import { createSyncLoader } from "applesauce-loaders/loaders";
import {
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  fromEvent,
  isObservable,
  lastValueFrom,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  tap,
  timeout,
} from "rxjs";
import { configured$, settle } from "../common/helpers.js";
import { withMessageAuth$ } from "../common/authentication.js";
import type { LegacyMessageHistoryOptions, LegacyMessagesClientOptions, LegacyMessagesSyncStatus } from "./types.js";

/** A directional legacy mailbox with reactive delivery relays */
export interface LegacyMailbox {
  /** The incoming or outgoing event filter */
  filter: Filter;
  /** The relays holding this direction's messages */
  relays$: Observable<string[]>;
}

/** Creates incoming and outgoing mailbox routes, optionally restricted to a correspondent */
export function createLegacyMailboxes(options: LegacyMessagesClientOptions, correspondent?: string): LegacyMailbox[] {
  const owner = castUser(options.pubkey, options.eventStore);
  const peer = correspondent ? castUser(correspondent, options.eventStore) : undefined;
  const fallback$ = configured$(options.fallbackRelays, []).pipe(catchError(() => of([])));
  const targets$ = (...sources: Observable<string[] | undefined>[]) =>
    combineLatest([...sources.map((source) => source.pipe(startWith(undefined))), fallback$]).pipe(
      map((lists) => {
        const advertised = mergeRelaySets(...lists.slice(0, -1));
        return mergeRelaySets(advertised.length ? advertised : lists[lists.length - 1]).sort();
      }),
      distinctUntilChanged((previous, next) => previous.join() === next.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  return [
    {
      filter: { kinds: [4], "#p": [options.pubkey], ...(correspondent ? { authors: [correspondent] } : {}) },
      relays$: targets$(owner.inboxes$, owner.directMessageRelays$, ...(peer ? [peer.outboxes$] : [])),
    },
    {
      filter: { kinds: [4], authors: [options.pubkey], ...(correspondent ? { "#p": [correspondent] } : {}) },
      relays$: targets$(owner.outboxes$, ...(peer ? [peer.inboxes$, peer.directMessageRelays$] : [])),
    },
  ];
}

/** Restores only the encrypted events matching the requested mailbox filters */
export async function hydrateLegacyMessages(
  options: LegacyMessagesClientOptions,
  filters: Filter[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!options.cacheRequest) return;
  await lastValueFrom(
    defer(() => {
      const result = options.cacheRequest!(filters);
      return isObservable(result) ? result : Promise.resolve(result);
    }).pipe(
      timeout({ each: options.timeout ?? 4000 }),
      tap((value) => {
        signal.throwIfAborted();
        for (const event of Array.isArray(value) ? value : [value]) options.eventStore.add(event);
      }),
      takeUntil(fromEvent(signal, "abort")),
    ),
    { defaultValue: undefined },
  );
  signal.throwIfAborted();
}

/** Reconciles a finite range using the same scoped filters for cache and relay requests */
export function syncLegacyMessages$(
  options: LegacyMessagesClientOptions,
  mailboxes: LegacyMailbox[],
  history: LegacyMessageHistoryOptions,
  signal: AbortSignal,
  onCacheError: (error: unknown) => void,
): Observable<LegacyMessagesSyncStatus> {
  return defer(() => {
    signal.throwIfAborted();
    const filters = mailboxes.map((mailbox) => ({
      ...mailbox.filter,
      since: Math.max(0, history.since ?? 0),
      ...(history.until !== undefined ? { until: history.until } : {}),
    }));
    const sync = createSyncLoader({ pool: options.pool, eventStore: options.eventStore });
    return defer(async () => {
      try {
        await hydrateLegacyMessages(options, filters, signal);
      } catch (error) {
        signal.throwIfAborted();
        onCacheError(error);
      }
      const relays = await Promise.all(
        mailboxes.map((mailbox) =>
          settle(mailbox.relays$.pipe(filter((relays) => relays.length > 0)), [], options.timeout ?? 4000),
        ),
      );
      signal.throwIfAborted();
      return relays;
    }).pipe(
      switchMap((relays) =>
        combineLatest(
          filters.map((filter, index) =>
            withMessageAuth$(
              options,
              (auth) =>
                sync({
                  filter,
                  relays: relays[index],
                  ...auth,
                }).status$,
            ),
          ),
        ),
      ),
      map((mailboxes) => ({
        mailboxes,
        done: mailboxes.every((mailbox) => mailbox.done),
        loaded: mailboxes.reduce((sum, mailbox) => sum + mailbox.loaded, 0),
      })),
      takeUntil(fromEvent(signal, "abort")),
    );
  });
}
