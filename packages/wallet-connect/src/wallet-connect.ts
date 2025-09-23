import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { simpleTimeout } from "applesauce-core";
import { EncryptionMethod } from "applesauce-core/helpers";
import { create, EventSigner } from "applesauce-factory";
import { finalizeEvent, getPublicKey, nip04, nip44, NostrEvent, verifyEvent } from "nostr-tools";
import {
  BehaviorSubject,
  defer,
  filter,
  firstValueFrom,
  from,
  fromEvent,
  identity,
  ignoreElements,
  lastValueFrom,
  map,
  merge,
  mergeMap,
  Observable,
  repeat,
  ReplaySubject,
  retry,
  share,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  timer,
  toArray,
} from "rxjs";

import { WalletRequestBlueprint } from "./blueprints/index.js";
import { createWalletError } from "./helpers/error.js";
import {
  createWalletAuthURI,
  GetBalanceResult,
  GetInfoResult,
  getPreferredEncryption,
  getWalletRequestEncryption,
  getWalletResponseRequestId,
  getWalletSupport,
  isValidWalletNotification,
  isValidWalletResponse,
  ListTransactionsResult,
  LookupInvoiceResult,
  MakeInvoiceParams,
  MakeInvoiceResult,
  NotificationType,
  parseWalletConnectURI,
  PayInvoiceResult,
  PayKeysendResult,
  supportsMethod,
  supportsNotifications,
  supportsNotificationType,
  unlockWalletNotification,
  unlockWalletResponse,
  WALLET_INFO_KIND,
  WALLET_LEGACY_NOTIFICATION_KIND,
  WALLET_NOTIFICATION_KIND,
  WALLET_RESPONSE_KIND,
  WalletAuthURI,
  WalletConnectEncryptionMethod,
  WalletConnectURI,
  WalletMethod,
  WalletNotification,
  WalletNotificationEvent,
  WalletRequest,
  WalletResponse,
  WalletResponseEvent,
  WalletSupport,
} from "./helpers/index.js";
import {
  getConnectionMethods,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
} from "./interop.js";

export type SerializedWalletConnect = WalletConnectURI;

export type WalletConnectOptions = NostrConnectionMethodsOptions & {
  /** The secret to use for the connection */
  secret: Uint8Array;
  /** The relays to use for the connection */
  relays: string[];
  /** The service pubkey to use for the connection (optional) */
  service?: string;
  /** Default timeout for RPC requests in milliseconds */
  timeout?: number;
};

export class WalletConnect {
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the client */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the client */
  static publishMethod: NostrPublishMethod | undefined = undefined;
  /** A fallback pool to use if none is pass in when creating the signer */
  static pool: NostrPool | undefined = undefined;

  /** A method that is called when an event needs to be published */
  protected publishMethod: NostrPublishMethod;
  /** The active nostr subscription method */
  protected subscriptionMethod: NostrSubscriptionMethod;

  /** The local client signer */
  public readonly secret: Uint8Array;
  protected readonly signer: EventSigner;

  /** The relays to use for the connection */
  public readonly relays: string[];

  /** The wallet service public key ( unset if waiting for service ) */
  public service$ = new BehaviorSubject<string | undefined>(undefined);
  public get service(): string | undefined {
    return this.service$.value;
  }

  /** Default timeout for requests */
  defaultTimeout: number;

  /** Observable for wallet info updates */
  support$: Observable<WalletSupport | null>;

  /** The preferred encryption method for the wallet */
  encryption$: Observable<WalletConnectEncryptionMethod>;

  /** Shared observable for all wallet response events and notifications */
  protected events$: Observable<NostrEvent>;

  /** Shared observable for all wallet notifications */
  notifications$: Observable<WalletNotification>;

  /** An internal observable for listening for the wallet service to connect */
  protected waitForService$: Observable<string>;

  constructor(options: WalletConnectOptions) {
    this.secret = options.secret;
    this.relays = options.relays;
    this.service$.next(options.service);
    this.defaultTimeout = options.timeout || 30000; // 30 second default timeout

    // Create a signer for the factory
    this.signer = {
      getPublicKey: async () => getPublicKey(this.secret),
      signEvent: async (draft) => finalizeEvent(draft, this.secret),
      nip04: {
        encrypt: async (pubkey, plaintext) => nip04.encrypt(this.secret, pubkey, plaintext),
        decrypt: async (pubkey, ciphertext) => nip04.decrypt(this.secret, pubkey, ciphertext),
      },
      nip44: {
        encrypt: async (pubkey, plaintext) => nip44.encrypt(plaintext, nip44.getConversationKey(this.secret, pubkey)),
        decrypt: async (pubkey, ciphertext) => nip44.decrypt(ciphertext, nip44.getConversationKey(this.secret, pubkey)),
      },
    };

    // Get the subscription and publish methods
    const { subscriptionMethod, publishMethod } = getConnectionMethods(options, WalletConnect);

    // Use arrow functions so "this" isn't bound to the signer
    this.subscriptionMethod = (relays, filters) => subscriptionMethod(relays, filters);
    this.publishMethod = (relays, event) => publishMethod(relays, event);

    // Create shared observable for all wallet events
    this.events$ = this.service$.pipe(
      switchMap((service) => {
        const client = getPublicKey(this.secret);

        // If the service is not known yet, subscribe to a wallet info event tagging the client
        if (!service)
          return from(this.subscriptionMethod(this.relays, [{ kinds: [WALLET_INFO_KIND], "#p": [client] }])).pipe(
            // Keep the connection open indefinitely
            repeat(),
            // Retry on connection failure
            retry(),
            // Ignore strings (support for applesauce-relay)
            filter((event) => typeof event !== "string"),
          );

        return from(
          this.subscriptionMethod(this.relays, [
            // Subscribe to response events
            {
              kinds: [WALLET_RESPONSE_KIND, WALLET_NOTIFICATION_KIND, WALLET_LEGACY_NOTIFICATION_KIND],
              "#p": [client],
              authors: [service],
            },
            // Subscribe to wallet info events
            { kinds: [WALLET_INFO_KIND], authors: [service] },
          ]),
        ).pipe(
          // Keep the connection open indefinitely
          repeat(),
          // Retry on connection failure
          retry(),
          // Ignore strings (support for applesauce-relay)
          filter((event) => typeof event !== "string"),
          // Only include events from the wallet service
          filter((event) => event.pubkey === service),
        );
      }),
      // Only create a single subscription to the relays
      share({
        resetOnRefCountZero: () => timer(60000), // Keep subscription open for 1 minute after last unsubscribe
      }),
    );

    this.support$ = this.events$.pipe(
      filter((event) => event.kind === WALLET_INFO_KIND),
      map((event) => getWalletSupport(event)),
      share({
        connector: () => new ReplaySubject<WalletSupport | null>(1),
        resetOnRefCountZero: () => timer(60000), // Keep info observable around for 1 minute after last unsubscribe
      }),
    );

    this.encryption$ = this.support$.pipe(map((info) => (info ? getPreferredEncryption(info) : "nip04")));

    this.notifications$ = this.events$.pipe(
      filter((event) => isValidWalletNotification(event)),
      mergeMap((event) => this.handleNotificationEvent(event)),
    );

    this.waitForService$ = this.events$.pipe(
      // Complete when the service is set
      takeUntil(this.service$),
      // Only listen for wallet info events
      filter((event) => event.kind === WALLET_INFO_KIND && !this.service),
      // Set the service to the pubkey of the wallet info event
      tap((event) => {
        // Set the service to the pubkey of the wallet info event
        this.service$.next(event.pubkey);
      }),
      // Get the service pubkey from the event
      map((event) => event.pubkey),
      // Only create a single subscription to avoid multiple side effects
      share(),
    );
  }

  /** Process response events and return WalletResponse or throw error */
  protected async handleResponseEvent(
    event: WalletResponseEvent,
    encryption?: EncryptionMethod,
  ): Promise<WalletResponse> {
    if (!verifyEvent(event)) throw new Error("Invalid response event signature");

    const requestId = getWalletResponseRequestId(event);
    if (!requestId) throw new Error("Response missing request ID");

    const response = await unlockWalletResponse(event, this.signer, encryption);
    if (!response) throw new Error("Failed to decrypt or parse response");

    return response;
  }

  /** Handle notification events */
  protected async handleNotificationEvent(event: WalletNotificationEvent): Promise<WalletNotification> {
    if (!verifyEvent(event)) throw new Error("Invalid notification event signature");

    const notification = await unlockWalletNotification(event, this.signer);
    if (!notification) throw new Error("Failed to decrypt or parse notification");

    return notification;
  }

  /** Core RPC method that makes a request and returns the response */
  request(request: WalletRequest, options: { timeout?: number } = {}): Observable<WalletResponse> {
    if (!this.service) throw new Error("WalletConnect is not connected to a service");

    // Create the request evnet
    return defer(async () => {
      // Get the preferred encryption method for the wallet
      const encryption = await firstValueFrom(this.encryption$);

      // Create the request event
      const draft = await create({ signer: this.signer }, WalletRequestBlueprint, this.service!, request, encryption);

      // Sign the request event
      return await this.signer.signEvent(draft);
    }).pipe(
      // Then switch to the request observable
      switchMap((requestEvent) => {
        const encryption = getWalletRequestEncryption(requestEvent) === "nip44_v2" ? "nip44" : "nip04";

        // Create an observable that publishes the request event when subscribed to
        const request$ = defer(() => from(this.publishMethod(this.relays, requestEvent))).pipe(ignoreElements());

        // Create an observable that listens for response events
        const responses$ = this.events$.pipe(
          filter(isValidWalletResponse),
          filter((response) => getWalletResponseRequestId(response) === requestEvent.id),
          mergeMap((response) => this.handleResponseEvent(response, encryption)),
          // Set timeout for response events
          simpleTimeout(options.timeout || this.defaultTimeout),
        );

        return merge(request$, responses$);
      }),
    );
  }

  /**
   * Listen for a type of notification
   * @returns a method to unsubscribe the listener
   */
  notification<T extends WalletNotification>(
    type: T["notification_type"],
    listener: (notification: T["notification"]) => any,
  ): Subscription {
    return this.notifications$.subscribe((notification) => {
      if (notification.notification_type === type) listener(notification.notification);
    });
  }

  /** Gets the nostr+walletauth URI for the connection */
  getAuthURI(parts?: Omit<WalletAuthURI, "client" | "relays">): string {
    return createWalletAuthURI({ ...parts, client: getPublicKey(this.secret), relays: this.relays });
  }

  /** Wait for the wallet service to connect */
  async waitForService(abortSignal?: AbortSignal): Promise<string> {
    if (this.service) return this.service;

    return await firstValueFrom(
      this.waitForService$.pipe(
        // Listen for abort signal
        abortSignal ? takeUntil(fromEvent(abortSignal, "abort")) : identity,
      ),
    );
  }

  // Convenience methods that return promises for easy API usage

  /** Get the wallet support info */
  getSupport(): Promise<WalletSupport | null> {
    return firstValueFrom(this.support$);
  }

  /** Check if the wallet supports a method */
  async supportsMethod(method: WalletMethod): Promise<boolean> {
    const support = await this.getSupport();
    return support ? supportsMethod(support, method) : false;
  }

  /** Check if the wallet supports notifications */
  async supportsNotifications(): Promise<boolean> {
    const support = await this.getSupport();
    return support ? supportsNotifications(support) : false;
  }

  /** Check if the wallet supports a notification type */
  async supportsNotificationType(type: NotificationType): Promise<boolean> {
    const support = await this.getSupport();
    return support ? supportsNotificationType(support, type) : false;
  }

  /** Pay a lightning invoice */
  async payInvoice(invoice: string, amount?: number): Promise<PayInvoiceResult> {
    const response = await firstValueFrom(this.request({ method: "pay_invoice", params: { invoice, amount } }));
    if (response.result_type !== "pay_invoice") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Pay multiple lightning invoices */
  async payMultipleInvoices(
    invoices: Array<{ id?: string; invoice: string; amount?: number }>,
  ): Promise<PayInvoiceResult[]> {
    return await lastValueFrom(
      this.request({ method: "multi_pay_invoice", params: { invoices } })
        .pipe(
          map((response) => {
            if (response.result_type !== "multi_pay_invoice")
              throw new Error(`Unexpected response type: ${response.result_type}`);
            if (response.error) throw createWalletError(response.error.type, response.error.message);

            return response.result;
          }),
        )
        .pipe(toArray()),
    );
  }

  /** Send a keysend payment */
  async payKeysend(
    pubkey: string,
    amount: number,
    preimage?: string,
    tlv_records?: Array<{ type: number; value: string }>,
  ): Promise<PayKeysendResult> {
    const response = await firstValueFrom(
      this.request({ method: "pay_keysend", params: { pubkey, amount, preimage, tlv_records } }),
    );
    if (response.result_type !== "pay_keysend") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Send multiple keysend payments */
  async payMultipleKeysend(
    keysends: Array<{
      id?: string;
      pubkey: string;
      amount: number;
      preimage?: string;
      tlv_records?: Array<{ type: number; value: string }>;
    }>,
  ): Promise<PayKeysendResult[]> {
    return lastValueFrom(
      this.request({ method: "multi_pay_keysend", params: { keysends } }).pipe(
        map((response) => {
          if (response.result_type !== "multi_pay_keysend")
            throw new Error(`Unexpected response type: ${response.result_type}`);
          if (response.error) throw createWalletError(response.error.type, response.error.message);

          return response.result;
        }),
        toArray(),
      ),
    );
  }

  /** Create a new invoice */
  async makeInvoice(amount: number, options?: Omit<MakeInvoiceParams, "amount">): Promise<MakeInvoiceResult> {
    const response = await firstValueFrom(this.request({ method: "make_invoice", params: { amount, ...options } }));
    if (response.result_type !== "make_invoice") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Look up an invoice by payment hash or invoice string */
  async lookupInvoice(payment_hash?: string, invoice?: string): Promise<LookupInvoiceResult> {
    const response = await firstValueFrom(
      this.request({ method: "lookup_invoice", params: { payment_hash, invoice } }),
    );
    if (response.result_type !== "lookup_invoice") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** List transactions */
  async listTransactions(params?: {
    from?: number;
    until?: number;
    limit?: number;
    offset?: number;
    unpaid?: boolean;
    type?: "incoming" | "outgoing";
  }): Promise<ListTransactionsResult> {
    const response = await firstValueFrom(this.request({ method: "list_transactions", params: params || {} }));
    if (response.result_type !== "list_transactions")
      throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Get wallet balance */
  async getBalance(): Promise<GetBalanceResult> {
    const response = await firstValueFrom(this.request({ method: "get_balance", params: {} }));
    if (response.result_type !== "get_balance") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Get wallet info */
  async getInfo(): Promise<GetInfoResult> {
    const response = await firstValueFrom(this.request({ method: "get_info", params: {} }));

    if (response.result_type !== "get_info") throw new Error(`Unexpected response type: ${response.result_type}`);
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response.result;
  }

  /** Serialize the WalletConnect instance */
  toJSON(): SerializedWalletConnect {
    if (!this.service) throw new Error("WalletConnect is not connected to a service");

    return {
      secret: bytesToHex(this.secret),
      service: this.service,
      relays: this.relays,
    };
  }

  /** Create a new WalletConnect instance from a serialized object */
  static fromJSON(
    json: SerializedWalletConnect,
    options?: Omit<WalletConnectOptions, "secret" | "relays" | "service">,
  ): WalletConnect {
    return new WalletConnect({
      ...options,
      secret: hexToBytes(json.secret),
      service: json.service,
      relays: json.relays,
    });
  }

  /** Create a new WalletConnect instance from a connection string */
  static fromConnectURI(
    connectionString: string,
    options?: Omit<WalletConnectOptions, "secret" | "relays" | "service">,
  ): WalletConnect {
    const { secret, service, relays } = parseWalletConnectURI(connectionString);

    return new WalletConnect({
      ...options,
      secret: hexToBytes(secret),
      service,
      relays,
    });
  }
}
