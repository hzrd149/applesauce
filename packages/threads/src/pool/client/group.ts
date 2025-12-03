import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { GroupRequestOptions, GroupSubscriptionOptions } from "applesauce-relay/group";
import type { NegentropySyncOptions, ReconcileFunction } from "applesauce-relay/negentropy";
import type { SyncDirection } from "applesauce-relay/relay";
import type {
  CountResponse,
  FilterInput,
  IGroup,
  IRelay,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishResponse,
  SubscriptionResponse,
} from "applesauce-relay/types";
import { BehaviorSubject, firstValueFrom, Observable } from "rxjs";
import { RPCClient } from "../../common/rpc-client.js";
import type { AllRelayCommands } from "../commands.js";
import { RemoteRelay } from "./relay.js";

/**
 * Remote Group client that implements IGroup interface.
 * Communicates with a RelayGroup instance running in a web worker via RPC.
 *
 * @example
 * ```typescript
 * const worker = new Worker("./pool-worker.js");
 * const pool = new RemoteRelayPool(worker);
 * const group = pool.group(["wss://relay1.com", "wss://relay2.com"]);
 *
 * group.subscription({ kinds: [1] })
 *   .subscribe(response => console.log(response));
 * ```
 */
export class RemoteGroup implements IGroup {
  private readonly _relays$: BehaviorSubject<string[]>;

  constructor(
    private readonly client: RPCClient<AllRelayCommands>,
    relays: string[] | Observable<string[]>,
  ) {
    if (Array.isArray(relays)) {
      this._relays$ = new BehaviorSubject(relays);
    } else {
      // For Observable input, we'll need to track the current value
      // For now, start with empty array and update as values come in
      this._relays$ = new BehaviorSubject<string[]>([]);
      relays.subscribe({
        next: (urls) => this._relays$.next(urls),
        error: (err) => console.error("Error in relay URLs observable:", err),
      });
    }
  }

  get relays(): string[] {
    return this._relays$.value;
  }

  /** Send a REQ message */
  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse> {
    return this.client.call("poolReq", [this._relays$.value, filters, id]);
  }

  /** Send an EVENT message */
  event(event: NostrEvent): Observable<PublishResponse> {
    return this.client.call("poolEvent", [this._relays$.value, event]);
  }

  /** Negentropy sync event ids with the relays and an event store */
  async negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean> {
    const result$ = this.client.call("poolNegentropy", [this._relays$.value, store, filter, reconcile, opts]);
    return await firstValueFrom(result$);
  }

  /** Add a relay to the group */
  add(relay: IRelay | RemoteRelay): void {
    const url = relay.url;
    if (!this.has(url)) {
      this._relays$.next([...this._relays$.value, url]);
    }
  }

  /** Remove a relay from the group */
  remove(relay: IRelay | RemoteRelay | string): void {
    const url = typeof relay === "string" ? relay : relay.url;
    this._relays$.next(this._relays$.value.filter((u) => u !== url));
  }

  /** Check if a relay is in the group */
  has(relay: IRelay | RemoteRelay | string): boolean {
    const url = typeof relay === "string" ? relay : relay.url;
    return this._relays$.value.includes(url);
  }

  /** Send an EVENT message with retries */
  async publish(event: NostrEvent, opts?: import("applesauce-relay/types").PublishOptions): Promise<PublishResponse[]> {
    const result$ = this.client.call("poolPublish", [this._relays$.value, event, opts]);
    return await firstValueFrom(result$);
  }

  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: GroupRequestOptions): Observable<NostrEvent> {
    return this.client.call("poolRequest", [this._relays$.value, filters, opts]);
  }

  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: GroupSubscriptionOptions): Observable<SubscriptionResponse> {
    return this.client.call("poolSubscription", [this._relays$.value, filters, opts]);
  }

  /** Count events on the relays and an event store */
  count(filters: Filter | Filter[], id?: string): Observable<Record<string, CountResponse>> {
    return this.client.call("poolCount", [this._relays$.value, filters, id]);
  }

  /** Negentropy sync events with the relay and an event store */
  sync(store: NegentropySyncStore, filter: Filter, direction?: SyncDirection): Observable<NostrEvent> {
    return this.client.call("poolSync", [this._relays$.value, store, filter, direction]);
  }
}
