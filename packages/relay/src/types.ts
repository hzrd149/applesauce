import type {
  IAsyncEventStoreActions,
  IAsyncEventStoreRead,
  IEventStoreActions,
  IEventStoreRead,
} from "applesauce-core/event-store";
import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { RelayInformation as CoreRelayInformation } from "nostr-tools/nip11";
import type { MonoTypeOperatorFunction, Observable, repeat, retry } from "rxjs";
import type { WebSocketSubject } from "rxjs/webSocket";
import type { NegentropySyncOptions } from "./negentropy.js";
import type { Relay } from "./relay.js";

/** Status information for a single relay */
export interface RelayStatus {
  /** Relay URL */
  url: string;
  /** WebSocket connection state (true = socket is open) */
  connected: boolean;
  /** Authentication state (true = successfully authenticated) */
  authenticated: boolean;
  /** The pubkey of the authenticated user, or null if not authenticated */
  authenticatedAs: string | null;
  /** Application-layer ready state (true = safe to use) */
  ready: boolean;
  /** Whether authentication is required for read operations (REQ/COUNT) */
  authRequiredForRead: boolean;
  /** Whether authentication is required for publish operations (EVENT) */
  authRequiredForPublish: boolean;
  /** The authentication challenge string from the relay, or null if not yet received */
  challenge: string | null;
}

export type MultiplexWebSocket<T = any> = Pick<WebSocketSubject<T>, "multiplex">;

/** Options for the publish method on the pool and relay */
export type PublishOptions = {
  /** Number of times to retry the publish. default is 3 */
  retries?: boolean | number | Parameters<typeof retry>[0];
  /**
   * Whether to reconnect when socket fails to connect. default is true (3 retries with 1 second delay)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  /** Timeout for publish in milliseconds (default 30 seconds) */
  timeout?: number | boolean;
};

/** The response type when publishing an event to a relay */
export type PublishResponse = { ok: boolean; message?: string; from: string };

/** Base options for REQ subscriptions to a relay */
export type RelayReqOptions = {
  /** Custom REQ id for the subscription */
  id?: string;
  /**
   * Whether to resubscribe if the subscription is closed by the relay. default is false
   * @see https://rxjs.dev/api/index/function/repeat
   */
  resubscribe?: boolean | number | Parameters<typeof repeat>[0];
  /**
   * Whether to reconnect when socket is closed. default is true (3 retries with 1 second delay)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
};

/** Internal type emitted when REQ is sent to the relay */
export type RelayReqOpenMessage = { type: "OPEN"; id: string; filters: Filter[] };
/** Internal type emitted when an event is received from the relay */
export type RelayReqEventMessage = { type: "EVENT"; id: string; event: NostrEvent };
/** Internal type emitted when the relay sends an EOSE message */
export type RelayReqEoseMessage = { type: "EOSE"; id: string };
/** Internal type emitted when the relay sends a CLOSED message */
export type RelayReqClosedMessage = { type: "CLOSED"; id: string };

/** Internal type emitted from a REQ subscription to a relay */
export type RelayReqMessage = RelayReqOpenMessage | RelayReqEventMessage | RelayReqEoseMessage | RelayReqClosedMessage;

/** Options for the request method on the pool and relay */
export type RelayRequestOptions = RelayReqOptions;

/** The response type when making a request to a relay */
export type RelayRequestResponse = NostrEvent;

/** Options for the subscription method on the pool and relay */
export type RelaySubscriptionOptions = RelayReqOptions;

/** The response type when subscribing to a relay */
export type RelaySubscriptionResponse = NostrEvent | "EOSE";

/** The response type when counting events on a relay */
export type RelayCountResponse = { count: number };

/** A minimal signer interface for authenticating with a relay */
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
  | ((relay: Relay) => Filter | Filter[] | Observable<Filter | Filter[]>);

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

/** The input arguments for a relay group */
export type GroupRelayInput = Relay[] | Observable<Relay[]>;

/** A operator that determines when a group request should complete. */
export type CompleteOperator = MonoTypeOperatorFunction<GroupReqMessage>;

/** Options for negentropy sync on a group of relays */
export type GroupNegentropySyncOptions = NegentropySyncOptions & {
  /** Whether to sync in parallel (default true) */
  parallel?: boolean;
};

/** Options for a subscription on a group of relays */
export type GroupSubscriptionOptions = RelaySubscriptionOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};

/** Options for relay group REQ method */
export type GroupReqOptions = RelayReqOptions & {
  /** A custom operator that determines when the request should complete.*/
  complete?: CompleteOperator;
};

/** Options for a request on a group of relays */
export type GroupRequestOptions = RelayRequestOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
  /** A custom operator that determines when the request should complete.*/
  complete?: CompleteOperator;
};

/** The message that is emitted when the group sends the filters to a relay */
export type GroupReqOpenMessage = RelayReqOpenMessage & { relay: string };
/** The message that is emitted when the group receives an event from a relay */
export type GroupReqEventMessage = RelayReqEventMessage & { relay: string };
/** The message that is emitted when the group receives an EOSE message from a relay */
export type GroupReqEoseMessage = RelayReqEoseMessage & { relay: string };
/** The message that is emitted when the group receives a CLOSED message from a relay */
export type GroupReqClosedMessage = RelayReqClosedMessage & { relay: string };
/** The message that is emitted when the group receives an error message from the relay observable */
export type GroupReqErrorMessage = { type: "ERROR"; relay: string; error: unknown };

/** The response messages from a relay group subscription */
export type GroupReqMessage = GroupReqOpenMessage | GroupReqEventMessage | GroupReqEoseMessage | GroupReqErrorMessage;

/** The input type of relays for pool methods */
export type PoolRelayInput = string[] | Observable<string[]>;
