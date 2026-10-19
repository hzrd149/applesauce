import type { NostrEvent } from "applesauce-core/helpers/event";
import { Filter, isFilterEqual } from "applesauce-core/helpers/filter";
import { createFilterMap, FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import { normalizeURL } from "applesauce-core/helpers/url";
import { combineLatestByValue } from "applesauce-core/observable";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  isObservable,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
} from "rxjs";
import { RelayGroup } from "./group.js";
import type { PoolLivenessSource } from "./liveness.js";
import { Relay, type RelayOptions, SyncDirection } from "./relay.js";
import type {
  FilterInput,
  GroupReqMessage,
  GroupReqOptions,
  NegentropySyncStore,
  PoolRelayInput,
  PublishResponse,
  RelayStatus,
} from "./types.js";

/** Options for a {@link RelayPool} */
export type RelayPoolOptions = RelayOptions & {
  /** Liveness sources whose unhealthy relays are skipped, subscriptions re-add relays once they recover */
  liveness?: PoolLivenessSource | PoolLivenessSource[];
};

export class RelayPool {
  relays$ = new BehaviorSubject<Map<string, Relay>>(new Map());
  get relays() {
    return this.relays$.value;
  }

  /** A stream of current relay statuses that preserves subscriptions for unchanged relays */
  status$: Observable<Record<string, RelayStatus>>;

  /** A signal when a relay is added */
  add$ = new Subject<Relay>();
  /** A signal when a relay is removed */
  remove$ = new Subject<Relay>();

  /** A signal when a relay is added */
  added$ = this.add$.asObservable();
  /** A signal when a relay is removed */
  removed$ = this.remove$.asObservable();

  /** The liveness sources used to skip unhealthy relays */
  readonly liveness: PoolLivenessSource[];
  /** The options passed to each new relay */
  options?: RelayOptions;

  constructor(options?: RelayPoolOptions) {
    const { liveness, ...relayOptions } = options ?? {};
    this.options = options ? relayOptions : undefined;
    this.liveness = liveness ? (Array.isArray(liveness) ? liveness : [liveness]) : [];

    // Initialize status$ observable
    this.status$ = this.relays$.pipe(
      // Convert Map to array of relays
      map((relayMap) => Array.from(relayMap.values())),
      // Retain unchanged branches and batch synchronous initial statuses on membership changes.
      combineLatestByValue((relay) => relay.status$),
      map((statuses) => Object.fromEntries(Array.from(statuses.values(), (status) => [status.url, status]))),
      shareReplay(1),
    );

    // Let liveness sources track the pool's relays
    for (const source of this.liveness) source.connectToPool?.(this);
  }

  /** Removes relays that any liveness source currently considers unhealthy */
  filterRelays(relays: string[]): string[] {
    for (const source of this.liveness) relays = source.filter(relays);
    return relays;
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

  /** Create a group of relays, skipping relays the liveness sources currently consider unhealthy */
  group(relays: PoolRelayInput): RelayGroup {
    // Filter each list once as it arrives so one-shot requests keep a stable cohort and can settle
    const input: Relay[] | Observable<Relay[]> = Array.isArray(relays)
      ? this.filterRelays(relays).map((url) => this.relay(url))
      : relays.pipe(map((urls) => this.filterRelays(urls).map((url) => this.relay(url))));

    return new RelayGroup(input);
  }

  /** Creates a group that re-filters its relays whenever a liveness source changes, so recovered relays rejoin */
  protected liveGroup(relays: PoolRelayInput): RelayGroup {
    if (this.liveness.length === 0) return this.group(relays);

    // unhealthy$ is only a change signal, the current exclusions are always read from filter()
    const changes$ = merge(...this.liveness.map((source) => source.unhealthy$)).pipe(startWith(undefined));
    const input$ = isObservable(relays) ? relays : of(relays);

    return new RelayGroup(
      combineLatest([input$, changes$]).pipe(
        map(([urls]) => this.filterRelays(urls)),
        distinctUntilChanged((a, b) => a.length === b.length && a.every((url, i) => url === b[i])),
        map((urls) => urls.map((url) => this.relay(url))),
      ),
    );
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
    return this.liveGroup(relays).req(filters, opts);
  }

  /** Send an EVENT message to multiple relays */
  event(relays: PoolRelayInput, event: NostrEvent): Observable<PublishResponse> {
    return this.group(relays).event(event);
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
  ): ReturnType<RelayGroup["request"]> {
    return this.group(relays).request(filters, opts);
  }

  /** Open a subscription to multiple relays */
  subscription(
    relays: PoolRelayInput,
    filters: Parameters<RelayGroup["subscription"]>[0],
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): ReturnType<RelayGroup["subscription"]> {
    return this.liveGroup(relays).subscription(filters, options);
  }

  /** Open a subscription for a map of relays and filters */
  subscriptionMap(
    relays: FilterMap | Observable<FilterMap>,
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<NostrEvent> {
    // Convert input to observable
    const relays$ = isObservable(relays) ? relays : of(relays);

    return this.liveGroup(
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
  ): ReturnType<RelayGroup["count"]> {
    return this.group(relays).count(filters, id, opts);
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    relays: PoolRelayInput,
    store: NegentropySyncStore | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
    // D-05: derived from RelayGroup.sync (literal 5 of 5, the last hand-declared option literal) so a
    // future option added there reaches the pool surface automatically.
    opts?: Parameters<RelayGroup["sync"]>[3],
  ): ReturnType<RelayGroup["sync"]> {
    return this.group(relays).sync(store, filter, direction, opts);
  }
}
