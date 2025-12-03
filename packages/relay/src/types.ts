import type { IAsyncEventStoreActions, IAsyncEventStoreRead, IEventStoreRead } from "applesauce-core/event-store";
import type { Filter } from "applesauce-core/helpers/filter";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { RelayInformation as CoreRelayInformation } from "nostr-tools/nip11";
import type { Observable, repeat, retry } from "rxjs";
import type { WebSocketSubject } from "rxjs/webSocket";
import type { GroupNegentropySyncOptions, GroupRequestOptions, GroupSubscriptionOptions } from "./group.js";
import type { NegentropySyncOptions, ReconcileFunction } from "./negentropy.js";
import type { SyncDirection } from "./relay.js";

export type SubscriptionResponse = NostrEvent | "EOSE";
export type PublishResponse = { ok: boolean; message?: string; from: string };
export type CountResponse = { count: number };

export type MultiplexWebSocket<T = any> = Pick<WebSocketSubject<T>, "multiplex">;

/** Options for the publish method on the pool and relay */
export type PublishOptions = {
  /**
   * Number of times to retry the publish. default is 10
   * @see https://rxjs.dev/api/index/function/retry
   * @deprecated use `reconnect` instead
   */
  retries?: number | Parameters<typeof retry>[0];
  /**
   * Whether to reconnect when socket fails to connect. default is true (10 retries with 1 second delay)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  /** Timeout for publish in milliseconds (default 30 seconds) */
  timeout?: number | boolean;
};

/** Options for the request method on the pool and relay */
export type RequestOptions = SubscriptionOptions;

/** Options for the subscription method on the pool and relay */
export type SubscriptionOptions = {
  /** Custom REQ id for the subscription */
  id?: string;
  /**
   * Number of times to retry the subscription if the relay fails to connect. default is 10
   * @see https://rxjs.dev/api/index/function/retry
   * @deprecated use `reconnect` instead
   */
  retries?: number | Parameters<typeof retry>[0];
  /**
   * Whether to resubscribe if the subscription is closed by the relay. default is false
   * @see https://rxjs.dev/api/index/function/repeat
   */
  resubscribe?: boolean | number | Parameters<typeof repeat>[0];
  /**
   * Whether to reconnect when socket is closed. default is true (10 retries with 1 second delay)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
};

export type AuthSigner = {
  signEvent: (event: EventTemplate) => NostrEvent | Promise<NostrEvent>;
};

/** Filters that can be passed to request methods on the pool or relay */
export type FilterInput =
  // A single filter
  | Filter
  // An array of filters
  | Filter[]
  // A stream of filters
  | Observable<Filter | Filter[]>
  // A function to create a filter for a relay
  | ((relay: IRelay) => Filter | Filter[] | Observable<Filter | Filter[]>);

export type RelayInformation = CoreRelayInformation & {
  /** An array of attributes that describe the relay type/characteristics */
  attributes?: string[];
};

/** A read only event store for negentropy sync */
export type NegentropyReadStore = IEventStoreRead | IAsyncEventStoreRead | NostrEvent[];
/** A writeable event store for negentropy sync */
export type NegentropyWriteStore =
  | (IAsyncEventStoreRead & IAsyncEventStoreActions)
  | (IEventStoreRead & IAsyncEventStoreActions);

/** An event store that can be used for negentropy sync */
export type NegentropySyncStore = NegentropyReadStore | NegentropyWriteStore;

export interface IRelay extends MultiplexWebSocket {
  url: string;

  message$: Observable<any>;
  notice$: Observable<string>;
  connected$: Observable<boolean>;
  challenge$: Observable<string | null>;
  authenticated$: Observable<boolean>;
  notices$: Observable<string[]>;
  open$: Observable<Event>;
  close$: Observable<CloseEvent>;
  closing$: Observable<void>;
  error$: Observable<Error | null>;

  readonly connected: boolean;
  readonly authenticated: boolean;
  readonly challenge: string | null;
  readonly notices: string[];

  /** Force close the connection */
  close(): void;

  /** Send a REQ message */
  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send a COUNT message */
  count(filters: Filter | Filter[], id?: string): Observable<CountResponse>;
  /** Send an EVENT message */
  event(event: NostrEvent): Observable<PublishResponse>;
  /** Send an AUTH message */
  auth(event: NostrEvent): Promise<PublishResponse>;
  /** Negentropy sync event ids with the relay and an event store */
  negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean>;

  /** Authenticate with the relay using a signer */
  authenticate(signer: AuthSigner): Promise<PublishResponse>;
  /** Send an EVENT message with retries */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse>;
  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: RequestOptions): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: SubscriptionOptions): Observable<SubscriptionResponse>;
  /** Negentropy sync events with the relay and an event store */
  sync(store: NegentropySyncStore, filter: Filter, direction?: SyncDirection): Observable<NostrEvent>;

  /** Get the NIP-11 information document for the relay */
  getInformation(): Promise<RelayInformation | null>;
  /** Get the limitations for the relay */
  getLimitations(): Promise<RelayInformation["limitation"] | null>;
  /** Get the supported NIPs for the relay */
  getSupported(): Promise<number[] | null>;
}

export type IGroupRelayInput = IRelay[] | Observable<IRelay[]>;

export interface IGroup {
  /** Send a REQ message */
  req(filters: Parameters<IRelay["req"]>[0], id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(event: Parameters<IRelay["event"]>[0]): Observable<PublishResponse>;
  /** Negentropy sync event ids with the relays and an event store */
  negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean>;

  /** Add a relay to the group */
  add(relay: IRelay): void;
  /** Remove a relay from the group */
  remove(relay: IRelay): void;
  /** Check if a relay is in the group */
  has(relay: IRelay | string): boolean;

  /** Send an EVENT message with retries */
  publish(event: Parameters<IRelay["event"]>[0], opts?: PublishOptions): Promise<PublishResponse[]>;
  /** Send a REQ message with retries */
  request(filters: Parameters<IRelay["request"]>[0], opts?: GroupRequestOptions): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(
    filters: Parameters<IRelay["subscription"]>[0],
    opts?: GroupSubscriptionOptions,
  ): Observable<SubscriptionResponse>;
  /** Count events on the relays and an event store */
  count(filters: Filter | Filter[], id?: string): Observable<Record<string, CountResponse>>;
  /** Negentropy sync events with the relay and an event store */
  sync(store: NegentropySyncStore, filter: Filter, direction?: SyncDirection): Observable<NostrEvent>;
}

/** Signals emitted by the pool */
export interface IPoolSignals {
  add$: Observable<IRelay>;
  remove$: Observable<IRelay>;
}

export type IPoolRelayInput = string[] | Observable<string[]>;

export interface IPool extends IPoolSignals {
  /** Get or create a relay */
  relay(url: string): IRelay;
  /** Create a relay group */
  group(relays: IPoolRelayInput): IGroup;

  /** Removes a relay from the pool and defaults to closing the connection */
  remove(relay: string | IRelay, close?: boolean): void;

  /** Send a REQ message */
  req(relays: IPoolRelayInput, filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(relays: IPoolRelayInput, event: NostrEvent): Observable<PublishResponse>;
  /** Negentropy sync event ids with the relays and an event store */
  negentropy(
    relays: IPoolRelayInput,
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: GroupNegentropySyncOptions,
  ): Promise<boolean>;

  /** Send an EVENT message to relays with retries */
  publish(
    relays: IPoolRelayInput,
    event: Parameters<IGroup["publish"]>[0],
    opts?: Parameters<IGroup["publish"]>[1],
  ): Promise<PublishResponse[]>;
  /** Send a REQ message to relays with retries */
  request(
    relays: IPoolRelayInput,
    filters: Parameters<IGroup["request"]>[0],
    opts?: Parameters<IGroup["request"]>[1],
  ): Observable<NostrEvent>;
  /** Open a subscription to relays with retries */
  subscription(
    relays: IPoolRelayInput,
    filters: Parameters<IGroup["subscription"]>[0],
    opts?: Parameters<IGroup["subscription"]>[1],
  ): Observable<SubscriptionResponse>;
  /** Count events on the relays and an event store */
  count(relays: IPoolRelayInput, filters: Filter | Filter[], id?: string): Observable<Record<string, CountResponse>>;
  /** Negentropy sync events with the relay and an event store */
  sync(
    relays: IPoolRelayInput,
    store: NegentropySyncStore,
    filter: Filter,
    direction?: SyncDirection,
  ): Observable<NostrEvent>;
}
