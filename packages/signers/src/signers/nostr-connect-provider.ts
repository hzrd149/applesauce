import { EventTemplate, kinds, NostrEvent, verifyEvent } from "nostr-tools";
import { ISigner } from "../interface.js";
import { Deferred, createDefer } from "applesauce-core/promise";
import { unixNow } from "applesauce-core/helpers";
import { logger } from "applesauce-core";

import { isNIP04 } from "../helpers/encryption.js";
import {
  NostrConnectMethod,
  NostrConnectRequest,
  NostrConnectResponse,
  NostrSubscriptionMethod,
  NostrPublishMethod,
  ConnectResponseResults,
  ConnectRequestParams,
} from "./nostr-connect-signer.js";
import { Unsubscribable } from "../types/observable.js";

export type NostrConnectProviderOptions = {
  /** The relays to communicate over */
  relays: string[];
  /** The signer to use for signing events and encryption */
  upstream: ISigner;
  /** Optional signer for provider identity (if different from upstream) */
  signer?: ISigner;
  /** A method for subscribing to relays */
  subscriptionMethod?: NostrSubscriptionMethod;
  /** A method for publishing events */
  publishMethod?: NostrPublishMethod;
  /** Callback for when a client connects */
  onClientConnect?: (clientPubkey: string) => void;
  /** Callback for when a client disconnects */
  onClientDisconnect?: (clientPubkey: string) => void;
  /** Callback for authorization requests */
  onAuth?: (clientPubkey: string, permissions: string[]) => Promise<boolean>;
};

export class NostrConnectProvider {
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the provider */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the provider */
  static publishMethod: NostrPublishMethod | undefined = undefined;
  /** A method that is called when an event needs to be published */
  protected publishMethod: NostrPublishMethod;
  /** The active nostr subscription */
  protected subscriptionMethod: NostrSubscriptionMethod;

  /** Internal logger */
  protected log = logger.extend("NostrConnectProvider");

  /** The main signer for actual signing operations */
  public upstream: ISigner;

  /** The identity signer (provider's identity) */
  public signer: ISigner;

  /** Whether the provider is listening for events */
  public listening = false;

  /** The connected client's public key */
  public client?: string;

  /** Relays to communicate over */
  public readonly relays: string[];

  /** Whether a client is connected */
  get connected() {
    return !!this.client;
  }

  /** Provider's public key */
  async getProviderPubkey() {
    return await this.signer.getPublicKey();
  }

  /** Callbacks */
  public onClientConnect?: (clientPubkey: string) => void;
  public onClientDisconnect?: (clientPubkey: string) => void;
  public onAuth?: (clientPubkey: string, permissions: string[]) => Promise<boolean>;

  constructor(opts: NostrConnectProviderOptions) {
    this.relays = opts.relays;
    this.upstream = opts.upstream;
    this.signer = opts.signer || opts.upstream;

    const subscriptionMethod = opts.subscriptionMethod || NostrConnectProvider.subscriptionMethod;
    if (!subscriptionMethod)
      throw new Error(
        "Missing subscriptionMethod, either pass a method or set NostrConnectProvider.subscriptionMethod",
      );
    const publishMethod = opts.publishMethod || NostrConnectProvider.publishMethod;
    if (!publishMethod)
      throw new Error("Missing publishMethod, either pass a method or set NostrConnectProvider.publishMethod");

    this.subscriptionMethod = subscriptionMethod;
    this.publishMethod = publishMethod;

    if (opts.onClientConnect) this.onClientConnect = opts.onClientConnect;
    if (opts.onClientDisconnect) this.onClientDisconnect = opts.onClientDisconnect;
    if (opts.onAuth) this.onAuth = opts.onAuth;
  }

  /** The currently active REQ subscription */
  protected req?: Unsubscribable;

  /** Open the connection */
  async open() {
    if (this.listening) return;

    this.listening = true;
    const pubkey = await this.getProviderPubkey();

    // Setup subscription to listen for requests
    this.req = this.subscriptionMethod(this.relays, [
      {
        kinds: [kinds.NostrConnect],
        "#p": [pubkey],
      },
    ]).subscribe({
      next: (event) => typeof event !== "string" && this.handleEvent(event),
    });

    this.log("Opened", this.relays);
  }

  /** Close the connection */
  async close() {
    this.listening = false;

    // Close the current subscription
    if (this.req) {
      this.req.unsubscribe();
      this.req = undefined;
    }

    // Cancel waiting promise
    if (this.waitingPromise) {
      this.waitingPromise.reject(new Error("Closed"));
      this.waitingPromise = null;
    }

    // Notify client disconnect
    if (this.client && this.onClientDisconnect) {
      this.onClientDisconnect(this.client);
    }

    this.client = undefined;
    this.log("Closed");
  }

  private waitingPromise: Deferred<void> | null = null;

  /** Wait for a client to connect */
  waitForClient(abort?: AbortSignal): Promise<void> {
    if (this.isClientConnected) return Promise.resolve();

    this.open();
    this.waitingPromise = createDefer();
    abort?.addEventListener(
      "abort",
      () => {
        this.waitingPromise?.reject(new Error("Aborted"));
        this.waitingPromise = null;
        this.close();
      },
      true,
    );

    return this.waitingPromise;
  }

  /** Call this method with incoming events */
  public async handleEvent(event: NostrEvent) {
    if (!verifyEvent(event)) return;

    // Only accept requests from the connected client (or allow new connections)
    if (this.client && event.pubkey !== this.client) return;

    try {
      const requestStr = isNIP04(event.content)
        ? await this.signer.nip04!.decrypt(event.pubkey, event.content)
        : await this.signer.nip44!.decrypt(event.pubkey, event.content);
      const request = JSON.parse(requestStr) as NostrConnectRequest<any>;

      // Process the request
      await this.processRequest(event.pubkey, request);
    } catch (e) {
      this.log("Error handling request:", e);
    }
  }

  /** Process a decrypted NostrConnect request */
  protected async processRequest(clientPubkey: string, request: NostrConnectRequest<any>) {
    this.log(`Processing ${request.method} from ${clientPubkey}`);

    try {
      let result: any;

      switch (request.method) {
        case NostrConnectMethod.Connect:
          result = await this.handleConnect(
            clientPubkey,
            request.params as [string] | [string, string] | [string, string, string],
          );
          break;
        case NostrConnectMethod.GetPublicKey:
          result = await this.upstream.getPublicKey();
          break;
        case NostrConnectMethod.SignEvent:
          result = await this.handleSignEvent(request.params as [string]);
          break;
        case NostrConnectMethod.Nip04Encrypt:
          result = await this.handleNip04Encrypt(request.params as [string, string]);
          break;
        case NostrConnectMethod.Nip04Decrypt:
          result = await this.handleNip04Decrypt(request.params as [string, string]);
          break;
        case NostrConnectMethod.Nip44Encrypt:
          result = await this.handleNip44Encrypt(request.params as [string, string]);
          break;
        case NostrConnectMethod.Nip44Decrypt:
          result = await this.handleNip44Decrypt(request.params as [string, string]);
          break;
        default:
          throw new Error(`Unsupported method: ${request.method}`);
      }

      // Send success response
      await this.sendResponse(clientPubkey, request.id, result);
    } catch (error) {
      this.log(`Error processing ${request.method}:`, error);
      await this.sendErrorResponse(clientPubkey, request.id, error instanceof Error ? error.message : "Unknown error");
    }
  }

  /** Handle connect request */
  protected async handleConnect(
    clientPubkey: string,
    [target, secret, permissionsStr]: ConnectRequestParams[NostrConnectMethod.Connect],
  ): Promise<ConnectResponseResults[NostrConnectMethod.Connect]> {
    const permissions = permissionsStr ? permissionsStr.split(",") : [];

    // Check if this is a connection to our provider
    const providerPubkey = await this.getProviderPubkey();
    if (target !== providerPubkey) {
      throw new Error("Invalid target pubkey");
    }

    // Handle authorization if callback is provided
    if (this.onAuth) {
      const authorized = await this.onAuth(clientPubkey, permissions);
      if (!authorized) {
        throw new Error("Authorization denied");
      }
    }

    // Establish connection
    this.client = clientPubkey;
    this.isClientConnected = true;

    // Notify connection
    if (this.onClientConnect) this.onClientConnect(clientPubkey);

    // Resolve waiting promise
    if (this.waitingPromise) {
      this.waitingPromise.resolve();
      this.waitingPromise = null;
    }

    // Return ack or the secret if provided
    return secret || "ack";
  }

  /** Handle sign event request */
  protected async handleSignEvent([eventJson]: ConnectRequestParams[NostrConnectMethod.SignEvent]): Promise<
    ConnectResponseResults[NostrConnectMethod.SignEvent]
  > {
    const template = JSON.parse(eventJson) as EventTemplate;
    const signedEvent = await this.upstream.signEvent(template);
    return JSON.stringify(signedEvent);
  }

  /** Handle NIP-04 encryption */
  protected async handleNip04Encrypt([
    pubkey,
    plaintext,
  ]: ConnectRequestParams[NostrConnectMethod.Nip04Encrypt]): Promise<
    ConnectResponseResults[NostrConnectMethod.Nip04Encrypt]
  > {
    if (!this.upstream.nip04) throw new Error("NIP-04 not supported");

    return await this.upstream.nip04.encrypt(pubkey, plaintext);
  }

  /** Handle NIP-04 decryption */
  protected async handleNip04Decrypt([
    pubkey,
    ciphertext,
  ]: ConnectRequestParams[NostrConnectMethod.Nip04Decrypt]): Promise<
    ConnectResponseResults[NostrConnectMethod.Nip04Decrypt]
  > {
    if (!this.upstream.nip04) throw new Error("NIP-04 not supported");

    return await this.upstream.nip04.decrypt(pubkey, ciphertext);
  }

  /** Handle NIP-44 encryption */
  protected async handleNip44Encrypt([
    pubkey,
    plaintext,
  ]: ConnectRequestParams[NostrConnectMethod.Nip44Encrypt]): Promise<
    ConnectResponseResults[NostrConnectMethod.Nip44Encrypt]
  > {
    if (!this.upstream.nip44) throw new Error("NIP-44 not supported");

    return await this.upstream.nip44.encrypt(pubkey, plaintext);
  }

  /** Handle NIP-44 decryption */
  protected async handleNip44Decrypt([
    pubkey,
    ciphertext,
  ]: ConnectRequestParams[NostrConnectMethod.Nip44Decrypt]): Promise<
    ConnectResponseResults[NostrConnectMethod.Nip44Decrypt]
  > {
    if (!this.upstream.nip44) throw new Error("NIP-44 not supported");

    return await this.upstream.nip44.decrypt(pubkey, ciphertext);
  }

  /** Send a response to the client */
  protected async sendResponse<T extends NostrConnectMethod>(
    clientPubkey: string,
    requestId: string,
    result: ConnectResponseResults[T],
  ) {
    const response: NostrConnectResponse<any> = {
      id: requestId,
      result,
    };

    await this.sendMessage(clientPubkey, response);
  }

  /** Send an error response to the client */
  protected async sendErrorResponse(clientPubkey: string, requestId: string, error: string) {
    const response = {
      id: requestId,
      result: "",
      error,
    };

    await this.sendMessage(clientPubkey, response);
  }

  /** Send an encrypted message to the client */
  protected async sendMessage(clientPubkey: string, message: NostrConnectResponse<any>) {
    const messageStr = JSON.stringify(message);

    // Try NIP-44 first, fallback to NIP-04
    let encrypted: string;
    if (this.signer.nip44) {
      encrypted = await this.signer.nip44.encrypt(clientPubkey, messageStr);
    } else if (this.signer.nip04) {
      encrypted = await this.signer.nip04.encrypt(clientPubkey, messageStr);
    } else {
      throw new Error("No encryption methods available");
    }

    const event = await this.signer.signEvent({
      kind: kinds.NostrConnect,
      created_at: unixNow(),
      tags: [["p", clientPubkey]],
      content: encrypted,
    });

    const result = this.publishMethod(this.relays, event);

    // Handle returned Promise or Observable
    if (result instanceof Promise) {
      await result;
    } else if ("subscribe" in result) {
      await new Promise<void>((res) => result.subscribe({ complete: res }));
    }
  }

  /** Get the connection string that clients can use to connect */
  async getBunkerURI(secret?: string): Promise<string> {
    const params = new URLSearchParams();

    if (secret) params.set("secret", secret);
    for (const relay of this.relays) params.append("relay", relay);

    const providerPubkey = await this.getProviderPubkey();
    return `bunker://${providerPubkey}?` + params.toString();
  }

  /** Check if the provider is listening */
  isListening(): boolean {
    return this.listening;
  }

  /** Check if a client is connected */
  hasClientConnected(): boolean {
    return this.isClientConnected;
  }

  /** Get the connected client's public key */
  getClientPubkey(): string | undefined {
    return this.client;
  }
}
