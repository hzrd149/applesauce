import { logger as baseLogger } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { addSeenRelay, relaySet } from "applesauce-core/helpers/relays";
import { mapEventsToStore } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import {
  asapScheduler,
  catchError,
  concat,
  defer,
  EMPTY,
  expand,
  from,
  identity,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  ReplaySubject,
  share,
  Subject,
  Subscription,
  subscribeOn,
  switchMap,
  take,
  timeout as rxTimeout,
  toArray,
} from "rxjs";
import { TimelessFilter } from "../types.js";

/** The method a relay was loaded with */
export type SyncRelayMethod = "negentropy" | "request";

/** The lifecycle state of a single relay during a sync load */
export type SyncRelayState = "pending" | "checking" | "loading" | "complete" | "error";

/** The status of a single relay during a sync load */
export type SyncRelayStatus = {
  relay: string;
  state: SyncRelayState;
  /** Whether the relay supports NIP-77 negentropy sync (undefined until checked) */
  negentropy?: boolean;
  /** The method used to load events from the relay (undefined until loading starts) */
  method?: SyncRelayMethod;
  /** The number of events received from this relay */
  count: number;
  /** The error that occurred while loading from this relay */
  error?: Error;
};

/** A full snapshot of a sync loader's status, emitted on every status change */
export type SyncLoaderStatus = {
  /** Per-relay status keyed by relay url */
  relays: Record<string, SyncRelayStatus>;
  /** The number of unique events loaded so far across all relays (after store deduplication) */
  loaded: number;
  /** Whether every relay has finished (completed or errored) */
  done: boolean;
};

/** The pair of observables returned when a sync loader is called */
export type SyncLoaderResult = {
  /** A full status snapshot emitted on every status change. Completes when the load is done */
  status$: Observable<SyncLoaderStatus>;
  /** The deduplicated events streamed from all relays. Completes when the load is done */
  events$: Observable<NostrEvent>;
};

/** A method that makes a one-shot REQ to a single relay and completes on EOSE */
export type SyncRequestMethod = (relay: string, filters: Filter[]) => Observable<NostrEvent>;

/** A method that returns the list of NIPs a single relay supports (used to detect NIP-77) */
export type SyncSupportedMethod = (relay: string) => Promise<number[] | null> | Observable<number[] | null>;

/** A method that runs a NIP-77 negentropy sync against a single relay, receiving missing events, and completes
 * when the sync is done */
export type SyncSyncMethod = (relay: string, filter: Filter) => Observable<NostrEvent>;

/** The minimal relay interface the sync loader needs (structurally satisfied by applesauce-relay's `Relay`) */
export interface SyncLoaderRelay {
  request(filters: Filter | Filter[]): Observable<NostrEvent>;
  getSupported(): Promise<number[] | null>;
  sync(store: unknown, filter: Filter): Observable<NostrEvent>;
}

/** The minimal pool interface the sync loader needs (structurally satisfied by applesauce-relay's `RelayPool`) */
export interface SyncLoaderPool {
  relay(url: string): SyncLoaderRelay;
}

type EventStoreInput = Parameters<typeof mapEventsToStore>[0];

/** The per-relay functional methods the sync loader uses internally */
export type SyncLoaderMethods = {
  request: SyncRequestMethod;
  getSupported: SyncSupportedMethod;
  sync: SyncSyncMethod;
};

/** Options for creating a sync loader */
export type SyncLoaderOptions = {
  /** The event store used to deduplicate events and as the local store for negentropy sync */
  eventStore: EventStoreInput;
  /** A logger to extend */
  logger?: debug.Debugger;
} & ({ pool: SyncLoaderPool } | SyncLoaderMethods);

/** A request to load a set of events from a set of relays */
export type SyncLoadRequest = {
  /** The relays to load from */
  relays: string[];
  /** The filter describing the set of events to load (NIP-77 reconciles a single filter) */
  filter: Filter;
  /** The page size for paginated REQ loading on relays without NIP-77 (default 100) */
  limit?: number;
  /**
   * The max time in ms a single relay may take to make progress before it is errored: the time to the first
   * event, and the time between events. This bounds offline or unresponsive relays so the loader always
   * completes. A negentropy sync that times out falls back to a paginated request. Pass `false` to disable.
   * @default 30000
   */
  timeout?: number | false;
  /** The max number of relays to load from concurrently (default 10) */
  concurrency?: number;
};

/** A loader that loads a set of events from multiple relays using NIP-77 sync or paginated requests */
export type SyncLoader = (request: SyncLoadRequest) => SyncLoaderResult;

/**
 * Part 1: Paginated REQ loading.
 *
 * Loads every event matching `filter` from a single relay by requesting blocks backward in time. After each
 * block it moves the `until` cursor just past the oldest event seen and requests again, stopping when a block
 * comes back empty. Events outside the requested window are dropped, so a relay that ignores `until` cannot
 * produce duplicates. Use this for relays that do not support NIP-77, where a single REQ would be capped by
 * the relay's `limit`.
 *
 * NOTE: like other timeline pagination, if more than `limit` events share the same `created_at`, the events
 * past the page boundary at that exact second may be skipped.
 *
 * @internal exported for the sync loader only
 */
function paginatedRequest(
  request: SyncRequestMethod,
  relay: string,
  filter: TimelessFilter,
  limit = 100,
): Observable<NostrEvent> {
  // Loads a single block ending at `until`, keeping only events within the window and reporting the oldest
  const loadBlock = (until?: number): Observable<{ events: NostrEvent[]; oldest?: number }> => {
    const block: Filter = until !== undefined ? { ...filter, until, limit } : { ...filter, limit };
    return request(relay, [block]).pipe(
      toArray(),
      map((all) => {
        // A relay that ignores `until` returns events newer than the cursor; drop them so they are not
        // re-emitted as duplicates and so the cursor always makes backward progress
        const events = until === undefined ? all : all.filter((event) => event.created_at <= until);
        return {
          events,
          oldest: events.length ? events.reduce((min, e) => Math.min(min, e.created_at), Infinity) : undefined,
        };
      }),
    );
  };

  return loadBlock().pipe(
    // Keep loading older blocks until one comes back empty. NIP-01 defines `until` as inclusive, so move past
    // the oldest event in the block
    expand(({ events, oldest }) => (events.length === 0 || oldest === undefined ? EMPTY : loadBlock(oldest - 1))),
    // Flatten each block's events into the stream
    mergeMap(({ events }) => from(events)),
  );
}

/** Resolves the per-relay functional methods from either a relay pool or the manually provided methods */
function resolveMethods(options: SyncLoaderOptions): SyncLoaderMethods {
  if ("pool" in options) {
    const { pool, eventStore } = options;
    return {
      request: (relay, filters) => pool.relay(relay).request(filters),
      getSupported: (relay) => pool.relay(relay).getSupported(),
      // The event store doubles as the local store the relay reconciles against. The relay defaults to
      // receiving missing events; sending is intentionally left to a higher layer
      sync: (relay, filter) => pool.relay(relay).sync(eventStore, filter),
    };
  }

  return { request: options.request, getSupported: options.getSupported, sync: options.sync };
}

/**
 * Creates a {@link SyncLoader} that confidently loads a set of events from multiple relays, some of which may
 * support NIP-77 negentropy sync and some of which may not.
 *
 * For each relay it probes for NIP-77 support and then either:
 * - runs an efficient negentropy sync (Part 2), falling back to a paginated request if the sync fails, or
 * - runs a paginated REQ that pages backward in time until the relay is exhausted (Part 1).
 *
 * Calling the loader returns a `status$` observable (a full status snapshot on every change) and an `events$`
 * observable (the deduplicated events). Both complete when every relay has finished. Subscribing to either
 * observable starts a single shared run that writes received events to the store (deduplicated like the other
 * loaders). A `status$` subscriber that joins after the run started replays the latest status snapshot.
 *
 * @example
 * const loader = createSyncLoader({ eventStore, pool });
 * const { status$, events$ } = loader({ relays, filter: { kinds: [1], authors: [pubkey] } });
 * events$.subscribe((event) => console.log(event));
 * status$.subscribe((status) => console.log(status));
 */
export function createSyncLoader(options: SyncLoaderOptions): SyncLoader {
  const { request, getSupported, sync } = resolveMethods(options);
  const eventStore = options.eventStore;
  const baseLog = (options.logger ?? baseLogger).extend("sync-loader");

  return ({ relays, filter, limit = 100, timeout = 30_000, concurrency = 10 }: SyncLoadRequest): SyncLoaderResult => {
    const log = baseLog.extend(nanoid(4));

    // Normalize, de-duplicate, and drop invalid relay urls
    const urls = relaySet(relays);

    // Bound how long a relay may stall (time to first event and between events) so an offline or
    // unresponsive relay can never block the merge from completing. 0/false disables it
    const timeoutMs = timeout === false ? 0 : timeout;
    const withTimeout = <T>(observable: Observable<T>): Observable<T> =>
      timeoutMs > 0 ? observable.pipe(rxTimeout({ first: timeoutMs, each: timeoutMs })) : observable;

    type Msg = { event: NostrEvent } | { status: SyncLoaderStatus };

    // Build the combined work as a single lazy stream of events and status snapshots
    const work$ = defer<Observable<Msg>>(() => {
      // Mutable per-relay state, reset on each (re)subscription
      const state: Record<string, SyncRelayStatus> = {};
      for (const url of urls) state[url] = { relay: url, state: "pending", count: 0 };

      // The unique event ids surfaced across all relays (after store dedupe), drives the global `loaded` count
      const seen = new Set<string>();

      // Builds a full status snapshot from the current mutable state
      const snapshot = (): SyncLoaderStatus => ({
        relays: Object.fromEntries(urls.map((url) => [url, { ...state[url] }])),
        loaded: seen.size,
        done: urls.every((url) => state[url].state === "complete" || state[url].state === "error"),
      });

      // Mutates the state then emits a full status snapshot
      const status = (mutate?: () => void): Observable<Msg> =>
        defer(() => {
          mutate?.();
          return of<Msg>({ status: snapshot() });
        });

      // No relays to load from, emit a single (done) status
      if (urls.length === 0) return status();

      const buildRelayStream = (url: string): Observable<Msg> => {
        // Resolve the relay's supported NIPs (Promise or Observable) into a single emission
        const supported$ = defer(() => {
          const result = getSupported(url);
          return isObservable(result) ? result.pipe(take(1)) : from(Promise.resolve(result));
        }).pipe(
          // Don't let an unresponsive support check hang the relay; assume no NIP-77 on timeout
          timeoutMs > 0 ? rxTimeout({ first: timeoutMs }) : identity,
          catchError(() => of<number[] | null>(null)),
        );

        // Adds each event to the store, drops events it rejects (expired/invalid/deleted), counts the
        // store-accepted events from this relay, and globally de-duplicates so `loaded` and events$ only
        // reflect events consumers actually receive
        const toMessages = (events$: Observable<NostrEvent>): Observable<Msg> =>
          events$.pipe(
            mapEventsToStore(eventStore),
            mergeMap((event) => {
              // A negentropy sync reconciles events by id, so an event may belong to a relay even when it
              // was not fetched from it with a REQ
              addSeenRelay(event, url);
              state[url].count++;
              // Skip events another relay already surfaced
              if (seen.has(event.id)) return EMPTY;
              seen.add(event.id);
              return of<Msg>({ event });
            }),
          );

        // Choose the loading method based on NIP-77 support, then stream the events
        const load$ = supported$.pipe(
          switchMap((nips) => {
            const negentropy = !!nips?.includes(77);
            state[url].negentropy = negentropy;
            state[url].method = negentropy ? "negentropy" : "request";
            state[url].state = "loading";
            log("Loading from %s via %s", url, state[url].method);

            // Part 1: paginated REQ
            const request$ = () => toMessages(withTimeout(paginatedRequest(request, url, filter, limit)));

            // A relay without NIP-77 just pages through a REQ
            if (!negentropy) return concat(status(), request$());

            // Part 2: negentropy sync, falling back to a paginated request if it fails or times out
            return concat(
              status(),
              toMessages(withTimeout(sync(url, filter))).pipe(
                catchError((error) => {
                  log("Negentropy sync failed for %s, falling back to request: %s", url, error?.message ?? error);
                  // Surface the fallback as its own status change before streaming the request's events
                  return concat(
                    status(() => {
                      state[url].method = "request";
                      // Reset the count so it reflects the fallback request, not the partial sync
                      state[url].count = 0;
                    }),
                    request$(),
                  );
                }),
              ),
            );
          }),
        );

        return concat(
          // Mark the relay as being checked for NIP-77 support
          status(() => {
            state[url].state = "checking";
          }),
          load$,
          // Mark the relay as complete once its events have finished
          status(() => {
            if (state[url].state !== "error") state[url].state = "complete";
          }),
        ).pipe(
          // A failed relay should not fail the whole loader, surface it as an error status instead
          catchError((error) => {
            log("Relay %s failed: %s", url, error?.message ?? error);
            state[url].state = "error";
            state[url].error = error instanceof Error ? error : new Error(String(error));
            return of<Msg>({ status: snapshot() });
          }),
        );
      };

      // Emit an initial status, then run the relays with a concurrency cap so a large relay set does not
      // open every connection at once
      return merge(
        status(),
        from(urls).pipe(mergeMap((url) => buildRelayStream(url), Math.max(1, concurrency))),
      );
    }).pipe(
      // Delay the run until after same-tick subscriptions to status$ and events$ have attached
      subscribeOn(asapScheduler),
    );

    // Lazily start a single shared run on the first subscription to either observable, and tear it down when
    // both unsubscribe. Status snapshots replay the latest value so a status$ subscriber that joins after the
    // run started still sees the current state; events are a hot stream and must be subscribed to be received.
    let refCount = 0;
    let runSub: Subscription | undefined;
    let eventsSubject: Subject<NostrEvent> | undefined;
    let statusSubject: ReplaySubject<SyncLoaderStatus> | undefined;

    const start = () => {
      const events = (eventsSubject = new Subject<NostrEvent>());
      const statuses = (statusSubject = new ReplaySubject<SyncLoaderStatus>(1));
      runSub = work$.subscribe({
        next: (msg) => ("event" in msg ? events.next(msg.event) : statuses.next(msg.status)),
        error: (error) => {
          events.error(error);
          statuses.error(error);
        },
        complete: () => {
          events.complete();
          statuses.complete();
        },
      });
    };
    const retain = () => {
      if (refCount++ === 0) start();
    };
    const release = () => {
      if (--refCount === 0) {
        runSub?.unsubscribe();
        runSub = undefined;
        eventsSubject = undefined;
        statusSubject = undefined;
      }
    };

    const events$ = new Observable<NostrEvent>((observer) => {
      retain();
      const sub = eventsSubject!.subscribe(observer);
      return () => {
        sub.unsubscribe();
        release();
      };
    }).pipe(share());

    const status$ = new Observable<SyncLoaderStatus>((observer) => {
      retain();
      const sub = statusSubject!.subscribe(observer);
      return () => {
        sub.unsubscribe();
        release();
      };
    });

    return { status$, events$ };
  };
}
