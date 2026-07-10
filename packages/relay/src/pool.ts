import type { NostrEvent } from "applesauce-core/helpers/event";
import { Filter, isFilterEqual } from "applesauce-core/helpers/filter";
import { createFilterMap, FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import { normalizeURL } from "applesauce-core/helpers/url";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  isObservable,
  map,
  merge,
  Observable,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
} from "rxjs";
import { RelayGroup } from "./group.js";
import type { NegentropySyncOptions, ReconcileFunction } from "./negentropy.js";
import { Relay, type RelayOptions, SyncDirection } from "./relay.js";
import type {
  AuthRequirement,
  FilterInput,
  GroupReqMessage,
  GroupReqOptions,
  NegentropyReadStore,
  NegentropySyncStore,
  PoolRelayInput,
  PublishResponse,
  RelayCountResponse,
  RelayStatus,
} from "./types.js";

export class RelayPool {
  relays$ = new BehaviorSubject<Map<string, Relay>>(new Map());
  get relays() {
    return this.relays$.value;
  }

  /** Observable of relay status for all relays in the pool */
  status$: Observable<Record<string, RelayStatus>>;

  /**
   * Whether to ignore relays that are ready=false
   * @deprecated use {@link ignoreUnhealthyRelays} in group() or request() input
   */
  ignoreOffline = false;

  /** A signal when a relay is added */
  add$ = new Subject<Relay>();
  /** A signal when a relay is removed */
  remove$ = new Subject<Relay>();

  constructor(public options?: RelayOptions) {
    // Initialize status$ observable
    this.status$ = this.relays$.pipe(
      // Convert Map to array of relays
      map((relayMap) => Array.from(relayMap.values())),
      // Use same pattern as RelayGroup
      switchMap((relays) => {
        if (relays.length === 0) return of({} as Record<string, RelayStatus>);

        return merge(...relays.map((relay) => relay.status$)).pipe(
          scan(
            (acc, status) => ({
              ...acc,
              [status.url]: status,
            }),
            {} as Record<string, RelayStatus>,
          ),
          startWith({} as Record<string, RelayStatus>),
        );
      }),
      shareReplay(1),
    );
  }

  /** Get or create a new relay connection */
  relay(url: string): Relay {
    // Normalize the url
    url = normalizeURL(url);

    // Check if the relay already exists
    let relay = this.relays.get(url);
    if (relay) return relay;

    // Create a new relay
    relay = new Relay(url, this.options);
    this.relays.set(url, relay);
    this.relays$.next(this.relays);
    this.add$.next(relay);
    return relay;
  }

  /** Create a group of relays */
  group(relays: PoolRelayInput, ignoreOffline = this.ignoreOffline): RelayGroup {
    let input: Relay[] | Observable<Relay[]> = Array.isArray(relays)
      ? relays.map((url) => this.relay(url))
      : relays.pipe(map((urls) => urls.map((url) => this.relay(url))));

    if (ignoreOffline) {
      // Convert input to an observable so it can react to relays becoming ready.
      // Each relay is included once `ready$` first emits true, and stays included
      // afterwards (subsequent ready=false changes are ignored since the request
      // or subscription will have already started).
      const input$ = Array.isArray(input) ? of(input) : input;
      input = input$.pipe(
        switchMap((relays) => {
          if (relays.length === 0) return of([] as Relay[]);
          const signals = relays.map((relay) =>
            relay.ready$.pipe(
              filter((ready) => ready),
              take(1),
              map(() => relay),
              startWith(null as Relay | null),
            ),
          );
          return combineLatest(signals).pipe(map((arr) => arr.filter((r): r is Relay => r !== null)));
        }),
      );
    }

    return new RelayGroup(input);
  }

  /** Removes a relay from the pool and defaults to closing the connection */
  remove(relay: string | Relay, close = true): void {
    let instance: Relay | undefined;
    if (typeof relay === "string") {
      instance = this.relays.get(relay);
      if (!instance) return;
    } else if (Array.from(this.relays.values()).some((r) => r === relay)) {
      instance = relay;
    } else return;

    if (close) instance?.close();
    this.relays.delete(instance.url);
    this.relays$.next(this.relays);
    this.remove$.next(instance);
  }

  /** Closes and removes every relay in the pool, tearing down all of their connections and timers */
  close(): void {
    for (const relay of [...this.relays.values()]) this.remove(relay, true);
  }

  /** Make a REQ to multiple relays that does not deduplicate events */
  req(relays: PoolRelayInput, filters: FilterInput, opts?: GroupReqOptions): Observable<GroupReqMessage> {
    return this.group(relays).req(filters, opts);
  }

  /** Send an EVENT message to multiple relays */
  event(
    relays: PoolRelayInput,
    event: NostrEvent,
    opts?: Parameters<RelayGroup["event"]>[1],
  ): Observable<PublishResponse> {
    return this.group(relays).event(event, opts);
  }

  /** Negentropy sync event ids with the relays and an event store */
  negentropy(
    relays: PoolRelayInput,
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean> {
    return this.group(relays).negentropy(store, filter, reconcile, opts);
  }

  /** Publish an event to multiple relays */
  publish(
    relays: PoolRelayInput,
    event: Parameters<RelayGroup["publish"]>[0],
    opts?: Parameters<RelayGroup["publish"]>[1],
  ): Promise<PublishResponse[]> {
    return this.group(relays).publish(event, opts);
  }

  /** Request events from multiple relays */
  request(
    relays: PoolRelayInput,
    filters: Parameters<RelayGroup["request"]>[0],
    opts?: Parameters<RelayGroup["request"]>[1],
  ): Observable<NostrEvent> {
    return this.group(relays).request(filters, opts);
  }

  /** Open a subscription to multiple relays */
  subscription(
    relays: PoolRelayInput,
    filters: Parameters<RelayGroup["subscription"]>[0],
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<NostrEvent> {
    return this.group(relays).subscription(filters, options);
  }

  /** Open a subscription for a map of relays and filters */
  subscriptionMap(
    relays: FilterMap | Observable<FilterMap>,
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<NostrEvent> {
    // Convert input to observable
    const relays$ = isObservable(relays) ? relays : of(relays);

    return this.group(
      // Create a group with an observable of dynamic relay urls
      relays$.pipe(map((dir) => Object.keys(dir))),
    ).subscription((relay) => {
      // Return observable to subscribe to the relays unique filters
      return relays$.pipe(
        // Select the relays filters
        map((dir) => dir[relay.url]),
        // Don't send duplicate filters
        distinctUntilChanged(isFilterEqual),
      );
    }, options);
  }

  /** Open a subscription for an {@link OutboxMap} and filter */
  outboxSubscription(
    outboxes: OutboxMap | Observable<OutboxMap>,
    filter: Omit<Filter, "authors">,
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<NostrEvent> {
    const filterMap = isObservable(outboxes)
      ? outboxes.pipe(
          // Project outbox map to filter map
          map((outboxes) => createFilterMap(outboxes, filter)),
        )
      : createFilterMap(outboxes, filter);

    return this.subscriptionMap(filterMap, options);
  }

  /** Count events on multiple relays */
  count(
    relays: PoolRelayInput,
    filters: Filter | Filter[],
    id?: string,
    opts?: Parameters<RelayGroup["count"]>[2],
  ): Observable<Record<string, RelayCountResponse>> {
    // Never filter out offline relays in manual methods
    return this.group(relays, false).count(filters, id, opts);
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    relays: PoolRelayInput,
    store: NegentropySyncStore | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
    opts?: { waitForAuth?: AuthRequirement },
  ): Observable<NostrEvent> {
    // Never filter out offline relays in manual methods
    return this.group(relays, false).sync(store, filter, direction, opts);
  }
}
