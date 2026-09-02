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
  filter,
  from,
  identity,
  lastValueFrom,
  map,
  merge,
  MonoTypeOperatorFunction,
  Observable,
  of,
  ReplaySubject,
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
import { RELAY_REQ_LIFECYCLE } from "./internal.js";
import { AuthPhaseGate, authSuspendableLifetime } from "./operators/auth-retry.js";
import { reverseSwitchMap } from "./operators/reverse-switch-map.js";
import { isReqProgress, Relay, SyncDirection } from "./relay.js";
import {
  FilterInput,
  GroupRelayInput,
  GroupReqErrorMessage,
  GroupReqMessage,
  GroupReqOptions,
  GroupRequestCompleteOperator,
  GroupRequestOptions,
  GroupSubscriptionOptions,
  GroupSyncMessage,
  NegentropySyncStore,
  PublishOptions,
  PublishResponse,
  RelayCountResponse,
  RelayCountOutcomes,
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

/** Legacy exported progress classifier retained for compatibility (Phase 13 residual 999.18 WR-07). */
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
      let order: string[] = [];
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
        ? messages.pipe(complete, filter(Boolean), take(1)).subscribe({
            next: () => finish("complete"),
            error: (error) => finish("error", error),
          })
        : Subscription.EMPTY;

      const membershipSubscription = this.relays$.subscribe({
        next: (relays) => {
          if (settled) return;
          const normalized = new Map<string, Relay>();
          for (const relay of relays) normalized.set(normalizeURL(relay.url), relay);
          order = [...normalized.keys()];

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
          }
          // Install the complete replacement cohort before subscribing any new inner: a
          // synchronous failure must be evaluated against every newly-active URL.
          for (const [url, relay] of normalized) {
            if (relaySubscriptions.has(url)) continue;
            const relaySubscription = defer(() => project(relay)).subscribe({
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
        typeof relay[RELAY_REQ_LIFECYCLE] === "function"
          ? relay[RELAY_REQ_LIFECYCLE](filters, { ...opts, reconnect: opts?.reconnect ?? relay.requestReconnect }, gate)
          : relay.req(filters, opts as GroupReqOptions),
      complete,
    ).pipe(
      // Suspend the whole-operation clock across auth. This lifetime consumes no values, so neither
      // synthetic OPEN nor manufactured ERROR can disarm or reset it.
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
    return this.settledSubscription(
      "subscription",
      // NOTE: we need to use the .req() method here because it returns the full RelayReqResponse object
      (relay) =>
        typeof relay[RELAY_REQ_LIFECYCLE] === "function"
          ? relay[RELAY_REQ_LIFECYCLE](filters, { ...opts, reconnect: opts?.reconnect ?? relay.subscriptionReconnect })
          : relay.req(filters, opts as GroupReqOptions),
    ).pipe(
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
  ): Observable<RelayCountOutcomes> {
    const EMPTY_RETRACTION = Symbol("EMPTY_RETRACTION");
    type InternalValue = RelayCountOutcomes | typeof EMPTY_RETRACTION;

    const operation = new Observable<InternalValue>((subscriber) => {
      const active = new Map<string, { relay: Relay; token: symbol; sub: Subscription }>();
      const outcomes = new Map<string, RelayOutcome<RelayCountResponse>>();
      let order: string[] = [];
      let emitted = false;

      const snapshot = (): RelayCountOutcomes =>
        Object.fromEntries(order.filter((url) => outcomes.has(url)).map((url) => [url, outcomes.get(url)!]));
      const finishIfSettled = () => {
        if (order.every((url) => outcomes.has(url))) {
          if (order.length === 0) subscriber.next(EMPTY_RETRACTION);
          subscriber.complete();
        }
      };

      const membership = this.relays$.subscribe({
        next: (relays) => {
          const latest = new Map<string, Relay>();
          for (const relay of relays) {
            const url = normalizeURL(relay.url);
            latest.delete(url);
            latest.set(url, relay);
          }
          const nextOrder = [...latest.keys()];
          const changed =
            order.length !== nextOrder.length ||
            nextOrder.some((url, index) => order[index] !== url || active.get(url)?.relay !== latest.get(url));

          for (const [url, entry] of active) {
            const relay = latest.get(url);
            if (!relay || relay !== entry.relay) {
              entry.sub.unsubscribe();
              active.delete(url);
              outcomes.delete(url);
            }
          }
          order = nextOrder;
          if (changed && emitted) subscriber.next(outcomes.size > 0 ? snapshot() : EMPTY_RETRACTION);
          if (order.length === 0) return finishIfSettled();

          for (const [url, relay] of latest) {
            if (active.has(url) || outcomes.has(url)) continue;
            const token = Symbol(url);
            const entry = { relay, token, sub: Subscription.EMPTY };
            active.set(url, entry);
            const settle = (outcome: RelayOutcome<RelayCountResponse>) => {
              if (active.get(url)?.token !== token) return;
              outcomes.set(url, outcome);
              emitted = true;
              subscriber.next(snapshot());
              finishIfSettled();
            };
            entry.sub = defer(() => relay.count(filters, id, opts)).subscribe({
              next: (value) => settle({ ok: true, value }),
              error: (error) => settle({ ok: false, error }),
            });
          }
          finishIfSettled();
        },
        error: (error) => subscriber.error(error),
        complete: () => finishIfSettled(),
      });

      return () => {
        membership.unsubscribe();
        for (const entry of active.values()) entry.sub.unsubscribe();
      };
    }).pipe(
      share({ connector: () => new ReplaySubject<InternalValue>(1), resetOnComplete: false, resetOnError: false, resetOnRefCountZero: true }),
    );

    return operation.pipe(filter((value): value is RelayCountOutcomes => value !== EMPTY_RETRACTION));
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    store: NegentropySyncStore | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
    // D-05: derived from Relay.sync (literal 4 of 5) rather than hand-declared, so a future option
    // added to Relay.sync propagates here automatically.
    opts?: Parameters<Relay["sync"]>[3],
  ): Observable<GroupSyncMessage> {
    return new Observable<GroupSyncMessage>((subscriber) => {
      const active = new Map<string, { relay: Relay; token: symbol; subscription: Subscription }>();
      let processingMembership = false;

      const finishIfIdle = () => {
        if (!processingMembership && active.size === 0) subscriber.complete();
      };
      const membership = this.relays$.subscribe({
        next: (relays) => {
          if (subscriber.closed) return;
          processingMembership = true;
          const latest = new Map<string, Relay>();
          for (const relay of relays) latest.set(normalizeURL(relay.url), relay);

          for (const [url, entry] of active) {
            if (latest.get(url) !== entry.relay) {
              entry.subscription.unsubscribe();
              active.delete(url);
            }
          }

          const additions: Array<[string, Relay, symbol]> = [];
          for (const [url, relay] of latest) {
            if (active.has(url)) continue;
            const token = Symbol(url);
            active.set(url, { relay, token, subscription: Subscription.EMPTY });
            additions.push([url, relay, token]);
          }

          for (const [url, relay, token] of additions) {
            const subscription = defer(() => from(relay.getSupported())).pipe(
              switchMap((supported) => {
                if (!supported?.includes(77)) throw new Error("Relay does not support NIP-77");
                return relay.sync(store, filter, direction, opts);
              }),
              catchError((error) => {
                const reason = RELAY_AUTH_ERROR_NAMES.has(error?.name)
                  ? `an auth failure (${error.name})`
                  : error?.message || "an unknown error";
                this.log(`Dropped relay ${relay.url} from group sync: ${reason}`, error);
                return of({ type: "relay-failed", from: url, error } satisfies GroupSyncMessage);
              }),
            ).subscribe({
              next: (message) => {
                if (active.get(url)?.token === token) subscriber.next(message);
              },
              complete: () => {
                if (active.get(url)?.token !== token) return;
                active.delete(url);
                finishIfIdle();
              },
            });
            if (active.get(url)?.token === token) active.get(url)!.subscription = subscription;
            else subscription.unsubscribe();
          }
          processingMembership = false;
          finishIfIdle();
        },
        error: (error) => subscriber.error(error),
        complete: finishIfIdle,
      });

      return () => {
        membership.unsubscribe();
        for (const entry of active.values()) entry.subscription.unsubscribe();
      };
    }).pipe(share());
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
