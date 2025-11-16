import type { IAsyncEventStoreRead, IEventStoreRead } from "applesauce-core";
import {
  createFilterMap,
  FilterMap,
  isFilterEqual,
  normalizeURL,
  OutboxMap,
  type FilterWithAnd,
} from "applesauce-core/helpers";
import { Filter, type NostrEvent } from "nostr-tools";
import { BehaviorSubject, distinctUntilChanged, isObservable, map, Observable, of, Subject } from "rxjs";

import { RelayGroup } from "./group.js";
import type { NegentropySyncOptions, ReconcileFunction } from "./negentropy.js";
import { Relay, SyncDirection, type RelayOptions } from "./relay.js";
import type {
  CountResponse,
  FilterInput,
  IPool,
  IPoolRelayInput,
  IRelay,
  PublishResponse,
  SubscriptionResponse,
} from "./types.js";

export class RelayPool implements IPool {
  relays$ = new BehaviorSubject<Map<string, Relay>>(new Map());
  get relays() {
    return this.relays$.value;
  }

  /** A signal when a relay is added */
  add$ = new Subject<IRelay>();
  /** A signal when a relay is removed */
  remove$ = new Subject<IRelay>();

  constructor(public options?: RelayOptions) {}

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
  group(relays: IPoolRelayInput): RelayGroup {
    return new RelayGroup(
      Array.isArray(relays)
        ? relays.map((url) => this.relay(url))
        : relays.pipe(map((urls) => urls.map((url) => this.relay(url)))),
    );
  }

  /** Removes a relay from the pool and defaults to closing the connection */
  remove(relay: string | IRelay, close = true): void {
    let instance: IRelay | undefined;
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

  /** Make a REQ to multiple relays that does not deduplicate events */
  req(relays: IPoolRelayInput, filters: FilterInput, id?: string): Observable<SubscriptionResponse> {
    return this.group(relays).req(filters, id);
  }

  /** Send an EVENT message to multiple relays */
  event(relays: IPoolRelayInput, event: NostrEvent): Observable<PublishResponse> {
    return this.group(relays).event(event);
  }

  /** Negentropy sync event ids with the relays and an event store */
  negentropy(
    relays: IPoolRelayInput,
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: FilterWithAnd,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean> {
    return this.group(relays).negentropy(store, filter, reconcile, opts);
  }

  /** Publish an event to multiple relays */
  publish(
    relays: IPoolRelayInput,
    event: Parameters<RelayGroup["publish"]>[0],
    opts?: Parameters<RelayGroup["publish"]>[1],
  ): Promise<PublishResponse[]> {
    return this.group(relays).publish(event, opts);
  }

  /** Request events from multiple relays */
  request(
    relays: IPoolRelayInput,
    filters: FilterInput,
    opts?: Parameters<RelayGroup["request"]>[1],
  ): Observable<NostrEvent> {
    return this.group(relays).request(filters, opts);
  }

  /** Open a subscription to multiple relays */
  subscription(
    relays: IPoolRelayInput,
    filters: FilterInput,
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<SubscriptionResponse> {
    return this.group(relays).subscription(filters, options);
  }

  /** Open a subscription for a map of relays and filters */
  subscriptionMap(
    relays: FilterMap | Observable<FilterMap>,
    options?: Parameters<RelayGroup["subscription"]>[1],
  ): Observable<SubscriptionResponse> {
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
  ): Observable<SubscriptionResponse> {
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
    relays: IPoolRelayInput,
    filters: FilterWithAnd | FilterWithAnd[],
    id?: string,
  ): Observable<Record<string, CountResponse>> {
    return this.group(relays).count(filters, id);
  }

  /** Negentropy sync events with the relays and an event store */
  sync(
    relays: IPoolRelayInput,
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: FilterWithAnd,
    direction?: SyncDirection,
  ): Observable<NostrEvent> {
    return this.group(relays).sync(store, filter, direction);
  }
}
