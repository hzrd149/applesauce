import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { simpleTimeout } from "applesauce-core";
import { create, EventSigner } from "applesauce-factory";
import { finalizeEvent, getPublicKey, nip04, nip44, NostrEvent, verifyEvent } from "nostr-tools";
import {
  defer,
  filter,
  firstValueFrom,
  from,
  ignoreElements,
  lastValueFrom,
  map,
  merge,
  mergeMap,
  Observable,
  ReplaySubject,
  share,
  switchMap,
  take,
  timeout,
  timer,
  toArray,
} from "rxjs";

import { WalletRequestBlueprint } from "./blueprints/index.js";
import { createWalletError } from "./helpers/error.js";
import {
  WalletConnectEncryptionMethod,
  GetBalanceResult,
  GetInfoResult,
  getPreferredEncryption,
  getWalletSupport,
  getWalletNotification,
  getWalletResponse,
  getWalletResponseRequestId,
  isWalletNotificationLocked,
  isWalletResponseLocked,
  ListTransactionsResult,
  LookupInvoiceResult,
  MakeInvoiceResult,
  parseWalletConnectURI,
  PayInvoiceResult,
  PayKeysendResult,
  unlockWalletNotification,
  unlockWalletResponse,
  WALLET_INFO_KIND,
  WALLET_LEGACY_NOTIFICATION_KIND,
  WALLET_NOTIFICATION_KIND,
  WALLET_RESPONSE_KIND,
  WalletConnectURI,
  WalletSupport,
  WalletNotification,
  WalletRequest,
  WalletResponse,
  getWalletRequestEncryption,
  MakeInvoiceParams,
} from "./helpers/index.js";
import { NostrPublishMethod, NostrSubscriptionMethod } from "./interface.js";
import { EncryptionMethod } from "applesauce-core/helpers";

export type SerializedWalletConnect = WalletConnectURI;

export type WalletConnectOptions = {
  /** A method for subscribing to relays */
  subscriptionMethod?: NostrSubscriptionMethod;
  /** A method for publishing events */
  publishMethod?: NostrPublishMethod;
  /** Default timeout for RPC requests in milliseconds */
  timeout?: number;
};

export class WalletConnect {
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the client */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the client */
  static publishMethod: NostrPublishMethod | undefined = undefined;

  /** A method that is called when an event needs to be published */
  protected publishMethod: NostrPublishMethod;
  /** The active nostr subscription method */
  protected subscriptionMethod: NostrSubscriptionMethod;

  /** The local client signer */
  public readonly secret: Uint8Array;
  protected readonly signer: EventSigner;

  /** The relays to use for the connection */
  public readonly relays: string[];

  /** The wallet service public key */
  public readonly service: string;

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

  constructor(secret: Uint8Array, service: string, relays: string[], options: WalletConnectOptions = {}) {
    this.service = service;
    this.secret = secret;
    this.relays = relays;
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

    const subscriptionMethod = options.subscriptionMethod || WalletConnect.subscriptionMethod;
    if (!subscriptionMethod)
      throw new Error("Missing subscriptionMethod, either pass a method or set WalletConnect.subscriptionMethod");
    const publishMethod = options.publishMethod || WalletConnect.publishMethod;
    if (!publishMethod)
      throw new Error("Missing publishMethod, either pass a method or set WalletConnect.publishMethod");

    this.subscriptionMethod = subscriptionMethod;
    this.publishMethod = publishMethod;

    // Create shared response observable with ref counting and timer
    this.events$ = defer(() => this.signer.getPublicKey()).pipe(
      switchMap((client) =>
        this.subscriptionMethod(this.relays, [
          // Subscribe to response events
          {
            kinds: [WALLET_RESPONSE_KIND, WALLET_NOTIFICATION_KIND, WALLET_LEGACY_NOTIFICATION_KIND],
            "#p": [client],
            authors: [this.service],
          },
          // Subscribe to wallet info events
          { kinds: [WALLET_INFO_KIND], authors: [this.service] },
        ]),
      ),
      // Ingore strings (support for applesauce-relay)
      filter((event) => typeof event !== "string"),
      // Only include events from the wallet service
      filter((event) => event.pubkey === this.service),
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
      filter((event) => event.kind === WALLET_NOTIFICATION_KIND),
      mergeMap((event) => this.handleNotificationEvent(event)),
    );
  }

  /** Process response events and return WalletResponse or throw error */
  protected async handleResponseEvent(event: NostrEvent, encryption?: EncryptionMethod): Promise<WalletResponse> {
    if (!verifyEvent(event)) throw new Error("Invalid response event signature");

    const requestId = getWalletResponseRequestId(event);
    if (!requestId) throw new Error("Response missing request ID");

    let response: WalletResponse | undefined | null;
    if (isWalletResponseLocked(event)) response = await unlockWalletResponse(event, this.signer, encryption);
    else response = getWalletResponse(event);

    if (!response) throw new Error("Failed to decrypt or parse response");

    // Check for errors and throw if present
    if (response.error) throw createWalletError(response.error.type, response.error.message);

    return response;
  }

  /** Handle notification events */
  protected async handleNotificationEvent(event: NostrEvent): Promise<WalletNotification> {
    if (!verifyEvent(event)) throw new Error("Invalid notification event signature");

    let notification: WalletNotification | undefined | null;

    if (isWalletNotificationLocked(event)) notification = await unlockWalletNotification(event, this.signer);
    else notification = getWalletNotification(event);

    if (!notification) throw new Error("Failed to decrypt or parse notification");

    return notification;
  }

  /** Core RPC method that returns an Observable for streaming responses */
  request(request: WalletRequest, options: { timeout?: number } = {}): Observable<WalletResponse> {
    // Create the request evnet
    return defer(async () => {
      // Get the preferred encryption method for the wallet
      const encryption = await firstValueFrom(this.encryption$);

      // Create the request event
      const draft = await create({ signer: this.signer }, WalletRequestBlueprint, this.service, request, encryption);

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
          filter(
            (response) =>
              response.kind === WALLET_RESPONSE_KIND && getWalletResponseRequestId(response) === requestEvent.id,
          ),
          mergeMap((response) => this.handleResponseEvent(response, encryption)),
          // Set timeout for response events
          simpleTimeout(options.timeout || this.defaultTimeout),
        );

        return merge(request$, responses$);
      }),
    );
  }

  /** Wait for wallet info to be available */
  waitForInfo(timeoutMs: number = 10000): Promise<WalletSupport> {
    return firstValueFrom(
      this.support$.pipe(
        filter((info) => info !== null),
        take(1),
        timeout(timeoutMs),
      ),
    );
  }

  // Convenience methods that return promises for easy API usage

  /** Pay a lightning invoice */
  async payInvoice(invoice: string, amount?: number): Promise<PayInvoiceResult> {
    const response = await firstValueFrom(this.request({ method: "pay_invoice", params: { invoice, amount } }));
    if (response.result_type !== "pay_invoice") {
      throw new Error(`Unexpected response type: ${response.result_type}`);
    }
    return response.result as PayInvoiceResult;
  }

  /** Pay multiple lightning invoices */
  payMultipleInvoices(
    invoices: Array<{ id?: string; invoice: string; amount?: number }>,
  ): Observable<PayInvoiceResult> {
    return this.request({ method: "multi_pay_invoice", params: { invoices } }).pipe(
      map((response) => {
        if (response.result_type !== "multi_pay_invoice") {
          throw new Error(`Unexpected response type: ${response.result_type}`);
        }
        return response.result as PayInvoiceResult;
      }),
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

    return response.result as PayKeysendResult;
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

          return response.result as PayKeysendResult;
        }),
        toArray(),
      ),
    );
  }

  /** Create a new invoice */
  async makeInvoice(amount: number, options?: Omit<MakeInvoiceParams, "amount">): Promise<MakeInvoiceResult> {
    const response = await firstValueFrom(this.request({ method: "make_invoice", params: { amount, ...options } }));
    if (response.result_type !== "make_invoice") {
      throw new Error(`Unexpected response type: ${response.result_type}`);
    }
    return response.result as MakeInvoiceResult;
  }

  /** Look up an invoice by payment hash or invoice string */
  async lookupInvoice(payment_hash?: string, invoice?: string): Promise<LookupInvoiceResult> {
    const response = await firstValueFrom(
      this.request({ method: "lookup_invoice", params: { payment_hash, invoice } }),
    );
    if (response.result_type !== "lookup_invoice") throw new Error(`Unexpected response type: ${response.result_type}`);

    return response.result as LookupInvoiceResult;
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
    if (response.result_type !== "list_transactions") {
      throw new Error(`Unexpected response type: ${response.result_type}`);
    }
    return response.result as ListTransactionsResult;
  }

  /** Get wallet balance */
  async getBalance(): Promise<GetBalanceResult> {
    const response = await firstValueFrom(this.request({ method: "get_balance", params: {} }));
    if (response.result_type !== "get_balance") {
      throw new Error(`Unexpected response type: ${response.result_type}`);
    }
    return response.result as GetBalanceResult;
  }

  /** Get wallet info */
  async getInfo(): Promise<GetInfoResult> {
    const response = await firstValueFrom(this.request({ method: "get_info", params: {} }));

    if (response.result_type !== "get_info") throw new Error(`Unexpected response type: ${response.result_type}`);

    return response.result as GetInfoResult;
  }

  /** Serialize the WalletConnect instance */
  toJSON(): SerializedWalletConnect {
    return {
      secret: bytesToHex(this.secret),
      service: this.service,
      relays: this.relays,
    };
  }

  /** Create a new WalletConnect instance from a serialized object */
  static fromJSON(json: SerializedWalletConnect, options?: WalletConnectOptions): WalletConnect {
    return new WalletConnect(hexToBytes(json.secret), json.service, json.relays, options);
  }

  /** Create a new WalletConnect instance from a connection string */
  static fromConnectionString(connectionString: string, options?: WalletConnectOptions): WalletConnect {
    const { secret, service, relays } = parseWalletConnectURI(connectionString);

    return new WalletConnect(hexToBytes(secret), service, relays, options);
  }
}
