import { logger } from "applesauce-core";
import {
  EncryptionMethods,
  getEncryptedContentEncryptionMethods,
  getHiddenContent,
  isEvent,
  unixNow,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { createDefer, Deferred } from "applesauce-core/promise";
import { nanoid } from "nanoid";
import { EventTemplate, kinds, NostrEvent, verifyEvent } from "nostr-tools";

import { filter, from, repeat, retry, Subscription } from "rxjs";
import { isNIP04 } from "../helpers/encryption.js";
import {
  ConnectRequestParams,
  ConnectResponseResults,
  createBunkerURI,
  NostrConnectMethod,
  NostrConnectRequest,
  NostrConnectResponse,
  NostrConnectURI,
  parseNostrConnectURI,
} from "../helpers/nostr-connect.js";
import {
  getConnectionMethods,
  ISigner,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
} from "../interop.js";
import { SimpleSigner } from "./simple-signer.js";

export interface ProviderAuthorization {
  /** A method used to accept or reject `connect` requests */
  onConnect?: (client: string, permissions: string[]) => boolean | Promise<boolean>;
  /** A method used to accept or reject `sign_event` requests */
  onSignEvent?: (draft: EventTemplate, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip04_encrypt` requests */
  onNip04Encrypt?: (pubkey: string, plaintext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip04_decrypt` requests */
  onNip04Decrypt?: (pubkey: string, ciphertext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip44_encrypt` requests */
  onNip44Encrypt?: (pubkey: string, plaintext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip44_decrypt` requests */
  onNip44Decrypt?: (pubkey: string, ciphertext: string, client: string) => boolean | Promise<boolean>;
}

export type NostrConnectProviderOptions = ProviderAuthorization &
  NostrConnectionMethodsOptions & {
    /** The relays to communicate over */
    relays: string[];
    /** The signer to use for signing events and encryption */
    upstream: ISigner;
    /** Optional signer for provider identity */
    signer?: ISigner;
    /** A random secret used to authorize clients to connect */
    secret?: string;
    /** Callback for when a client connects (receives a `connect` request) */
    onClientConnect?: (client: string) => any;
    /** Callback for when a client disconnects (previously connected and the provider stops) */
    onClientDisconnect?: (client: string) => void;
  };

export class NostrConnectProvider implements ProviderAuthorization {
  /** A fallback method to use for subscriptionMethod if none is passed in when creating the provider */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is passed in when creating the provider */
  static publishMethod: NostrPublishMethod | undefined = undefined;
  /** A fallback pool to use if none is pass in when creating the provider */
  static pool: NostrPool | undefined = undefined;

  /** A method that is called when an event needs to be published */
  protected publishMethod: NostrPublishMethod;
  /** The active nostr subscription */
  protected subscriptionMethod: NostrSubscriptionMethod;

  /** Internal logger */
  protected log = logger.extend("NostrConnectProvider");

  /** A set of nostr requests that have been seen */
  protected seen = new Set<string>();

  /** The main signer for the actual signing operations */
  public upstream: ISigner;

  /** The identity signer (provider's identity) */
  public signer: ISigner;

  /** Whether the provider is listening for events */
  public listening = false;

  /** The connected client's public key */
  public client?: string;

  /** The secret used to authorize clients to connect */
  public secret?: string;

  /** Relays to communicate over */
  public readonly relays: string[];

  /** Whether a client is connected (received a `connect` request) */
  public connected = false;

  /** Callbacks */
  public onClientConnect?: (client: string) => any;
  public onClientDisconnect?: (client: string) => any;

  /** A method used to accept or reject `connect` requests */
  public onConnect?: (client: string, permissions: string[]) => boolean | Promise<boolean>;
  /** A method used to accept or reject `sign_event` requests */
  public onSignEvent?: (draft: EventTemplate, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip04_encrypt` requests */
  public onNip04Encrypt?: (pubkey: string, plaintext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip04_decrypt` requests */
  public onNip04Decrypt?: (pubkey: string, ciphertext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip44_encrypt` requests */
  public onNip44Encrypt?: (pubkey: string, plaintext: string, client: string) => boolean | Promise<boolean>;
  /** A method used to accept or reject `nip44_decrypt` requests */
  public onNip44Decrypt?: (pubkey: string, ciphertext: string, client: string) => boolean | Promise<boolean>;

  constructor(options: NostrConnectProviderOptions) {
    this.relays = options.relays;
    this.upstream = options.upstream;
    this.signer = options.signer ?? new SimpleSigner();
    this.secret = options.secret;

    // Get the subscription and publish methods
    const { subscriptionMethod, publishMethod } = getConnectionMethods(options, NostrConnectProvider);

    // Use arrow functions so "this" isn't bound to the signer
    this.subscriptionMethod = (relays, filters) => subscriptionMethod(relays, filters);
    this.publishMethod = (relays, event) => publishMethod(relays, event);

    // Set client connection callbacks
    if (options.onClientConnect) this.onClientConnect = options.onClientConnect;
    if (options.onClientDisconnect) this.onClientDisconnect = options.onClientDisconnect;

    // Set authorization callbacks
    if (options.onConnect) this.onConnect = options.onConnect;
    if (options.onSignEvent) this.onSignEvent = options.onSignEvent;
    if (options.onNip04Encrypt) this.onNip04Encrypt = options.onNip04Encrypt;
    if (options.onNip04Decrypt) this.onNip04Decrypt = options.onNip04Decrypt;
    if (options.onNip44Encrypt) this.onNip44Encrypt = options.onNip44Encrypt;
    if (options.onNip44Decrypt) this.onNip44Decrypt = options.onNip44Decrypt;
  }

  /** The currently active REQ subscription */
  protected req?: Subscription;

  /** Updates the relay subscription to listen for request events */
  protected async updateSubscription() {
    if (this.req) this.req.unsubscribe();

    const pubkey = await this.signer.getPublicKey();

    // Setup subscription to listen for requests
    this.req = from(
      this.subscriptionMethod(this.relays, [
        // If client is known, only listen for requests from the client
        this.client
          ? {
              kinds: [kinds.NostrConnect],
              "#p": [pubkey],
              authors: [this.client],
            }
          : // Otherwise listen for all requests (waiting for a `connect` request)
            {
              kinds: [kinds.NostrConnect],
              "#p": [pubkey],
            },
      ]),
    )
      .pipe(
        // Keep the connection open indefinitely
        repeat(),
        // Retry on connection failure
        retry(),
        // Ignore strings (support for applesauce-relay)
        filter((event) => typeof event !== "string"),
      )
      .subscribe(this.handleEvent.bind(this));
  }

  /**
   * Start the provider
   * @param request - An inital `connect` request to respond to or a {@link NostrConnectURI}
   */
  async start(request?: NostrEvent | NostrConnectURI | string) {
    if (this.listening) return;
    this.listening = true;

    // Handle first request if provided (e.g. from a `connect` request)
    if (isEvent(request)) await this.handleEvent(request);
    // Handle NostrConnectURI
    else if (request) await this.handleNostrConnectURI(request as NostrConnectURI | string);

    // Start the subscription (if its not already started)
    if (!this.req) await this.updateSubscription();

    this.log("Started", this.relays);
  }

  /** Stop the provider */
  async stop() {
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
    if (this.client && this.connected && this.onClientDisconnect) this.onClientDisconnect(this.client);

    // Forget all seen requests
    this.seen.clear();

    this.client = undefined;
    this.connected = false;
    this.log("Stopped");
  }

  private waitingPromise: Deferred<string> | null = null;

  /** Wait for a client to connect */
  waitForClient(abort?: AbortSignal): Promise<string> {
    if (this.client) return Promise.resolve(this.client);

    this.start();
    this.waitingPromise = createDefer<string>();
    abort?.addEventListener(
      "abort",
      () => {
        this.waitingPromise?.reject(new Error("Aborted"));
        this.waitingPromise = null;
        this.stop();
      },
      true,
    );

    return this.waitingPromise;
  }

  /** Call this method with incoming events */
  public async handleEvent(event: NostrEvent) {
    if (!verifyEvent(event)) return;

    // Do nothing if this request has already been seen
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);

    try {
      const content =
        getHiddenContent(event) ||
        // Support legacy NIP-04 encryption
        (isNIP04(event.content)
          ? await unlockHiddenContent(event, this.signer, "nip04")
          : await unlockHiddenContent(event, this.signer, "nip44"));
      const request = JSON.parse(content) as NostrConnectRequest<any>;

      // If the client isn't known, reject the request
      if (!this.client && request.method !== NostrConnectMethod.Connect)
        throw new Error("Received request from unknown client");
      else if (this.client && event.pubkey !== this.client) throw new Error("Received request from wrong client");

      // Process the request
      this.log(`Processing ${request.method} from ${event.pubkey}`);

      try {
        let result: any;

        switch (request.method) {
          case NostrConnectMethod.Connect:
            result = await this.handleConnect(
              event.pubkey,
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
        await this.sendResponse(event, request.id, result);
      } catch (error) {
        this.log(`Error processing ${request.method}:`, error);
        await this.sendErrorResponse(event, request.id, error instanceof Error ? error.message : "Unknown error");
      }
    } catch (err) {
      this.log("Error handling request:", err);
    }
  }

  /** Handle an initial NostrConnectURI */
  public async handleNostrConnectURI(uri: NostrConnectURI | string) {
    if (this.client) throw new Error("Already connected to a client");

    // Parse the URI
    if (typeof uri === "string") uri = parseNostrConnectURI(uri);

    // Get a response to a fake initial `connect` request
    const response = await this.handleConnect(uri.client, [
      await this.signer.getPublicKey(),
      uri.secret,
      uri.metadata?.permissions?.join(",") ?? "",
    ]);

    // Send `connect` response with random id
    await this.sendResponse(uri.client, nanoid(8), response);
  }

  /** Handle connect request */
  protected async handleConnect(
    client: string,
    [target, secret, permissionsStr]: ConnectRequestParams[NostrConnectMethod.Connect],
  ): Promise<ConnectResponseResults[NostrConnectMethod.Connect]> {
    const permissions = permissionsStr ? permissionsStr.split(",") : [];

    // Check if this is a connection to our provider
    const providerPubkey = await this.signer.getPublicKey();
    if (target !== providerPubkey) throw new Error("Invalid target pubkey");

    // If the client is already known, ensure that it matches the new client
    if (this.client && this.client !== client) throw new Error("Only one client can connect at a time");

    // If this is the first `connect` request, check that the secret matches
    if (this.secret && !this.client && this.secret !== secret) throw new Error("Invalid connection secret");

    // Handle authorization if callback is provided
    if (this.onConnect) {
      const authorized = await this.onConnect(client, permissions);
      if (authorized === false) throw new Error("Authorization denied");
    }

    // If the client isn't set yet, this if the first `connect` request
    const isFirstRequest = !this.client;

    // Establish connection
    this.client = client;
    this.connected = true;
    if (!this.secret) this.secret = secret;

    // Update the subscription since we now know the client pubkey
    if (isFirstRequest) await this.updateSubscription();

    // Notify connection
    if (this.onClientConnect) this.onClientConnect(client);

    // Resolve waiting promise
    if (this.waitingPromise) {
      this.waitingPromise.resolve(client);
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

    // Check if the sign event is allowed
    if (this.onSignEvent) {
      const result = await this.onSignEvent(template, this.client!);
      if (result === false) throw new Error("Sign event denied");
    }

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

    // Check if the nip04 encryption is allowed
    if (this.onNip04Encrypt) {
      const result = await this.onNip04Encrypt(pubkey, plaintext, this.client!);
      if (result === false) throw new Error("NIP-04 encryption denied");
    }

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

    // Check if the nip04 decryption is allowed
    if (this.onNip04Decrypt) {
      const result = await this.onNip04Decrypt(pubkey, ciphertext, this.client!);
      if (result === false) throw new Error("NIP-04 decryption denied");
    }

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

    // Check if the nip44 encryption is allowed
    if (this.onNip44Encrypt) {
      const result = await this.onNip44Encrypt(pubkey, plaintext, this.client!);
      if (result === false) throw new Error("NIP-44 encryption denied");
    }

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

    // Check if the nip44 decryption is allowed
    if (this.onNip44Decrypt) {
      const result = await this.onNip44Decrypt(pubkey, ciphertext, this.client!);
      if (result === false) throw new Error("NIP-44 decryption denied");
    }

    return await this.upstream.nip44.decrypt(pubkey, ciphertext);
  }

  /**
   * Send a response to the client
   * @param clientOrRequest - The client pubkey or request event
   * @param requestId - The id of the request
   * @param result - The result of the request
   */
  protected async sendResponse<T extends NostrConnectMethod>(
    clientOrRequest: NostrEvent | string,
    requestId: string,
    result: ConnectResponseResults[T],
  ) {
    const response: NostrConnectResponse<any> = {
      id: requestId,
      result,
    };

    await this.sendMessage(clientOrRequest, response);
  }

  /** Send an error response to the client */
  protected async sendErrorResponse(event: NostrEvent, requestId: string, error: string) {
    const response = {
      id: requestId,
      result: "",
      error,
    };

    await this.sendMessage(event, response);
  }

  /** Send an encrypted message to the client */
  protected async sendMessage(clientOrRequest: string | NostrEvent, message: NostrConnectResponse<any>) {
    // Get the pubkey of the client
    const client = typeof clientOrRequest === "string" ? clientOrRequest : clientOrRequest.pubkey;

    // Try NIP-44 first, fallback to NIP-04
    let encryption: EncryptionMethods;

    // If responding to a request, try to use the same encryption
    if (typeof clientOrRequest !== "string")
      encryption = getEncryptedContentEncryptionMethods(
        clientOrRequest.kind,
        this.signer,
        isNIP04(clientOrRequest.content) ? "nip04" : "nip44",
      );
    // Get default encryption method (nip44)
    else encryption = getEncryptedContentEncryptionMethods(kinds.NostrConnect, this.signer);

    const content = JSON.stringify(message);
    const event = await this.signer.signEvent({
      kind: kinds.NostrConnect,
      created_at: unixNow(),
      tags: [["p", client]],
      content: await encryption.encrypt(client, content),
    });

    // Publish the event
    const result = this.publishMethod(this.relays, event);

    // Handle returned Promise or Observable
    if (result instanceof Promise) {
      await result;
    } else if ("subscribe" in result) {
      await new Promise<void>((res) => result.subscribe({ complete: res }));
    }
  }

  /** Get the connection string that clients can use to connect */
  async getBunkerURI(): Promise<string> {
    return createBunkerURI({
      remote: await this.signer.getPublicKey(),
      relays: this.relays,
      secret: this.secret,
    });
  }
}
