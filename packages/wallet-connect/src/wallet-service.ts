import { logger } from "applesauce-core";
import { create, EventSigner } from "applesauce-factory";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { filter, from, mergeMap, Observable, repeat, retry, share, Subscription } from "rxjs";

import { bytesToHex } from "@noble/hashes/utils";
import { WalletLegacyNotificationBlueprint, WalletNotificationBlueprint } from "./blueprints/notification.js";
import { WalletResponseBlueprint } from "./blueprints/response.js";
import { WalletSupportBlueprint } from "./blueprints/support.js";
import { parseWalletAuthURI, WalletAuthURI } from "./helpers/auth-uri.js";
import { WalletConnectEncryptionMethod } from "./helpers/encryption.js";
import { WalletBaseError, WalletErrorCode } from "./helpers/error.js";
import { NotificationType, WalletNotification } from "./helpers/notification.js";
import {
  GetBalanceParams,
  GetBalanceRequest,
  GetInfoParams,
  GetInfoRequest,
  getWalletRequest,
  isValidWalletRequest,
  isWalletRequestExpired,
  ListTransactionsParams,
  ListTransactionsRequest,
  LookupInvoiceParams,
  LookupInvoiceRequest,
  MakeInvoiceParams,
  MakeInvoiceRequest,
  MultiPayInvoiceParams,
  MultiPayInvoiceRequest,
  MultiPayKeysendParams,
  MultiPayKeysendRequest,
  PayInvoiceParams,
  PayInvoiceRequest,
  PayKeysendParams,
  PayKeysendRequest,
  unlockWalletRequest,
  WALLET_REQUEST_KIND,
  WalletRequest,
  WalletRequestEvent,
} from "./helpers/request.js";
import {
  GetBalanceResult,
  GetInfoResult,
  ListTransactionsResult,
  LookupInvoiceResult,
  MakeInvoiceResult,
  MultiPayInvoiceResult,
  MultiPayKeysendResult,
  PayInvoiceResult,
  PayKeysendResult,
  WalletResponse,
} from "./helpers/response.js";
import { WalletMethod, WalletSupport } from "./helpers/support.js";
import {
  getConnectionMethods,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
} from "./interop.js";

/** Handler function for pay_invoice method */
export type PayInvoiceHandler = (params: PayInvoiceParams) => Promise<PayInvoiceResult>;

/** Handler function for multi_pay_invoice method */
export type MultiPayInvoiceHandler = (params: MultiPayInvoiceParams) => Promise<MultiPayInvoiceResult[]>;

/** Handler function for pay_keysend method */
export type PayKeysendHandler = (params: PayKeysendParams) => Promise<PayKeysendResult>;

/** Handler function for multi_pay_keysend method */
export type MultiPayKeysendHandler = (params: MultiPayKeysendParams) => Promise<MultiPayKeysendResult[]>;

/** Handler function for make_invoice method */
export type MakeInvoiceHandler = (params: MakeInvoiceParams) => Promise<MakeInvoiceResult>;

/** Handler function for lookup_invoice method */
export type LookupInvoiceHandler = (params: LookupInvoiceParams) => Promise<LookupInvoiceResult>;

/** Handler function for list_transactions method */
export type ListTransactionsHandler = (params: ListTransactionsParams) => Promise<ListTransactionsResult>;

/** Handler function for get_balance method */
export type GetBalanceHandler = (params: GetBalanceParams) => Promise<GetBalanceResult>;

/** Handler function for get_info method */
export type GetInfoHandler = (params: GetInfoParams) => Promise<GetInfoResult>;

/** Map of method handlers for the wallet service */
export interface WalletServiceHandlers {
  pay_invoice?: PayInvoiceHandler;
  multi_pay_invoice?: MultiPayInvoiceHandler;
  pay_keysend?: PayKeysendHandler;
  multi_pay_keysend?: MultiPayKeysendHandler;
  make_invoice?: MakeInvoiceHandler;
  lookup_invoice?: LookupInvoiceHandler;
  list_transactions?: ListTransactionsHandler;
  get_balance?: GetBalanceHandler;
  get_info?: GetInfoHandler;
}

export type SerializedWalletService = {
  /** The client's public key */
  client: string;
  /** The relays to use for the service */
  relays: string[];
};

/** Options for creating a WalletService */
export interface WalletServiceOptions extends NostrConnectionMethodsOptions {
  /** The relays to use for the service */
  relays: string[];
  /** The signer to use for creating and unlocking events */
  signer: EventSigner;
  /** The client's secret key */
  secret?: Uint8Array;
  /** The client's public key (used for restoring the service) */
  client?: string;
  /** Map of method handlers */
  handlers: WalletServiceHandlers;
  /** An array of notifications this wallet supports */
  notifications?: NotificationType[];
}

/** NIP-47 Wallet Service implementation */
export class WalletService {
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the client */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the client */
  static publishMethod: NostrPublishMethod | undefined = undefined;
  /** A fallback pool to use if none is pass in when creating the signer */
  static pool: NostrPool | undefined = undefined;

  /** A method for subscribing to relays */
  protected readonly subscriptionMethod: NostrSubscriptionMethod;
  /** A method for publishing events */
  protected readonly publishMethod: NostrPublishMethod;

  protected log = logger.extend("WalletService");

  /** The relays to use for the service */
  public readonly relays: string[];

  /** The signer used for creating and unlocking events */
  protected readonly signer: EventSigner;

  /** Map of method handlers */
  protected readonly handlers: WalletServiceHandlers;

  /** Wallet support information */
  protected readonly support: WalletSupport;

  /** The service's public key */
  public pubkey: string | null = null;

  /** The client's secret key */
  protected secret?: Uint8Array;

  /** The client's public key */
  public client: string;

  /** Shared observable for all wallet request events */
  protected events$: Observable<WalletRequestEvent> | null = null;

  /** Subscription to the events observable */
  protected subscription: Subscription | null = null;

  /** Whether the service is currently running */
  public running: boolean = false;

  constructor(options: WalletServiceOptions) {
    this.relays = options.relays;
    this.signer = options.signer;
    this.handlers = options.handlers;

    // Set the client's secret and public key
    if (options.secret) {
      // Service was created with a custom secret
      this.secret = options.secret;
      this.client = getPublicKey(this.secret);
    } else if (options.client) {
      // Service was restored with only the clients pubkey
      this.client = options.client;
    } else {
      // Generate secret and client pubkey
      this.secret = generateSecretKey();
      this.client = getPublicKey(this.secret);
    }

    // Get the subscription and publish methods
    const { subscriptionMethod, publishMethod } = getConnectionMethods(options, WalletService);

    // Use arrow functions so "this" isn't bound to the signer
    this.subscriptionMethod = (relays, filters) => subscriptionMethod(relays, filters);
    this.publishMethod = (relays, event) => publishMethod(relays, event);

    const encryption: WalletConnectEncryptionMethod[] = [];
    if (options.signer.nip04) encryption.push("nip04");
    if (options.signer.nip44) encryption.push("nip44_v2");

    // Ensure there is at least one encryption method
    if (!encryption.length) throw new Error("No encryption methods supported by signer");

    // Build the support infomation based on options
    this.support = {
      methods: Object.keys(options.handlers) as WalletMethod[],
      notifications: options.notifications,
      encryption,
    };
  }

  /** Start the wallet service */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;

    // Get our public key
    this.pubkey = await this.signer.getPublicKey();

    // Create shared request observable with ref counting and timer
    this.events$ = from(
      this.subscriptionMethod(this.relays, [
        {
          kinds: [WALLET_REQUEST_KIND],
          "#p": [this.pubkey], // Only requests directed to us
          authors: [this.client], // Only requests from the client
        },
      ]),
    ).pipe(
      // Keep the connection open indefinitely
      repeat(),
      // Retry on connection failure
      retry(),
      // Ignore strings (support for applesauce-relay)
      filter((event) => typeof event !== "string"),
      // Only include valid wallet request events
      filter(isValidWalletRequest),
      // Ensure they are to our pubkey
      filter((event) => event.pubkey === this.client),
      // Verify event signature
      filter((event) => verifyEvent(event)),
      // Only create a single subscription to the relays
      share(),
    );

    // Subscribe to request events and handle them
    this.subscription = this.events$.pipe(mergeMap((requestEvent) => this.handleRequestEvent(requestEvent))).subscribe({
      error: (error) => {
        this.log("Error handling wallet request:", error);
      },
    });

    // Publish wallet support event
    await this.publishSupportEvent();
  }

  /** Stop the wallet service */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    this.events$ = null;
  }

  /** Check if the service is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the connection URI for the service */
  getConnectURI(): string {
    if (!this.secret) throw new Error("Service was not created with a secret");
    if (!this.pubkey) throw new Error("Service is not running");
    if (!this.relays.length) throw new Error("No relays configured");
    const url = new URL(`nostr+walletconnect://${this.pubkey}`);
    for (const relay of this.relays) {
      url.searchParams.append("relay", relay);
    }
    url.searchParams.set("secret", bytesToHex(this.secret));

    return url.toString();
  }

  /** Send a notification to the client */
  async notify<T extends WalletNotification>(
    type: T["notification_type"],
    notification: T["notification"],
    legacy = false,
  ): Promise<void> {
    const draft = await create(
      { signer: this.signer },
      legacy ? WalletLegacyNotificationBlueprint : WalletNotificationBlueprint,
      this.client,
      {
        notification_type: type,
        notification,
      },
    );

    const event = await this.signer.signEvent(draft);
    await this.publishMethod(this.relays, event);
  }

  /** Publish the wallet support event */
  protected async publishSupportEvent(): Promise<void> {
    try {
      // Tell the client which relay to use if there is only one (for nostr+walletauth URI connections)
      const overrideRelay = this.relays.length === 1 ? this.relays[0] : undefined;
      const draft = await create(
        { signer: this.signer },
        WalletSupportBlueprint,
        this.support,
        this.client,
        overrideRelay,
      );
      const event = await this.signer.signEvent(draft);
      await this.publishMethod(this.relays, event);
    } catch (error) {
      this.log("Failed to publish wallet support event:", error);
      throw error;
    }
  }

  /** Handle a wallet request event */
  protected async handleRequestEvent(requestEvent: WalletRequestEvent): Promise<void> {
    try {
      // Check if the request has expired
      if (isWalletRequestExpired(requestEvent))
        return await this.sendErrorResponse(requestEvent, "OTHER", "Request has expired");

      // Unlock the request if needed
      const request = await unlockWalletRequest(requestEvent, this.signer);
      if (!request) return await this.sendErrorResponse(requestEvent, "OTHER", "Failed to decrypt or parse request");

      // Handle the request based on its method
      await this.processRequest(requestEvent, request);
    } catch (error) {
      this.log("Error processing wallet request:", error);
      await this.sendErrorResponse(requestEvent, "INTERNAL", "Internal server error");
    }
  }

  /** Process a decrypted wallet request */
  protected async processRequest(requestEvent: WalletRequestEvent, request: WalletRequest): Promise<void> {
    const handler = this.handlers[request.method];

    if (!handler) {
      await this.sendErrorResponse(requestEvent, "NOT_IMPLEMENTED", `Method ${request.method} not supported`);
      return;
    }

    try {
      let result: any;
      const method = request.method; // Store method for use in catch block

      switch (method) {
        case "pay_invoice":
          result = await (handler as PayInvoiceHandler)((request as PayInvoiceRequest).params);
          break;
        case "multi_pay_invoice":
          result = await (handler as MultiPayInvoiceHandler)((request as MultiPayInvoiceRequest).params);
          break;
        case "pay_keysend":
          result = await (handler as PayKeysendHandler)((request as PayKeysendRequest).params);
          break;
        case "multi_pay_keysend":
          result = await (handler as MultiPayKeysendHandler)((request as MultiPayKeysendRequest).params);
          break;
        case "make_invoice":
          result = await (handler as MakeInvoiceHandler)((request as MakeInvoiceRequest).params);
          break;
        case "lookup_invoice":
          result = await (handler as LookupInvoiceHandler)((request as LookupInvoiceRequest).params);
          break;
        case "list_transactions":
          result = await (handler as ListTransactionsHandler)((request as ListTransactionsRequest).params);
          break;
        case "get_balance":
          result = await (handler as GetBalanceHandler)((request as GetBalanceRequest).params);
          break;
        case "get_info":
          result = await (handler as GetInfoHandler)((request as GetInfoRequest).params);
          break;
      }

      // Send success response
      await this.sendSuccessResponse(requestEvent, method, result);
    } catch (error) {
      this.log(`Error executing ${request.method}:`, error);

      // Determine error type and message
      let errorCode: WalletErrorCode = "OTHER";
      let errorMessage = "Unknown error";

      if (error instanceof WalletBaseError) {
        errorCode = error.code;
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      await this.sendErrorResponse(requestEvent, errorCode, errorMessage);
    }
  }

  /** Send a success response */
  protected async sendSuccessResponse<T extends WalletResponse>(
    requestEvent: WalletRequestEvent,
    method: T["result_type"],
    result: T["result"],
  ): Promise<void> {
    const response = {
      result_type: method,
      error: null,
      result,
    } as WalletResponse;

    await this.sendResponse(requestEvent, response);
  }

  /** Send an error response */
  protected async sendErrorResponse(
    requestEvent: WalletRequestEvent,
    errorType: WalletErrorCode,
    errorMessage: string,
  ): Promise<void> {
    const request = getWalletRequest(requestEvent);
    if (!request) throw new Error("Cant respond to a locked request");

    const response: WalletResponse = {
      result_type: request.method,
      error: {
        type: errorType,
        message: errorMessage,
      },
      result: null,
    };

    await this.sendResponse(requestEvent, response);
  }

  /** Send a response event */
  protected async sendResponse(requestEvent: WalletRequestEvent, response: WalletResponse): Promise<void> {
    try {
      const draft = await create({ signer: this.signer }, WalletResponseBlueprint, requestEvent, response);
      const event = await this.signer.signEvent(draft);
      await this.publishMethod(this.relays, event);
    } catch (error) {
      this.log("Failed to send response:", error);
      throw error;
    }
  }

  /** Creates a service for a nostr+walletauth URI */
  static fromAuthURI(
    uri: string | WalletAuthURI,
    options: Omit<WalletServiceOptions, "relays"> & {
      /** A relay or method to select a single relay for the client and service to communicate over */
      overrideRelay?: string | ((relays: string[]) => string);
    },
  ): WalletService {
    const authURI = typeof uri === "string" ? parseWalletAuthURI(uri) : uri;

    const relays = options.overrideRelay
      ? [typeof options.overrideRelay === "function" ? options.overrideRelay(authURI.relays) : options.overrideRelay]
      : authURI.relays;

    return new WalletService({
      ...options,
      client: authURI.client,
      relays,
    });
  }
}
