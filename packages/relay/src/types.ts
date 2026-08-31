import type {
  IAsyncEventStoreActions,
  IAsyncEventStoreRead,
  IEventStoreActions,
  IEventStoreRead,
} from "applesauce-core/event-store";
import type { EventTemplate, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { RelayInformation as CoreRelayInformation } from "nostr-tools/nip11";
import type { Observable, OperatorFunction, repeat, retry } from "rxjs";
import type { WebSocketSubject } from "rxjs/webSocket";
import type { NegentropySyncOptions } from "./negentropy.js";
import type { Relay } from "./relay.js";

/** The authentication state of a single pubkey on a relay connection */
export type RelayAuthState = {
  /** The kind 22242 AUTH event sent to the relay */
  event: KnownEvent<kinds.ClientAuth>;
  /** The OK response from the relay, or null while waiting for a response */
  response: PublishResponse | null;
};

/**
 * What authentication to wait for before sending a REQ or EVENT.
 * `true` waits for any authenticated user, a pubkey (or array of pubkeys) waits until all of them are authenticated,
 * and `false` disables waiting.
 */
export type AuthRequirement = boolean | string | string[];

/** Status information for a single relay */
export interface RelayStatus {
  /** Relay URL */
  url: string;
  /** WebSocket connection state (true = socket is open) */
  connected: boolean;
  /** Authentication state (true = at least one pubkey successfully authenticated) */
  authenticated: boolean;
  /**
   * The pubkey of the authenticated user, or null if not authenticated
   * @deprecated use {@link authenticatedPubkeys} instead
   */
  authenticatedAs: string | null;
  /** The pubkeys that are currently authenticated on the connection */
  authenticatedPubkeys: string[];
  /** All AUTH attempts on the connection keyed by pubkey */
  authentications: Record<string, RelayAuthState>;
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

/**
 * The exact wire request a relay refused with `auth-required:`, discriminated by the NIP-01/NIP-77 verb
 * that carried it. D-02: an `onAuthRequired` handler receives this instead of a three-value operation
 * category, so it can branch on the request the relay actually rejected.
 */
export type RelayAuthWireRequest =
  | { verb: "REQ"; id: string; filters: Filter[] }
  | { verb: "COUNT"; id: string; filters: Filter[] }
  | { verb: "EVENT"; event: NostrEvent }
  | { verb: "NEG-OPEN"; id: string; filter: Filter };

/** The verb of a {@link RelayAuthWireRequest}, derived from the union itself so it stays the single source of truth */
export type RelayAuthWireVerb = RelayAuthWireRequest["verb"];

/**
 * The context passed to a {@link RelayAuthHandler} when a relay signals that authentication is required
 * for a specific operation (RAUTH-01)
 */
export type RelayAuthContext = {
  /** The relay that requires authentication */
  relay: Relay;
  /** The URL of the relay */
  url: string;
  /** The current NIP-42 AUTH challenge string, or null if none has been received yet */
  challenge: string | null;
  /** The exact wire request the relay refused */
  request: RelayAuthWireRequest;
  /** The auth requirement configured for the operation that triggered this auth phase */
  requirement: AuthRequirement;
  /** The pubkeys that are not yet authenticated for `requirement`, or null when `requirement` is `true` */
  missingPubkeys: string[] | null;
  /** The machine-readable reason string reported by the relay */
  reason: string;
};

/** A caller-supplied callback invoked when a relay signals that authentication is required */
export type RelayAuthHandler = (context: RelayAuthContext) => void | Promise<void>;

/**
 * D-05 mixin: the shared set of auth-related options intersected into every operation's option type
 * (`RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, `RelayCountOptions`,
 * `RelaySyncOptions`) so `waitForAuth` and its siblings are declared exactly once.
 */
export type RelayAuthOptions = {
  /**
   * What authentication to wait for when the relay requires auth for this operation. default is `true` (any authenticated user)
   * Pass a pubkey (or array of pubkeys) to wait until those specific users are authenticated.
   */
  waitForAuth?: AuthRequirement;
  /** Called when the relay signals that authentication is required for this operation */
  onAuthRequired?: RelayAuthHandler;
  /**
   * The maximum time (in milliseconds) to wait for a single auth phase (handler execution plus the
   * subsequent authentication wait). default is 30_000. Pass `false` to wait indefinitely for external
   * auth state to satisfy the requirement.
   */
  authTimeout?: number | false;
  /** The number of consecutive auth-required cycles to tolerate before giving up. default is 1 */
  authRetries?: number;
};

/** High-level EVENT policy owned by publish on the relay, group, and pool (D-01/D-07). */
export type PublishOptions = {
  /** Number of times to retry the publish. default is 3 */
  retries?: boolean | number | Parameters<typeof retry>[0];
  /**
   * Whether to reconnect when socket fails to connect. default is true (3 retries with 1 second delay)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  /** Whole-operation timeout for publish, suspended only during an active auth phase (default 30 seconds) */
  timeout?: number | boolean;
} & RelayAuthOptions;

/** The response type when publishing an event to a relay */
export type PublishResponse = {
  ok: boolean;
  message?: string;
  from: string;
  /** Typed relay-verdict or group-converted failure; client attempt failures reject instead */
  error?: unknown;
};

/** Base options for REQ subscriptions to a relay */
export type RelayReqOptions = {
  /** Custom REQ id for the subscription */
  id?: string;
  /**
   * Whether to resubscribe after a clean CLOSED message from the relay. default is false
   * @see https://rxjs.dev/api/index/function/repeat
   */
  resubscribe?: boolean | number | Parameters<typeof repeat>[0];
  /**
   * Whether to retry connection errors. default is true (3 retries with linear backoff)
   * @see https://rxjs.dev/api/index/function/retry
   */
  reconnect?: boolean | number | Parameters<typeof retry>[0];
} & RelayAuthOptions;

/** Options for the count method on the pool and relay */
export type RelayCountOptions = RelayAuthOptions & {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: boolean | number;
};

/** Options for the sync method on the pool and relay */
export type RelaySyncOptions = RelayAuthOptions;

/** Internal type emitted when REQ is sent to the relay */
export type RelayReqOpenMessage = { type: "OPEN"; from: string; id: string; filters: Filter[] };
/** Internal type emitted when an event is received from the relay */
export type RelayReqEventMessage = { type: "EVENT"; from: string; id: string; event: NostrEvent };
/** Internal type emitted when the relay sends an EOSE message */
export type RelayReqEoseMessage = { type: "EOSE"; from: string; id: string };
/** Internal type emitted when the relay sends a CLOSED message */
export type RelayReqClosedMessage = { type: "CLOSED"; from: string; id: string; reason: string };

/** Internal type emitted from a REQ subscription to a relay */
export type RelayReqMessage = RelayReqOpenMessage | RelayReqEventMessage | RelayReqEoseMessage | RelayReqClosedMessage;

/** Options for the request method on the pool and relay */
export type RelayRequestOptions = RelayReqOptions & {
  /**
   * Total timeout for the request before request emits a TimeoutError in milliseconds (default 30 seconds)
   * Passed to rjxs timeout() operator */
  timeout?: number;
  /** An operator that determines when the request should complete. */
  complete?: RelayRequestCompleteOperator;
};

/** The response type when making a request to a relay */
export type RelayRequestResponse = NostrEvent;

/** An operator that determines when a relay request should complete. truthy values are considered complete */
export type RelayRequestCompleteOperator = OperatorFunction<RelayReqMessage, any>;

/** Options for the subscription method on the pool and relay */
export type RelaySubscriptionOptions = RelayReqOptions;

/** The response type when subscribing to a relay */
export type RelaySubscriptionResponse = NostrEvent | "EOSE";

/** The response type when counting events on a relay */
export type RelayCountResponse = Record<string, unknown> & { count: number; approximate?: boolean; hll?: string };

/** A minimal signer interface for authenticating with a relay */
export type AuthSigner = {
  signEvent: (event: EventTemplate) => NostrEvent | Promise<NostrEvent>;
};

/** Whole-operation policy for {@link Relay.authenticate}. */
export type RelayAuthenticateOptions = {
  /** Finite non-negative wall-clock bound for the whole operation. Zero expires immediately; false disables it. Default 30 seconds. */
  timeout?: number | false;
  /** Finite non-negative integer number of post-sign challenge changes to tolerate. Zero permits no changes. Default 1. */
  challengeRetries?: number;
  /** Cancels the logical authentication operation. */
  signal?: AbortSignal;
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
  (IAsyncEventStoreRead & IAsyncEventStoreActions) | (IEventStoreRead & IAsyncEventStoreActions);

/** An event store that can be used for negentropy sync */
export type NegentropySyncStore = NegentropyReadStore | NegentropyWriteStore;

/** The input arguments for a relay group */
export type GroupRelayInput = Relay[] | Observable<Relay[]>;

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
export type GroupReqOptions = RelayReqOptions;

/** Options for a request on a group of relays */
export type GroupRequestOptions = RelayRequestOptions & {
  /** Deduplicate events with an event store (default is a temporary instance of EventMemory), null will disable deduplication */
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
  /** A custom operator that determines when the request should complete.*/
  complete?: GroupRequestCompleteOperator;
};

/** The message that is emitted when the group receives an error message from the relay observable */
export type GroupReqErrorMessage = { type: "ERROR"; from: string; error: unknown };

/** The response messages from a relay group subscription */
export type GroupReqMessage = RelayReqMessage | GroupReqErrorMessage;

/** A operator that determines when a group request should complete. truthy values are considered complete */
export type GroupRequestCompleteOperator = OperatorFunction<GroupReqMessage, any>;

/** The input type of relays for pool methods */
export type PoolRelayInput = string[] | Observable<string[]>;
