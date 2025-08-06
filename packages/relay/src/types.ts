import { type EventTemplate, type Filter, type NostrEvent } from "nostr-tools";
import { Observable } from "rxjs";
import { WebSocketSubject } from "rxjs/webSocket";

export type SubscriptionResponse = NostrEvent | "EOSE";
export type PublishResponse = { ok: boolean; message?: string; from: string };

export type MultiplexWebSocket<T = any> = Pick<WebSocketSubject<T>, "multiplex">;

export type PublishOptions = {
  retries?: number;
};
export type RequestOptions = {
  id?: string;
  retries?: number;
};
export type SubscriptionOptions = {
  id?: string;
  retries?: number;
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
  publish(event: NostrEvent, opts?: { retries?: number }): Promise<PublishResponse>;
  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: { id?: string; retries?: number }): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: { id?: string; retries?: number }): Observable<SubscriptionResponse>;
}

export interface IGroup {
  /** Send a REQ message */
  req(filters: FilterInput, id?: string): Observable<SubscriptionResponse>;
  /** Send an EVENT message */
  event(event: NostrEvent): Observable<PublishResponse>;
  /** Send an EVENT message with retries */
  publish(event: NostrEvent, opts?: { retries?: number }): Promise<PublishResponse[]>;
  /** Send a REQ message with retries */
  request(filters: FilterInput, opts?: { id?: string; retries?: number }): Observable<NostrEvent>;
  /** Open a subscription with retries */
  subscription(filters: FilterInput, opts?: { id?: string; retries?: number }): Observable<SubscriptionResponse>;
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
  publish(relays: string[], event: NostrEvent, opts?: { retries?: number }): Promise<PublishResponse[]>;
  /** Send a REQ message to relays with retries */
  request(relays: string[], filters: FilterInput, opts?: { id?: string; retries?: number }): Observable<NostrEvent>;
  /** Open a subscription to relays with retries */
  subscription(
    relays: string[],
    filters: FilterInput,
    opts?: { id?: string; retries?: number },
  ): Observable<SubscriptionResponse>;
}
