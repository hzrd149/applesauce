import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import type { GroupNegentropySyncOptions, GroupRequestOptions, GroupSubscriptionOptions } from "applesauce-relay/group";
import type { ReconcileFunction } from "applesauce-relay/negentropy";
import type { SyncDirection } from "applesauce-relay/relay";
import type {
  CountResponse,
  FilterInput,
  IPool,
  IPoolRelayInput,
  IRelay,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishResponse,
  SubscriptionResponse,
} from "applesauce-relay/types";
import { BehaviorSubject, firstValueFrom, fromEvent, isObservable, map, Observable, Subject } from "rxjs";
import { RPCClient } from "../../common/rpc-client.js";
import type { AllRelayCommands } from "../commands.js";
import { RemoteGroup } from "./group.js";
import { RemoteRelay } from "./relay.js";

// Worker type from DOM
type Worker = globalThis.Worker;

/**
 * Remote RelayPool client that implements IPool interface.
 * Communicates with a RelayPool instance running in a web worker via RPC.
 *
 * @example
 * ```typescript
 * const worker = new Worker("./pool-worker.js");
 * const pool = new RemoteRelayPool(worker);
 *
 * pool.subscription(["wss://relay.example.com"], { kinds: [1] })
 *   .subscribe(response => console.log(response));
 * ```
 */
export class RemoteRelayPool implements IPool {
  readonly client: RPCClient<AllRelayCommands>;
  private readonly _relays$ = new BehaviorSubject<Map<string, IRelay>>(new Map());
  private readonly _add$ = new Subject<IRelay>();
  private readonly _remove$ = new Subject<IRelay>();

  constructor(worker: Worker) {
    this.client = new RPCClient<AllRelayCommands>(
      fromEvent<MessageEvent>(worker, "message").pipe(
        map((e) => e.data as import("../../common/interface.js").RPCResponse),
      ),
      (msg) => worker.postMessage(msg),
      "pool",
    );

    // Subscribe to relays$ updates
    this.client.call("poolRelays$", []).subscribe({
      next: (entries) => {
        // Update local relays map
        // Note: We can't fully recreate IRelay objects, so we'll maintain a simplified map
        const newMap = new Map<string, IRelay>();
        for (const [url] of entries) {
          // Try to get existing relay or create a placeholder
          const existing = this._relays$.value.get(url);
          if (existing) {
            newMap.set(url, existing);
          }
        }
        this._relays$.next(newMap);
      },
      error: (err) => console.error("Error in relays$ stream:", err),
    });

    // Subscribe to add$ updates
    this.client.call("poolAdd$", []).subscribe({
      next: ({ url }) => {
        // Create a RemoteRelay for the added relay
        const relay = new RemoteRelay(this.client, url);
        this._relays$.value.set(url, relay);
        this._relays$.next(this._relays$.value);
        this._add$.next(relay);
      },
      error: (err) => console.error("Error in add$ stream:", err),
    });

    // Subscribe to remove$ updates
    this.client.call("poolRemove$", []).subscribe({
      next: ({ url }) => {
        const relay = this._relays$.value.get(url);
        if (relay) {
          this._relays$.value.delete(url);
          this._relays$.next(this._relays$.value);
          this._remove$.next(relay);
        }
      },
      error: (err) => console.error("Error in remove$ stream:", err),
    });
  }

  get relays$(): Observable<Map<string, IRelay>> {
    return this._relays$;
  }

  get relays(): Map<string, IRelay> {
    return this._relays$.value;
  }

  get add$(): Observable<IRelay> {
    return this._add$;
  }

  get remove$(): Observable<IRelay> {
    return this._remove$;
  }

  /**
   * Get or create a relay.
   * Returns a RemoteRelay that forwards calls via RPC.
   */
  relay(url: string): IRelay {
    // Check if we already have a proxy for this relay
    let relay = this._relays$.value.get(url);
    if (relay) {
      return relay;
    }

    // Call RPC to create/get the relay
    this.client.call("poolRelay", [url]).subscribe({
      next: ({ url: relayUrl }) => {
        relay = new RemoteRelay(this.client, relayUrl);
        this._relays$.value.set(relayUrl, relay);
        this._relays$.next(this._relays$.value);
        this._add$.next(relay);
      },
      error: (err) => console.error("Error creating relay:", err),
    });

    // Return immediately - the actual relay will be set asynchronously
    relay = new RemoteRelay(this.client, url);
    this._relays$.value.set(url, relay);
    this._relays$.next(this._relays$.value);
    return relay;
  }

  /**
   * Create a group of relays.
   */
  group(relays: IPoolRelayInput): import("applesauce-relay/types").IGroup {
    // Convert to string array or Observable<string[]>
    if (isObservable(relays)) {
      return new RemoteGroup(this.client, relays.pipe(map((urls) => urls)));
    } else {
      return new RemoteGroup(this.client, relays);
    }
  }

  remove(relay: string | IRelay, close = true): void {
    const url = typeof relay === "string" ? relay : relay.url;
    this.client.call("poolRemove", [url, close]).subscribe({
      error: (err) => console.error("Error removing relay:", err),
    });
  }

  req(relays: IPoolRelayInput, filters: FilterInput, id?: string): Observable<SubscriptionResponse> {
    const urls = isObservable(relays) ? [] : relays; // Simplified - handle Observable case separately
    return this.client.call("poolReq", [urls, filters, id]);
  }

  event(relays: IPoolRelayInput, event: NostrEvent): Observable<PublishResponse> {
    const urls = isObservable(relays) ? [] : relays;
    return this.client.call("poolEvent", [urls, event]);
  }

  async negentropy(
    relays: IPoolRelayInput,
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: GroupNegentropySyncOptions,
  ): Promise<boolean> {
    const urls = isObservable(relays) ? [] : relays;
    // Note: ReconcileFunction may not be serializable - this is a limitation
    const result$ = this.client.call("poolNegentropy", [urls, store, filter, reconcile, opts]);
    return await firstValueFrom(result$);
  }

  async publish(
    relays: IPoolRelayInput,
    event: NostrEvent,
    opts?: Parameters<import("applesauce-relay/types").IGroup["publish"]>[1],
  ): Promise<PublishResponse[]> {
    const urls = isObservable(relays) ? [] : relays;
    const result$ = this.client.call("poolPublish", [urls, event, opts]);
    return await firstValueFrom(result$);
  }

  request(relays: IPoolRelayInput, filters: FilterInput, opts?: GroupRequestOptions): Observable<NostrEvent> {
    const urls = isObservable(relays) ? [] : relays;
    return this.client.call("poolRequest", [urls, filters, opts]);
  }

  subscription(
    relays: IPoolRelayInput,
    filters: FilterInput,
    options?: GroupSubscriptionOptions,
  ): Observable<SubscriptionResponse> {
    const urls = isObservable(relays) ? [] : relays;
    return this.client.call("poolSubscription", [urls, filters, options]);
  }

  count(relays: IPoolRelayInput, filters: Filter | Filter[], id?: string): Observable<Record<string, CountResponse>> {
    const urls = isObservable(relays) ? [] : relays;
    return this.client.call("poolCount", [urls, filters, id]);
  }

  sync(
    relays: IPoolRelayInput,
    store: NegentropySyncStore | NostrEvent[],
    filter: Filter,
    direction?: SyncDirection,
  ): Observable<NostrEvent> {
    const urls = isObservable(relays) ? [] : relays;
    return this.client.call("poolSync", [urls, store, filter, direction]);
  }

  subscriptionMap(
    relays: FilterMap | Observable<FilterMap>,
    options?: GroupSubscriptionOptions,
  ): Observable<SubscriptionResponse> {
    // Convert Observable to FilterMap for RPC
    // Note: This is a limitation - we can't stream FilterMap updates over RPC easily
    const filterMap = isObservable(relays) ? {} : relays;
    return this.client.call("poolSubscriptionMap", [filterMap, options]);
  }

  outboxSubscription(
    outboxes: OutboxMap | Observable<OutboxMap>,
    filter: Omit<Filter, "authors">,
    options?: GroupSubscriptionOptions,
  ): Observable<SubscriptionResponse> {
    const outboxMap = isObservable(outboxes) ? {} : outboxes;
    return this.client.call("poolOutboxSubscription", [outboxMap, filter, options]);
  }
}
