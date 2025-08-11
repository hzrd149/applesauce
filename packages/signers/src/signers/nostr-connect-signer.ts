import { EventTemplate, Filter, kinds, NostrEvent, verifyEvent } from "nostr-tools";
import { ISigner, SimpleSigner } from "applesauce-signers";
import { Deferred, createDefer } from "applesauce-core/promise";
import { isHexKey, unixNow } from "applesauce-core/helpers";
import { logger } from "applesauce-core";
import { getPublicKey } from "nostr-tools";
import { nanoid } from "nanoid";

import { isNIP04 } from "../helpers/encryption.js";
import { Subscribable, Unsubscribable } from "../types/observable.js";

export function isErrorResponse(response: any): response is NostrConnectErrorResponse {
  return !!response.error;
}

export enum Permission {
  GetPublicKey = "get_pubic_key",
  SignEvent = "sign_event",
  Nip04Encrypt = "nip04_encrypt",
  Nip04Decrypt = "nip04_decrypt",
  Nip44Encrypt = "nip44_encrypt",
  Nip44Decrypt = "nip44_decrypt",
}

export enum NostrConnectMethod {
  Connect = "connect",
  CreateAccount = "create_account",
  GetPublicKey = "get_public_key",
  SignEvent = "sign_event",
  Nip04Encrypt = "nip04_encrypt",
  Nip04Decrypt = "nip04_decrypt",
  Nip44Encrypt = "nip44_encrypt",
  Nip44Decrypt = "nip44_decrypt",
}
export type ConnectRequestParams = {
  [NostrConnectMethod.Connect]: [string] | [string, string] | [string, string, string];
  [NostrConnectMethod.CreateAccount]: [string, string] | [string, string, string] | [string, string, string, string];
  [NostrConnectMethod.GetPublicKey]: [];
  [NostrConnectMethod.SignEvent]: [string];
  [NostrConnectMethod.Nip04Encrypt]: [string, string];
  [NostrConnectMethod.Nip04Decrypt]: [string, string];
  [NostrConnectMethod.Nip44Encrypt]: [string, string];
  [NostrConnectMethod.Nip44Decrypt]: [string, string];
};
export type ConnectResponseResults = {
  [NostrConnectMethod.Connect]: "ack" | string;
  [NostrConnectMethod.CreateAccount]: string;
  [NostrConnectMethod.GetPublicKey]: string;
  [NostrConnectMethod.SignEvent]: string;
  [NostrConnectMethod.Nip04Encrypt]: string;
  [NostrConnectMethod.Nip04Decrypt]: string;
  [NostrConnectMethod.Nip44Encrypt]: string;
  [NostrConnectMethod.Nip44Decrypt]: string;
};

export type NostrConnectRequest<N extends NostrConnectMethod> = {
  id: string;
  method: N;
  params: ConnectRequestParams[N];
};
export type NostrConnectResponse<N extends NostrConnectMethod> = {
  id: string;
  result: ConnectResponseResults[N];
  error?: string;
};
export type NostrConnectErrorResponse = {
  id: string;
  result: string;
  error: string;
};

async function defaultHandleAuth(url: string) {
  window.open(url, "auth", "width=400,height=600,resizable=no,status=no,location=no,toolbar=no,menubar=no");
}

export type NostrConnectSignerOptions = {
  /** The relays to communicate over */
  relays: string[];
  /** A {@link SimpleSigner} for this client */
  signer?: SimpleSigner;
  /** pubkey of the remote signer application */
  remote?: string;
  /** Users pubkey */
  pubkey?: string;
  /** A method for handling "auth" requests */
  onAuth?: (url: string) => Promise<void>;
  /** A method for subscribing to relays */
  subscriptionMethod?: NostrSubscriptionMethod;
  /** A method for publishing events */
  publishMethod?: NostrPublishMethod;
};

/** A method used to subscribe to events on a set of relays */
export type NostrSubscriptionMethod = (relays: string[], filters: Filter[]) => Subscribable<NostrEvent | string>;

/** A method used for publishing an event, can return a Promise that completes when published or an Observable that completes when published*/
export type NostrPublishMethod = (relays: string[], event: NostrEvent) => Promise<any> | Subscribable<any>;

export type NostrConnectAppMetadata = {
  name?: string;
  image?: string;
  url?: string | URL;
  permissions?: string[];
};

export class NostrConnectSigner implements ISigner {
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
  protected clientSecret = nanoid(12);

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

  /** A fallback method to use for subscriptionMethod if none is pass in when creating the signer */
  static subscriptionMethod: NostrSubscriptionMethod | undefined = undefined;
  /** A fallback method to use for publishMethod if none is pass in when creating the signer */
  static publishMethod: NostrPublishMethod | undefined = undefined;

  constructor(opts: NostrConnectSignerOptions) {
    this.relays = opts.relays;
    this.pubkey = opts.pubkey;
    this.remote = opts.remote;
    const subscriptionMethod = opts.subscriptionMethod || NostrConnectSigner.subscriptionMethod;
    if (!subscriptionMethod)
      throw new Error("Missing subscriptionMethod, either pass a method or set NostrConnectSigner.subscriptionMethod");
    const publishMethod = opts.publishMethod || NostrConnectSigner.publishMethod;
    if (!publishMethod)
      throw new Error("Missing publishMethod, either pass a method or set NostrConnectSigner.publishMethod");

    this.subscriptionMethod = subscriptionMethod;
    this.publishMethod = publishMethod;

    if (opts.onAuth) this.onAuth = opts.onAuth;

    this.signer = opts?.signer || new SimpleSigner();

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
  protected req?: Unsubscribable;

  /** Open the connection */
  async open() {
    if (this.listening) return;

    this.listening = true;
    const pubkey = await this.signer.getPublicKey();

    // Setup subscription
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
      const responseStr = isNIP04(event.content)
        ? await this.signer.nip04.decrypt(event.pubkey, event.content)
        : await this.signer.nip44.decrypt(event.pubkey, event.content);
      const response = JSON.parse(responseStr);

      // handle remote signer connection
      if (!this.remote && (response.result === "ack" || (this.clientSecret && response.result === this.clientSecret))) {
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
    const params = new URLSearchParams();

    params.set("secret", this.clientSecret);
    if (metadata?.name) params.set("name", metadata.name);
    if (metadata?.url) params.set("url", String(metadata.url));
    if (metadata?.image) params.set("image", metadata.image);
    if (metadata?.permissions) params.set("perms", metadata.permissions.join(","));
    for (const relay of this.relays) params.append("relay", relay);

    const client = getPublicKey(this.signer.key);
    return `nostrconnect://${client}?` + params.toString();
  }

  /** Parses a bunker:// URI */
  static parseBunkerURI(uri: string): { remote: string; relays: string[]; secret?: string } {
    const url = new URL(uri);

    // firefox puts pubkey part in host, chrome puts pubkey in pathname
    const remote = url.host || url.pathname.replace("//", "");
    if (!isHexKey(remote)) throw new Error("Invalid connection URI");

    const relays = url.searchParams.getAll("relay");
    if (relays.length === 0) throw new Error("Missing relays");
    const secret = url.searchParams.get("secret") ?? undefined;

    return { remote, relays, secret };
  }

  /** Builds an array of signing permissions for event kinds */
  static buildSigningPermissions(kinds: number[]) {
    return [Permission.GetPublicKey, ...kinds.map((k) => `${Permission.SignEvent}:${k}`)];
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
