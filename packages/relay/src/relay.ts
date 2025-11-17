import { IAsyncEventStoreRead, IEventStoreRead, logger } from "applesauce-core";
import { ensureHttpURL, type FilterWithAnd } from "applesauce-core/helpers";
import { simpleTimeout } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import { nip42, type Filter, type NostrEvent } from "nostr-tools";
import { RelayInformation } from "nostr-tools/nip11";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
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
  mergeWith,
  MonoTypeOperatorFunction,
  NEVER,
  Observable,
  of,
  repeat,
  RepeatConfig,
  retry,
  RetryConfig,
  scan,
  share,
  shareReplay,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timeout,
  timer,
} from "rxjs";
import { webSocket, WebSocketSubject, WebSocketSubjectConfig } from "rxjs/webSocket";

import { type NegentropySyncOptions, type ReconcileFunction } from "./negentropy.js";
import { completeOnEose } from "./operators/complete-on-eose.js";
import { markFromRelay } from "./operators/mark-from-relay.js";
import {
  AuthSigner,
  CountResponse,
  FilterInput,
  IRelay,
  PublishOptions,
  PublishResponse,
  RequestOptions,
  SubscriptionOptions,
  SubscriptionResponse,
} from "./types.js";

const AUTH_REQUIRED_PREFIX = "auth-required:";
const DEFAULT_RETRY_CONFIG: RetryConfig = { count: 10, delay: 1000, resetOnSuccess: true };

/** Flags for the negentropy sync type */
export enum SyncDirection {
  RECEIVE = 1 << 0,
  SEND = 1 << 1,
  BOTH = SEND | RECEIVE,
}

/** An error that is thrown when a REQ is closed from the relay side */
export class ReqCloseError extends Error {}

export type RelayOptions = {
  /** Custom WebSocket implementation */
  WebSocket?: WebSocketSubjectConfig<any>["WebSocketCtor"];
  /** How long to wait for an EOSE message (default 10s) */
  eoseTimeout?: number;
  /** How long to wait for an OK message from the relay (default 10s) */
  eventTimeout?: number;
  /** How long to wait for a publish to complete (default 30s) */
  publishTimeout?: number;
  /** How long to keep the connection alive after nothing is subscribed (default 30s) */
  keepAlive?: number;
};

export class Relay implements IRelay {
  protected log: typeof logger = logger.extend("Relay");
  protected socket: WebSocketSubject<any>;

  /** Whether the relay is ready for subscriptions or event publishing. setting this to false will cause all .req and .event observables to hang until the relay is ready */
  protected ready$ = new BehaviorSubject(true);

  /** A method that returns an Observable that emits when the relay should reconnect */
  reconnectTimer: (error: CloseEvent | Error, attempts: number) => Observable<number>;

  /** How many times the relay has tried to reconnect */
  attempts$ = new BehaviorSubject(0);
  /** Whether the relay is connected */
  connected$ = new BehaviorSubject(false);
  /** The authentication challenge string from the relay */
  challenge$ = new BehaviorSubject<string | null>(null);
  /** Boolean authentication state (will be false if auth failed) */
  authenticated$: Observable<boolean>;
  /** The response to the last AUTH message sent to the relay */
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

  /** An observable that emits the NIP-11 information document for the relay */
  information$: Observable<RelayInformation | null>;
  protected _nip11: RelayInformation | null = null;

  /** An observable that emits the limitations for the relay */
  limitations$: Observable<RelayInformation["limitation"] | null>;

  /** An array of supported NIPs from the NIP-11 information document */
  supported$: Observable<number[] | null>;

  /** An observable that emits when underlying websocket is opened */
  open$ = new Subject<Event>();

  /** An observable that emits when underlying websocket is closed */
  close$ = new Subject<CloseEvent>();

  /** An observable that emits when underlying websocket is closing due to unsubscription */
  closing$ = new Subject<void>();

  // sync state
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
    return this.authenticationResponse?.ok === true;
  }
  get authenticationResponse() {
    return this.authenticationResponse$.value;
  }
  get information() {
    return this._nip11;
  }

  /** If an EOSE message is not seen in this time, emit one locally (default 10s)  */
  eoseTimeout = 10_000;
  /** How long to wait for an OK message from the relay (default 10s) */
  eventTimeout = 10_000;
  /** How long to wait for a publish to complete (default 30s) */
  publishTimeout = 30_000;

  /** How long to keep the connection alive after nothing is subscribed (default 30s) */
  keepAlive = 30_000;

  // Subjects that track if an "auth-required" message has been received for REQ or EVENT
  protected receivedAuthRequiredForReq = new BehaviorSubject(false);
  protected receivedAuthRequiredForEvent = new BehaviorSubject(false);

  // Computed observables that track if auth is required for REQ or EVENT
  authRequiredForRead$: Observable<boolean>;
  authRequiredForPublish$: Observable<boolean>;

  protected resetState() {
    // NOTE: only update the values if they need to be changed, otherwise this will cause an infinite loop
    if (this.challenge$.value !== null) this.challenge$.next(null);
    if (this.authenticationResponse$.value) this.authenticationResponse$.next(null);
    if (this.notices$.value.length > 0) this.notices$.next([]);

    if (this.receivedAuthRequiredForReq.value) this.receivedAuthRequiredForReq.next(false);
    if (this.receivedAuthRequiredForEvent.value) this.receivedAuthRequiredForEvent.next(false);
  }

  /** An internal observable that is responsible for watching all messages and updating state, subscribing to it will trigger a connection to the relay */
  protected watchTower: Observable<never>;

  constructor(
    public url: string,
    opts?: RelayOptions,
  ) {
    this.log = this.log.extend(url);

    // Set common options
    if (opts?.eoseTimeout !== undefined) this.eoseTimeout = opts.eoseTimeout;
    if (opts?.eventTimeout !== undefined) this.eventTimeout = opts.eventTimeout;
    if (opts?.publishTimeout !== undefined) this.publishTimeout = opts.publishTimeout;
    if (opts?.keepAlive !== undefined) this.keepAlive = opts.keepAlive;

    // Create an observable that tracks boolean authentication state
    this.authenticated$ = this.authenticationResponse$.pipe(map((response) => response?.ok === true));

    /** Use the static method to create a new reconnect method for this relay */
    this.reconnectTimer = Relay.createReconnectTimer(url);

    // Subscribe to open and close events
    this.open$.subscribe(() => {
      this.log("Connected");
      this.connected$.next(true);
      this.attempts$.next(0);
      this.error$.next(null);
      this.resetState();
    });
    this.close$.subscribe((event) => {
      this.log("Disconnected");
      this.connected$.next(false);
      this.attempts$.next(this.attempts$.value + 1);
      this.resetState();

      // Start the reconnect timer if the connection was not closed cleanly
      if (!event.wasClean) this.startReconnectTimer(event);
    });

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

    // Create observables that track if auth is required for REQ or EVENT
    this.authRequiredForRead$ = this.receivedAuthRequiredForReq;
    this.authRequiredForPublish$ = this.receivedAuthRequiredForEvent;

    // Log when auth is required
    this.authRequiredForRead$
      .pipe(
        filter((r) => r === true),
        take(1),
      )
      .subscribe(() => this.log("Auth required for REQ"));
    this.authRequiredForPublish$
      .pipe(
        filter((r) => r === true),
        take(1),
      )
      .subscribe(() => this.log("Auth required for EVENT"));

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
        this.log("Received AUTH challenge", challenge);
        this.challenge$.next(challenge);
      }),
    );

    const allMessagesSubject = new Subject<any>();
    const listenForAllMessages = this.socket.pipe(tap((message) => allMessagesSubject.next(message)));

    // Create passive observables for messages and notices
    this.message$ = allMessagesSubject.asObservable();
    this.notice$ = this.message$.pipe(
      // listen for NOTICE messages
      filter((m) => Array.isArray(m) && m[0] === "NOTICE"),
      // pick the string out of the message
      map((m) => m[1]),
    );

    // Merge all watchers
    this.watchTower = this.ready$.pipe(
      switchMap((ready) => {
        if (!ready) return NEVER;

        // Only start the watch tower if the relay is ready
        return merge(listenForAllMessages, listenForNotice, ListenForChallenge, this.information$).pipe(
          // Never emit any values
          ignoreElements(),
          // Start the reconnect timer if the connection has an error
          catchError((error) => {
            this.startReconnectTimer(error instanceof Error ? error : new Error("Connection error"));
            return NEVER;
          }),
          // Add keep alive timer to the connection
          share({ resetOnRefCountZero: () => timer(this.keepAlive) }),
        );
      }),
      // There should only be a single watch tower
      share(),
    );
  }

  /** Set ready = false and start the reconnect timer */
  protected startReconnectTimer(error: Error | CloseEvent) {
    if (!this.ready$.value) return;

    this.error$.next(error instanceof Error ? error : new Error("Connection error"));
    this.ready$.next(false);
    this.reconnectTimer(error, this.attempts$.value)
      .pipe(take(1))
      .subscribe(() => this.ready$.next(true));
  }

  /** Wait for authentication state, make connection and then wait for authentication if required */
  protected waitForAuth<T extends unknown = unknown>(
    // NOTE: require BehaviorSubject or shareReplay so it always has a value
    requireAuth: Observable<boolean>,
    observable: Observable<T>,
  ): Observable<T> {
    return combineLatest([requireAuth, this.authenticated$]).pipe(
      // Once the auth state is known, make a connection and watch for auth challenges
      mergeWith(this.watchTower),
      // wait for auth not required or authenticated
      filter(([required, authenticated]) => !required || authenticated),
      // complete after the first value so this does not repeat
      take(1),
      // switch to the observable
      switchMap(() => observable),
    );
  }

  /** Wait for the relay to be ready to accept connections */
  protected waitForReady<T extends unknown = unknown>(observable: Observable<T>): Observable<T> {
    // Don't wait if the relay is already ready
    if (this.ready$.value) return observable;
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

  /** Create a REQ observable that emits events or "EOSE" or errors */
  req(filters: FilterInput, id = nanoid()): Observable<SubscriptionResponse> {
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
    const filtersComplete = input.pipe(ignoreElements(), endWith(null));

    // Create an observable that filters responses from the relay to just the ones for this REQ
    const messages: Observable<any[]> = this.socket.pipe(
      filter((m) => Array.isArray(m) && (m[0] === "EVENT" || m[0] === "CLOSED" || m[0] === "EOSE") && m[1] === id),
      // Singleton (prevents the .pipe() operator later from sending two REQ messages )
      share(),
    );

    // Create an observable that controls sending the filters and closing the REQ
    const control = input.pipe(
      // Send the filters when they change
      tap((filters) => this.socket.next(["REQ", id, ...filters])),
      // Send the CLOSE message when unsubscribed or input completes
      finalize(() => this.socket.next(["CLOSE", id])),
      // Once filters have been sent, switch to listening for messages
      switchMap(() => messages),
    );

    // Start the watch tower with the observables
    const observable = merge(this.watchTower, control).pipe(
      // Complete the subscription when the control observable completes
      // This is to work around the fact that merge() waits for both observables to complete
      takeUntil(messages.pipe(ignoreElements(), endWith(true))),
      // Complete the subscription when the input is completed
      takeUntil(filtersComplete),
      // Map the messages to events, EOSE, or throw an error
      map<any[], SubscriptionResponse>((message) => {
        if (message[0] === "EOSE") return "EOSE";
        else if (message[0] === "CLOSED") throw new ReqCloseError(message[2]);
        else return message[2] as NostrEvent;
      }),
      this.handleAuthRequiredForReq("REQ"),
      // mark events as from relays
      markFromRelay(this.url),
      // if no events are seen in 10s, emit EOSE
      // TODO: this timeout should only emit EOSE after the last event is seen and no EOSE has been sent in (timeout ms)
      timeout({
        first: this.eoseTimeout,
        with: () => merge(of<SubscriptionResponse>("EOSE"), NEVER),
      }),
      // Only create one upstream subscription
      share(),
    );

    // Wait for auth if required and make sure to start the watch tower
    return this.waitForReady(this.waitForAuth(this.authRequiredForRead$, observable));
  }

  /** Create a COUNT observable that emits a single count response */
  count(filters: FilterWithAnd | FilterWithAnd[], id = nanoid()): Observable<CountResponse> {
    // Create an observable that filters responses from the relay to just the ones for this COUNT
    const messages: Observable<any[]> = this.socket.pipe(
      filter((m) => Array.isArray(m) && (m[0] === "COUNT" || m[0] === "CLOSED") && m[1] === id),
    );

    // Send the COUNT message and listen for response
    const observable = defer(() => {
      // Send the COUNT message when subscription starts
      this.socket.next(Array.isArray(filters) ? ["COUNT", id, ...filters] : ["COUNT", id, filters]);

      // Merge with watch tower to keep connection alive
      return merge(this.watchTower, messages);
    }).pipe(
      // Map the messages to count responses or throw an error
      map<any[], CountResponse>((message) => {
        if (message[0] === "COUNT") return message[2] as CountResponse;
        else throw new ReqCloseError(message[2]);
      }),
      this.handleAuthRequiredForReq("COUNT"),
      // Complete on first value (COUNT responses are single-shot)
      take(1),
      // Add timeout
      timeout({
        first: this.eoseTimeout,
        with: () => throwError(() => new Error("COUNT timeout")),
      }),
    );

    // Start the watch tower and wait for auth if required
    // Use share() to prevent multiple subscriptions from creating duplicate COUNT messages
    return this.waitForReady(this.waitForAuth(this.authRequiredForRead$, observable)).pipe(share());
  }

  /** Send an EVENT or AUTH message and return an observable of PublishResponse that completes or errors */
  event(event: NostrEvent, verb: "EVENT" | "AUTH" = "EVENT"): Observable<PublishResponse> {
    const messages: Observable<PublishResponse> = defer(() => {
      // Send event when subscription starts
      this.socket.next([verb, event]);

      return this.socket.pipe(
        filter((m) => m[0] === "OK" && m[1] === event.id),
        // format OK message
        map((m) => ({ ok: m[2] as boolean, message: m[3] as string, from: this.url })),
      );
    }).pipe(
      // Singleton (prevents the .pipe() operator later from sending two EVENT messages )
      share(),
    );

    // Start the watch tower and add complete operators
    const observable = merge(this.watchTower, messages).pipe(
      // Complete the subscription when the messages observable completes
      // This is to work around the fact that merge() waits for both observables to complete
      takeUntil(messages.pipe(ignoreElements(), endWith(true))),
      // complete on first value
      take(1),
      // listen for OK auth-required
      tap(({ ok, message }) => {
        if (ok === false && message?.startsWith(AUTH_REQUIRED_PREFIX) && !this.receivedAuthRequiredForEvent.value) {
          this.log("Auth required for publish");
          this.receivedAuthRequiredForEvent.next(true);
        }
      }),
      // if no message is seen in 10s, emit EOSE
      timeout({
        first: this.eventTimeout,
        with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
      }),
    );

    // skip wait for auth if verb is AUTH
    // Use share() to prevent multiple subscriptions from creating duplicate EVENT messages
    if (verb === "AUTH") return this.waitForReady(observable).pipe(share());
    else return this.waitForReady(this.waitForAuth(this.authRequiredForPublish$, observable)).pipe(share());
  }

  /** send and AUTH message */
  auth(event: NostrEvent): Promise<PublishResponse> {
    return lastValueFrom(
      this.event(event, "AUTH").pipe(
        // update authenticated
        tap((result) => this.authenticationResponse$.next(result)),
      ),
    );
  }

  /** Negentropy sync event ids with the relay and an event store */
  async negentropy(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: FilterWithAnd,
    reconcile: ReconcileFunction,
    opts?: NegentropySyncOptions,
  ): Promise<boolean> {
    // Check relay supports NIP-77 sync
    if ((await this.getSupported())?.includes(77) === false) throw new Error("Relay does not support NIP-77");

    // Import negentropy functions dynamically
    const { buildStorageVector, buildStorageFromFilter, negentropySync } = await import("./negentropy.js");

    const storage = Array.isArray(store) ? buildStorageVector(store) : await buildStorageFromFilter(store, filter);
    return negentropySync(storage, this.socket, filter, reconcile, opts);
  }

  /** Authenticate with the relay using a signer */
  authenticate(signer: AuthSigner): Promise<PublishResponse> {
    if (!this.challenge) throw new Error("Have not received authentication challenge");

    const p = signer.signEvent(nip42.makeAuthEvent(this.url, this.challenge));
    const start = p instanceof Promise ? from(p) : of(p);

    return lastValueFrom(start.pipe(switchMap((event) => this.auth(event))));
  }

  /** Internal operator for creating the retry() operator */
  protected customRetryOperator<T extends unknown = unknown>(
    times: undefined | boolean | number | RetryConfig,
    base?: RetryConfig,
  ): MonoTypeOperatorFunction<T> {
    if (times === false) return identity;
    else if (typeof times === "number") return retry({ ...base, count: times });
    else if (times === true) return base ? retry(base) : retry();
    else return retry({ ...base, ...times });
  }

  /** Internal operator for creating the repeat() operator */
  protected customRepeatOperator<T extends unknown = unknown>(
    times: undefined | boolean | number | RepeatConfig | undefined,
  ): MonoTypeOperatorFunction<T> {
    if (times === false || times === undefined) return identity;
    else if (times === true) return repeat();
    else if (typeof times === "number") return repeat(times);
    else return repeat(times);
  }

  /** Internal operator for creating the timeout() operator */
  protected customTimeoutOperator<T extends unknown = unknown>(
    timeout: undefined | boolean | number,
    defaultTimeout: number,
  ): MonoTypeOperatorFunction<T> {
    // Do nothing if disabled
    if (timeout === false) return identity;
    // If true default to 30 seconds
    else if (timeout === true) return simpleTimeout(defaultTimeout);
    // Otherwise use the timeout value or default to 30 seconds
    else return simpleTimeout(timeout ?? defaultTimeout);
  }

  /** Internal operator for handling auth-required errors from REQ/COUNT operations */
  protected handleAuthRequiredForReq(operation: "REQ" | "COUNT"): MonoTypeOperatorFunction<any> {
    return catchError((error) => {
      // Set auth required if the operation is closed with auth-required
      if (
        error instanceof ReqCloseError &&
        error.message.startsWith(AUTH_REQUIRED_PREFIX) &&
        !this.receivedAuthRequiredForReq.value
      ) {
        this.log(`Auth required for ${operation}`);
        this.receivedAuthRequiredForReq.next(true);
      }

      // Pass the error through
      return throwError(() => error);
    });
  }

  /** Creates a REQ that retries when relay errors ( default 3 retries ) */
  subscription(filters: FilterInput, opts?: SubscriptionOptions): Observable<SubscriptionResponse> {
    return this.req(filters, opts?.id).pipe(
      // Retry on connection errors
      this.customRetryOperator(opts?.retries ?? opts?.reconnect ?? true, DEFAULT_RETRY_CONFIG),
      // Create resubscribe logic (repeat operator)
      this.customRepeatOperator(opts?.resubscribe),
      // Single subscription
      share(),
    );
  }

  /** Makes a single request that retires on errors and completes on EOSE */
  request(filters: FilterInput, opts?: RequestOptions): Observable<NostrEvent> {
    return this.req(filters, opts?.id).pipe(
      // Retry on connection errors
      this.customRetryOperator(opts?.retries ?? opts?.reconnect ?? true, DEFAULT_RETRY_CONFIG),
      // Create resubscribe logic (repeat operator)
      this.customRepeatOperator(opts?.resubscribe),
      // Complete when EOSE is received
      completeOnEose(),
      // Single subscription
      share(),
    );
  }

  /** Publishes an event to the relay and retries when relay errors or responds with auth-required ( default 3 retries ) */
  publish(event: NostrEvent, opts?: PublishOptions): Promise<PublishResponse> {
    return lastValueFrom(
      this.event(event).pipe(
        mergeMap((result) => {
          // If the relay responds with auth-required, throw an error for the retry operator to handle
          if (result.ok === false && result.message?.startsWith(AUTH_REQUIRED_PREFIX))
            return throwError(() => new Error(result.message));

          return of(result);
        }),
        // Retry the publish until it succeeds or the number of retries is reached
        this.customRetryOperator(opts?.retries ?? opts?.reconnect ?? true, DEFAULT_RETRY_CONFIG),
        // Add timeout for publishing
        this.customTimeoutOperator(opts?.timeout, this.publishTimeout),
      ),
    );
  }

  /** Negentropy sync events with the relay and an event store */
  sync(
    store: IEventStoreRead | IAsyncEventStoreRead | NostrEvent[],
    filter: FilterWithAnd,
    direction: SyncDirection = SyncDirection.RECEIVE,
  ): Observable<NostrEvent> {
    const getEvents = async (ids: string[]) => {
      if (Array.isArray(store)) return store.filter((event) => ids.includes(event.id));
      else return store.getByFilters({ ids });
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
        filter,
        async (have, need) => {
          // NOTE: it may be more efficient to sync all the events later in a single batch

          // Send missing events to the relay
          if (direction & SyncDirection.SEND && have.length > 0) {
            const events = await getEvents(have);

            // Send all events to the relay
            await Promise.allSettled(events.map((event) => lastValueFrom(this.event(event))));
          }

          // Fetch missing events from the relay
          if (direction & SyncDirection.RECEIVE && need.length > 0) {
            await lastValueFrom(
              this.req({ ids: need }).pipe(
                completeOnEose(),
                tap((event) => observer.next(event)),
              ),
            );
          }
        },
        { signal: controller.signal },
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

  /** Force close the connection */
  close() {
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
}
