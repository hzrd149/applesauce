import { IAsyncEventStoreActions, IEventStoreActions, logger } from "applesauce-core";
import { addSeenRelay } from "applesauce-core/helpers";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { ensureHttpURL } from "applesauce-core/helpers/url";
import { mapEventsToStore, simpleTimeout } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import { makeAuthEvent } from "nostr-tools/nip42";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  defaultIfEmpty,
  distinctUntilChanged,
  EMPTY,
  endWith,
  filter,
  finalize,
  firstValueFrom,
  from,
  identity,
  ignoreElements,
  isObservable,
  lastValueFrom,
  map,
  merge,
  mergeMap,
  MonoTypeOperatorFunction,
  NEVER,
  Observable,
  of,
  OperatorFunction,
  repeat,
  RepeatConfig,
  ReplaySubject,
  retry,
  RetryConfig,
  scan,
  share,
  shareReplay,
  startWith,
  Subject,
  Subscription,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  throwError,
  timeout,
  timer,
} from "rxjs";
import { webSocket, WebSocketSubject, WebSocketSubjectConfig } from "rxjs/webSocket";

import { describeWireRequest, truncateForLog } from "./helpers/auth-log.js";
import { parseRelayCountResponse, RelayCountResponseError } from "./nip45.js";
import { type NegentropySyncOptions, type ReconcileFunction } from "./negentropy.js";
import {
  AUTH_PHASE_GATE,
  authRequiredSignal,
  AuthPhaseGate,
  authRetry,
  isAuthRequiredSignal,
  suspendableTimeout,
  type AuthRequiredSignal,
  type ProgressPredicate,
  type WithAuthPhaseGate,
} from "./operators/auth-retry.js";
import { completeWhen } from "./operators/complete-when.js";
import {
  AuthRequirement,
  AuthSigner,
  FilterInput,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishOptions,
  RelayAuthContext,
  RelayAuthenticateOptions,
  RelayAuthOptions,
  RelayAuthWireRequest,
  RelayAuthWireVerb,
  RelayAuthState,
  PublishResponse,
  RelayCountOptions,
  RelayCountResponse,
  RelayInformation,
  RelayReqClosedMessage,
  RelayReqEoseMessage,
  RelayReqEventMessage,
  RelayReqMessage,
  RelayReqOpenMessage,
  RelayReqOptions,
  RelayRequestCompleteOperator,
  RelayRequestOptions,
  RelayRequestResponse,
  RelayStatus,
  RelaySubscriptionOptions,
  RelaySubscriptionResponse,
  RelaySyncOptions,
} from "./types.js";

const AUTH_REQUIRED_PREFIX = "auth-required:";

/** Default reconnect/retry config for request, subscription, and publish. linear backoff */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  count: 3,
  delay: (_err, count) => timer(count * 1000),
  resetOnSuccess: true,
};

function normalizeRetryConfig(config?: number | RetryConfig): RetryConfig {
  if (typeof config === "number") return { ...DEFAULT_RETRY_CONFIG, count: config };
  return { ...DEFAULT_RETRY_CONFIG, ...(config ?? {}) };
}

/** Flags for the negentropy sync type */
export enum SyncDirection {
  RECEIVE = 1 << 0,
  SEND = 1 << 1,
  BOTH = SEND | RECEIVE,
}

/** Base error thrown when a relay closes a REQ or COUNT with a CLOSED message */
export class RelayClosedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RelayClosedError";
  }
}

/** Thrown when the relay closes a subscription with an auth-required: prefix */
export class AuthRequiredError extends RelayClosedError {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredError";
  }
}

/**
 * NOTE: the `.name` values of `AuthHandlerError` and `AuthTimeoutError` are load-bearing wire between
 * packages. `packages/loaders/src/loaders/sync-loader.ts` deliberately does NOT import these classes
 * (D-06 keeps `applesauce-loaders` free of an `applesauce-relay` dependency) and instead duck-types
 * against these exact strings. Renaming either class requires updating that check in the same change.
 */

/** Thrown when a caller-supplied `onAuthRequired` handler rejects or throws (D-17) */
export class AuthHandlerError extends RelayClosedError {
  constructor(reason: string, cause: unknown) {
    super(reason);
    this.name = "AuthHandlerError";
    // ES2022 target: Error.cause carries the handler's original rejection
    this.cause = cause;
  }
}

/** Thrown when a single auth phase (handler execution plus the subsequent wait) exceeds `authTimeout` (D-17) */
export class AuthTimeoutError extends RelayClosedError {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthTimeoutError";
  }
}

/** The whole authenticate operation expired before it could return a relay verdict. */
export class RelayAuthChallengeTimeoutError extends Error {
  constructor(public readonly url: string) {
    super(`Timed out waiting to authenticate with ${url}`);
    this.name = "RelayAuthChallengeTimeoutError";
  }
}

/** The relay challenge changed too many times while AUTH candidates were being signed. */
export class RelayAuthChallengeChangedError extends Error {
  constructor(public readonly url: string) {
    super(`Authentication challenge changed too many times for ${url}`);
    this.name = "RelayAuthChallengeChangedError";
  }
}

/** A genuine negative OK verdict returned by a relay for an EVENT or AUTH frame. */
export class RelayEventVerdictError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RelayEventVerdictError";
  }
}

/** The fixed reply bound for one written EVENT or AUTH attempt expired. */
export class RelayEventTimeoutError extends Error {
  constructor(public readonly url: string) {
    super(`Timed out waiting for OK response from ${url}`);
    this.name = "RelayEventTimeoutError";
  }
}

export class RelayCountTimeoutError extends Error {
  constructor(public readonly url: string) {
    super(`Timed out waiting for COUNT response from ${url}`);
    this.name = "RelayCountTimeoutError";
  }
}

/** Whether an error represents a transport failure for which reconnecting can make progress. */
function isReconnectableTransportError(error: unknown): error is CloseEvent {
  return (
    typeof error === "object" &&
    error !== null &&
    "wasClean" in error &&
    error.wasClean === false &&
    "code" in error &&
    typeof error.code === "number"
  );
}

/** Publish retries are deliberately limited to typed reply timeouts and reconnectable transport failures. */
function isRetryablePublishError(error: unknown): boolean {
  return error instanceof RelayEventTimeoutError || isReconnectableTransportError(error);
}

/** NIP-01 machine-readable prefixes that indicate an error condition on CLOSED/OK messages */
const CLOSED_ERROR_PREFIXES = new Map<string, new (reason: string) => RelayClosedError>([
  ["auth-required", AuthRequiredError],
  ["unsupported", RelayClosedError],
  ["error", RelayClosedError],
  ["blocked", RelayClosedError],
  ["restricted", RelayClosedError],
  ["rate-limited", RelayClosedError],
  ["pow", RelayClosedError],
  ["invalid", RelayClosedError],
  ["duplicate", RelayClosedError],
  ["mute", RelayClosedError],
]);

/**
 * Parse a NIP-01 machine-readable CLOSED reason string into a typed error.
 * Returns null if the reason has no recognized prefix — the relay closed gracefully
 * and the observable should complete rather than error.
 */
function parseClosedError(reason: string): RelayClosedError | null {
  const ErrorClass = CLOSED_ERROR_PREFIXES.get(reason.split(":")[0]);
  if (ErrorClass) return new ErrorClass(reason);
  return null;
}

/**
 * The single REQ progress predicate (CR-01/WR-01): `req()`'s synthetic `OPEN` message is a bookkeeping
 * value this call site generates for itself, not progress from the relay — only `EVENT`/`EOSE`/`CLOSED`
 * are. Defined exactly once and exported so `group.ts` (plan 13-11) reuses it rather than redeclaring its
 * own copy. Passed as the required `isProgress`/`firstWhen` argument at every `authRetry`/
 * `suspendableTimeout` call site that consumes a `RelayReqMessage` stream.
 */
export function isReqProgress(message: RelayReqMessage): boolean {
  return message.type !== "OPEN";
}

/** A dummy filter that will return empty results */
const PING_FILTER: Filter = {
  ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  limit: 0,
};

export type RelayOptions = {
  /** Custom WebSocket implementation */
  WebSocket?: WebSocketSubjectConfig<any>["WebSocketCtor"];
  /** How long to wait for an OK message from the relay (default 10s) */
  eventTimeout?: number;
  /** How long to wait for a publish to complete (default 30s) */
  publishTimeout?: number;
  /** Whole logical COUNT request timeout (default 10s) */
  countTimeout?: number;
  /** How long to keep the connection alive after nothing is subscribed (default 30s) */
  keepAlive?: number;
  /** Enable/disable ping functionality (default false) */
  enablePing?: boolean;
  /** How often to send pings in milliseconds (default 29000) */
  pingFrequency?: number;
  /** How long to wait for EOSE response in milliseconds (default 20000) */
  pingTimeout?: number;
  /** Policy for handling unresponsive connections (default: reconnect) */
  onUnresponsive?: (info: {
    url: string;
    lastMessageAt: number;
    now: number;
    attempts: number;
  }) => "reconnect" | "close" | "ignore";
  /** Default retry count or config for subscription() connection errors (default: 3) */
  subscriptionReconnect?: number | RetryConfig;
  /** Default retry count or config for request() connection errors (default: 3) */
  requestReconnect?: number | RetryConfig;
  /** Default retry config for publish() method */
  publishRetry?: RetryConfig;
};

export class Relay {
  protected log: typeof logger = logger.extend("Relay");
  /** D-13/D-20: the relay's NIP-42 lines, re-derived in the constructor as `Relay:auth:<url>`. */
  protected authLog: typeof logger = this.log.extend("auth");
  protected socket: WebSocketSubject<any>;

  /** Internal subject that tracks the ready state of the relay */
  protected _ready$ = new BehaviorSubject(true);

  /** Whether the relay is ready for subscriptions or event publishing. setting this to false will cause all .req and .event observables to hang until the relay is ready */
  ready$ = this._ready$.asObservable();

  /** A method that returns an Observable that emits when the relay should reconnect */
  reconnectTimer: (error: CloseEvent | Error, attempts: number) => Observable<number>;

  /** How many times the relay has tried to reconnect */
  attempts$ = new BehaviorSubject(0);
  /** Whether the relay is connected */
  connected$ = new BehaviorSubject(false);
  /** The authentication challenge string from the relay */
  challenge$ = new BehaviorSubject<string | null>(null);
  /** All AUTH attempts on this connection keyed by pubkey (NIP-42 supports multiple authenticated users per connection) */
  authentications$ = new BehaviorSubject<Record<string, RelayAuthState>>({});
  /** In-memory identities prevent deterministic event IDs from aliasing separate logical attempts. */
  private authAttemptTokens = new Map<string, symbol>();
  private latestAuthAttempt: symbol | null = null;
  /** Duplicate wire IDs are serialized because an OK frame cannot distinguish concurrent identical events. */
  private authEventQueues = new Map<string, Promise<void>>();
  /** The pubkeys that are currently authenticated on the connection, ordered oldest to most recent */
  authenticatedPubkeys$: Observable<string[]>;
  /** Boolean authentication state (true if at least one pubkey is authenticated) */
  authenticated$: Observable<boolean>;
  /**
   * The pubkey of the most recently authenticated user, or null if not authenticated
   * @deprecated use {@link authenticatedPubkeys$} instead
   */
  authenticatedAs$: Observable<string | null>;
  /**
   * The last authentication event sent to the relay
   * @deprecated use {@link authentications$} instead
   */
  authentication$ = new BehaviorSubject<KnownEvent<kinds.ClientAuth> | null>(null);
  /**
   * The response to the last AUTH message sent to the relay
   * @deprecated use {@link authentications$} instead
   */
  authenticationResponse$ = new BehaviorSubject<PublishResponse | null>(null);
  /** The notices from the relay */
  notices$ = new BehaviorSubject<string[]>([]);
  /** The last connection error */
  error$ = new BehaviorSubject<Error | null>(null);

  /**
   * A passive observable of all messages from the relay
   * @note Subscribing to this will not connect to the relay
   */
  message$: Observable<any>;
  /**
   * A passive observable of NOTICE messages from the relay
   * @note Subscribing to this will not connect to the relay
   */
  notice$: Observable<string>;

  /** Timestamp of the last message received from the relay */
  private lastMessageReceivedAt = 0;

  /** Observable of the timestamp when last message was received */
  private _lastMessageAt$ = new BehaviorSubject<number>(0);
  lastMessageAt$ = this._lastMessageAt$.asObservable();

  /** Observable of relay status (connection, authentication, and ready state) */
  status$: Observable<RelayStatus>;

  /** An observable that emits the NIP-11 information document for the relay */
  information$: Observable<RelayInformation | null>;
  protected _nip11: RelayInformation | null = null;

  /** An observable that emits the icon URL for the relay, or the favicon.ico URL for the relay */
  icon$: Observable<string | undefined>;

  /** An observable that emits the limitations for the relay */
  limitations$: Observable<RelayInformation["limitation"] | null>;

  /** An array of supported NIPs from the NIP-11 information document */
  supported$: Observable<number[] | null>;

  /** An observable that emits when underlying websocket is opened */
  open$ = new Subject<Event>();

  /** An observable that emits when underlying websocket is closed */
  close$ = new Subject<CloseEvent>();

  /** An observable that emits when underlying websocket is closing due to unsubscribe or complete */
  closing$ = new Subject<void>();

  /** Tracks active req() operations by subscription ID */
  reqs$ = new BehaviorSubject<Record<string, Filter[]>>({});

  // sync state
  get ready() {
    return this._ready$.value;
  }
  get connected() {
    return this.connected$.value;
  }
  get challenge() {
    return this.challenge$.value;
  }
  get notices() {
    return this.notices$.value;
  }
  get authenticated() {
    return this.authenticatedPubkeys.length > 0 || this.authenticationResponse?.ok === true;
  }
  get authentications() {
    return this.authentications$.value;
  }
  get authenticatedPubkeys() {
    return Object.entries(this.authentications$.value)
      .filter(([, state]) => state.response?.ok === true)
      .map(([pubkey]) => pubkey);
  }
  /** @deprecated use {@link authentications} instead */
  get authentication() {
    return this.authentication$.value;
  }
  /** @deprecated use {@link authenticatedPubkeys} instead */
  get authenticatedAs() {
    const pubkeys = this.authenticatedPubkeys;
    if (pubkeys.length > 0) return pubkeys[pubkeys.length - 1];
    return this.authenticated ? (this.authentication?.pubkey ?? null) : null;
  }
  /** @deprecated use {@link authentications} instead */
  get authenticationResponse() {
    return this.authenticationResponse$.value;
  }
  get information() {
    return this._nip11;
  }
  get lastMessageAt() {
    return this._lastMessageAt$.value;
  }
  get reqs() {
    return this.reqs$.value;
  }

  /** How long to wait for an OK message from the relay (default 10s) */
  eventTimeout = 10_000;
  /** How long to wait for a publish to complete (default 30s) */
  publishTimeout = 30_000;
  /** Whole logical COUNT request timeout (default 10s) */
  countTimeout = 10_000;

  /** How long to keep the connection alive after nothing is subscribed (default 30s) */
  keepAlive = 30_000;

  /** Enable/disable ping functionality (default false) */
  enablePing = false;
  /** How often to send pings in milliseconds (default 29000) */
  pingFrequency = 29_000;
  /** How long to wait for EOSE response in milliseconds (default 20000) */
  pingTimeout = 20_000;

  /** Default retry config for subscription() connection errors */
  subscriptionReconnect: RetryConfig;
  /** Default retry config for request() connection errors */
  requestReconnect: RetryConfig;
  /** Default retry config for publish() method */
  publishRetry: RetryConfig;

  /** Policy hook for unresponsive connections */
  protected onUnresponsive?: RelayOptions["onUnresponsive"];

  // Subjects that track if an "auth-required" message has been received for REQ or EVENT
  protected receivedAuthRequiredForReq = new BehaviorSubject(false);
  protected receivedAuthRequiredForEvent = new BehaviorSubject(false);

  /**
   * D-03: the single surviving mapping from a wire verb to the legacy read/publish informational flags.
   * `REQ`, `COUNT`, and `NEG-OPEN` set `receivedAuthRequiredForReq`; `EVENT` sets
   * `receivedAuthRequiredForEvent`. Each branch is guarded by the subject's current value so a repeat
   * call is a no-op. The `default` branch assigns the narrowed `verb` to a `never`-typed local so a new
   * {@link RelayAuthWireVerb} member added later is a compile error here rather than a silent default.
   * WR-04: that branch is unreachable through the type system today, but this method is called from
   * inside a socket `map`/`tap`/`catchError` at every call site — a throw here would drop the whole
   * subscription instead of just leaving an informational flag stale, so it fails soft (a no-op) rather
   * than throwing.
   */
  protected receivedAuthRequiredFor(verb: RelayAuthWireVerb): void {
    switch (verb) {
      case "REQ":
      case "COUNT":
      case "NEG-OPEN":
        if (!this.receivedAuthRequiredForReq.value) this.receivedAuthRequiredForReq.next(true);
        break;
      case "EVENT":
        if (!this.receivedAuthRequiredForEvent.value) this.receivedAuthRequiredForEvent.next(true);
        break;
      default: {
        const exhaustive: never = verb;
        void exhaustive;
        return;
      }
    }
  }

  /**
   * Computed observables that track if auth is required for REQ
   * @deprecated
   */
  authRequiredForRead$: Observable<boolean>;

  /**
   * Computed observables that track if auth is required for EVENT
   * @deprecated
   */
  authRequiredForPublish$: Observable<boolean>;

  protected resetState() {
    // D-12/WR-02: read BEFORE the guarded clears below run, so the counts describe what is about to be
    // dropped rather than what has already been cleared. Makes the expected re-auth-per-reconnect
    // cycle legible as its own line instead of appearing as an unexplained disconnect. Uses
    // authenticatedPubkeys (filters on response?.ok === true), not a bare count of every entry in the
    // map: auth() inserts an entry with response: null the instant an AUTH is queued, so a bare
    // Object.keys(...).length also counts never-answered and rejected attempts as "authenticated
    // pubkeys" being dropped — a false positive in a line whose only job is to explain the re-auth cycle.
    const authenticatedCount = this.authenticatedPubkeys.length;
    const challengeHeld = this.challenge$.value !== null;
    // Count alone gates the line: a held challenge with nothing authenticated has no re-auth to explain.
    if (authenticatedCount > 0) {
      this.authLog(
        `Invalidating auth state on reset: dropping ${authenticatedCount} authenticated pubkey${authenticatedCount === 1 ? "" : "s"}${challengeHeld ? ", and the held challenge" : ""}`,
      );
    }

    // NOTE: only update the values if they need to be changed, otherwise this will cause an infinite loop
    if (this.challenge$.value !== null) this.challenge$.next(null);
    if (Object.keys(this.authentications$.value).length > 0) this.authentications$.next({});
    if (this.authenticationResponse$.value) this.authenticationResponse$.next(null);
    if (this.authentication$.value !== null) this.authentication$.next(null);
    if (this.notices$.value.length > 0) this.notices$.next([]);

    if (this.receivedAuthRequiredForReq.value) this.receivedAuthRequiredForReq.next(false);
    if (this.receivedAuthRequiredForEvent.value) this.receivedAuthRequiredForEvent.next(false);
  }

  /** An internal observable that is responsible for watching all messages and updating state, subscribing to it will trigger a connection to the relay */
  protected watchTower: Observable<never>;

  /** Long-lived state-watcher subscriptions created in the constructor (open/close/auth) */
  protected internalSubscriptions = new Subscription();

  /** The currently armed reconnect timer subscription, if any */
  protected reconnectSubscription: Subscription | null = null;

  /**
   * Fires when the relay is closed. Used to cancel the watchTower's keepAlive reset timer.
   * A ReplaySubject so a reset timer armed after close() is torn down immediately.
   */
  protected destroy$ = new ReplaySubject<void>(1);

  constructor(
    public url: string,
    opts?: RelayOptions,
  ) {
    // Derive off the still-url-less this.log for `Relay:auth:<url>` — must precede the line below.
    this.authLog = this.log.extend("auth").extend(url);
    this.log = this.log.extend(url);

    // Set common options
    if (opts?.eventTimeout !== undefined) this.eventTimeout = opts.eventTimeout;
    if (opts?.publishTimeout !== undefined) this.publishTimeout = opts.publishTimeout;
    if (opts?.countTimeout !== undefined) this.countTimeout = opts.countTimeout;
    if (opts?.keepAlive !== undefined) this.keepAlive = opts.keepAlive;
    if (opts?.enablePing !== undefined) this.enablePing = opts.enablePing;
    if (opts?.pingFrequency !== undefined) this.pingFrequency = opts.pingFrequency;
    if (opts?.pingTimeout !== undefined) this.pingTimeout = opts.pingTimeout;
    if (opts?.onUnresponsive !== undefined) this.onUnresponsive = opts.onUnresponsive;

    // Set retry configs
    this.subscriptionReconnect = normalizeRetryConfig(opts?.subscriptionReconnect);
    this.requestReconnect = normalizeRetryConfig(opts?.requestReconnect);
    this.publishRetry = { ...DEFAULT_RETRY_CONFIG, ...(opts?.publishRetry ?? {}) };

    // Create an observable of successfully authenticated pubkeys
    this.authenticatedPubkeys$ = this.authentications$.pipe(
      map((auths) =>
        Object.entries(auths)
          .filter(([, state]) => state.response?.ok === true)
          .map(([pubkey]) => pubkey),
      ),
    );

    // Create an observable that tracks boolean authentication state
    // NOTE: also watch the deprecated authenticationResponse$ subject so writing to it directly keeps working
    this.authenticated$ = combineLatest([this.authenticatedPubkeys$, this.authenticationResponse$]).pipe(
      map(([pubkeys, response]) => pubkeys.length > 0 || response?.ok === true),
      distinctUntilChanged(),
    );

    // Create an observable that returns the most recently authenticated pubkey, or null otherwise
    this.authenticatedAs$ = combineLatest([this.authenticatedPubkeys$, this.authenticated$, this.authentication$]).pipe(
      map(([pubkeys, authenticated, authEvent]) => {
        if (pubkeys.length > 0) return pubkeys[pubkeys.length - 1];
        return authenticated && authEvent ? authEvent.pubkey : null;
      }),
    );

    /** Use the static method to create a new reconnect method for this relay */
    this.reconnectTimer = Relay.createReconnectTimer(url);

    // Subscribe to open and close events
    this.internalSubscriptions.add(
      this.open$.subscribe(() => {
        this.log("Connected");
        this.connected$.next(true);
        this.attempts$.next(0);
        this.error$.next(null);

        // Reset to clean state
        this.resetState();
      }),
    );
    this.internalSubscriptions.add(
      this.close$.subscribe((event) => {
        if (this.connected$.value) this.log("Disconnected");
        else this.log("Failed to connect");

        // Changed the connected state to false
        if (this.connected$.value) this.connected$.next(false);

        // Increment the attempts counter
        this.attempts$.next(this.attempts$.value + 1);

        // Reset the state
        this.resetState();

        // Start the reconnect timer if the connection was not closed cleanly
        if (!event.wasClean) this.startReconnectTimer(event);
      }),
    );

    this.socket = webSocket({
      url,
      openObserver: this.open$,
      closeObserver: this.close$,
      closingObserver: this.closing$,
      WebSocketCtor: opts?.WebSocket,
    });

    // Create an observable to fetch the NIP-11 information document
    this.information$ = defer(() => {
      this.log("Fetching NIP-11 information document");
      return Relay.fetchInformationDocument(this.url);
    }).pipe(
      // if the fetch fails, return null
      catchError(() => of(null)),
      // update the internal state
      tap((info) => (this._nip11 = info)),
      // cache the result
      shareReplay(1),
    );
    this.limitations$ = this.information$.pipe(map((info) => (info ? info.limitation : null)));
    this.supported$ = this.information$.pipe(
      map((info) =>
        info && Array.isArray(info.supported_nips) ? info.supported_nips.filter((n) => typeof n === "number") : null,
      ),
    );
    this.icon$ = this.information$.pipe(
      map((info) => info?.icon || new URL("/favicon.ico", ensureHttpURL(this.url)).toString()),
    );

    // Create observables that track if auth is required for REQ or EVENT
    this.authRequiredForRead$ = this.receivedAuthRequiredForReq;
    this.authRequiredForPublish$ = this.receivedAuthRequiredForEvent;

    // Create status$ observable by combining state observables
    this.status$ = combineLatest({
      url: of(this.url),
      connected: this.connected$,
      authenticated: this.authenticated$,
      authenticatedAs: this.authenticatedAs$,
      authenticatedPubkeys: this.authenticatedPubkeys$,
      authentications: this.authentications$,
      ready: this._ready$,
      authRequiredForRead: this.authRequiredForRead$,
      authRequiredForPublish: this.authRequiredForPublish$,
      challenge: this.challenge$.asObservable(),
    }).pipe(shareReplay(1));

    // Update the notices state
    const listenForNotice = this.socket.pipe(
      // listen for NOTICE messages
      filter((m) => Array.isArray(m) && m[0] === "NOTICE"),
      // pick the string out of the message
      map((m) => m[1]),
      // Track all notices
      scan((acc, notice) => [...acc, notice], [] as string[]),
      // Update the notices state
      tap((notices) => this.notices$.next(notices)),
    );

    // Update the challenge state
    const ListenForChallenge = this.socket.pipe(
      // listen for AUTH messages
      filter((message) => message[0] === "AUTH"),
      // pick the challenge string out
      map((m) => m[1]),
      // Update the challenge state
      tap((challenge) => {
        this.authLog(`Relay sent NIP-42 auth challenge: ${truncateForLog(challenge)}`);
        this.challenge$.next(challenge);
      }),
    );

    const allMessagesSubject = new Subject<any>();
    const listenForAllMessages = this.socket.pipe(
      tap((message) => {
        // Update the last message received at timestamp
        const now = Date.now();
        this.lastMessageReceivedAt = now;
        this._lastMessageAt$.next(now);

        // Pass to the message subject
        allMessagesSubject.next(message);
      }),
    );

    // Create passive observables for messages and notices
    this.message$ = allMessagesSubject.asObservable();
    this.notice$ = this.message$.pipe(
      // listen for NOTICE messages
      filter((m) => Array.isArray(m) && m[0] === "NOTICE"),
      // pick the string out of the message
      map((m) => m[1]),
    );

    // Create ping health check observable
    const pingHealthCheck = this.connected$.pipe(
      // Switch based on connection state
      switchMap((connected) => {
        // Only run when connected and ping is enabled
        if (!connected || !this.enablePing) return NEVER;

        // Start timer that emits periodically
        return timer(this.pingFrequency, this.pingFrequency).pipe(
          // For each ping, create a dummy REQ and wait for EOSE
          mergeMap(() => {
            // Skip ping if we have received a message in the last pingFrequency milliseconds
            if (Date.now() - this.lastMessageReceivedAt < this.pingFrequency) return NEVER;

            // Generate unique ping ID for correlation
            const pingId = "ping:" + nanoid();
            this.send(["REQ", pingId, PING_FILTER]);

            // Wait for the EOSE or CLOSED response for this specific ping
            return this.message$.pipe(
              // Wait specifically for response to OUR ping
              filter((m) => Array.isArray(m) && (m[0] === "EOSE" || m[0] === "CLOSED") && m[1] === pingId),
              // Complete after first matching message received
              take(1),
              // Add timeout to detect unresponsive connections
              timeout({
                first: this.pingTimeout,
                with: () => {
                  // Determine action via policy hook (default: reconnect)
                  const now = Date.now();
                  const action =
                    this.onUnresponsive?.({
                      url: this.url,
                      lastMessageAt: this.lastMessageReceivedAt,
                      now,
                      attempts: this.attempts$.value,
                    }) ?? "reconnect";

                  const err = new Error(`Relay ping timeout after ${this.pingTimeout}ms`);

                  if (action === "reconnect") {
                    this.log("Relay connection has become unresponsive, triggering reconnect");
                    this.startReconnectTimer(err);
                  } else if (action === "close") {
                    this.log("Relay connection has become unresponsive, closing connection");
                    this.error$.next(err);
                    this.socket.complete();
                  } else {
                    // "ignore" - log but don't take action
                    this.log("Relay connection has become unresponsive (ignoring per policy)");
                  }

                  return NEVER;
                },
              }),
              // Close the ping subscription when done
              finalize(() => this.send(["CLOSE", pingId])),
            );
          }),
        );
      }),
      // Catch errors to prevent breaking the watchTower
      catchError(() => NEVER),
    );

    // A single shared watcher for the socket. Its created once (outside of the switchMap below) so
    // that re-subscribing within the keepAlive window rejoins the SAME watcher instead of creating
    // a duplicate one (which would process every relay message multiple times)
    const watchers = merge(listenForAllMessages, listenForNotice, ListenForChallenge, pingHealthCheck).pipe(
      // Never emit any values
      ignoreElements(),
      // Start the reconnect timer if the connection has an error.
      // NOTE: this must be upstream of the share so it still observes the error when all
      // subscribers have already been torn down by the same error. Completing (instead of
      // switching to NEVER) resets the share so the next subscription makes a fresh connection
      catchError((error) => {
        this.startReconnectTimer(error instanceof Error ? error : new Error("Connection error"));
        return EMPTY;
      }),
      // Keep the connection alive for keepAlive ms after the last subscriber leaves, cancelled when the relay is closed
      share({ resetOnRefCountZero: () => timer(this.keepAlive).pipe(takeUntil(this.destroy$)) }),
    );

    // Merge all watchers
    this.watchTower = this.ready$.pipe(
      // Only start the watch tower if the relay is ready
      switchMap((ready) => (ready ? watchers : NEVER)),
      // There should only be a single watch tower
      share(),
    );
  }

  /** Set ready = false and start the reconnect timer */
  protected startReconnectTimer(error: Error | CloseEvent) {
    if (!this.ready) return;

    this.error$.next(error instanceof Error ? error : new Error("Connection error"));
    this._ready$.next(false);

    // Cancel any previously armed reconnect timer before arming a new one
    this.reconnectSubscription?.unsubscribe();
    this.reconnectSubscription = this.reconnectTimer(error, this.attempts$.value)
      .pipe(take(1))
      .subscribe(() => {
        this.reconnectSubscription = null;
        this._ready$.next(true);
      });
  }

  /** Whether a specific pubkey (or all of an array of pubkeys) is authenticated on the connection */
  isAuthenticated(pubkeys: string | string[]): boolean {
    const required = Array.isArray(pubkeys) ? pubkeys : [pubkeys];
    return required.every((pubkey) => this.authentications$.value[pubkey]?.response?.ok === true);
  }

  /** An observable that emits whether a specific pubkey (or all of an array of pubkeys) is authenticated */
  authenticatedFor$(pubkeys: string | string[]): Observable<boolean> {
    const required = Array.isArray(pubkeys) ? pubkeys : [pubkeys];
    return this.authentications$.pipe(
      map((auths) => required.every((pubkey) => auths[pubkey]?.response?.ok === true)),
      distinctUntilChanged(),
    );
  }

  /** Convert an auth requirement into an observable of whether it is satisfied */
  protected authSatisfied$(requirement: AuthRequirement): Observable<boolean> {
    if (typeof requirement === "boolean") return this.authenticated$;
    return this.authenticatedFor$(requirement);
  }

  /**
   * Compute the pubkeys not yet authenticated for an {@link AuthRequirement}, for {@link RelayAuthContext.missingPubkeys}.
   * `true` returns null (any authenticated user satisfies it, so no specific pubkeys are "missing").
   * A single pubkey returns an empty array when already authenticated, a one-element array otherwise.
   * An array returns only the entries `isAuthenticated` reports false for.
   */
  protected missingPubkeysFor(requirement: AuthRequirement): string[] | null {
    if (typeof requirement === "boolean") return null;
    if (typeof requirement === "string") return this.isAuthenticated(requirement) ? [] : [requirement];
    return requirement.filter((pubkey) => !this.isAuthenticated(pubkey));
  }

  /**
   * D-08: compute the pubkeys that currently satisfy an {@link AuthRequirement} — the join key an
   * operation track hangs its "now waiting for …" line off. `true` is satisfied by any authenticated
   * pubkey, so the whole current set is returned wholesale. A string or array requirement returns only
   * the required pubkeys that are already authenticated.
   */
  protected satisfiedPubkeysFor(requirement: AuthRequirement): string[] {
    if (typeof requirement === "boolean") return this.authenticatedPubkeys;
    const required = Array.isArray(requirement) ? requirement : [requirement];
    return required.filter((pubkey) => this.isAuthenticated(pubkey));
  }

  /** Assemble the {@link RelayAuthContext} passed to a caller's `onAuthRequired` handler (RAUTH-01) */
  protected buildAuthContext(
    request: RelayAuthWireRequest,
    requirement: AuthRequirement,
    reason: string,
  ): RelayAuthContext {
    return {
      relay: this,
      url: this.url,
      challenge: this.challenge,
      request,
      requirement,
      missingPubkeys: this.missingPubkeysFor(requirement),
      reason,
    };
  }

  /**
   * Thin `Relay`-side adapter over the shared `authRetry` operator (`operators/auth-retry.ts`, D-04).
   * Resolves `waitForAuth`/`onAuthRequired`/`authTimeout`/`authRetries` off `opts` (defaults: waitForAuth
   * true, authTimeout 30_000, authRetries 1) and injects the three terminal error constructors here so the
   * value-level dependency stays one-way — `relay.ts` imports the operator module, never the reverse, and
   * D-01 keeps auth-required value-shaped across this multi-hop operator chain; terminal
   * `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError` instances are constructed at its caller boundary.
   * `isProgress` is required (CR-01) — every call site must state what counts as progress for its
   * own stream shape; there is no permissive default.
   *
   * SEND/LISTEN INVARIANT (13-10, closing CR-02/CR-03 as a class rather than per-site): any call site
   * that pipes through this adapter must construct its send side effect and its signal-terminating
   * listen chain together, per attempt, inside one unshared `defer` — nothing that completes on the
   * auth-required signal may be hoisted to call scope. `authRetry`'s internal resubscribe (below) can be
   * driven synchronously, from inside the very CLOSED/OK dispatch that delivered the auth-required
   * signal, by a synchronous `onAuthRequired` handler; a call-scoped, already-terminating listen chain
   * lets that resubscribe's send reach the wire while its reply is never observed (CR-02 on `req()`,
   * CR-03 on `count()`) or, if the listen chain never terminates at all (`event()`'s `messages`), the
   * invariant is trivially satisfied without a restructure. `event()` (13-05), `req()` (13-09), and
   * `count()` (13-10) each independently rediscovered and fixed this same defect class one call site at
   * a time — this comment, plus 13-10's Task 3 per-site audit (recorded in that plan's SUMMARY), exists
   * so the next call site added to this adapter checks itself against a written invariant instead of
   * needing its own reentrancy bug found by a future verifier.
   */
  protected authRetryOperator<T extends unknown = unknown>(
    describeRequest: () => RelayAuthWireRequest,
    opts: RelayAuthOptions | undefined,
    gate: AuthPhaseGate,
    isProgress: ProgressPredicate<T>,
    counter?: { consecutive: number },
  ): OperatorFunction<T | AuthRequiredSignal, T> {
    const waitForAuth = opts?.waitForAuth ?? true;
    const authTimeout = opts?.authTimeout ?? 30_000;
    const authRetries = opts?.authRetries ?? 1;

    return authRetry<T>({
      counter,
      waitForAuth,
      onAuthRequired: opts?.onAuthRequired,
      authTimeout,
      authRetries,
      isProgress,
      // A thunk, not a value: req()'s filters can change over the life of the subscription, so the
      // summary must describe the request as it stood when the relay refused it, not as it stands now.
      buildContext: (reason) => this.buildAuthContext(describeRequest(), waitForAuth, reason),
      authSatisfied$: (requirement) => this.authSatisfied$(requirement),
      satisfiedPubkeys: () => this.satisfiedPubkeysFor(waitForAuth),
      gate,
      log: this.authLog,
      errors: {
        exhausted: (reason) => new AuthRequiredError(reason),
        handler: (reason, cause) => new AuthHandlerError(reason, cause),
        timeout: (reason) => new AuthTimeoutError(reason),
      },
    });
  }

  /** Wait for the relay to be ready to accept connections */
  protected waitForReady<T extends unknown = unknown>(observable: Observable<T>): Observable<T> {
    // Don't wait if the relay is already ready
    if (this.ready) return observable;
    else
      return this.ready$.pipe(
        // wait for ready to be true
        filter((ready) => ready),
        // complete after the first value so this does not repeat
        take(1),
        // switch to the observable
        switchMap(() => observable),
      );
  }

  multiplex<T>(open: () => any, close: () => any, filter: (message: any) => boolean): Observable<T> {
    return this.socket.multiplex(open, close, filter);
  }

  /** Send a message to the relay */
  send(message: any) {
    this.socket.next(message);
  }

  /**
   * Create a REQ observable that emits OPEN, EVENT, EOSE, and CLOSED messages.
   *
   * `resubscribe` only repeats after the relay sends a clean CLOSED message for this REQ.
   * `reconnect` only retries connection errors and does not retry relay CLOSED errors.
   */
  req(filters: FilterInput, opts?: RelayReqOptions & WithAuthPhaseGate): Observable<RelayReqMessage> {
    const id = opts?.id ?? nanoid();

    // Convert filters input into an observable, if its a normal value merge it with NEVER so it never completes
    let input: Observable<Filter[]>;

    // Create input from filters input
    if (typeof filters === "function") {
      const result = filters(this);
      input = (isObservable(result) ? result : merge(of(result), NEVER)).pipe(map((f) => (Array.isArray(f) ? f : [f])));
    } else {
      input = (isObservable(filters) ? filters : merge(of(filters), NEVER)).pipe(
        map((f) => (Array.isArray(f) ? f : [f])),
      );
    }

    // Create an observable that completes when the upstream observable completes
    const filtersComplete = input.pipe(ignoreElements(), endWith(true));

    // CR-02: customRepeatOperator's condition callback (below) is read AFTER the auth retry boundary,
    // once the attempt chain constructed inside the defer below has fully completed — by which point no
    // attempt-scoped local survives. Each attempt writes its own outcome into this call-scoped holder, so
    // the condition callback always observes the most recently completed attempt's result.
    const resubscribeHolder = { value: false };

    // D-04: use the gate an outer operation (e.g. request()) threaded in via the module-private
    // symbol key, or make a fresh one for this call. RAUTH-02: no pre-block here — the REQ is sent
    // immediately regardless of any other REQ's auth state; auth-required is handled entirely by
    // the shared operator below.
    const gate = opts?.[AUTH_PHASE_GATE] ?? new AuthPhaseGate();

    // A thunk (not a value) since this REQ's filters can change over the life of the subscription —
    // the wire request handed to onAuthRequired must describe the filters as they stood when the relay
    // refused them. Filters are already tracked at the send site (this.reqs$), so no new bookkeeping.
    const describeRequest = (): RelayAuthWireRequest => ({ verb: "REQ", id, filters: this.reqs$.value[id] ?? [] });

    return defer(() => {
      // CR-02: one auth attempt owns one send and one terminating listen chain, both constructed fresh
      // on every subscription to this defer — including the internal resubscription the shared auth
      // operator drives from inside its own CLOSED dispatch when a synchronous onAuthRequired handler
      // resolves the auth phase synchronously. Nothing that completes on the auth-required signal is
      // hoisted above this defer, so a synchronous resubscribe can never rejoin a still-connected
      // share() and silently skip the resend (mirrors event()'s 13-05 send/listen split).

      // Track whether the relay already sent CLOSED so we skip the redundant client CLOSE. Attempt-scoped
      // (CR-02): a stale value carried over from a prior attempt would send a redundant CLOSE for a REQ
      // the relay already closed, or skip the CLOSE for this attempt's own still-open REQ.
      let relayClosedSub = false;

      // Create an observable that filters responses from the relay to just the ones for this REQ.
      // Per-attempt: a fresh chain, so a resend after an auth-required signal always registers its own
      // socket filters and its own inclusive takeWhile rather than rejoining a chain that already
      // completed for the previous attempt.
      const messages: Observable<RelayReqMessage | AuthRequiredSignal> = this.socket.pipe(
        filter((m) => Array.isArray(m) && (m[0] === "EVENT" || m[0] === "CLOSED" || m[0] === "EOSE") && m[1] === id),
        // Map NIP-01 messages to RelayReqMessage
        map<any, RelayReqMessage>((m) => {
          if (m[0] === "EVENT" && typeof m[2] === "object")
            return { type: "EVENT", from: this.url, id: m[1], event: m[2] } satisfies RelayReqEventMessage;
          if (m[0] === "CLOSED")
            return { type: "CLOSED", from: this.url, id: m[1], reason: m[2] ?? "" } satisfies RelayReqClosedMessage;
          // EOSE
          return { type: "EOSE", from: this.url, id: m[1] } satisfies RelayReqEoseMessage;
        }),
        // D-01/D-02/D-03: auth-required crosses a multi-hop operator chain, so signal it as a value
        // that the shared auth operator consumes; every other prefixed CLOSED still throws its typed error
        // unchanged. Mark relay-closed before takeWhile sees either outcome.
        map<RelayReqMessage, RelayReqMessage | AuthRequiredSignal>((m) => {
          if (m.type === "CLOSED") {
            relayClosedSub = true;

            // D-01/D-02/D-03: only multi-hop auth-required is signalled as a value; check the reason prefix
            // directly (mirrors event()'s existing value-signal check) rather than parsing then
            // narrowing by instanceof
            if (m.reason.startsWith(AUTH_REQUIRED_PREFIX)) {
              this.authLog(
                `Relay refused ${describeWireRequest(describeRequest())} — authentication required: ${truncateForLog(m.reason)}`,
              );
              this.receivedAuthRequiredFor("REQ");
              return authRequiredSignal(m.reason);
            }

            const error = parseClosedError(m.reason);
            if (error) throw error;
            resubscribeHolder.value = true;
          }
          return m;
        }),
        // Complete the stream on unprefixed CLOSED or an auth-required signal, emitting it last (inclusive)
        takeWhile((m) => !isAuthRequiredSignal(m) && m.type !== "CLOSED", true),
        // Singleton within this attempt only (prevents the switchMap below and the takeUntil notifier
        // from registering two separate socket filters for the same attempt)
        share(),
      );

      // Create an observable that controls sending the filters and closing the REQ. Per-attempt: this
      // send side effect always re-runs when this defer's factory runs, independent of any share()
      // reset timing — the fix for CR-02's "REQ never written to the socket at all" symptom.
      const control = input.pipe(
        // Send the filters when they change
        map((filters) => {
          // Reset closed flag on each new REQ (resubscribe cycles within this attempt)
          relayClosedSub = false;
          resubscribeHolder.value = false;
          this.socket.next(["REQ", id, ...filters]);
          // Add to tracking when REQ is sent
          this.reqs$.next({ ...this.reqs$.value, [id]: filters });

          return { type: "OPEN", id, filters, from: this.url } satisfies RelayReqOpenMessage;
        }),
        // Send CLOSE when unsubscribed or input completes, but not if relay already sent CLOSED
        finalize(() => {
          if (!relayClosedSub) this.socket.next(["CLOSE", id]);
          // Remove from tracking when REQ closes
          const { [id]: _, ...rest } = this.reqs$.value;
          this.reqs$.next(rest);
        }),
        // Once filters have been sent, switch to listening for messages
        switchMap((openMessage) =>
          messages.pipe(
            // Pass along the OPEN message for listeners
            startWith(openMessage),
          ),
        ),
      );

      // Start the watch tower with this attempt's observables. Deliberately NOT share()'d here (CR-02):
      // the returned pipe's own share() (below) already dedupes downstream subscribers and sits outside
      // the auth retry boundary where it belongs; a share() on this attempt-scoped observable would
      // reintroduce the same reentrancy race this restructuring removes.
      const observable = merge(this.watchTower, control).pipe(
        // Complete when messages completes (e.g. unprefixed CLOSED = graceful relay close)
        takeUntil(messages.pipe(ignoreElements(), endWith(true))),
        // Complete the subscription when the input is completed
        takeUntil(filtersComplete),
        // mark events as from relays
        tap((message) => {
          if (!isAuthRequiredSignal(message) && message.type === "EVENT") addSeenRelay(message.event, this.url);
        }),
      );

      return this.waitForReady(observable);
    }).pipe(
      // D-04/D-09: the shared auth-retry operator drives the whole read auth phase, innermost in the pipe.
      // CR-01: isReqProgress excludes the synthetic OPEN bookkeeping message from resetting the retry budget.
      this.authRetryOperator(describeRequest, opts, gate, isReqProgress),
      // Retry connection errors independently from relay CLOSED errors
      this.customConnectionRetryOperator(opts?.reconnect),
      // Resubscribe only after the relay cleanly CLOSED this REQ — reads the most recently completed
      // attempt's outcome via the call-scoped holder (CR-02: no attempt-scoped local survives to this point)
      this.customRepeatOperator(opts?.resubscribe, () => resubscribeHolder.value),
      // Only create one upstream subscription
      share(),
    );
  }

  /** Create a COUNT observable that emits a single count response */
  count(filters: Filter | Filter[], id = nanoid(), opts?: RelayCountOptions): Observable<RelayCountResponse> {
    // D-04: count owns both the auth operator and its own clock in this one method, unlike
    // request()/req() — nothing needs threading via AUTH_PHASE_GATE. Call-scoped: one gate spans every
    // attempt of this count() call, which is what lets suspendableTimeout suspend its clock across
    // every auth phase rather than resetting per attempt.
    const gate = new AuthPhaseGate();
    const authCounter = { consecutive: 0 };

    // A thunk describing the wire request this COUNT sent, for the shared operator's onAuthRequired context.
    const describeRequest = (): RelayAuthWireRequest => ({
      verb: "COUNT",
      id,
      filters: Array.isArray(filters) ? filters : [filters],
    });

    // D-04/D-09: the shared auth-retry operator drives the whole read auth phase. RAUTH-02: no
    // pre-block here — the COUNT is sent immediately regardless of any other operation's auth state.
    // Annotated explicitly so the `with` callback below can't leak a `never` inference back into it.
    // COUNT responses carry no bookkeeping value of their own, so every response is real progress.
    const authOperator: OperatorFunction<RelayCountResponse | AuthRequiredSignal, RelayCountResponse> =
      this.authRetryOperator(describeRequest, opts, gate, () => true, authCounter);

    return defer(() => {
      // CR-03: mirrors req()'s CR-02 fix — one auth attempt owns one send and one terminating listen
      // chain, both constructed fresh on every subscription to this defer, including the internal
      // resubscription the shared auth operator drives from inside its own CLOSED dispatch when a
      // synchronous onAuthRequired handler resolves the auth phase synchronously. Nothing that
      // completes on the auth-required signal is hoisted above this defer, so a synchronous resubscribe
      // always reaches a live listen chain instead of rejoining one that already terminated (mirrors
      // event()'s 13-05 and req()'s 13-09 send/listen splits).

      // Track whether the relay already sent CLOSED so we skip the redundant client CLOSE.
      // Attempt-scoped (CR-03): a stale value from a prior attempt would send a redundant CLOSE for a
      // COUNT the relay already closed.
      let relayClosedSub = false;
      let transportClose: CloseEvent | undefined;
      const closeSubscription = this.close$.subscribe((event) => (transportClose = event));

      // Create an observable that filters responses from the relay to just the ones for this COUNT.
      // Per-attempt: a fresh chain, so a resend after an auth-required signal always registers its own
      // socket filters and its own inclusive takeWhile rather than rejoining a chain that already
      // completed for the previous attempt.
      const messages: Observable<RelayCountResponse | AuthRequiredSignal> = this.socket.pipe(
        filter((m) => Array.isArray(m) && (m[0] === "COUNT" || m[0] === "CLOSED") && m[1] === id),
        // Map to typed response. D-01/D-02/D-03: multi-hop auth-required is signalled as a value (the
        // shared auth operator consumes and never forwards it) — check the reason prefix directly
        // (mirrors req()'s existing value-signal check) rather than parsing then narrowing by
        // instanceof. Every other recognized CLOSED prefix still throws its typed error unchanged.
        map<any, RelayCountResponse | AuthRequiredSignal | null>((m) => {
          if (m[0] === "COUNT") return parseRelayCountResponse(m[2]);
          else if (m[0] === "CLOSED") {
            relayClosedSub = true;
            const reason = m[2] ?? "";

            if (reason.startsWith(AUTH_REQUIRED_PREFIX)) {
              this.authLog(
                `Relay refused ${describeWireRequest(describeRequest())} — authentication required: ${truncateForLog(reason)}`,
              );
              this.receivedAuthRequiredFor("COUNT");
              return authRequiredSignal(reason);
            }

            throw parseClosedError(reason) ?? new RelayClosedError(reason);
          }
          return null;
        }),
        // Complete the stream on any CLOSED (including graceful close) or an auth-required signal,
        // emitting it last (inclusive)
        takeWhile((m) => m !== null && !isAuthRequiredSignal(m), true),
        filter((m): m is RelayCountResponse | AuthRequiredSignal => m !== null),
        // Singleton within this attempt only
        share(),
      );

      // Send the COUNT message and listen for response. Per-attempt: this send side effect always
      // re-runs when this defer's factory runs, independent of any share() reset timing — the fix for
      // CR-03's "resend never reaches a live listen chain" symptom.
      const control = defer(() => {
        // Send the COUNT message when subscription starts
        this.socket.next(Array.isArray(filters) ? ["COUNT", id, ...filters] : ["COUNT", id, filters]);

        return messages;
      }).pipe(
        // Send CLOSE when unsubscribed, but not if relay already sent CLOSED
        finalize(() => {
          if (!relayClosedSub) this.socket.next(["CLOSE", id]);
        }),
      );

      const countObservable = merge(this.watchTower, control).pipe(
        // Complete when messages completes (unprefixed CLOSED = graceful relay close, or the terminal
        // auth-required signal)
        takeUntil(messages.pipe(ignoreElements(), endWith(true))),
      );

      return this.waitForReady(countObservable).pipe(
        // A clean socket completion before COUNT is still a failed request. Convert it before the
        // reconnect operator so callers receive a typed terminal error instead of EmptyError (or a
        // value-less successful completion), and so this application-level failure is not retried.
        defaultIfEmpty(null),
        mergeMap((response) =>
          response !== null
            ? of(response)
            : timer(0).pipe(
                mergeMap(() =>
                  throwError(() =>
                    transportClose && !transportClose.wasClean
                      ? transportClose
                      : new RelayCountResponseError("COUNT completed without a response"),
                  ),
                ),
              ),
        ),
        finalize(() => closeSubscription.unsubscribe()),
      );
    }).pipe(
      authOperator,
      this.customRetryOperator(
        opts?.retries ?? opts?.reconnect ?? true,
        this.publishRetry,
        isReconnectableTransportError,
      ),
      // Complete on the first (genuine) COUNT response (COUNT responses are single-shot)
      take(1),
      // D-01: one configurable whole-logical-request deadline spans readiness, retry and backoff.
      // countTimeout defaults to 10 seconds, suspends during auth, and expires terminally outside retry.
      opts?.timeout === false
        ? identity
        : suspendableTimeout<RelayCountResponse>(opts?.timeout === true ? this.countTimeout : (opts?.timeout ?? this.countTimeout), gate, {
            firstWhen: () => true,
            with: () => throwError(() => new RelayCountTimeoutError(this.url)),
          }),
      share(),
    );
  }

  /** Shared readiness-aware one-frame/one-matching-OK exchange for EVENT and AUTH. */
  private eventExchange(event: NostrEvent, verb: "EVENT" | "AUTH"): Observable<PublishResponse> {
    // D-01: each subscription creates one fresh listener and one write. Readiness is outside this
    // defer, so the fixed reply clock begins only after the socket is ready and the frame is written.
    return this.waitForReady(
      defer(() => {
        const messages = this.socket.pipe(
          filter((m) => m[0] === "OK" && m[1] === event.id),
          map((m): PublishResponse => {
            const ok = m[2] as boolean;
            const message = m[3] as string;
            return {
              ok,
              message,
              from: this.url,
              ...(ok ? {} : { error: new RelayEventVerdictError(message) }),
            };
          }),
          take(1),
          timeout({ first: this.eventTimeout, with: () => throwError(() => new RelayEventTimeoutError(this.url)) }),
          share(),
        );

        const control = defer(() => {
          if (verb === "AUTH") this.authLog(`Sending AUTH event for pubkey ${event.pubkey}`);
          this.socket.next([verb, event]);
          return messages;
        });

        return merge(this.watchTower, control).pipe(
          takeUntil(messages.pipe(ignoreElements(), endWith(true))),
          take(1),
        );
      }),
    );
  }

  /** Send one EVENT frame and observe its matching OK response. */
  event(event: NostrEvent): Observable<PublishResponse> {
    return this.eventExchange(event, "EVENT").pipe(
      map((response) => {
        if (!response.ok && response.message?.startsWith(AUTH_REQUIRED_PREFIX)) {
          this.authLog(
            `Relay refused ${describeWireRequest({ verb: "EVENT", event })} — authentication required: ${truncateForLog(response.message)}`,
          );
          this.receivedAuthRequiredFor("EVENT");
          throw new AuthRequiredError(response.message);
        }
        return response;
      }),
    );
  }

  /** Create a cancellable AUTH exchange and update authentication state only while it remains subscribed. */
  private authExchange(event: NostrEvent, cancel$: Observable<unknown> = NEVER): Observable<PublishResponse> {
    const authEvent = event as KnownEvent<kinds.ClientAuth>;
    const attempt = Symbol("AUTH attempt");
    this.authAttemptTokens.set(event.pubkey, attempt);
    this.latestAuthAttempt = attempt;

    // Save the authentication event (deprecated mirror of the most recent AUTH attempt)
    this.authentication$.next(authEvent);

    // Record the pending AUTH attempt keyed by pubkey (re-insert so key order reflects recency)
    const { [event.pubkey]: _replaced, ...rest } = this.authentications$.value;
    this.authentications$.next({ ...rest, [event.pubkey]: { event: authEvent, response: null } });

    // D-10/WR-03: the "Sending AUTH event" line itself lives inside eventExchange()'s control defer (the
    // actual write side effect, guarded to the AUTH-verb path), not here — logging it here fired even
    // when a reconnect was armed and waitForReady deferred the write indefinitely, so the line was
    // sometimes not a statement of fact. The fixed AUTH route reaches that defer for every caller of
    // auth() (including one who signed their own AUTH event and called auth() directly), so nothing is
    // lost by moving it.
    let releaseTurn!: () => void;
    const turn = new Promise<void>((resolve) => (releaseTurn = resolve));
    const previous = this.authEventQueues.get(event.id) ?? Promise.resolve();
    const tail = previous.catch(() => {}).then(() => turn);
    this.authEventQueues.set(event.id, tail);
    void tail.then(() => {
      if (this.authEventQueues.get(event.id) === tail) this.authEventQueues.delete(event.id);
    });

    return from(previous.catch(() => {})).pipe(
      takeUntil(cancel$),
      switchMap(() =>
        this.eventExchange(event, "AUTH").pipe(
          takeUntil(cancel$),
          tap((result) => {
            // Update keyed and deprecated mirrors only if this is still the latest logical attempt.
            if (this.authAttemptTokens.get(event.pubkey) === attempt)
              this.authentications$.next({
                ...this.authentications$.value,
                [event.pubkey]: { event: authEvent, response: result },
              });
            if (this.latestAuthAttempt === attempt) this.authenticationResponse$.next(result);

            // D-09: the connection track's result line — the relay's own OK message carried verbatim (only
            // bounded) as the "why", joined to the challenge/signing/sent lines above by the full pubkey.
            this.authLog(
              `Relay ${result.ok ? "accepted" : "rejected"} AUTH for ${event.pubkey}: ${truncateForLog(result.message)}`,
            );
          }),
        ),
      ),
      finalize(() => releaseTurn()),
    );
  }

  /** Send an AUTH message. Can be called multiple times with events from different pubkeys to authenticate multiple users */
  auth(event: NostrEvent): Promise<PublishResponse> {
    return lastValueFrom(this.authExchange(event));
  }

  /** Negentropy sync event ids with the relay and an event store */
  async negentropy(
    store: NegentropyReadStore,
    filter: Filter,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean> {
    // Check relay supports NIP-77 sync
    if ((await this.getSupported())?.includes(77) === false) throw new Error("Relay does not support NIP-77");

    // Import negentropy functions dynamically
    const { buildStorageVector, buildStorageFromFilter, negentropySync, NegentropyError } =
      await import("./negentropy.js");

    // Build the storage vector fresh for each negotiation attempt (so an auth retry re-negotiates cleanly)
    const buildStorage = async () =>
      Array.isArray(store) ? buildStorageVector(store) : await buildStorageFromFilter(store, filter);

    // D-05: minted once per negentropy() call, before the runSync defer factory, so the NEG-OPEN id stays
    // stable across every auth retry of this call — the shared auth operator resubscribes runSync on every
    // retry, and an id minted inside the factory would identify an attempt rather than the operation.
    const negOpenId = nanoid();

    // A thunk describing the wire request this negotiation opened, for the shared operator's
    // onAuthRequired context. Declared after negOpenId so the id is stable across auth retries (D-05).
    const describeRequest = (): RelayAuthWireRequest => ({ verb: "NEG-OPEN", id: negOpenId, filter });

    // Run a single negentropy negotiation. D-02: a NegentropyError from negentropySync is still translated
    // at this edge — its reason is parsed by parseClosedError, because translating a lower layer's error at
    // the boundary is not throw-as-signal. What changes is the result: when the parse yields
    // AuthRequiredError, the translation produces an auth-required signal value instead of re-throwing
    // (D-01), keeping expected state value-shaped across this multi-hop chain and flipping the informational
    // flag at the same point so authRequiredForRead$ keeps updating
    // (RAUTH-09). Every other parsed prefix still re-throws its typed error, and an unparseable reason
    // still re-throws the original.
    const runSync: Observable<boolean | AuthRequiredSignal> = defer(() =>
      from(buildStorage().then((storage) => negentropySync(storage, this.socket, filter, reconcile, opts, negOpenId))),
    ).pipe(
      catchError((err) => {
        if (err instanceof NegentropyError) {
          const parsed = parseClosedError(err.reason);
          if (parsed instanceof AuthRequiredError) {
            this.authLog(
              `Relay refused ${describeWireRequest(describeRequest())} — authentication required: ${truncateForLog(parsed.reason)}`,
            );
            this.receivedAuthRequiredFor("NEG-OPEN");
            return of(authRequiredSignal(parsed.reason));
          }
          if (parsed) return throwError(() => parsed);
        }
        return throwError(() => err);
      }),
    );

    // D-04: negentropy() has no operation-level clock of its own (that's sync()'s to manage), so nothing
    // needs threading via AUTH_PHASE_GATE here — construct a fresh gate locally.
    const gate = new AuthPhaseGate();

    // D-04/D-09: the shared auth-retry operator drives the whole auth flow, delegating handler invocation,
    // the per-phase timeout, retry counting/reset and error mapping. RAUTH-02: no pre-block — the
    // negotiation starts immediately regardless of any other operation's auth state. The boolean
    // negotiation result carries no bookkeeping value of its own, so every value is real progress.
    const observable: Observable<boolean> = runSync.pipe(
      this.authRetryOperator(describeRequest, opts, gate, () => true),
    );

    // Resolve to false if aborted while waiting for auth (before negentropySync starts handling the signal itself)
    const signal = opts?.signal;
    if (!signal) return firstValueFrom(observable);

    const abort$ = new Observable<boolean>((observer) => {
      if (signal.aborted) {
        observer.next(false);
        observer.complete();
        return;
      }
      const onAbort = () => {
        observer.next(false);
        observer.complete();
      };
      signal.addEventListener("abort", onAbort);
      return () => signal.removeEventListener("abort", onAbort);
    });

    return firstValueFrom(merge(observable, abort$).pipe(take(1)));
  }

  /** Authenticate with bounded challenge acquisition, signing, freshness checks, and one raw AUTH verdict. */
  authenticate(signer: AuthSigner, opts?: RelayAuthenticateOptions): Promise<PublishResponse> {
    return (async () => {
      const signal = opts?.signal;
      const retries = opts?.challengeRetries ?? 1;
      const cancel$ = new Subject<void>();
      let abandoned = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let removeAbort = () => {};
      let rejectCancellation!: (reason: unknown) => void;
      const cancellation = new Promise<never>((_, reject) => (rejectCancellation = reject));

      const abortReason = () => {
        if (signal?.reason !== undefined) return signal.reason;
        return new DOMException("The operation was aborted", "AbortError");
      };
      const abandon = (reason: unknown, stage: "timeout" | "abort") => {
        if (abandoned) return;
        abandoned = true;
        this.authLog(`${stage === "timeout" ? "Timed out" : "Aborted"} AUTH operation`);
        rejectCancellation(reason);
        cancel$.next();
        cancel$.complete();
      };

      if (signal) {
        const onAbort = () => abandon(abortReason(), "abort");
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
      }
      if (opts?.timeout !== false) {
        timeoutId = setTimeout(
          () => abandon(new RelayAuthChallengeTimeoutError(this.url), "timeout"),
          opts?.timeout ?? this.publishTimeout,
        );
      }

      const bounded = <T>(value: Promise<T>): Promise<T> => Promise.race([value, cancellation]);
      const waitForChallenge = async (): Promise<string> => {
        this.authLog("Waiting for NIP-42 authentication challenge");
        return bounded(
          firstValueFrom(
            merge(
              this.challenge$.pipe(filter((challenge): challenge is string => challenge !== null)),
              this.watchTower,
            ).pipe(takeUntil(cancel$), take(1)),
          ),
        );
      };

      try {
        let changes = 0;
        while (true) {
          const challenge = await waitForChallenge();
          if (abandoned) return await cancellation;

          this.authLog(`Signing AUTH event for challenge ${truncateForLog(challenge)}, waiting on signer`);
          const event = await bounded(Promise.resolve().then(() => signer.signEvent(makeAuthEvent(this.url, challenge))));
          if (abandoned) return await cancellation;

          if (this.challenge !== challenge) {
            changes += 1;
            this.authLog(`AUTH challenge changed after signing; discarding candidate and re-signing (${changes}/${retries})`);
            if (changes > retries) throw new RelayAuthChallengeChangedError(this.url);
            continue;
          }

          return await bounded(lastValueFrom(this.authExchange(event, cancel$)));
        }
      } finally {
        abandoned = true;
        cancel$.next();
        cancel$.complete();
        removeAbort();
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    })();
  }

  /**
   * Classifier-supplied retry policy shared by the high-level publish and COUNT families.
   * Each caller supplies a positive allow-list; all other failures are re-thrown immediately.
   * The call-scoped auth counter persists across transient resubscriptions, enforcing the additive
   * `1 + authRetries + retries` EVENT-write bound.
   */
  protected customRetryOperator<T extends unknown = unknown>(
    times: undefined | boolean | number | RetryConfig,
    base?: RetryConfig,
    classifier: (error: unknown) => boolean = isRetryablePublishError,
  ): MonoTypeOperatorFunction<T> {
    if (times === false || times === undefined) return identity;

    const config: RetryConfig =
      typeof times === "number" ? { ...base, count: times } : times === true ? (base ?? {}) : { ...base, ...times };

    return retry({
      ...config,
      delay: (error, count) => {
        if (!classifier(error)) return throwError(() => error);

        if (typeof config.delay === "number") return timer(config.delay);
        if (typeof config.delay === "function") return config.delay(error, count);
        return of(null);
      },
    });
  }

  /** Internal operator for retrying connection failures without retrying relay CLOSED errors */
  protected customConnectionRetryOperator<T extends unknown = unknown>(
    times: undefined | boolean | number | RetryConfig,
    base?: RetryConfig,
  ): MonoTypeOperatorFunction<T> {
    if (times === false || times === undefined) return identity;

    const config: RetryConfig =
      typeof times === "number" ? { ...base, count: times } : times === true ? (base ?? {}) : { ...base, ...times };

    return retry({
      ...config,
      delay: (error, count) => {
        if (error instanceof RelayClosedError) return throwError(() => error);

        if (typeof config.delay === "number") return timer(config.delay);
        if (typeof config.delay === "function") return config.delay(error, count);
        return of(null);
      },
    });
  }

  /** Internal operator for creating the repeat() operator, optionally gated by a condition */
  protected customRepeatOperator<T extends unknown = unknown>(
    times: undefined | boolean | number | RepeatConfig | undefined,
    condition?: () => boolean,
  ): MonoTypeOperatorFunction<T> {
    if (times === false || times === undefined) return identity;

    const delay = (repeatCount: number) => {
      if (condition && !condition()) return EMPTY;

      if (typeof times === "object") {
        if (typeof times.delay === "number") return timer(times.delay);
        if (typeof times.delay === "function") return times.delay(repeatCount);
      }

      return of(null);
    };

    if (times === true) return repeat({ delay });
    else if (typeof times === "number") return repeat({ count: times, delay });
    else return repeat({ ...times, delay });
  }

  /**
   * Internal operator for creating a suspendable timeout() operator whose countdown does not advance
   * while `gate` is in an auth phase (D-15) — used by `publish()` so `publishTimeout` gets its full
   * budget for the real work once the auth phase closes, rather than racing `authTimeout`. Preserves
   * the same false/true/number semantics the prior bare-timeout helper had. Do NOT "simplify" this back
   * to a bare rxjs timeout(), which cannot pause. `firstWhen` is required (CR-01/WR-01) — the sole
   * caller states what counts as progress for its own stream shape; there is no permissive default.
   */
  protected customSuspendableTimeoutOperator<T extends unknown = unknown>(
    timeout: undefined | boolean | number,
    defaultTimeout: number,
    gate: AuthPhaseGate,
    firstWhen: ProgressPredicate<T>,
  ): MonoTypeOperatorFunction<T> {
    // Do nothing if disabled
    if (timeout === false) return identity;
    // If true default to defaultTimeout
    else if (timeout === true) return suspendableTimeout<T>(defaultTimeout, gate, { firstWhen });
    // Otherwise use the timeout value or default to defaultTimeout
    else return suspendableTimeout<T>(timeout ?? defaultTimeout, gate, { firstWhen });
  }

  /** Creates a persistent REQ that retries connection errors (default 3 retries) */
  subscription(filters: FilterInput, opts?: RelaySubscriptionOptions): Observable<RelaySubscriptionResponse> {
    return this.req(filters, {
      ...opts,
      reconnect: opts?.reconnect ?? this.subscriptionReconnect,
    }).pipe(
      // Filter for EOSE messages
      filter((message) => message.type === "EOSE" || message.type === "EVENT"),
      // Extract EOSE messages
      map((message) => (message.type === "EOSE" ? "EOSE" : message.event)),
      // Single subscription
      share(),
    );
  }

  /** Makes a single request that retries connection errors and completes on EOSE */
  request(filters: FilterInput, opts?: RelayRequestOptions): Observable<RelayRequestResponse> {
    // D-15: a dedicated gate for this operation's REQ, threaded into req() via the module-private
    // symbol key so this method's own operation clock (below) can suspend across req()'s auth phase
    const gate = new AuthPhaseGate();

    const req = this.req(filters, {
      ...opts,
      reconnect: opts?.reconnect ?? this.requestReconnect,
      [AUTH_PHASE_GATE]: gate,
    });

    return req.pipe(
      // Add completion condition
      opts?.complete ? completeWhen(opts?.complete) : identity,
      // D-15: suspend the operation clock across the auth phase so it does not race authTimeout's own
      // clock — do NOT "simplify" this back to a bare rxjs timeout(), which cannot pause. WR-01:
      // isReqProgress excludes req()'s synthetic OPEN so it can no longer cancel this clock before the
      // relay has said anything.
      suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: isReqProgress }),
      // Complete when EOSE is received
      takeWhile((message) => message.type !== "EOSE"),
      // Filter only for event messages
      filter((message) => message.type === "EVENT"),
      // Extract event messages
      map((message) => message.event),
      // Single subscription
      share(),
    );
  }

  /** Publishes an event to the relay and retries when relay errors or responds with auth-required ( default 3 retries ) */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse> {
    // D-07/D-15: all policy state is created once for this publish call. event() remains the raw,
    // readiness-aware one-attempt primitive and knows nothing about this gate or these options.
    const gate = new AuthPhaseGate();
    const authCounter = { consecutive: 0 };
    const describeRequest = (): RelayAuthWireRequest => ({ verb: "EVENT", event });
    const attempt = defer(() =>
      this.event(event).pipe(
        catchError((error) =>
          error instanceof AuthRequiredError ? of(authRequiredSignal(error.reason)) : throwError(() => error),
        ),
      ),
    );

    return lastValueFrom(
      attempt.pipe(
        this.authRetryOperator(describeRequest, opts, gate, () => true, authCounter),
        // Retry the publish until it succeeds or the number of retries is reached. D-07: with
        // customRetryOperator's RelayClosedError skip, terminal auth failures are never retried here.
        this.customRetryOperator(opts?.retries ?? opts?.reconnect ?? true, this.publishRetry),
        // D-15: suspend publishTimeout across the auth phase so it does not run while waiting for auth,
        // and gets its full budget for the real work afterwards. PublishResponse carries no bookkeeping
        // value, so every response is real progress.
        this.customSuspendableTimeoutOperator(opts?.timeout, this.publishTimeout, gate, () => true),
      ),
    );
  }

  /** Negentropy sync events with the relay and an event store */
  sync(
    store: NegentropySyncStore,
    filters: Filter,
    direction: SyncDirection = SyncDirection.RECEIVE,
    opts?: RelaySyncOptions,
  ): Observable<NostrEvent> {
    const getEvents = async (ids: string[]) => {
      if (Array.isArray(store)) return store.filter((event) => ids.includes(event.id));
      else return store.getByFilters({ ids });
    };

    // RAUTH-08: extract the forwarded auth option set once so all three of the relay operations sync()
    // performs — the negentropy negotiation, the SEND-direction event() calls, and the RECEIVE-direction
    // req() — carry the same caller-supplied bounds, so a future added field cannot land on two of the
    // three sites instead of all three.
    const authOptions: RelayAuthOptions = {
      waitForAuth: opts?.waitForAuth,
      onAuthRequired: opts?.onAuthRequired,
      authTimeout: opts?.authTimeout,
      authRetries: opts?.authRetries,
    };

    return new Observable<NostrEvent>((observer) => {
      const controller = new AbortController();
      let cleanupCalled = false;

      // Store reference to cleanup the negentropy properly
      const cleanup = () => {
        if (!cleanupCalled) {
          cleanupCalled = true;
          controller.abort();
        }
      };

      this.negentropy(
        store,
        filters,
        async (have, need) => {
          // NOTE: it may be more efficient to sync all the events later in a single batch

          // Send missing events to the relay
          if (direction & SyncDirection.SEND && have.length > 0) {
            const events = await getEvents(have);

            // Send all events to the relay, marking them as seen on this relay once accepted.
            // The events were not fetched from the relay, but after a successful publish the relay has them.
            await Promise.allSettled(
              events.map(async (event) => {
                // RAUTH-08/Phase 15: forward the caller's auth options — leaving this call unthreaded
                // would make it default to waitForAuth: true with no handler and wait the 30s default
                // for an unrelated pubkey, entirely disconnected from what the caller configured.
                const response = await this.publish(event, authOptions);
                if (response.ok) addSeenRelay(event, this.url);
                return response;
              }),
            );
          }

          // Fetch missing events from the relay
          if (direction & SyncDirection.RECEIVE && need.length > 0) {
            await lastValueFrom(
              // RAUTH-08/Phase 15: forward the caller's auth options here too — same rationale as the
              // SEND-direction event() call above.
              this.req({ ids: need }, authOptions).pipe(
                // Complete when EOSE is received
                takeWhile((message) => message.type !== "EOSE"),
                // Filter only for event messages
                filter((message) => message.type === "EVENT"),
                // Extract event messages
                map((message) => message.event),
                // Add events to the store if its writable
                Reflect.has(store, "add")
                  ? mapEventsToStore(store as unknown as IEventStoreActions | IAsyncEventStoreActions)
                  : identity,
                // Pass events to observer
                tap((event) => observer.next(event)),
              ),
            );
          }
        },
        { signal: controller.signal, ...authOptions },
      )
        // Complete the observable when the sync is complete
        .then(() => {
          if (!cleanupCalled) observer.complete();
        })
        // Error the observable when the sync fails
        .catch((err) => {
          if (!cleanupCalled) observer.error(err);
        });

      // Cancel the sync when the observable is unsubscribed
      return cleanup;
    }).pipe(
      // Only create one upstream subscription
      share(),
    );
  }

  /**
   * Force close the connection and tear down all internal subscriptions and timers.
   * @note This is a terminal operation; the relay should be discarded after calling it.
   */
  close() {
    // Cancel the watchTower's keepAlive reset timer armed at refcount-zero (and any future one)
    this.destroy$.next();
    this.destroy$.complete();

    // Cancel any pending reconnect timer so it cannot fire (or hold the event loop open) after close
    this.reconnectSubscription?.unsubscribe();
    this.reconnectSubscription = null;

    // Tear down the constructor state watchers (open/close/auth)
    this.internalSubscriptions.unsubscribe();

    // Mark as disconnected since the close$ watcher has been torn down
    if (this.connected$.value) this.connected$.next(false);

    // Terminate the watchTower source: flip ready to false (trips the startReconnectTimer guard)
    // and complete it so a subscriber still holding the watchTower can't re-arm reconnect on teardown
    this._ready$.next(false);
    this._ready$.complete();

    // Finally close the underlying socket
    this.socket.unsubscribe();
  }

  /** An async method that returns the NIP-11 information document for the relay */
  async getInformation(): Promise<RelayInformation | null> {
    return firstValueFrom(this.information$);
  }

  /** An async method that returns the NIP-11 limitations for the relay */
  async getLimitations(): Promise<RelayInformation["limitation"] | null> {
    return firstValueFrom(this.limitations$);
  }

  /** An async method that returns the supported NIPs for the relay */
  async getSupported(): Promise<number[] | null> {
    return firstValueFrom(this.supported$);
  }

  /** Static method to fetch the NIP-11 information document for a relay */
  static fetchInformationDocument(url: string): Observable<RelayInformation | null> {
    return from(
      fetch(ensureHttpURL(url), { headers: { Accept: "application/nostr+json" } }).then((res) => res.json()),
    ).pipe(
      // if the fetch fails, return null
      catchError(() => of(null)),
      // timeout after 10s
      simpleTimeout(10_000),
    );
  }

  /** Static method to create a reconnection method for each relay */
  static createReconnectTimer(_relay: string) {
    return (_error?: Error | CloseEvent, tries = 0) => {
      // Calculate delay with exponential backoff: 2^attempts * 1000ms
      // with a maximum delay of 5 minutes (300000ms)
      const delay = Math.min(Math.pow(1.5, tries) * 1000, 300000);

      // Return a timer that will emit after the calculated delay
      return timer(delay);
    };
  }

  /** A complete condition that waits for the subscription to open */
  static afterOpen(condition: RelayRequestCompleteOperator): RelayRequestCompleteOperator {
    return (source) =>
      source.pipe(
        // Wait for subscription open
        filter((m) => m.type === "OPEN"),
        // Switch to timer for complete
        switchMap(() => source.pipe(condition)),
      );
  }

  /** An OR complete condition, that completes when either condition is truthy */
  static completeOr(...conditions: RelayRequestCompleteOperator[]): RelayRequestCompleteOperator {
    return (source) =>
      combineLatest(conditions.map((condition) => source.pipe(condition, startWith(false)))).pipe(
        // Return true if any condition is truthy
        map((all) => all.some((v) => !!v)),
      );
  }

  /** An AND complete condition, that completes when all conditions are truthy */
  static completeAnd(...conditions: RelayRequestCompleteOperator[]): RelayRequestCompleteOperator {
    return (source) =>
      combineLatest(conditions.map((condition) => source.pipe(condition, startWith(false)))).pipe(
        // Return true if all conditions are truthy
        map((all) => all.every((v) => !!v)),
      );
  }

  /** A default complete condition that waits for the subscription to open and then completes after a timeout */
  static defaultComplete(timeout: number, afterOpen = 10_000): RelayRequestCompleteOperator {
    return this.completeOr(
      () => timer(timeout),
      this.afterOpen(() => timer(afterOpen)),
    );
  }
}
