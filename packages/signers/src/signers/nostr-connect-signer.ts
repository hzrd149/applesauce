import { logger } from "applesauce-core";
import { getHiddenContent, unixNow } from "applesauce-core/helpers";
import { Deferred, createDefer } from "applesauce-core/promise";
import {
  ISigner,
  NostrConnectionMethodsOptions,
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
  SimpleSigner,
  getConnectionMethods,
} from "applesauce-signers";
import { nanoid } from "nanoid";
import { EventTemplate, NostrEvent, getPublicKey, kinds, verifyEvent } from "nostr-tools";

import { Subscription, filter, from, repeat, retry } from "rxjs";
import { isNIP04 } from "../helpers/encryption.js";
import {
  BunkerURI,
  ConnectRequestParams,
  ConnectResponseResults,
  NostrConnectAppMetadata,
  NostrConnectMethod,
  NostrConnectRequest,
  NostrConnectResponse,
  buildSigningPermissions,
  createNostrConnectURI,
  parseBunkerURI,
} from "../helpers/nostr-connect.js";

async function defaultHandleAuth(url: string) {
  window.open(url, "auth", "width=400,height=600,resizable=no,status=no,location=no,toolbar=no,menubar=no");
}

export type NostrConnectSignerOptions = NostrConnectionMethodsOptions & {
  /** The relays to communicate over */
  relays: string[];
  /** A {@link SimpleSigner} for this client */
  signer?: SimpleSigner;
  /** pubkey of the remote signer application */
  remote?: string;
  /** Users pubkey */
  pubkey?: string;
  /** A secret used when initalizing the connection from the client side */
  secret?: string;
  /** A method for handling "auth" requests */
  onAuth?: (url: string) => Promise<void>;
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

  protected log = logger.extend("NostrConnectSigner");
  /** The local client signer */
  public signer: SimpleSigner;

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

  verifyEvent: typeof verifyEvent = verifyEvent;

  /** A secret used when initiating a connection from the client side */
  public secret: string;

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
    this.secret = options.secret || nanoid(12);

    // Get the subscription and publish methods
    const { subscriptionMethod, publishMethod } = getConnectionMethods(options, NostrConnectSigner);

    // Use arrow functions so "this" isn't bound to the signer
    this.subscriptionMethod = (relays, filters) => subscriptionMethod(relays, filters);
    this.publishMethod = (relays, event) => publishMethod(relays, event);

    if (options.onAuth) this.onAuth = options.onAuth;

    // Get or create the local signer
    this.signer = options?.signer || new SimpleSigner();

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

    this.log("Opened", this.relays);
  }

  /** Close the connection */
  async close() {
    this.listening = false;
    this.isConnected = false;

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

    this.log("Closed");
  }

  protected requests = new Map<string, Deferred<any>>();
  protected auths = new Set<string>();

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

      // handle remote signer connection
      if (!this.remote && (response.result === "ack" || (this.secret && response.result === this.secret))) {
        this.log("Got ack response from", event.pubkey, response.result);
        this.isConnected = true;
        this.remote = event.pubkey;
        this.waitingPromise?.resolve();
        this.waitingPromise = null;
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
              if (this.onAuth) {
                try {
                  await this.onAuth(response.error);
                } catch (e) {
                  p.reject(e);
                }
              }
            }
          } else p.reject(new Error(response.error));
        } else if (response.result) {
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

  private async makeRequest<T extends NostrConnectMethod>(
    method: T,
    params: ConnectRequestParams[T],
    kind = kinds.NostrConnect,
  ): Promise<ConnectResponseResults[T]> {
    // Talk to the remote signer or the users pubkey
    if (!this.remote) throw new Error("Missing remote signer pubkey");

    const id = nanoid(8);
    const request: NostrConnectRequest<T> = { id, method, params };
    const encrypted = await this.signer.nip44.encrypt(this.remote, JSON.stringify(request));
    const event = await this.createRequestEvent(encrypted, this.remote, kind);
    this.log(`Sending ${id} (${method}) ${JSON.stringify(params)}`);

    const p = createDefer<ConnectResponseResults[T]>();
    this.requests.set(id, p);

    const result = this.publishMethod?.(this.relays, event);

    // Handle returned Promise or Observable
    if (result instanceof Promise) await result;
    else if ("subscribe" in result) await new Promise<void>((res) => result.subscribe({ complete: res }));

    this.log(`Sent ${id} (${method})`);

    return p;
  }

  /** Connect to remote signer */
  async connect(secret?: string | undefined, permissions?: string[]) {
    // Attempt to connect to the users pubkey if remote note set
    if (!this.remote && this.pubkey) this.remote = this.pubkey;

    if (!this.remote) throw new Error("Missing remote signer pubkey");

    await this.open();
    try {
      const result = await this.makeRequest(NostrConnectMethod.Connect, [
        this.remote,
        secret || "",
        permissions?.join(",") ?? "",
      ]);
      this.isConnected = true;
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

  /** Ensure the signer is connected to the remote signer */
  async requireConnection() {
    if (!this.isConnected) await this.connect();
  }

  /** Get the users pubkey */
  async getPublicKey() {
    if (this.pubkey) return this.pubkey;

    await this.requireConnection();
    return this.makeRequest(NostrConnectMethod.GetPublicKey, []);
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

  /** Returns the nostrconnect:// URI for this signer */
  getNostrConnectURI(metadata?: NostrConnectAppMetadata) {
    return createNostrConnectURI({
      client: getPublicKey(this.signer.key),
      secret: this.secret,
      relays: this.relays,
      metadata,
    });
  }

  /** Parses a bunker:// URI */
  static parseBunkerURI(uri: string): BunkerURI {
    return parseBunkerURI(uri);
  }

  /** Builds an array of signing permissions for event kinds */
  static buildSigningPermissions(kinds: number[]) {
    return buildSigningPermissions(kinds);
  }

  /** Create a {@link NostrConnectSigner} from a bunker:// URI */
  static async fromBunkerURI(
    uri: string,
    options?: Omit<NostrConnectSignerOptions, "relays"> & { permissions?: string[]; signer?: SimpleSigner },
  ) {
    const { remote, relays, secret } = NostrConnectSigner.parseBunkerURI(uri);

    const client = new NostrConnectSigner({ relays, remote, ...options });
    await client.connect(secret, options?.permissions);

    return client;
  }
}
