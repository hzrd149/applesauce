import { logger } from "applesauce-core";
import { EventMemory } from "applesauce-core/event-store";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import { normalizeURL } from "applesauce-core/helpers/url";
import { filterDuplicateEvents } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  connect,
  defaultIfEmpty,
  defer,
  EMPTY,
  filter,
  from,
  identity,
  lastValueFrom,
  map,
  merge,
  MonoTypeOperatorFunction,
  Observable,
  of,
  scan,
  share,
  shareReplay,
  startWith,
  Subject,
  Subscription,
  switchMap,
  take,
  timer,
  toArray,
} from "rxjs";
import { type ReconcileFunction } from "./negentropy.js";
import { AUTH_PHASE_GATE, AuthPhaseGate, authSuspendableLifetime } from "./operators/auth-retry.js";
import { reverseSwitchMap } from "./operators/reverse-switch-map.js";
import { isReqProgress, Relay, SyncDirection } from "./relay.js";
import {
  FilterInput,
  GroupNegentropySyncOptions,
  GroupRelayInput,
  GroupReqErrorMessage,
  GroupReqMessage,
  GroupReqOptions,
  GroupRequestCompleteOperator,
  GroupRequestOptions,
  GroupSubscriptionOptions,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishOptions,
  PublishResponse,
  RelayCountResponse,
  RelayReqMessage,
  RelayOutcome,
  RelayStatus,
} from "./types.js";

/** Aggregate failure raised by high-level group requests and subscriptions. */
export class RelayGroupError extends AggregateError {
  readonly outcomes: Readonly<Record<string, RelayOutcome<never>>>;

  constructor(entries: ReadonlyArray<readonly [string, unknown]>) {
    super(
      entries.map(([, error]) => error),
      "All relays failed",
    );
    this.name = "RelayGroupError";
    this.outcomes = Object.fromEntries(entries.map(([url, error]) => [url, { ok: false, error }]));
  }
}

type CohortState = { status: "pending" | "live" | "eose" | "failed"; error?: unknown };

/**
 * The group-level progress predicate (CR-02). `GroupReqErrorMessage` is a value the group manufactures
 * for itself in `internalSubscription`'s `catchError` when a relay's stream fails — it means that relay
 * produced *nothing*, so it is bookkeeping rather than progress, exactly as `req()`'s synthetic `OPEN`
 * is at the relay layer (WR-01). Narrowing instead of casting keeps the compiler responsible for this
 * question: a new arm added to `GroupReqMessage` fails to typecheck here rather than silently counting
 * as progress.
 */
export function isGroupReqProgress(message: GroupReqMessage): boolean {
  if (message.type === "ERROR") return false;
  return isReqProgress(message);
}

/**
 * The `.name` values of Relay's terminal authentication errors
 * (`relay.ts`). Matched by string rather than `instanceof`/import, mirroring
 * `packages/loaders/src/loaders/sync-loader.ts`'s `RELAY_AUTH_ERROR_NAMES` duck-typed precedent —
 * a rename of any of those classes' pinned `.name` must update this set in the same change.
 */
const RELAY_AUTH_ERROR_NAMES = new Set([
  "AuthRequiredError",
  "AuthHandlerError",
  "AuthTimeoutError",
  "RelayAuthChallengeTimeoutError",
  "RelayAuthChallengeChangedError",
]);

/** Convert an error to a PublishResponse */
function errorToPublishResponse(relay: Relay): MonoTypeOperatorFunction<PublishResponse> {
  return catchError((err) =>
    of({
      ok: false,
      from: relay.url,
      message: err?.message || "Unknown error",
      // D-18: attach the original error object alongside the message so a group publish failure
      // reaches the consumer as something it can branch on rather than a bare string.
      error: err,
    } satisfies PublishResponse),
  );
}

export class RelayGroup {
  protected log: typeof logger = logger.extend("RelayGroup");
  protected relays$: BehaviorSubject<Relay[]> | Observable<Relay[]> = new BehaviorSubject<Relay[]>([]);

  /** Observable of relay status for all relays in the group */
  status$: Observable<Record<string, RelayStatus>>;

  get relays(): Relay[] {
    if (this.relays$ instanceof BehaviorSubject) return this.relays$.value;
    throw new Error("This group was created with an observable, relays are not available");
  }

  constructor(relays: GroupRelayInput) {
    this.relays$ = Array.isArray(relays) ? new BehaviorSubject(relays) : relays;

    // Initialize status$ observable
    this.status$ = this.relays$.pipe(
      switchMap((relays) => {
        // If no relays, return empty record
        if (relays.length === 0) return of({} as Record<string, RelayStatus>);

        // Merge all relay status streams
        return merge(...relays.map((relay) => relay.status$)).pipe(
          // Accumulate into a Record
          scan(
            (acc, status) => ({
              ...acc,
              [status.url]: status,
            }),
            {} as Record<string, RelayStatus>,
          ),
          // Start with initial empty state
          startWith({} as Record<string, RelayStatus>),
        );
      }),
      // Share the subscription
      shareReplay(1),
    );
  }

  /** Whether this group is controlled by an upstream observable */
  private get controlled() {
    return this.relays$ instanceof BehaviorSubject === false;
  }

  /** Check if a relay is in the group */
  public has(relay: Relay | string): boolean {
    if (this.controlled) throw new Error("This group was created with an observable, relays are not available");

    if (typeof relay === "string") return this.relays.some((r) => r.url === relay);
    return this.relays.includes(relay);
  }

  /** Add a relay to the group */
  public add(relay: Relay): void {
    if (this.has(relay)) return;
    (this.relays$ as BehaviorSubject<Relay[]>).next([...this.relays, relay]);
  }

  /** Remove a relay from the group */
  public remove(relay: Relay): void {
    if (!this.has(relay)) return;
    (this.relays$ as BehaviorSubject<Relay[]>).next(this.relays.filter((r) => r !== relay));
  }

  /** Internal logic for handling requests to multiple relays */
  protected internalSubscription(project: (relay: Relay) => Observable<RelayReqMessage>): Observable<GroupReqMessage> {
    // Keep a cache of upstream observables for each relay
    const upstream = new WeakMap<Relay, Observable<GroupReqMessage>>();

    // Subscribe to the group relays
    const messages = this.relays$.pipe(
      // Every time they change switch to a new observable
      // Using reverseSwitchMap to subscribe to the new relays before unsubscribing from the old ones
      // This avoids sending duplicate REQ messages to the relays
      reverseSwitchMap((relays) => {
        const observables: Observable<GroupReqMessage>[] = [];
        for (const relay of relays) {
          // If an upstream observable exists for this relay, use it
          if (upstream.has(relay)) {
            observables.push(upstream.get(relay)!);
            continue;
          }

          const observable: Observable<GroupReqMessage> = project(relay).pipe(
            // Catch connection errors and return ERROR
            catchError((err) => of({ type: "ERROR", from: relay.url, error: err } satisfies GroupReqErrorMessage)),
          );
          observables.push(observable);
          upstream.set(relay, observable);
        }

        return merge(...observables);
      }),
      // Ensure a single upstream subscription
      // NOTE: this is required because the complete operator will subscribe many times to this
      share(),
    );

    return messages;
  }

  /** High-level request/subscription fan-out with one latest-cohort settlement decision. */
  private settledSubscription(
    mode: "request" | "subscription",
    project: (relay: Relay) => Observable<RelayReqMessage>,
    complete?: GroupRequestCompleteOperator,
  ): Observable<GroupReqMessage> {
    return new Observable((subscriber) => {
      const messages = new Subject<GroupReqMessage>();
      const relaySubscriptions = new Map<string, { relay: Relay; subscription: Subscription }>();
      const states = new Map<string, CohortState>();
      const order: string[] = [];
      let settled = false;

      const finish = (kind: "complete" | "error", error?: unknown) => {
        if (settled) return;
        settled = true;
        kind === "error" ? subscriber.error(error) : subscriber.complete();
      };

      const decide = () => {
        if (states.size === 0) {
          if (mode === "request") finish("complete");
          return;
        }
        const current = order.filter((url) => states.has(url));
        if (current.every((url) => states.get(url)?.status === "failed")) {
          finish(
            "error",
            new RelayGroupError(current.map((url) => [url, states.get(url)?.error] as const)),
          );
          return;
        }
        if (
          mode === "request" &&
          current.every((url) => {
            const status = states.get(url)?.status;
            return status === "eose" || status === "failed";
          })
        )
          finish("complete");
      };

      const completionSubscription = complete
        ? messages.pipe(complete, filter(Boolean), take(1)).subscribe(() => finish("complete"))
        : Subscription.EMPTY;

      const membershipSubscription = this.relays$.subscribe({
        next: (relays) => {
          if (settled) return;
          const normalized = new Map<string, Relay>();
          for (const relay of relays) normalized.set(normalizeURL(relay.url), relay);

          for (const url of [...states.keys()]) {
            const activeRelay = normalized.get(url);
            const existing = relaySubscriptions.get(url);
            if (!activeRelay || (existing && existing.relay !== activeRelay)) {
              states.delete(url);
              existing?.subscription.unsubscribe();
              relaySubscriptions.delete(url);
            }
          }
          for (const url of normalized.keys()) {
            if (states.has(url)) continue;
            states.set(url, { status: "pending" });
            order.push(url);
          }
          // Install the complete replacement cohort before subscribing any new inner: a
          // synchronous failure must be evaluated against every newly-active URL.
          for (const [url, relay] of normalized) {
            if (relaySubscriptions.has(url)) continue;
            const relaySubscription = project(relay).subscribe({
              next: (message) => {
                if (settled || !states.has(url)) return;
                if (message.type === "EVENT") states.set(url, { status: "live" });
                else if (message.type === "EOSE")
                  states.set(url, { status: mode === "request" ? "eose" : "live" });
                subscriber.next(message);
                decide();
                if (!settled) messages.next(message);
              },
              error: (error) => {
                if (settled || !states.has(url)) return;
                const message = { type: "ERROR", from: relay.url, error } satisfies GroupReqErrorMessage;
                states.set(url, { status: "failed", error });
                decide();
                if (!settled) messages.next(message);
              },
            });
            relaySubscriptions.set(url, { relay, subscription: relaySubscription });
          }
          decide();
        },
        error: (error) => finish("error", error),
      });

      return () => {
        settled = true;
        membershipSubscription.unsubscribe();
        completionSubscription.unsubscribe();
        messages.complete();
        for (const { subscription } of relaySubscriptions.values()) subscription.unsubscribe();
      };
    });
  }

  /** Internal logic for handling publishes to multiple relays */
  protected internalPublish(project: (relay: Relay) => Observable<PublishResponse>): Observable<PublishResponse> {
    // Keep a cache of upstream observables for each relay
    const upstream = new WeakMap<Relay, Observable<PublishResponse>>();

    // Subscribe to the group relays
    return this.relays$.pipe(
      // Take a snapshot of relays (no updates yet...)
      take(1),
      // Every time they change switch to a new observable
      switchMap((relays) => {
        const observables: Observable<PublishResponse>[] = [];
        for (const relay of relays) {
          // If an upstream observable exists for this relay, use it
          if (upstream.has(relay)) {
            observables.push(upstream.get(relay)!);
            continue;
          }

          // Create a new upstream observable for this relay
          const observable = project(relay).pipe(
            // Catch error and return as PublishResponse
            errorToPublishResponse(relay),
          );
          observables.push(observable);
          upstream.set(relay, observable);
        }

        return merge(...observables);
      }),
      // Ensure a single upstream publish
      share(),
    );
  }

  /** Send a REQ to all relays and returns all responses */
  req(filters: FilterInput, opts?: GroupReqOptions): Observable<GroupReqMessage> {
    return this.internalSubscription((relay) => relay.req(filters, opts));
  }

  /** Send an event to all relays */
  event(event: NostrEvent): Observable<PublishResponse> {
    return this.internalPublish((relay) => relay.event(event));
  }

  /** Negentropy sync events with the relays and an event store */
  async negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: GroupNegentropySyncOptions,
  ): Promise<boolean> {
    // Filter out relays that do not support NIP-77 negentropy sync
    const supported = await Promise.all(this.relays.map(async (relay) => [relay, await relay.getSupported()] as const));
    const relays = supported.filter(([_, supported]) => supported?.includes(77)).map(([relay]) => relay);
    if (relays.length === 0) throw new Error("No relays support NIP-77 negentropy sync");

    // Non parallel sync is not supported yet
    if (!opts?.parallel) throw new Error("Negentropy sync must be parallel (for now)");

    // Sync all the relays in parallel
    await Promise.allSettled(relays.map((relay) => relay.negentropy(store, filter, reconcile, opts)));

    return true;
  }

  /** Publish an event to all relays with retries ( default 3 retries ) */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse[]> {
    return lastValueFrom(
      this.internalPublish((relay) => from(relay.publish(event, opts))).pipe(toArray(), defaultIfEmpty([])),
    );
  }

  /** Request events from all relays and complete based on condition */
  request(filters: FilterInput, opts?: GroupRequestOptions): Observable<NostrEvent> {
    // Cohort settlement owns all-terminal completion. Preserve the legacy five-second
    // fallback after the first EOSE; a caller-supplied operator replaces that early policy.
    const complete = opts?.complete ?? RelayGroup.completeAfterFirstRelay(5_000);

    // D-15/WR-02: one AuthPhaseGate per call, shared by every relay in the fan-out — the group's clock
    // is a single budget over the whole fan-out, so any relay's in-flight auth phase must suspend it.
    const gate = new AuthPhaseGate();

    return this.settledSubscription(
      "request",
      // NOTE: we need to use the .req() method here because it returns the full RelayReqResponse object
      (relay) =>
        relay.req(
          filters,
          // Manually default to relays reconnect config; thread the shared gate so req()'s auth phase
          // suspends this call's own operation clock below.
          { ...opts, reconnect: opts?.reconnect ?? relay.requestReconnect, [AUTH_PHASE_GATE]: gate },
        ),
      complete,
    ).pipe(
      // D-15: suspend the operation clock across the auth phase so it does not race authTimeout's own
      // clock — do NOT "simplify" this back to a bare rxjs timeout(), which cannot pause. isGroupReqProgress
      // (CR-02) is total over GroupReqMessage with no cast: it excludes req()'s synthetic OPEN (WR-01's
      // group analog) *and* the group's own manufactured ERROR bookkeeping value, so neither can
      // prematurely cancel this clock before some relay has actually made progress. A future arm added to
      // GroupReqMessage is a compile error here, not a silent default to "this counts as progress".
      authSuspendableLifetime(opts?.timeout ?? 30_000, gate),
      // Filter only for event messages
      filter((message) => message.type === "EVENT"),
      // Extract event messages
      map((message) => message.event),
      // If an event store is provided, filter duplicate events
      opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory<NostrEvent>()),
      // Only create one upstream subscription
      share(),
    );
  }

  /** Open a subscription to all relays with retries ( default 3 retries ) */
  subscription(filters: FilterInput, opts?: GroupSubscriptionOptions): Observable<NostrEvent> {
    const gate = new AuthPhaseGate();
    return this.settledSubscription(
      "subscription",
      // NOTE: we need to use the .req() method here because it returns the full RelayReqResponse object
      (relay) =>
        relay.req(filters, {
          ...opts,
          reconnect: opts?.reconnect ?? relay.subscriptionReconnect,
          [AUTH_PHASE_GATE]: gate,
        }),
    ).pipe(
      typeof opts?.timeout === "number" ? authSuspendableLifetime(opts.timeout, gate) : identity,
      // Filter only for event messages
      filter((message) => message.type === "EVENT"),
      // Extract event messages
      map((message) => message.event),
      // If an event store is provided, filter duplicate events
      opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory<NostrEvent>()),
      // Only create one upstream subscription
      share(),
    );
  }

  /** Count events on all relays in the group */
  count(
    filters: Filter | Filter[],
    id = nanoid(),
    opts?: Parameters<Relay["count"]>[2],
  ): Observable<Record<string, RelayCountResponse>> {
    return this.relays$.pipe(
      switchMap((relays) =>
        combineLatest(Object.fromEntries(relays.map((relay) => [relay.url, relay.count(filters, id, opts)]))),
      ),
      // Ensure a single upstream
      share(),
    );
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    store: NegentropySyncStore | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
    // D-05: derived from Relay.sync (literal 4 of 5) rather than hand-declared, so a future option
    // added to Relay.sync propagates here automatically.
    opts?: Parameters<Relay["sync"]>[3],
  ): Observable<NostrEvent> {
    // Get an array of relays that support NIP-77 negentropy sync
    return defer(async () => {
      const supported = await Promise.all(
        this.relays.map(async (relay) => [relay, await relay.getSupported()] as const),
      );
      const relays = supported.filter(([_, supported]) => supported?.includes(77)).map(([relay]) => relay);
      if (relays.length === 0) throw new Error("No relays support NIP-77 negentropy sync");
      return relays;
    }).pipe(
      // Once relays are selected, sync all the relays in parallel
      switchMap((relays) =>
        merge(
          ...relays.map((relay) =>
            relay.sync(store, filter, direction, opts).pipe(
              // D-19: isolate one relay's sync failure so it doesn't end the sync for the rest of the
              // group, matching the fan-out fidelity the REQ path and publish path already have.
              // sync() has no error channel (Observable<NostrEvent>), so the dropped relay is visible
              // in debug output only — a status channel for it remains out of scope (resolved by
              // Phase 14/ALOG-02 as a logging-only diagnostic, not a new observable).
              catchError((err) => {
                const reason = RELAY_AUTH_ERROR_NAMES.has(err?.name)
                  ? `an auth failure (${err.name})`
                  : err?.message || "an unknown error";
                this.log(`Dropped relay ${relay.url} from group sync: ${reason}`, err);
                return EMPTY;
              }),
            ),
          ),
        ),
      ),
      // Only create one upstream subscription
      share(),
    );
  }

  /**
   * Creates a complete condition that waits for the first EOSE message from a relay and then starts a timeout for the remaining relays
   * @param timeout - The timeout in milliseconds for the remaining relays
   */
  static completeAfterFirstRelay(timeout = 5_000): GroupRequestCompleteOperator {
    return (source) =>
      // Listen for first EOSE message from a relay
      source.pipe(filter((m) => m.type === "EOSE")).pipe(
        // Ignore all other EOSE messages
        take(1),
        // Start a timeout for the remaining relays
        switchMap(() => timer(timeout)),
        // Emit true when the timeout completes
        map(() => true),
      );
  }

  /** Creates a group request complete operator that waits for all relays to send an EOSE message or timeout */
  static completeOnAllEose(): GroupRequestCompleteOperator {
    return (source) =>
      source.pipe(
        // Filter for relay status messages
        filter((message) => message.type === "OPEN" || message.type === "EOSE" || message.type === "ERROR"),
        // Accumulate the relay status messages
        scan((acc, message) => acc.set(message.from, message.type), new Map<string, "EOSE" | "ERROR" | "OPEN">()),
        // Emit true when all relays are no longer OPEN
        map((all) => Array.from(all.values()).every((t) => t !== "OPEN")),
      );
  }

  /** A group request complete condition that completes when any of the provided conditions are truthy (OR) */
  static completeOnAny(...conditions: GroupRequestCompleteOperator[]): GroupRequestCompleteOperator {
    return connect((shared$) =>
      // Merge all the conditions
      merge(...conditions.map((condition) => shared$.pipe(condition))),
    );
  }

  /** A group request complete condition that completes when any of the provided conditions are truthy (AND) */
  static completeOnAll(...conditions: GroupRequestCompleteOperator[]): GroupRequestCompleteOperator {
    return connect((shared$) =>
      // Get last state from all conditions
      combineLatest(conditions.map((condition) => shared$.pipe(condition))).pipe(
        // Check all values are truthy
        map((all) => all.every((v) => !!v)),
      ),
    );
  }
}
