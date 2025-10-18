import { nanoid } from "nanoid";
import { Filter, type NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defaultIfEmpty,
  defer,
  endWith,
  filter,
  from,
  identity,
  ignoreElements,
  lastValueFrom,
  map,
  merge,
  MonoTypeOperatorFunction,
  Observable,
  of,
  scan,
  share,
  switchMap,
  take,
  takeWhile,
  toArray,
} from "rxjs";

import {
  EventMemory,
  filterDuplicateEvents,
  IAsyncEventStoreActions,
  IAsyncEventStoreRead,
  IEventStoreActions,
  IEventStoreRead,
} from "applesauce-core";
import { NegentropySyncOptions, type ReconcileFunction } from "./negentropy.js";
import { completeOnEose } from "./operators/complete-on-eose.js";
import { onlyEvents } from "./operators/only-events.js";
import { reverseSwitchMap } from "./operators/reverse-switch-map.js";
import { SyncDirection } from "./relay.js";
import {
  CountResponse,
  FilterInput,
  IGroup,
  IGroupRelayInput,
  IRelay,
  PublishOptions,
  PublishResponse,
  RequestOptions,
  SubscriptionOptions,
  SubscriptionResponse,
} from "./types.js";

/** Options for negentropy sync on a group of relays */
export type GroupNegentropySyncOptions = NegentropySyncOptions & {
  /** Whether to sync in parallel (default true) */
  parallel?: boolean;
};

/** Options for a subscription on a group of relays */
export type GroupSubscriptionOptions = SubscriptionOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};

/** Options for a request on a group of relays */
export type GroupRequestOptions = RequestOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};

/** Convert an error to a PublishResponse */
function errorToPublishResponse(relay: IRelay): MonoTypeOperatorFunction<PublishResponse> {
  return catchError((err) =>
    of({ ok: false, from: relay.url, message: err?.message || "Unknown error" } satisfies PublishResponse),
  );
}

export class RelayGroup implements IGroup {
  protected relays$: BehaviorSubject<IRelay[]> | Observable<IRelay[]> = new BehaviorSubject<IRelay[]>([]);
  get relays(): IRelay[] {
    if (this.relays$ instanceof BehaviorSubject) return this.relays$.value;
    throw new Error("This group was created with an observable, relays are not available");
  }

  constructor(relays: IGroupRelayInput) {
    this.relays$ = Array.isArray(relays) ? new BehaviorSubject(relays) : relays;
  }

  /** Whether this group is controlled by an upstream observable */
  private get controlled() {
    return this.relays$ instanceof BehaviorSubject === false;
  }

  /** Check if a relay is in the group */
  public has(relay: IRelay | string): boolean {
    if (this.controlled) throw new Error("This group was created with an observable, relays are not available");

    if (typeof relay === "string") return this.relays.some((r) => r.url === relay);
    return this.relays.includes(relay);
  }

  /** Add a relay to the group */
  public add(relay: IRelay): void {
    if (this.has(relay)) return;
    (this.relays$ as BehaviorSubject<IRelay[]>).next([...this.relays, relay]);
  }

  /** Remove a relay from the group */
  public remove(relay: IRelay): void {
    if (!this.has(relay)) return;
    (this.relays$ as BehaviorSubject<IRelay[]>).next(this.relays.filter((r) => r !== relay));
  }

  /** Internal logic for handling requests to multiple relays */
  protected internalSubscription(
    project: (relay: IRelay) => Observable<SubscriptionResponse>,
    eventOperator: MonoTypeOperatorFunction<NostrEvent> = identity,
  ): Observable<SubscriptionResponse> {
    // Keep a cache of upstream observables for each relay
    const upstream = new WeakMap<IRelay, Observable<readonly [IRelay, SubscriptionResponse]>>();

    // Subscribe to the group relays
    const main = this.relays$.pipe(
      // Every time they change switch to a new observable
      // Using reverseSwitchMap to subscribe to the new relays before unsubscribing from the old ones
      // This avoids sending duplicate REQ messages to the relays
      reverseSwitchMap((relays) => {
        const observables: Observable<readonly [IRelay, SubscriptionResponse]>[] = [];
        for (const relay of relays) {
          // If an upstream observable exists for this relay, use it
          if (upstream.has(relay)) {
            observables.push(upstream.get(relay)!);
            continue;
          }

          const observable = project(relay).pipe(
            // Catch connection errors and return EOSE
            catchError(() => of("EOSE" as const)),
            // Map values into tuple of relay and value
            map((value) => [relay, value] as const),
          );
          observables.push(observable);
          upstream.set(relay, observable);
        }
        return merge(...observables);
      }),
      // Only create one upstream subscription
      share(),
    );

    // Create an observable that only emits the events from the relays
    const events = main.pipe(
      // Pick the value from the tuple
      map(([_, value]) => value),
      // Only return events
      onlyEvents(),
      // Add event operations
      eventOperator,
    );

    // Create an observable that emits EOSE when all relays have sent EOSE
    const eose = this.relays$.pipe(
      // When the relays change, switch to a new observable
      switchMap((relays) =>
        // Subscribe to the events, and wait for EOSE from all relays
        main.pipe(
          // Only select EOSE messages
          filter(([_, value]) => value === "EOSE"),
          // Track the relays that have sent EOSE
          scan((received, [relay]) => [...received, relay], [] as IRelay[]),
          // Keep the observable open while there are relays that have not sent EOSE
          takeWhile((received) => relays.some((r) => !received.includes(r))),
          // Ignore all values
          ignoreElements(),
          // When all relays have sent EOSE, emit EOSE
          endWith("EOSE" as const),
        ),
      ),
    );

    return merge(events, eose).pipe(
      // Ensure a single upstream
      share(),
    );
  }

  /** Internal logic for handling publishes to multiple relays */
  protected internalPublish(project: (relay: IRelay) => Observable<PublishResponse>): Observable<PublishResponse> {
    // Keep a cache of upstream observables for each relay
    const upstream = new WeakMap<IRelay, Observable<PublishResponse>>();

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
      // Ensure a single upstream
      share(),
    );
  }

  /**
   * Make a request to all relays
   * @note This does not deduplicate events
   */
  req(
    filters: FilterInput,
    id = nanoid(),
    opts?: {
      /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
      eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
    },
  ): Observable<SubscriptionResponse> {
    return this.internalSubscription(
      (relay) => relay.req(filters, id),
      opts?.eventStore ? filterDuplicateEvents(opts?.eventStore) : identity,
    );
  }

  /** Send an event to all relays */
  event(event: NostrEvent): Observable<PublishResponse> {
    return this.internalPublish((relay) => relay.event(event));
  }

  /** Negentropy sync events with the relays and an event store */
  async negentropy(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
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

  /** Request events from all relays and complete on EOSE */
  request(filters: FilterInput, opts?: GroupRequestOptions): Observable<NostrEvent> {
    return this.internalSubscription(
      (relay) =>
        relay.request(filters, opts).pipe(
          // Simulate EOSE on completion
          endWith("EOSE" as SubscriptionResponse),
        ),
      // If an event store is provided, filter duplicate events
      opts?.eventStore == null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
    ).pipe(
      // Complete when all relays have sent EOSE
      completeOnEose(),
    );
  }

  /** Open a subscription to all relays with retries ( default 3 retries ) */
  subscription(filters: FilterInput, opts?: GroupSubscriptionOptions): Observable<SubscriptionResponse> {
    return this.internalSubscription(
      (relay) => relay.subscription(filters, opts),
      // If an event store is provided, filter duplicate events
      opts?.eventStore == null ? identity : filterDuplicateEvents(opts?.eventStore ?? new EventMemory()),
    );
  }

  /** Count events on all relays in the group */
  count(filters: Filter | Filter[], id = nanoid()): Observable<Record<string, CountResponse>> {
    return this.relays$.pipe(
      switchMap((relays) =>
        combineLatest(Object.fromEntries(relays.map((relay) => [relay.url, relay.count(filters, id)]))),
      ),
      // Ensure a single upstream
      share(),
    );
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
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
      switchMap((relays) => merge(...relays.map((relay) => relay.sync(store, filter, direction)))),
      // Only create one upstream subscription
      share(),
    );
  }
}
