import { logger } from "applesauce-core";
import { ensureHttpURL } from "applesauce-core/helpers/url";
import { getToken } from "nostr-tools/nip98";
import { BehaviorSubject, from, Observable, shareReplay, throwError } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";

import { AuthSigner } from "./types.js";
import { Relay } from "./relay.js";

/** Base request structure for all NIP-86 requests */
export interface TRelayRequest<Method extends string, Params extends any[] = any[]> {
  /** The method to call */
  method: Method;
  /** Parameters for the method */
  params: Params;
}

/** Base response structure for all NIP-86 responses */
export type TRelayErrorResponse = {
  /** Error message, non-null in case of error */
  error: string;
  result: null;
};

export type TRelaySuccessResponse<Result> = {
  error: null;
  /** Result object, null in case of error */
  result: Result;
};

/** Merged relay management method and response types */
export type TRelayMethod<Method extends string = string, Params extends any[] = any[], Result extends any = any> = {
  /** Method string */
  method: Method;
  /** Request type */
  request: TRelayRequest<Method, Params>;
  /** Response success type */
  response: TRelaySuccessResponse<Result>;
  /** Response error type */
  error: TRelayErrorResponse;
};

// Relay Management Method Definitions

export type SupportedMethodsMethod = TRelayMethod<"supportedmethods", [], string[]>;
export type BanPubkeyMethod = TRelayMethod<"banpubkey", [string, string?], true>;
export type ListBannedPubkeysMethod = TRelayMethod<"listbannedpubkeys", [], Array<{ pubkey: string; reason?: string }>>;
export type AllowPubkeyMethod = TRelayMethod<"allowpubkey", [string, string?], true>;
export type ListAllowedPubkeysMethod = TRelayMethod<
  "listallowedpubkeys",
  [],
  Array<{ pubkey: string; reason?: string }>
>;
export type ListEventsNeedingModerationMethod = TRelayMethod<
  "listeventsneedingmoderation",
  [],
  Array<{ id: string; reason?: string }>
>;
export type AllowEventMethod = TRelayMethod<"allowevent", [string, string?], true>;
export type BanEventMethod = TRelayMethod<"banevent", [string, string?], true>;
export type ListBannedEventsMethod = TRelayMethod<"listbannedevents", [], Array<{ id: string; reason?: string }>>;
export type ChangeRelayNameMethod = TRelayMethod<"changerelayname", [string], true>;
export type ChangeRelayDescriptionMethod = TRelayMethod<"changerelaydescription", [string], true>;
export type ChangeRelayIconMethod = TRelayMethod<"changerelayicon", [string], true>;
export type AllowKindMethod = TRelayMethod<"allowkind", [number], true>;
export type DisallowKindMethod = TRelayMethod<"disallowkind", [number], true>;
export type ListAllowedKindsMethod = TRelayMethod<"listallowedkinds", [], number[]>;
export type BlockIpMethod = TRelayMethod<"blockip", [string, string?], true>;
export type UnblockIpMethod = TRelayMethod<"unblockip", [string], true>;
export type ListBlockedIpsMethod = TRelayMethod<"listblockedips", [], Array<{ ip: string; reason?: string }>>;

/** Union type for all relay management method definitions */
export type RelayManagementMethods =
  | SupportedMethodsMethod
  | BanPubkeyMethod
  | ListBannedPubkeysMethod
  | AllowPubkeyMethod
  | ListAllowedPubkeysMethod
  | ListEventsNeedingModerationMethod
  | AllowEventMethod
  | BanEventMethod
  | ListBannedEventsMethod
  | ChangeRelayNameMethod
  | ChangeRelayDescriptionMethod
  | ChangeRelayIconMethod
  | AllowKindMethod
  | DisallowKindMethod
  | ListAllowedKindsMethod
  | BlockIpMethod
  | UnblockIpMethod
  | ListBlockedIpsMethod;

/** Custom error for relay management operations */
export class RelayManagementError extends Error {
  constructor(
    message: string,
    public readonly method?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "RelayManagementError";
  }
}

/** RelayManagement class for NIP-86 relay management API */
export class RelayManagement {
  protected log: typeof logger = logger.extend("RelayManagement");
  protected httpUrl: string;

  // Internal refresh triggers for observables
  #refreshSupportMethods$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshBannedPubkeys$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshAllowedPubkeys$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshEventsNeedingModeration$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshBannedEvents$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshAllowedKinds$ = new BehaviorSubject<void | undefined>(undefined);
  #refreshBlockedIps$ = new BehaviorSubject<void | undefined>(undefined);

  constructor(
    public readonly relay: Relay,
    public readonly signer: AuthSigner,
  ) {
    this.log = this.log.extend(relay.url);
    this.httpUrl = ensureHttpURL(relay.url);
  }

  /**
   * Core request method that handles all RPC calls with NIP-98 authentication
   */
  async request<Method extends RelayManagementMethods>(
    method: Method["method"],
    params: Method["request"]["params"],
  ): Promise<Method["response"]["result"]> {
    const requestBody = {
      method,
      params,
    };
    const requestBodyString = JSON.stringify(requestBody);

    // Generate NIP-98 token using getToken from nostr-tools
    const authHeader = await getToken(
      this.httpUrl,
      "POST",
      (event) => this.signer.signEvent(event),
      true, // includeAuthorizationScheme - returns "Nostr <token>" format
      requestBody, // payload as object
    );

    // Make the HTTP request
    const response = await fetch(this.httpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/nostr+json+rpc",
        Authorization: authHeader,
      },
      body: requestBodyString,
    });

    // Handle HTTP errors
    if (!response.ok) {
      if (response.status === 401) {
        throw new RelayManagementError(
          "Unauthorized: Invalid or missing NIP-98 authentication",
          method,
          response.status,
        );
      }
      const errorText = await response.text().catch(() => "Unknown error");
      throw new RelayManagementError(`HTTP ${response.status}: ${errorText}`, method, response.status);
    }

    // Parse the response
    const data = await response.json();

    // Handle RPC errors
    if (data.error) {
      throw new RelayManagementError(`RPC error: ${data.error}`, method, response.status);
    }

    return data.result as Method["response"]["result"];
  }

  // Convenience methods for each RPC call

  /** Get list of supported methods */
  async supportedMethods(): Promise<string[]> {
    return this.request<SupportedMethodsMethod>("supportedmethods", []);
  }

  /** Ban a pubkey */
  async banPubkey(pubkey: string, reason?: string): Promise<true> {
    const result = await this.request<BanPubkeyMethod>("banpubkey", reason ? [pubkey, reason] : [pubkey]);
    this.#refreshBannedPubkeys$.next();
    return result;
  }

  /** List all banned pubkeys */
  async listBannedPubkeys(): Promise<Array<{ pubkey: string; reason?: string }>> {
    return this.request<ListBannedPubkeysMethod>("listbannedpubkeys", []);
  }

  /** Allow a pubkey */
  async allowPubkey(pubkey: string, reason?: string): Promise<true> {
    const result = await this.request<AllowPubkeyMethod>("allowpubkey", reason ? [pubkey, reason] : [pubkey]);
    this.#refreshAllowedPubkeys$.next();
    this.#refreshBannedPubkeys$.next(); // Also refresh banned list in case it was unbanned
    return result;
  }

  /** List all allowed pubkeys */
  async listAllowedPubkeys(): Promise<Array<{ pubkey: string; reason?: string }>> {
    return this.request<ListAllowedPubkeysMethod>("listallowedpubkeys", []);
  }

  /** List events needing moderation */
  async listEventsNeedingModeration(): Promise<Array<{ id: string; reason?: string }>> {
    return this.request<ListEventsNeedingModerationMethod>("listeventsneedingmoderation", []);
  }

  /** Allow an event */
  async allowEvent(eventId: string, reason?: string): Promise<true> {
    const result = await this.request<AllowEventMethod>("allowevent", reason ? [eventId, reason] : [eventId]);
    this.#refreshBannedEvents$.next(); // Also refresh banned list in case it was unbanned
    this.#refreshEventsNeedingModeration$.next();
    return result;
  }

  /** Ban an event */
  async banEvent(eventId: string, reason?: string): Promise<true> {
    const result = await this.request<BanEventMethod>("banevent", reason ? [eventId, reason] : [eventId]);
    this.#refreshBannedEvents$.next();
    this.#refreshEventsNeedingModeration$.next();
    return result;
  }

  /** List all banned events */
  async listBannedEvents(): Promise<Array<{ id: string; reason?: string }>> {
    return this.request<ListBannedEventsMethod>("listbannedevents", []);
  }

  /** Change relay name */
  async changeRelayName(name: string): Promise<true> {
    return this.request<ChangeRelayNameMethod>("changerelayname", [name]);
  }

  /** Change relay description */
  async changeRelayDescription(description: string): Promise<true> {
    return this.request<ChangeRelayDescriptionMethod>("changerelaydescription", [description]);
  }

  /** Change relay icon */
  async changeRelayIcon(iconUrl: string): Promise<true> {
    return this.request<ChangeRelayIconMethod>("changerelayicon", [iconUrl]);
  }

  /** Allow a kind */
  async allowKind(kind: number): Promise<true> {
    const result = await this.request<AllowKindMethod>("allowkind", [kind]);
    this.#refreshAllowedKinds$.next();
    return result;
  }

  /** Disallow a kind */
  async disallowKind(kind: number): Promise<true> {
    const result = await this.request<DisallowKindMethod>("disallowkind", [kind]);
    this.#refreshAllowedKinds$.next();
    return result;
  }

  /** List all allowed kinds */
  async listAllowedKinds(): Promise<number[]> {
    return this.request<ListAllowedKindsMethod>("listallowedkinds", []);
  }

  /** Block an IP address */
  async blockIp(ip: string, reason?: string): Promise<true> {
    const result = await this.request<BlockIpMethod>("blockip", reason ? [ip, reason] : [ip]);
    this.#refreshBlockedIps$.next();
    return result;
  }

  /** Unblock an IP address */
  async unblockIp(ip: string): Promise<true> {
    const result = await this.request<UnblockIpMethod>("unblockip", [ip]);
    this.#refreshBlockedIps$.next();
    return result;
  }

  /** List all blocked IPs */
  async listBlockedIps(): Promise<Array<{ ip: string; reason?: string }>> {
    return this.request<ListBlockedIpsMethod>("listblockedips", []);
  }

  // Reactive observables for list methods

  /** Observable that emits supported methods when subscribed */
  supportMethods$: Observable<string[]> = this.#refreshSupportMethods$.pipe(
    switchMap(() => from(this.supportedMethods())),
    catchError((error) => {
      this.log("Error fetching supported methods:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );

  /** Observable that emits banned pubkeys when subscribed */
  bannedPubkeys$: Observable<Array<{ pubkey: string; reason?: string }>> = this.#refreshBannedPubkeys$.pipe(
    switchMap(() => from(this.listBannedPubkeys())),
    catchError((error) => {
      this.log("Error fetching banned pubkeys:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );

  /** Observable that emits allowed pubkeys when subscribed */
  allowedPubkeys$: Observable<Array<{ pubkey: string; reason?: string }>> = this.#refreshAllowedPubkeys$.pipe(
    switchMap(() => from(this.listAllowedPubkeys())),
    catchError((error) => {
      this.log("Error fetching allowed pubkeys:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );

  /** Observable that emits events needing moderation when subscribed */
  eventsNeedingModeration$: Observable<Array<{ id: string; reason?: string }>> =
    this.#refreshEventsNeedingModeration$.pipe(
      switchMap(() => from(this.listEventsNeedingModeration())),
      catchError((error) => {
        this.log("Error fetching events needing moderation:", error);
        return throwError(() => error);
      }),
      shareReplay(1),
    );

  /** Observable that emits banned events when subscribed */
  bannedEvents$: Observable<Array<{ id: string; reason?: string }>> = this.#refreshBannedEvents$.pipe(
    switchMap(() => from(this.listBannedEvents())),
    catchError((error) => {
      this.log("Error fetching banned events:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );

  /** Observable that emits allowed kinds when subscribed */
  allowedKinds$: Observable<number[]> = this.#refreshAllowedKinds$.pipe(
    switchMap(() => from(this.listAllowedKinds())),
    catchError((error) => {
      this.log("Error fetching allowed kinds:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );

  /** Observable that emits blocked IPs when subscribed */
  blockedIps$: Observable<Array<{ ip: string; reason?: string }>> = this.#refreshBlockedIps$.pipe(
    switchMap(() => from(this.listBlockedIps())),
    catchError((error) => {
      this.log("Error fetching blocked IPs:", error);
      return throwError(() => error);
    }),
    shareReplay(1),
  );
}
