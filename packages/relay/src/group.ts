import { EventMemory } from "applesauce-core/event-store";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import { filterDuplicateEvents } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
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
  scan,
  share,
  shareReplay,
  startWith,
  switchMap,
  take,
  toArray,
} from "rxjs";
import { RequestComplete } from "./helpers/complete-conditions.js";
import { type ReconcileFunction } from "./negentropy.js";
import { reverseSwitchMap } from "./operators/reverse-switch-map.js";
import { Relay, SyncDirection } from "./relay.js";
import {
  CompleteOperator,
  FilterInput,
  GroupNegentropySyncOptions,
  GroupRelayInput,
  GroupReqErrorMessage,
  GroupReqOptions,
  GroupReqMessage,
  GroupRequestOptions,
  GroupSubscriptionOptions,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishOptions,
  PublishResponse,
  RelayCountResponse,
  RelayReqMessage,
  RelayStatus,
} from "./types.js";

/** Convert an error to a PublishResponse */
function errorToPublishResponse(relay: Relay): MonoTypeOperatorFunction<PublishResponse> {
  return catchError((err) =>
    of({ ok: false, from: relay.url, message: err?.message || "Unknown error" } satisfies PublishResponse),
  );
}

export class RelayGroup {
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
  protected internalSubscription(
    project: (relay: Relay) => Observable<RelayReqMessage>,
    completeOperator: CompleteOperator = identity,
  ): Observable<GroupReqMessage> {
    // Keep a cache of upstream observables for each relay
    const upstream = new WeakMap<Relay, Observable<GroupReqMessage>>();

    // Subscribe to the group relays
    return this.relays$.pipe(
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

          const observable = project(relay).pipe(
            // Convert the relay req message by prepending the relay url
            map((m) => ({ ...m, relay: relay.url }) as GroupReqMessage),
            // Catch connection errors and return ERROR
            catchError((err) => of({ type: "ERROR", relay: relay.url, error: err } as GroupReqErrorMessage)),
          );
          observables.push(observable);
          upstream.set(relay, observable);
        }
        return merge(...observables);
      }),
      // Add complete operator
      completeOperator,
      // Only create one upstream subscription
      share(),
    );
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
    );
  }

  /** Send a REQ to all relays and returns all responses */
  req(filters: FilterInput, opts?: GroupReqOptions): Observable<GroupReqMessage> {
    return this.internalSubscription((relay) => relay.req(filters, opts), opts?.complete);
  }

  /** Send an event to all relays */
  event(event: NostrEvent): Observable<PublishResponse> {
    return this.internalPublish((relay) => relay.event(event)).pipe(
      // Ensure a single upstream subscription
      share(),
    );
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
    return this.internalSubscription(
      // NOTE: we need to use the .req() method here because it returns the full RelayReqResponse object
      (relay) =>
        relay.req(
          filters,
          // Manually default to relays reconnect config
          { ...opts, reconnect: opts?.reconnect ?? relay.requestReconnect },
        ),
      // Use provided complete condition or default to waiting for all relays to send EOSE
      opts?.complete ?? RequestComplete.onAllEose(),
    ).pipe(
      // Filter only for event messages
      filter((message) => message.type === "EVENT"),
      // Extract event messages
      map((message) => message.event),
      // If an event store is provided, filter duplicate events
      opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
      // Only create one upstream subscription
      share(),
    );
  }

  /** Open a subscription to all relays with retries ( default 3 retries ) */
  subscription(filters: FilterInput, opts?: GroupSubscriptionOptions): Observable<NostrEvent> {
    return this.internalSubscription(
      // NOTE: we need to use the .req() method here because it returns the full RelayReqResponse object
      (relay) => relay.req(filters, { ...opts, reconnect: opts?.reconnect ?? relay.subscriptionReconnect }),
    ).pipe(
      // Filter only for event messages
      filter((message) => message.type === "EVENT"),
      // Extract event messages
      map((message) => message.event),
      // If an event store is provided, filter duplicate events
      opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
      // Only create one upstream subscription
      share(),
    );
  }

  /** Count events on all relays in the group */
  count(filters: Filter | Filter[], id = nanoid()): Observable<Record<string, RelayCountResponse>> {
    return this.relays$.pipe(
      switchMap((relays) =>
        combineLatest(Object.fromEntries(relays.map((relay) => [relay.url, relay.count(filters, id)]))),
      ),
      // Ensure a single upstream
      share(),
    );
  }

  /** Negentropy sync events with the relays and an event store */
  sync(store: NegentropySyncStore | NostrEvent[], filter: Filter, direction?: SyncDirection): Observable<NostrEvent> {
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
      switchMap((relays) => merge(...relays.map((relay) => relay.sync(store, filter, direction)))),
      // Only create one upstream subscription
      share(),
    );
  }
}
