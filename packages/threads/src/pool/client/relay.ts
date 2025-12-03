import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { ReconcileFunction } from "applesauce-relay/negentropy";
import type { SyncDirection } from "applesauce-relay/relay";
import type {
  CountResponse,
  FilterInput,
  IRelay,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishResponse,
  SubscriptionResponse,
} from "applesauce-relay/types";
import { firstValueFrom, map, Observable } from "rxjs";
import { RPCClient } from "../../common/rpc-client.js";
import type { AllRelayCommands } from "../commands.js";

/**
 * Remote Relay client that implements IRelay interface.
 * Communicates with a Relay instance running in a web worker via RPC.
 *
 * @example
 * ```typescript
 * const worker = new Worker("./pool-worker.js");
 * const pool = new RemoteRelayPool(worker);
 * const relay = pool.relay("wss://relay.example.com");
 *
 * relay.subscription({ kinds: [1] })
 *   .subscribe(response => console.log(response));
 * ```
 */
export class RemoteRelay implements IRelay {
  readonly url: string;

  constructor(
    private readonly client: RPCClient<AllRelayCommands>,
    url: string,
  ) {
    this.url = url;
  }

  // Observable properties
  get message$(): Observable<any> {
    return this.client.call("relayMessage$", [this.url]);
  }

  get notice$(): Observable<string> {
    return this.client.call("relayNotice$", [this.url]);
  }

  get connected$(): Observable<boolean> {
    return this.client.call("relayConnected$", [this.url]);
  }

  get challenge$(): Observable<string | null> {
    return this.client.call("relayChallenge$", [this.url]);
  }

  get authenticated$(): Observable<boolean> {
    return this.client.call("relayAuthenticated$", [this.url]);
  }

  get notices$(): Observable<string[]> {
    return this.client.call("relayNotices$", [this.url]);
  }

  get open$(): Observable<Event> {
    return this.client.call("relayOpen$", [this.url]);
  }

  get close$(): Observable<CloseEvent> {
    return this.client.call("relayClose$", [this.url]);
  }

  get closing$(): Observable<void> {
    return this.client.call("relayClosing$", [this.url]);
  }

  get error$(): Observable<Error | null> {
    return this.client.call("relayError$", [this.url]);
  }

  // Read-only properties (cached, updated via observables)
  private _connected = false;
  private _authenticated = false;
  private _challenge: string | null = null;
  private _notices: string[] = [];

  get connected(): boolean {
    return this._connected;
  }

  get authenticated(): boolean {
    return this._authenticated;
  }

  get challenge(): string | null {
    return this._challenge;
  }

  get notices(): string[] {
    return this._notices;
  }

  close(): void {
    this.client.call("relayClose", [this.url]).subscribe({
      error: (err) => console.error("Error closing relay:", err),
    });
  }

  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse> {
    return this.client.call("relayReq", [this.url, filters, id]);
  }

  count(filters: Filter | Filter[], id?: string): Observable<CountResponse> {
    return this.client.call("relayCount", [this.url, filters, id]);
  }

  event(event: NostrEvent): Observable<PublishResponse> {
    return this.client.call("relayEvent", [this.url, event]);
  }

  async auth(event: NostrEvent): Promise<PublishResponse> {
    const result$ = this.client.call("relayAuth", [this.url, event]);
    return await firstValueFrom(result$);
  }

  async negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: import("applesauce-relay/negentropy").NegentropySyncOptions,
  ): Promise<boolean> {
    const result$ = this.client.call("relayNegentropy", [this.url, store, filter, reconcile, opts]);
    return await firstValueFrom(result$);
  }

  async authenticate(signer: import("applesauce-relay/types").AuthSigner): Promise<PublishResponse> {
    const result$ = this.client.call("relayAuthenticate", [this.url, signer]);
    return await firstValueFrom(result$);
  }

  async publish(event: NostrEvent, opts?: import("applesauce-relay/types").PublishOptions): Promise<PublishResponse> {
    const result$ = this.client.call("relayPublish", [this.url, event, opts]);
    return await firstValueFrom(result$);
  }

  request(filters: FilterInput, opts?: import("applesauce-relay/types").RequestOptions): Observable<NostrEvent> {
    return this.client.call("relayRequest", [this.url, filters, opts]);
  }

  subscription(
    filters: FilterInput,
    opts?: import("applesauce-relay/types").SubscriptionOptions,
  ): Observable<SubscriptionResponse> {
    return this.client.call("relaySubscription", [this.url, filters, opts]);
  }

  sync(store: NegentropySyncStore, filter: Filter, direction?: SyncDirection): Observable<NostrEvent> {
    return this.client.call("relaySync", [this.url, store, filter, direction]);
  }

  async getInformation(): Promise<import("applesauce-relay/types").RelayInformation | null> {
    const result$ = this.client.call("relayGetInformation", [this.url]);
    return await firstValueFrom(result$);
  }

  async getLimitations(): Promise<import("applesauce-relay/types").RelayInformation["limitation"] | null> {
    const result$ = this.client.call("relayGetLimitations", [this.url]);
    return await firstValueFrom(result$);
  }

  async getSupported(): Promise<number[] | null> {
    const result$ = this.client.call("relayGetSupported", [this.url]);
    return await firstValueFrom(result$);
  }

  // MultiplexWebSocket interface
  multiplex<T = any>(): Observable<T> {
    // This would require additional RPC infrastructure to fully implement
    // For now, return a simplified implementation
    return this.message$.pipe(map((msg) => msg as T));
  }
}
