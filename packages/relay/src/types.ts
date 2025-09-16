import { type EventTemplate, type Filter, type NostrEvent } from "nostr-tools";
import { Observable, repeat, retry } from "rxjs";
import { WebSocketSubject } from "rxjs/webSocket";

export type SubscriptionResponse = NostrEvent | "EOSE";
export type PublishResponse = { ok: boolean; message?: string; from: string };

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

/** The type of input the REQ method accepts */
export type FilterInput = Filter | Filter[] | Observable<Filter | Filter[]>;

export interface IRelay extends MultiplexWebSocket {
  url: string;

  message$: Observable<any>;
  notice$: Observable<string>;
  connected$: Observable<boolean>;
  challenge$: Observable<string | null>;
  authenticated$: Observable<boolean>;
  notices$: Observable<string[]>;

  readonly connected: boolean;
  readonly authenticated: boolean;
  readonly challenge: string | null;
  readonly notices: string[];

  /** Force close the connection */
  close(): void;

  /** Send a REQ message */
  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(event: NostrEvent): Observable<PublishResponse>;
  /** Send an AUTH message */
  auth(event: NostrEvent): Promise<PublishResponse>;
  /** Authenticate with the relay using a signer */
  authenticate(signer: AuthSigner): Promise<PublishResponse>;
  /** Send an EVENT message with retries */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse>;
  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: RequestOptions): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: SubscriptionOptions): Observable<SubscriptionResponse>;
}

export interface IGroup {
  /** Send a REQ message */
  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(event: NostrEvent): Observable<PublishResponse>;
  /** Send an EVENT message with retries */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse[]>;
  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: RequestOptions): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: SubscriptionOptions): Observable<SubscriptionResponse>;
}

export interface IPool {
  /** Get or create a relay */
  relay(url: string): IRelay;
  /** Create a relay group */
  group(relays: string[]): IGroup;

  /** Removes a relay from the pool and defaults to closing the connection */
  remove(relay: string | IRelay, close?: boolean): void;

  /** Send a REQ message */
  req(relays: string[], filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(relays: string[], event: NostrEvent): Observable<PublishResponse>;
  /** Send an EVENT message to relays with retries */
  publish(
    relays: string[],
    event: Parameters<IGroup["publish"]>[0],
    opts?: Parameters<IGroup["publish"]>[1],
  ): Promise<PublishResponse[]>;
  /** Send a REQ message to relays with retries */
  request(
    relays: string[],
    filters: Parameters<IGroup["request"]>[0],
    opts?: Parameters<IGroup["request"]>[1],
  ): Observable<NostrEvent>;
  /** Open a subscription to relays with retries */
  subscription(
    relays: string[],
    filters: Parameters<IGroup["subscription"]>[0],
    opts?: Parameters<IGroup["subscription"]>[1],
  ): Observable<SubscriptionResponse>;
}
