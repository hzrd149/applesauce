import { logger } from "applesauce-core";
import { create, EventSigner } from "applesauce-core";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { filter, from, mergeMap, Observable, repeat, retry, share, Subscription } from "rxjs";

import { bytesToHex } from "@noble/hashes/utils";
import { WalletLegacyNotificationBlueprint, WalletNotificationBlueprint } from "./blueprints/notification.js";
import { WalletResponseBlueprint } from "./blueprints/response.js";
import { WalletSupportBlueprint } from "./blueprints/support.js";
import { parseWalletAuthURI, WalletAuthURI } from "./helpers/auth-uri.js";
import { WalletConnectEncryptionMethod } from "./helpers/encryption.js";
import { NotImplementedError, WalletBaseError, WalletErrorCode } from "./helpers/error.js";
import { CommonWalletMethods, TWalletMethod, WalletInfo } from "./helpers/methods.js";
import { NotificationType, WalletNotification } from "./helpers/notification.js";
import {
  getWalletRequest,
  isValidWalletRequest,
  isWalletRequestExpired,
  unlockWalletRequest,
  WALLET_REQUEST_KIND,
  WalletRequestEvent,
} from "./helpers/request.js";
import { WalletSupport } from "./helpers/support.js";
import {
  getConnectionMethods,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
} from "./interop.js";

/** Generic type for wallet method handlers */
export type WalletMethodHandler<Method extends TWalletMethod> = (
  params: Method["request"]["params"],
) => Promise<Method["response"]["result"]>;

/** Map of method handlers for the wallet service for a specific set of methods */
export type WalletServiceHandlers<Methods extends TWalletMethod = TWalletMethod> = {
  [K in Methods["method"]]?: WalletMethodHandler<Extract<Methods, { method: K }>>;
};

/** Serialized wallet service */
export type SerializedWalletService = {
  /** The client's public key */
  client: string;
  /** The relays to use for the service */
  relays: string[];
};

/** Only the necessary info for the getInfo method on wallet service */
export type WalletServiceInfo = Partial<Omit<WalletInfo, "methods" | "notifications">>;

/** Options for creating a WalletService */
export interface WalletServiceOptions<Methods extends TWalletMethod = CommonWalletMethods>
  extends NostrConnectionMethodsOptions {
  /** The relays to use for the service */
  relays: string[];
  /** The signer to use for creating and unlocking events */
  signer: EventSigner;
  /** The client's secret key */
  secret?: Uint8Array;
  /** The client's public key (used for restoring the service) */
  client?: string;
  /** A method for getting the general wallet information (Can be overwritten if get_info is set in handlers) */
  getInfo?: () => Promise<WalletServiceInfo>;
  /** Map of method handlers */
  handlers: WalletServiceHandlers<Methods>;
  /** An array of notifications this wallet supports */
  notifications?: NotificationType[];
}

/** NIP-47 Wallet Service implementation */
export class WalletService<Methods extends TWalletMethod = CommonWalletMethods> {
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

  /** A special method for getting the generic wallet information */
  public getInfo?: () => Promise<WalletServiceInfo>;

  /** The relays to use for the service */
  public readonly relays: string[];

  /** The signer used for creating and unlocking events */
  protected readonly signer: EventSigner;

  /** Map of method handlers */
  protected readonly handlers: WalletServiceHandlers<Methods>;

  /** Wallet support information */
  protected readonly support: WalletSupport<Methods>;

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

  constructor(options: WalletServiceOptions<Methods>) {
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
      methods: Object.keys(options.handlers),
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
        WalletSupportBlueprint<Methods>,
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
  protected async processRequest<Method extends Methods>(
    requestEvent: WalletRequestEvent,
    request: Method["request"],
  ): Promise<void> {
    const handler = this.handlers[request.method as Methods["method"]];

    try {
      let result: Method["response"]["result"] | undefined = undefined;

      // If the user has not implemented the method
      if (!handler) {
        // If its the get_info try to use the builtin getInfo method
        if (request.method === "get_info") {
          result = { ...(this.getInfo?.() ?? {}), ...this.support } satisfies WalletInfo;
        } else {
          // Else throw not supported error
          throw new NotImplementedError(`Method ${request.method} not supported`);
        }
      }

      // Otherwise use the user provided handler
      if (!result && handler) result = await handler(request.params);

      // Throw if failed to get result
      if (!result) throw new NotImplementedError(`Method ${request.method} not supported`);

      // Send success response
      await this.sendSuccessResponse(requestEvent, request.method, result);
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
  protected async sendSuccessResponse<Method extends Methods>(
    requestEvent: WalletRequestEvent,
    method: Method["response"]["result_type"],
    result: Method["response"]["result"],
  ): Promise<void> {
    const response: Method["response"] = {
      result_type: method,
      error: null,
      result,
    };

    await this.sendResponse<Method>(requestEvent, response);
  }

  /** Send an error response */
  protected async sendErrorResponse<Method extends Methods>(
    requestEvent: WalletRequestEvent,
    errorType: WalletErrorCode,
    errorMessage: string,
  ): Promise<void> {
    const request = getWalletRequest(requestEvent);
    if (!request) throw new Error("Cant respond to a locked request");

    const response: Method["error"] = {
      result_type: request.method,
      error: {
        type: errorType,
        message: errorMessage,
      },
      result: null,
    };

    await this.sendResponse<Method>(requestEvent, response);
  }

  /** Send a response event */
  protected async sendResponse<Method extends Methods>(
    requestEvent: WalletRequestEvent,
    response: Method["response"] | Method["error"],
  ): Promise<void> {
    try {
      const draft = await create({ signer: this.signer }, WalletResponseBlueprint<Method>(requestEvent, response));
      const event = await this.signer.signEvent(draft);
      await this.publishMethod(this.relays, event);
    } catch (error) {
      this.log("Failed to send response:", error);
      throw error;
    }
  }

  /** Creates a service for a nostr+walletauth URI */
  static fromAuthURI<Methods extends TWalletMethod = CommonWalletMethods>(
    uri: string | WalletAuthURI,
    options: Omit<WalletServiceOptions<Methods>, "relays"> & {
      /** A relay or method to select a single relay for the client and service to communicate over */
      overrideRelay?: string | ((relays: string[]) => string);
    },
  ): WalletService<Methods> {
    const authURI = typeof uri === "string" ? parseWalletAuthURI(uri) : uri;

    const relays = options.overrideRelay
      ? [typeof options.overrideRelay === "function" ? options.overrideRelay(authURI.relays) : options.overrideRelay]
      : authURI.relays;

    return new WalletService<Methods>({
      ...options,
      client: authURI.client,
      relays,
    });
  }
}
