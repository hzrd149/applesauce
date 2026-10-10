import { logger, type Debugger } from "applesauce-core";
import { getHiddenContent, isHexKey, unixNow } from "applesauce-core/helpers";
import { bytesToHex, EventTemplate, hexToBytes, NostrEvent, kinds, verifyEvent } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { Deferred, createDefer } from "applesauce-core/promise";
import {
  ISigner,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
  PrivateKeySigner,
  getConnectionMethods,
} from "applesauce-signers";
import { nanoid } from "nanoid";
import { Subscription, filter, from, repeat, retry } from "rxjs";
import { isNIP04 } from "../helpers/encryption.js";
import {
  BunkerURI,
  ConnectRequestParams,
  ConnectResponseResults,
  createConnectMetadata,
  createNbunksec,
  NostrConnectAppMetadata,
  NostrConnectMethod,
  NostrConnectRequest,
  NostrConnectResponse,
  Nbunksec,
  buildSigningPermissions,
  createNostrConnectURI,
  parseBunkerURI,
  parseNbunksec,
} from "../helpers/nostr-connect.js";

async function defaultHandleAuth(url: string) {
  window.open(url, "auth", "width=400,height=600,resizable=no,status=no,location=no,toolbar=no,menubar=no");
}

export type NostrConnectSignerOptions = NostrConnectionMethodsOptions & {
  /** The relays to communicate over */
  relays: string[];
  /** A {@link PrivateKeySigner} for this client */
  signer?: PrivateKeySigner;
  /** pubkey of the remote signer application */
  remote?: string;
  /** Users pubkey */
  pubkey?: string;
  /** @deprecated Use connectSecret instead */
  secret?: string;
  /** A secret used when initiating the connection from the client side (the `secret` in a nostrconnect:// URI) */
  connectSecret?: string;
  /** A secret used when connecting to a remote bunker (the `secret` in a bunker:// URI) */
  bunkerSecret?: string;
  /** A method for handling "auth" requests */
  onAuth?: (url: string) => Promise<void>;
  /** Milliseconds to wait for a response before rejecting a request (default 60s, 0 to disable) */
  timeout?: number;
  /** Whether to send a `switch_relays` request after connecting (default false) */
  autoSwitchRelays?: boolean;
  /** Client metadata sent with `connect` requests and used for the nostrconnect:// URI */
  metadata?: NostrConnectAppMetadata;
};

/** Options for {@link NostrConnectSigner.logout} */
export type NostrConnectLogoutOptions = {
  /** Milliseconds to wait for the remote signer to acknowledge before closing (defaults to the signer timeout) */
  timeout?: number;
};

export class NostrConnectSigner implements ISigner {
  /** A fallback method to use for subscriptionMethod if none is pass in when creating the signer */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is pass in when creating the signer */
  static publishMethod: NostrPublishMethod | undefined = undefined;
  /** A fallback pool to use if none is pass in when creating the signer */
  static pool: NostrPool | undefined = undefined;

  /** A method that is called when an event needs to be published */
  protected publishMethod: NostrPublishMethod;
  /** The active nostr subscription */
  protected subscriptionMethod: NostrSubscriptionMethod;

  protected log: Debugger = logger.extend("NostrConnectSigner");
  /** The local client signer */
  public signer: PrivateKeySigner;

  /** Whether the signer is listening for events */
  listening = false;

  /** Whether the signer is connected to the remote signer */
  isConnected = false;

  /** The users pubkey */
  protected pubkey?: string;
  /** Relays to communicate over */
  relays: string[];
  /** The remote signer pubkey */
  remote?: string;

  /** Client pubkey */
  get clientPubkey() {
    return getPublicKey(this.signer.key);
  }

  /** A method for handling "auth" requests */
  public onAuth: (url: string) => Promise<void> = defaultHandleAuth;

  /** Milliseconds to wait for a response before rejecting a request (0 to disable) */
  public timeout: number;

  /** Whether to send a `switch_relays` request after connecting */
  public autoSwitchRelays: boolean;

  /** Client metadata sent with `connect` requests */
  public metadata?: NostrConnectAppMetadata;

  verifyEvent: typeof verifyEvent = verifyEvent;

  /** A secret used when initiating a connection from the client side (the `secret` in a nostrconnect:// URI) */
  public connectSecret: string;

  /** A secret used when connecting to a remote bunker (the `secret` in a bunker:// URI) */
  public bunkerSecret?: string;

  /** @deprecated Use connectSecret instead */
  get secret(): string {
    return this.connectSecret;
  }
  set secret(value: string) {
    this.connectSecret = value;
  }

  nip04?:
    | {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
      }
    | undefined;
  nip44?:
    | {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
      }
    | undefined;

  constructor(options: NostrConnectSignerOptions) {
    this.relays = options.relays;
    this.pubkey = options.pubkey;
    this.remote = options.remote;
    this.connectSecret = options.connectSecret || options.secret || nanoid(12);
    this.bunkerSecret = options.bunkerSecret;
    this.timeout = options.timeout ?? 60_000;
    this.autoSwitchRelays = options.autoSwitchRelays ?? false;
    this.metadata = options.metadata;

    // Get the subscription and publish methods
    const { subscriptionMethod, publishMethod } = getConnectionMethods(options, NostrConnectSigner);

    // Use arrow functions so "this" isn't bound to the signer
    this.subscriptionMethod = (relays, filters) => subscriptionMethod(relays, filters);
    this.publishMethod = (relays, event) => publishMethod(relays, event);

    if (options.onAuth) this.onAuth = options.onAuth;

    // Get or create the local signer
    this.signer = options?.signer || new PrivateKeySigner();

    this.nip04 = {
      encrypt: this.nip04Encrypt.bind(this),
      decrypt: this.nip04Decrypt.bind(this),
    };
    this.nip44 = {
      encrypt: this.nip44Encrypt.bind(this),
      decrypt: this.nip44Decrypt.bind(this),
    };
  }

  /** The currently active REQ subscription */
  protected req?: Subscription;

  /** Open the connection */
  async open() {
    if (this.listening) return;

    this.listening = true;
    await this.subscribe();
    this.log("Opened", this.relays);
  }

  /** Starts the REQ subscription on the current relays */
  protected async subscribe() {
    this.req?.unsubscribe();
    const pubkey = await this.signer.getPublicKey();

    // Setup subscription
    this.req = from(
      this.subscriptionMethod(this.relays, [
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

  /** Close the connection */
  async close() {
    this.isConnected = false;

    // Already closed, nothing to clean up
    if (!this.listening) return;
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

    // Reject pending requests since their responses can no longer be received
    for (const request of this.requests.values()) request.reject(new Error("Closed"));

    this.log("Closed");
  }

  protected requests = new Map<string, Deferred<any>>();
  protected auths = new Set<string>();
  /** Timeout timers for pending requests */
  protected timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Starts or restarts the timeout for a pending request */
  protected startRequestTimeout(id: string, method: string) {
    clearTimeout(this.timers.get(id));
    if (!this.timeout) return;

    this.timers.set(
      id,
      setTimeout(() => {
        this.requests.get(id)?.reject(new Error(`Remote signer did not respond to ${method} request`));
      }, this.timeout),
    );
  }

  /** Call this method with incoming events */
  public async handleEvent(event: NostrEvent) {
    if (!this.verifyEvent(event)) return;

    // ignore the event if its not from the remote signer
    if (this.remote && event.pubkey !== this.remote) return;

    try {
      const responseStr =
        getHiddenContent(event) ??
        (isNIP04(event.content)
          ? await this.signer.nip04.decrypt(event.pubkey, event.content)
          : await this.signer.nip44.decrypt(event.pubkey, event.content));
      if (!responseStr) return;

      const response = JSON.parse(responseStr) as NostrConnectResponse<any>;

      // Handle the remote signer connecting from a nostrconnect:// URI
      if (!this.remote) {
        // The secret must be validated to prevent connection spoofing, so "ack" is not accepted here
        if (response.result !== this.connectSecret) return;

        this.log("Got connect response from", event.pubkey);
        this.isConnected = true;
        this.remote = event.pubkey;
        this.waitingPromise?.resolve();
        this.waitingPromise = null;
        this.startAutoSwitchRelays();
        return;
      }

      if (response.id) {
        const p = this.requests.get(response.id);
        if (!p) return;
        if (response.error) {
          this.log("Got Error", response.id, response.result, response.error);
          if (response.result === "auth_url") {
            if (!this.auths.has(response.id)) {
              this.auths.add(response.id);
              // Give the user time to authenticate before timing out
              this.startRequestTimeout(response.id, "auth");
              if (this.onAuth) {
                try {
                  await this.onAuth(response.error);
                } catch (e) {
                  p.reject(e);
                }
              }
            }
          } else p.reject(new Error(response.error));
        } else if (response.result !== undefined) {
          this.log("Got Response", response.id, response.result);
          p.resolve(response.result);
        }
      }
    } catch (e) {}
  }

  protected async createRequestEvent(content: string, target = this.remote, kind = kinds.NostrConnect) {
    if (!target) throw new Error("Missing target pubkey");

    return await this.signer.signEvent({
      kind,
      created_at: unixNow(),
      tags: [["p", target]],
      content,
    });
  }

  /** Sends a request and waits for the response */
  private async makeRequest<T extends NostrConnectMethod>(
    method: T,
    params: ConnectRequestParams[T],
    kind = kinds.NostrConnect,
  ): Promise<ConnectResponseResults[T]> {
    const { response } = await this.sendRequest(method, params, kind);
    return response;
  }

  /** Publishes a request and returns the pending response without waiting for it */
  private async sendRequest<T extends NostrConnectMethod>(
    method: T,
    params: ConnectRequestParams[T],
    kind = kinds.NostrConnect,
  ): Promise<{ response: Promise<ConnectResponseResults[T]> }> {
    // Talk to the remote signer or the users pubkey
    if (!this.remote) throw new Error("Missing remote signer pubkey");

    const id = nanoid(8);
    const request: NostrConnectRequest<T> = { id, method, params };
    const encrypted = await this.signer.nip44.encrypt(this.remote, JSON.stringify(request));
    const event = await this.createRequestEvent(encrypted, this.remote, kind);
    this.log(`Sending ${id} (${method}) ${JSON.stringify(params)}`);

    const p = createDefer<ConnectResponseResults[T]>();
    this.requests.set(id, p);

    // Cleanup when the request is resolved, rejected, or timed out
    const cleanup = () => {
      this.requests.delete(id);
      this.auths.delete(id);
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    };
    p.then(cleanup, cleanup);

    this.startRequestTimeout(id, method);
    try {
      // Handle returned Promise or Observable
      const result = this.publishMethod(this.relays, event);
      await new Promise<void>((res, rej) => from(result).subscribe({ complete: res, error: rej }));
      this.log(`Sent ${id} (${method})`);
    } catch (error) {
      p.reject(error);
      throw error;
    }

    return { response: p };
  }

  /**
   * Connect to a remote signer
   * @param bunkerSecret - The `secret` from a `bunker://` URI used to authorize this client with the remote signer
   * @param permissions - The signing permissions to request (see {@link NostrConnectSigner.buildSigningPermissions})
   */
  async connect(bunkerSecret?: string | undefined, permissions?: string[]) {
    // Attempt to connect to the users pubkey if remote note set
    if (!this.remote && this.pubkey) this.remote = this.pubkey;

    if (!this.remote) throw new Error("Missing remote signer pubkey");

    await this.open();
    try {
      if (bunkerSecret !== undefined) this.bunkerSecret = bunkerSecret;

      const metadata = createConnectMetadata(this.metadata);
      const secret = this.bunkerSecret || "";
      const perms = permissions?.join(",") ?? "";

      const result = await this.makeRequest(
        NostrConnectMethod.Connect,
        metadata ? [this.remote, secret, perms, metadata] : [this.remote, secret, perms],
      );
      this.isConnected = true;
      this.startAutoSwitchRelays();
      return result;
    } catch (e) {
      this.isConnected = false;
      this.close();
      throw e;
    }
  }

  private waitingPromise: Deferred<void> | null = null;

  /** Wait for a remote signer to connect */
  waitForSigner(abort?: AbortSignal): Promise<void> {
    if (this.isConnected) return Promise.resolve();

    this.open();
    const p = createDefer<void>();
    this.waitingPromise = p;

    const onAbort = () => {
      if (this.waitingPromise !== p) return;
      this.waitingPromise = null;
      p.reject(new Error("Aborted"));
      this.close();
    };
    abort?.addEventListener("abort", onAbort, true);

    // Remove the listener once settled so a later abort can't close a connected signer
    const cleanup = () => abort?.removeEventListener("abort", onAbort, true);
    p.then(cleanup, cleanup);

    return p;
  }

  /** Request to create an account on the remote signer */
  async createAccount(username: string, domain: string, email?: string, permissions?: string[]) {
    if (!this.remote) throw new Error("Remote pubkey must be set");
    await this.open();

    try {
      const newPubkey = await this.makeRequest(NostrConnectMethod.CreateAccount, [
        username,
        domain,
        email ?? "",
        permissions?.join(",") ?? "",
      ]);

      // set the users new pubkey
      this.pubkey = newPubkey;
      this.isConnected = true;
      return newPubkey;
    } catch (e) {
      this.isConnected = false;
      this.close();
      throw e;
    }
  }

  /** Ensure the signer is listening for responses from the remote signer */
  async requireConnection() {
    // Wait for an in-flight relay switch so requests are sent on the new relays
    if (this.switching) await this.switching;
    if (this.isConnected && this.listening) return;

    // Fallback for legacy sessions where the remote signer used the users key
    if (!this.remote && this.pubkey) this.remote = this.pubkey;
    if (!this.remote) throw new Error("Not connected to a remote signer");

    // Sessions are keyed by the client pubkey, so an established session only needs to listen again.
    // Re-sending `connect` would reuse a secret that remote signers are expected to ignore
    await this.open();
    this.isConnected = true;
  }

  /** The in-flight automatic `switch_relays` request */
  protected switching: Promise<unknown> | null = null;

  /** Sends a `switch_relays` request in the background if {@link autoSwitchRelays} is enabled */
  protected startAutoSwitchRelays() {
    if (!this.autoSwitchRelays || this.switching) return;

    this.switching = this.switchRelays()
      .catch((error) => this.log("Failed to switch relays", error))
      .finally(() => (this.switching = null));
  }

  /** Get the users pubkey */
  async getPublicKey() {
    if (this.pubkey) return this.pubkey;

    await this.requireConnection();
    const key = await this.makeRequest(NostrConnectMethod.GetPublicKey, []);

    if (!isHexKey(key)) throw new Error("Remote signer returned an invalid public key");
    this.pubkey = key;
    return key;
  }

  /** Request to sign an event */
  async signEvent(template: EventTemplate & { pubkey?: string }) {
    await this.requireConnection();
    const eventString = await this.makeRequest(NostrConnectMethod.SignEvent, [JSON.stringify(template)]);
    const event = JSON.parse(eventString) as NostrEvent;
    if (!this.verifyEvent(event)) throw new Error("Invalid event");
    return event;
  }

  // NIP-04
  async nip04Encrypt(pubkey: string, plaintext: string) {
    await this.requireConnection();
    return this.makeRequest(NostrConnectMethod.Nip04Encrypt, [pubkey, plaintext]);
  }
  async nip04Decrypt(pubkey: string, ciphertext: string) {
    await this.requireConnection();
    const plaintext = await this.makeRequest(NostrConnectMethod.Nip04Decrypt, [pubkey, ciphertext]);

    // NOTE: not sure why this is here, best guess is some signer used to return results as '["plaintext"]'
    if (plaintext.startsWith('["') && plaintext.endsWith('"]')) return JSON.parse(plaintext)[0] as string;

    return plaintext;
  }

  // NIP-44
  async nip44Encrypt(pubkey: string, plaintext: string) {
    await this.requireConnection();
    return this.makeRequest(NostrConnectMethod.Nip44Encrypt, [pubkey, plaintext]);
  }
  async nip44Decrypt(pubkey: string, ciphertext: string) {
    await this.requireConnection();
    const plaintext = await this.makeRequest(NostrConnectMethod.Nip44Decrypt, [pubkey, ciphertext]);

    // NOTE: not sure why this is here, best guess is some signer used to return results as '["plaintext"]'
    if (plaintext.startsWith('["') && plaintext.endsWith('"]')) return JSON.parse(plaintext)[0] as string;

    return plaintext;
  }

  /** Send a ping request to the remote signer */
  async ping() {
    await this.requireConnection();
    return this.makeRequest(NostrConnectMethod.Ping, []);
  }

  /**
   * Request relay list from the remote signer
   * @returns An array of relay URLs if the signer wants to switch relays, or null if no change
   */
  async switchRelays(): Promise<string[] | null> {
    if (!this.isConnected || !this.listening) await this.requireConnection();
    const response = await this.makeRequest(NostrConnectMethod.SwitchRelays, []);

    // NIP-46 results are strings, so the relay list arrives JSON-stringified
    let result: string[] | null = null;
    try {
      const parsed = typeof response === "string" ? JSON.parse(response) : response;
      if (Array.isArray(parsed)) result = parsed.filter((relay) => typeof relay === "string");
    } catch (e) {}

    // Update local relays if the remote signer provided new ones
    if (result && result.length > 0) {
      this.log("Switching relays from", this.relays, "to", result);
      this.relays = result;

      // Restart subscription with new relays
      if (this.listening) await this.subscribe();
    }

    return result;
  }

  /**
   * Notify the remote signer that the session is ending and close the connection
   *
   * The `logout` request is a courtesy hint, so the local connection is always closed even if the
   * remote signer does not acknowledge it. The consumer is responsible for deleting any persisted
   * client keypair.
   */
  async logout(options?: NostrConnectLogoutOptions) {
    const timeout = options?.timeout ?? this.timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (this.isConnected && this.remote) {
        const { response } = await this.sendRequest(NostrConnectMethod.Logout, []);

        // Wait for the acknowledgement, but give up after the timeout since it's only a courtesy
        const timedOut = new Promise<void>((res) => {
          if (timeout) timer = setTimeout(res, timeout);
        });
        await Promise.race([response, timedOut]);
      }
    } catch (error) {
      this.log("Failed to send logout request", error);
    } finally {
      clearTimeout(timer);
      this.isConnected = false;
      await this.close();
    }
  }

  /** Returns the nostrconnect:// URI for this signer */
  getNostrConnectURI(metadata: NostrConnectAppMetadata | undefined = this.metadata) {
    return createNostrConnectURI({
      client: getPublicKey(this.signer.key),
      connectSecret: this.connectSecret,
      relays: this.relays,
      metadata,
    });
  }

  /** Returns the nbunksec encoded session for this signer */
  getNbunksec(): string {
    if (!this.remote) throw new Error("Cant create nbunksec when remote signer is not set");

    return createNbunksec({
      remote: this.remote,
      clientKey: bytesToHex(this.signer.key),
      relays: this.relays,
      bunkerSecret: this.bunkerSecret,
    });
  }

  /** Parses a bunker:// URI */
  static parseBunkerURI(uri: string): BunkerURI {
    return parseBunkerURI(uri);
  }

  /** Parses an nbunksec encoded session */
  static parseNbunksec(encoded: string): Nbunksec {
    return parseNbunksec(encoded);
  }

  /** Creates an nbunksec encoded session */
  static createNbunksec(data: Nbunksec): string {
    return createNbunksec(data);
  }

  /** Builds an array of signing permissions for event kinds */
  static buildSigningPermissions(kinds: number[]) {
    return buildSigningPermissions(kinds);
  }

  /** Create a {@link NostrConnectSigner} from a bunker:// URI */
  static async fromBunkerURI(
    uri: string,
    options?: Omit<NostrConnectSignerOptions, "relays"> & { permissions?: string[]; signer?: PrivateKeySigner },
  ) {
    const { remote, relays, bunkerSecret } = NostrConnectSigner.parseBunkerURI(uri);

    const client = new NostrConnectSigner({ relays, remote, bunkerSecret, ...options });
    await client.connect(bunkerSecret, options?.permissions);

    return client;
  }

  /** Create a {@link NostrConnectSigner} from an nbunksec encoded session */
  static async fromNbunksec(
    encoded: string,
    options?: Omit<NostrConnectSignerOptions, "relays" | "remote" | "signer" | "bunkerSecret"> & {
      /** @deprecated permissions are only sent with the initial `connect` request, use fromBunkerURI instead */
      permissions?: string[];
    },
  ) {
    const { remote, clientKey, relays, bunkerSecret } = NostrConnectSigner.parseNbunksec(encoded);

    const client = new NostrConnectSigner({
      relays,
      remote,
      signer: new PrivateKeySigner(hexToBytes(clientKey)),
      bunkerSecret,
      ...options,
    });

    // The session already exists, so resume listening without re-sending `connect`
    await client.requireConnection();

    return client;
  }
}
