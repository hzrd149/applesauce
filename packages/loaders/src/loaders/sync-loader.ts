import { logger as baseLogger } from "applesauce-core";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
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
  filter as rxFilter,
  finalize,
  from,
  identity,
  isObservable,
  merge,
  mergeMap,
  map,
  Observable,
  of,
  ReplaySubject,
  share,
  Subject,
  Subscription,
  tap,
  subscribeOn,
  switchMap,
  take,
  timeout as rxTimeout,
} from "rxjs";

/**
 * What authentication to wait for when a relay requires NIP-42 auth for reading. `true` waits for any authenticated
 * user, a pubkey (or array of pubkeys) waits until those specific users are authenticated, `false` disables waiting.
 * Structurally matches applesauce-relay's `AuthRequirement`.
 */
export type SyncAuthRequirement = boolean | string | string[];

/**
 * The minimal relay interface a {@link SyncAuthHandler} needs to authenticate: `url`, `authenticate` and
 * `auth`. This structurally matches applesauce-relay's `Relay`, the concrete type behind its
 * `RelayAuthContext.relay` — a real `Relay` satisfies this interface without any adaptation.
 */
export interface SyncAuthRelay {
  /** The relay's URL */
  url: string;
  /** Authenticate with the relay using a signer */
  authenticate(signer: { signEvent: (event: EventTemplate) => NostrEvent | Promise<NostrEvent> }): Promise<unknown>;
  /** Send an already-signed AUTH event directly */
  auth(event: NostrEvent): Promise<unknown>;
}

/**
 * The context passed to a {@link SyncAuthHandler} when a relay signals that authentication is required.
 * This structurally matches applesauce-relay's `RelayAuthContext` (RAUTH-01), narrowed to the fields a
 * sync-loader-level handler actually needs. One-way assignability: a handler written against this type
 * accepts a real `Relay` for `relay` (a `Relay` satisfies {@link SyncAuthRelay}), but a handler written
 * against applesauce-relay's full `RelayAuthContext` is NOT assignable to a {@link SyncAuthHandler} —
 * `RelayAuthContext.relay` is a concrete `Relay`, which is not assignable backwards to the narrower
 * `SyncAuthRelay` some other caller of that wider handler type might expect.
 */
export type SyncAuthContext = {
  /** The relay that requires authentication */
  relay: SyncAuthRelay;
  /** The URL of the relay */
  url: string;
  /** The current NIP-42 AUTH challenge string, or null if none has been received yet */
  challenge: string | null;
  /** The auth requirement configured for the operation that triggered this auth phase */
  requirement: SyncAuthRequirement;
  /** The pubkeys that are not yet authenticated for `requirement`, or null when `requirement` is `true` */
  missingPubkeys: string[] | null;
  /** The machine-readable reason string reported by the relay */
  reason: string;
};

/**
 * A caller-supplied callback invoked when a relay signals that authentication is required. This
 * structurally matches applesauce-relay's `RelayAuthHandler` (D-06).
 */
export type SyncAuthHandler = (context: SyncAuthContext) => void | Promise<void>;

/**
 * NOTE: these three `name` strings are load-bearing wire between packages. They are coupled to
 * Relay's terminal authentication errors have pinned `.name` values declared in
 * `packages/relay/src/relay.ts`. D-06 deliberately forbids importing those classes here, so this loader
 * duck-types against the exact strings instead — a rename in `relay.ts` must update this set in the same
 * change.
 */
export const RELAY_AUTH_ERROR_NAMES = new Set([
  "AuthRequiredError",
  "AuthHandlerError",
  "AuthTimeoutError",
  "RelayAuthChallengeTimeoutError",
  "RelayAuthChallengeChangedError",
]);

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

/** Per-relay options threaded through the request and sync methods */
export type SyncMethodOptions = {
  waitForAuth?: SyncAuthRequirement;
  /** Called when the relay signals that authentication is required for this operation */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum time (in milliseconds) to wait for a single auth phase, or `false` to wait indefinitely */
  authTimeout?: number | false;
  /** The number of consecutive auth-required cycles to tolerate before giving up */
  authRetries?: number;
};

/** A method that makes a one-shot REQ to a single relay and completes on EOSE */
export type SyncRequestMethod = (relay: string, filters: Filter[], opts?: SyncMethodOptions) => Observable<NostrEvent>;

/** A method that returns the list of NIPs a single relay supports (used to detect NIP-77) */
export type SyncSupportedMethod = (relay: string) => Promise<number[] | null> | Observable<number[] | null>;

/** Dependency-free structural mirror of relay sync outcomes. */
export type SyncResult =
  | { type: "received"; from: string; event: NostrEvent }
  | { type: "sent"; from: string; event: NostrEvent; response: unknown }
  | { type: "send-failed"; from: string; event: NostrEvent; error: unknown; response?: unknown }
  | { type: "relay-failed"; from: string; error: unknown };

/** A method that runs a NIP-77 negentropy sync against a single relay, receiving missing events, and completes
 * when the sync is done */
export type SyncSyncMethod = (relay: string, filter: Filter, opts?: SyncMethodOptions) => Observable<SyncResult>;

/** The minimal relay interface the sync loader needs (structurally satisfied by applesauce-relay's `Relay`) */
export interface SyncLoaderRelay {
  request(filters: Filter | Filter[], opts?: SyncMethodOptions): Observable<NostrEvent>;
  getSupported(): Promise<number[] | null>;
  sync(store: unknown, filter: Filter, direction?: unknown, opts?: SyncMethodOptions): Observable<SyncResult>;
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
  /** The page size for paginated REQ loading on relays without NIP-77 (default 500) */
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
  /**
   * What authentication to wait for when a relay requires NIP-42 auth for reading. A relay that responds with
   * `auth-required` waits for authentication and retries both the negentropy sync and the paginated request. `true`
   * (the default) waits for any authenticated user, a pubkey (or array of pubkeys) waits until those specific users
   * are authenticated, and `false` disables waiting so an auth-required relay errors instead.
   * @default true
   */
  waitForAuth?: SyncAuthRequirement;
  /** Called when a relay signals that authentication is required, for both the negentropy sync and the
   * paginated request path identically (RAUTH-08) */
  onAuthRequired?: SyncAuthHandler;
  /**
   * The maximum time (in milliseconds) to wait for a single auth phase (handler execution plus the
   * subsequent authentication wait), owned by the relay layer. Pass `false` to wait indefinitely for
   * external auth state.
   * @default 30000
   */
  authTimeout?: number | false;
  /**
   * The number of consecutive auth-required cycles to tolerate before giving up, owned by the relay layer.
   * @default 1
   */
  authRetries?: number;
};

/** A loader that loads a set of events from multiple relays using NIP-77 sync or paginated requests */
export type SyncLoader = (request: SyncLoadRequest) => SyncLoaderResult;

/**
 * Part 1: Paginated REQ loading.
 *
 * Loads every event matching `filter` from a single relay by requesting blocks backward in time. The first
 * block honors the filter's `until`, and every block preserves the filter's `since`. After each block it moves
 * the `until` cursor just past the oldest event seen and requests again, stopping when a block comes back empty,
 * comes back short, or the next cursor would move before `since`. Events outside the requested window are dropped,
 * so a relay that ignores `since` or `until` cannot produce duplicates. Use this for relays that do not support
 * NIP-77, where a single REQ would be capped by the relay's `limit`.
 *
 * NOTE: like other timeline pagination, if more than `limit` events share the same `created_at`, the events
 * past the page boundary at that exact second may be skipped.
 *
 * @internal exported for the sync loader only
 */
function paginatedRequest(
  request: SyncRequestMethod,
  relay: string,
  filter: Filter,
  limit = 500,
  // D-18/WR-07: already the fully-derived "backward" logger, threaded in from buildRelayStream's
  // top level rather than derived here — this function is invoked from request$(), which lives
  // inside the switchMap projector below (a re-enterable reactive callback), so deriving on entry
  // would repeat the exact defect the requestLog hoist (14-02) fixed.
  log?: debug.Debugger,
  opts?: SyncMethodOptions,
): Observable<NostrEvent> {
  const since = filter.since;
  const initialUntil = filter.until;

  // Loads blocks ending at `until`, streaming each block before deciding whether to request the next one
  const loadBlocks = (until = initialUntil): Observable<NostrEvent> => {
    const block: Filter = until !== undefined ? { ...filter, until, limit } : { ...filter, limit };
    let count = 0;
    let oldest: number | undefined;

    log?.(`Loading block until:${until}`);

    const events$ = request(relay, [block], opts).pipe(
      mergeMap((event) => {
        if (until !== undefined && event.created_at > until) return EMPTY;
        if (since !== undefined && event.created_at < since) return EMPTY;
        return of(event);
      }),
      tap((event) => {
        count++;
        oldest = oldest === undefined ? event.created_at : Math.min(oldest, event.created_at);
      }),
    );

    return concat(
      events$,
      defer(() => {
        log?.(`Found ${count} events`);
        if (count === 0 || oldest === undefined || count < limit) {
          log?.("Complete");
          return EMPTY;
        }

        const next = oldest - 1;
        if (since !== undefined && next < since) {
          log?.("Complete");
          return EMPTY;
        }

        return loadBlocks(next);
      }),
    );
  };

  return loadBlocks();
}

/** Resolves the per-relay functional methods from either a relay pool or the manually provided methods */
function resolveMethods(options: SyncLoaderOptions): SyncLoaderMethods {
  if ("pool" in options) {
    const { pool, eventStore } = options;
    return {
      request: (relay, filters, opts) => pool.relay(relay).request(filters, opts),
      getSupported: (relay) => pool.relay(relay).getSupported(),
      // The event store doubles as the local store the relay reconciles against. The relay defaults to
      // receiving missing events; sending is intentionally left to a higher layer
      sync: (relay, filter, opts) => pool.relay(relay).sync(eventStore, filter, undefined, opts),
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

  return ({
    relays,
    filter,
    limit = 500,
    timeout = 30_000,
    concurrency = 10,
    waitForAuth,
    onAuthRequired,
    authTimeout,
    authRetries,
  }: SyncLoadRequest): SyncLoaderResult => {
    const log = baseLog.extend(nanoid(4));

    // Per-relay options threaded into both the negentropy sync and the paginated request so an auth-required
    // relay waits for authentication and retries instead of failing. This is the single construction point
    // both sync(url, filter, methodOptions) and paginatedRequest(..., methodOptions) read, which is what
    // makes RAUTH-08's "identically" requirement structural rather than a coincidence.
    const methodOptions: SyncMethodOptions = { waitForAuth, onAuthRequired, authTimeout, authRetries };

    // Normalize, de-duplicate, and drop invalid relay urls
    const urls = relaySet(relays);

    // Bound how long a relay may stall (time to first event and between events) so an offline or
    // unresponsive relay can never block the merge from completing. 0/false disables it. D-16: each
    // relay builds its own auth-aware version of this below (`buildRelayStream`'s `withTimeout`) rather
    // than sharing one function, since the clock must be suspendable per relay independently.
    const timeoutMs = timeout === false ? 0 : timeout;

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
        // D-18: derived once per relay, here at buildRelayStream's own top level — this function runs
        // once per relay, whereas the switchMap projector below is a re-enterable reactive callback the
        // request-logger derivation must not live inside. requestLog joins the other per-relay values
        // already derived at this level (authPhases, authPhaseChange$, the close-callback set).
        const requestLog = log.extend(url).extend("request");

        // WR-07: paginatedRequest's own logger, hoisted here for the identical reason requestLog was
        // hoisted above — paginatedRequest is invoked from request$(), which is defined inside the
        // switchMap projector below (a re-enterable reactive callback), so deriving it there would be
        // the same defect the requestLog hoist fixed, just at the paginatedRequest call site instead.
        // The "backward" sub-namespace and its per-relay nanoid(8) correlation suffix are both fixed
        // once here, unconditionally, and threaded into paginatedRequest directly rather than derived
        // on each call.
        const backwardLog = requestLog.extend("backward").extend(nanoid(8));

        // D-16: this relay's own auth-phase suspension, constructed per relay/url (not once for the
        // whole loader) so one relay's auth wait can never pause another relay's stall clock. A counter
        // (not a boolean), mirroring applesauce-relay's own AuthPhaseGate, so overlapping phases cannot
        // resume the clock early. `withTimeout` below does not advance while `authPhases > 0`.
        let authPhases = 0;
        const authPhaseChange$ = new Subject<void>();
        // Close callbacks for every currently in-flight phase, so a stream emission (meaning the auth
        // phase is over) can force ALL of them closed immediately, even ones whose own authTimeout-delay
        // hasn't elapsed yet
        const pendingAuthCloses = new Set<() => void>();
        const forceCloseAuthPhases = () => {
          if (pendingAuthCloses.size === 0) return;
          for (const close of pendingAuthCloses) close();
          pendingAuthCloses.clear();
        };

        // The onAuthRequired that actually goes into this relay's methodOptions. WR-03: this wrapper is
        // ALWAYS installed — never conditional on the caller supplying a handler — because the stall-guard
        // suspension is a property of the auth phase itself (D-16), and D-14's uniform 30s default applies
        // with or without a handler. Making "no wrapper installed" unrepresentable is what stops a
        // handler-less caller's stall clock from racing the relay's own `authTimeout` wait. It opens the
        // suspension the instant it is invoked and closes it on the later of (a) the caller's handler (if
        // any) settling and (b) `authTimeout` ms after that — the maximum possible remaining duration of
        // the relay-side auth phase, since this loader is the one passing that same `authTimeout` down.
        // When the caller supplied nothing, delegating to `undefined` still opens/closes the phase, and
        // `authRetry` folds an `undefined`-returning handler into the exact same `of(undefined)` it already
        // produces for a missing handler (auth-retry.ts's `result instanceof Promise ? from(result) :
        // of(undefined)`), so the relay-side semantics are unchanged either way. This closes RESEARCH's
        // Assumption A2 residual window: the suspension covers the post-handler `authSatisfied$` wait, not
        // just the handler call itself. `authTimeout: false` leaves it open indefinitely until a stream
        // emission closes it early. The wrapper never swallows the caller's rejection — it returns the
        // caller's result unchanged so the relay layer maps a rejection to its own AuthHandlerError — and
        // it never invokes the handler itself beyond this single delegation.
        // WR-04 invariant: a phase owns at most one timer, that timer never outlives the phase, and the
        // phase never outlives the relay stream (enforced below by `finalize` on the terminal pipeline).
        const relayOnAuthRequired: SyncAuthHandler = (context) => {
          authPhases++;
          authPhaseChange$.next();

          let closed = false;
          // The phase's own close-timer handle, retained so it can be cleared the moment the phase closes
          // by any means — nothing else clears it (WR-04)
          let handle: ReturnType<typeof setTimeout> | undefined;
          const close = () => {
            if (closed) return;
            closed = true;
            if (handle !== undefined) {
              clearTimeout(handle);
              handle = undefined;
            }
            pendingAuthCloses.delete(close);
            authPhases = Math.max(0, authPhases - 1);
            authPhaseChange$.next();
          };
          pendingAuthCloses.add(close);

          const scheduleClose = () => {
            // WR-04 leak path 1: a phase already closed (typically force-closed by a stream emission
            // while the handler was still pending) must never arm a fresh timer — nothing would ever
            // clear it, since `close()` early-returns on `closed` and the callback is already gone from
            // `pendingAuthCloses`.
            if (closed) return;
            // authTimeout: false means unbounded — only forceCloseAuthPhases (a stream emission)
            // closes this phase
            if (authTimeout !== false) handle = setTimeout(close, authTimeout ?? 30_000);
          };

          try {
            const result = onAuthRequired?.(context);
            if (result instanceof Promise) result.then(scheduleClose, scheduleClose);
            else scheduleClose();
            return result;
          } catch (error) {
            // WR-04 leak path 2: a synchronous throw must still close this phase — otherwise no timer is
            // armed, but the phase is also never closed, leaving the suspension open (and the stall guard
            // disarmed for this relay) until some later emission force-closes it. Re-raise the caller's
            // original error untouched so the relay layer still maps it to its own handler error class.
            close();
            throw error;
          }
        };

        // The options this relay's sync() and paginatedRequest() calls both read — the same base fields
        // constructed once at `methodOptions` above, with `onAuthRequired` always narrowed to this relay's
        // own wrapper (installed unconditionally, WR-03) so both paths always read one shared shape
        // carrying the wrapper (RAUTH-08)
        const relayMethodOptions: SyncMethodOptions = { ...methodOptions, onAuthRequired: relayOnAuthRequired };

        // D-16: an auth-aware replacement for the bare `rxTimeout({ first, each })` stall guard. Its
        // countdown is paused for the whole time `authPhases > 0` (constructed per relay above), and
        // resumes with the remaining — not reset — budget once every phase closes, mirroring D-15's
        // pause/resume model: an auth wait does not grant the operation extra time, it just stops the
        // clock while authentication is out of the operation's hands.
        const withTimeout = <T>(observable: Observable<T>): Observable<T> => {
          if (timeoutMs <= 0) return observable;

          return new Observable<T>((subscriber) => {
            let remaining = timeoutMs;
            let armedAt: number | null = null;
            let timer: ReturnType<typeof setTimeout> | null = null;
            let settled = false;

            const clearArmed = () => {
              if (timer !== null) {
                clearTimeout(timer);
                timer = null;
              }
            };
            const fail = () => {
              if (settled) return;
              settled = true;
              clearArmed();
              phaseSub.unsubscribe();
              sourceSub.unsubscribe();
              subscriber.error(new Error(`Sync loader timed out waiting for progress from ${url}`));
            };
            const arm = () => {
              if (settled || authPhases > 0) return;
              armedAt = Date.now();
              clearArmed();
              timer = setTimeout(fail, Math.max(0, remaining));
            };
            const disarm = () => {
              if (armedAt !== null) {
                remaining -= Date.now() - armedAt;
                armedAt = null;
              }
              clearArmed();
            };

            const phaseSub = authPhaseChange$.subscribe(() => {
              if (settled) return;
              if (authPhases > 0) disarm();
              else arm();
            });

            arm();

            const sourceSub = observable.subscribe({
              next: (value) => {
                if (settled) return;
                // An emission means any in-flight auth phase is over (D-16); force it closed and give
                // the next stall window a fresh budget, matching the existing `each` semantics
                forceCloseAuthPhases();
                remaining = timeoutMs;
                arm();
                subscriber.next(value);
              },
              error: (err) => {
                if (settled) return;
                settled = true;
                clearArmed();
                phaseSub.unsubscribe();
                subscriber.error(err);
              },
              complete: () => {
                if (settled) return;
                settled = true;
                clearArmed();
                phaseSub.unsubscribe();
                subscriber.complete();
              },
            });

            return () => {
              settled = true;
              clearArmed();
              phaseSub.unsubscribe();
              sourceSub.unsubscribe();
            };
          });
        };

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
            const request$ = () =>
              toMessages(withTimeout(paginatedRequest(request, url, filter, limit, backwardLog, relayMethodOptions)));

            // A relay without NIP-77 just pages through a REQ
            if (!negentropy) return concat(status(), request$());

            // Part 2: negentropy sync, falling back to a paginated request if it fails or times out
            return concat(
              status(),
              toMessages(
                withTimeout(sync(url, filter, relayMethodOptions)).pipe(
                  rxFilter((message) => message.type === "received" || !("type" in message)),
                  map((message) => message.type === "received" ? message.event : message as unknown as NostrEvent),
                ),
              ).pipe(
                catchError((error) => {
                  // D-16: an auth-required failure on the negentropy path must NOT trigger the paginated
                  // fallback — that would burn the request path against the same auth wall the negentropy
                  // path just gave up on, and report a spurious "sync failed" before the relay ultimately
                  // errors anyway. Re-throw so it reaches the per-relay catchError below instead.
                  if (error?.name && RELAY_AUTH_ERROR_NAMES.has(error.name)) {
                    log(
                      "Negentropy sync auth-required for %s, not falling back to request: %s",
                      url,
                      error?.message ?? error,
                    );
                    throw error;
                  }

                  // Re-arm the fallback's stall clock before its request observable is constructed.
                  forceCloseAuthPhases();
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
          // WR-04 leak path 3: force-close every auth phase still open on this relay when its stream ends
          // by any means (complete, error or unsubscribe alike) — the only hook that covers all three.
          // This must sit here, outside `withTimeout`, because `withTimeout` returns its source unwrapped
          // whenever the stall guard is disabled (`timeoutMs <= 0`), so a hook placed there would silently
          // disappear for those callers.
          finalize(forceCloseAuthPhases),
        );
      };

      // Emit an initial status, then run the relays with a concurrency cap so a large relay set does not
      // open every connection at once
      return merge(status(), from(urls).pipe(mergeMap((url) => buildRelayStream(url), Math.max(1, concurrency))));
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
    let eventsAttached = false;
    let pendingEvents: NostrEvent[] = [];

    const start = () => {
      const events = (eventsSubject = new Subject<NostrEvent>());
      const statuses = (statusSubject = new ReplaySubject<SyncLoaderStatus>(1));
      eventsAttached = false;
      pendingEvents = [];
      runSub = work$.subscribe({
        next: (msg) => {
          if ("status" in msg) {
            statuses.next(msg.status);
            return;
          }

          if (eventsAttached) events.next(msg.event);
          else pendingEvents.push(msg.event);
        },
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
        eventsAttached = false;
        pendingEvents = [];
      }
    };

    const events$ = new Observable<NostrEvent>((observer) => {
      retain();
      const sub = eventsSubject!.subscribe(observer);
      if (!eventsAttached) {
        eventsAttached = true;
        for (const event of pendingEvents) eventsSubject!.next(event);
        pendingEvents = [];
      }
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
