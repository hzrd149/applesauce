import {
  BehaviorSubject,
  combineLatest,
  filter,
  ignoreElements,
  map,
  merge,
  NEVER,
  Observable,
  of,
  scan,
  share,
  switchMap,
  take,
  takeWhile,
  tap,
  timeout,
} from "rxjs";
import { webSocket, WebSocketSubject, WebSocketSubjectConfig } from "rxjs/webSocket";
import { type Filter, type NostrEvent } from "nostr-tools";
import { nanoid } from "nanoid";
import { logger } from "applesauce-core";

import { markFromRelay } from "./operators/mark-from-relay.js";
import { IRelay, PublishResponse, SubscriptionResponse } from "./types.js";

export type RelayOptions = {
  WebSocket?: WebSocketSubjectConfig<any>["WebSocketCtor"];
};

export class Relay implements IRelay {
  protected log: typeof logger = logger.extend("Relay");
  protected socket: WebSocketSubject<any>;

  connected$ = new BehaviorSubject(false);
  challenge$ = new BehaviorSubject<string | null>(null);
  authenticated$ = new BehaviorSubject(false);
  notices$ = new BehaviorSubject<string[]>([]);

  /** An observable of all messages from the relay */
  message$: Observable<any>;

  /** An observable of NOTICE messages from the relay */
  notice$: Observable<string>;

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
    return this.authenticated$.value;
  }

  protected authRequiredForReq = new BehaviorSubject(false);
  protected authRequiredForPublish = new BehaviorSubject(false);

  protected resetState() {
    // NOTE: only update the values if they need to be changed, otherwise this will cause an infinite loop
    if (this.challenge$.value !== null) this.challenge$.next(null);
    if (this.authenticated$.value) this.authenticated$.next(false);
    if (this.notices$.value.length > 0) this.notices$.next([]);

    if (this.authRequiredForReq.value) this.authRequiredForReq.next(false);
    if (this.authRequiredForPublish.value) this.authRequiredForPublish.next(false);
  }

  /** An internal observable that is responsible for watching all messages and updating state */
  protected watchTower: Observable<never>;

  constructor(
    public url: string,
    opts?: RelayOptions,
  ) {
    this.log = this.log.extend(url);

    this.socket = webSocket({
      url,
      openObserver: {
        next: () => {
          this.log("Connected");
          this.connected$.next(true);
          this.resetState();
        },
      },
      closeObserver: {
        next: () => {
          this.log("Disconnected");
          this.connected$.next(false);
          this.resetState();
        },
      },
      WebSocketCtor: opts?.WebSocket,
    });

    this.message$ = this.socket.asObservable();

    this.notice$ = this.message$.pipe(
      // listen for NOTICE messages
      filter((m) => m[0] === "NOTICE"),
      // pick the string out of the message
      map((m) => m[1]),
    );

    // Update the notices state
    const notice = this.notice$.pipe(
      // Track all notices
      scan((acc, notice) => [...acc, notice], [] as string[]),
      // Update the notices state
      tap((notices) => this.notices$.next(notices)),
    );

    // Update the challenge state
    const challenge = this.message$.pipe(
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

    // Merge all watchers
    this.watchTower = merge(notice, challenge).pipe(
      // Never emit any values
      ignoreElements(),
      // There should only be a single watch tower
      share(),
    );
  }

  protected waitForAuth<T extends unknown = unknown>(
    requireAuth: Observable<boolean>,
    observable: Observable<T>,
  ): Observable<T> {
    return combineLatest([requireAuth, this.authenticated$]).pipe(
      // return EMPTY if auth is required and not authenticated
      switchMap(([required, authenticated]) => {
        if (required && !authenticated) return NEVER;
        else return observable;
      }),
    );
  }

  multiplex<T>(open: () => any, close: () => any, filter: (message: any) => boolean): Observable<T> {
    return this.socket.multiplex(open, close, filter);
  }

  req(filters: Filter | Filter[], id = nanoid()): Observable<SubscriptionResponse> {
    const request = this.socket
      .multiplex(
        () => (Array.isArray(filters) ? ["REQ", id, ...filters] : ["REQ", id, filters]),
        () => ["CLOSE", id],
        (message) => (message[0] === "EVENT" || message[0] === "CLOSE" || message[0] === "EOSE") && message[1] === id,
      )
      .pipe(
        // listen for CLOSE auth-required
        tap((m) => {
          if (m[0] === "CLOSE" && m[1].startsWith("auth-required") && !this.authRequiredForReq.value) {
            this.log("Auth required for REQ");
            this.authRequiredForReq.next(true);
          }
        }),
        // complete when CLOSE is sent
        takeWhile((m) => m[0] !== "CLOSE"),
        // pick event out of EVENT messages
        map<any[], SubscriptionResponse>((message) => {
          if (message[0] === "EOSE") return "EOSE";
          else return message[2] as NostrEvent;
        }),
        // mark events as from relays
        markFromRelay(this.url),
        // if no events are seen in 10s, emit EOSE
        // TODO: this should emit EOSE event if events are seen, the timeout should be for only the EOSE message
        timeout({
          first: 10_000,
          with: () => merge(of<SubscriptionResponse>("EOSE"), NEVER),
        }),
      );

    // Wait for auth if required and make sure to start the watch tower
    return this.waitForAuth(this.authRequiredForReq, merge(this.watchTower, request));
  }

  /** send an Event message */
  event(event: NostrEvent, verb: "EVENT" | "AUTH" = "EVENT"): Observable<PublishResponse> {
    const observable = this.socket
      .multiplex(
        () => [verb, event],
        () => void 0,
        (m) => m[0] === "OK" && m[1] === event.id,
      )
      .pipe(
        // format OK message
        map((m) => ({ ok: m[2], message: m[3], from: this.url })),
        // complete on first value
        take(1),
        // listen for OK auth-required
        tap(({ ok, message }) => {
          if (ok === false && message.startsWith("auth-required") && !this.authRequiredForPublish.value) {
            this.log("Auth required for publish");
            this.authRequiredForPublish.next(true);
          }
        }),
      );

    const withWatchTower = merge(this.watchTower, observable);

    // skip wait for auth if verb is AUTH
    if (verb === "AUTH") return withWatchTower;
    else return this.waitForAuth(this.authRequiredForPublish, withWatchTower);
  }

  /** send and AUTH message */
  auth(event: NostrEvent): Observable<{ ok: boolean; message?: string }> {
    return this.event(event, "AUTH").pipe(
      // update authenticated
      tap((result) => this.authenticated$.next(result.ok)),
    );
  }
}
