import { ISigner } from "applesauce-signers";
import { nanoid } from "nanoid";
import { BehaviorSubject } from "rxjs";
import { getEventHash, NostrEvent, UnsignedEvent } from "nostr-tools";

import { EventTemplate, IAccount, IAccountConstructor, SerializedAccount } from "./types.js";

/** Wraps a promise in an abort signal */
function wrapInSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((res, rej) => {
    signal.throwIfAborted();
    let done = false;

    // reject promise if abort signal is triggered
    signal.addEventListener("abort", () => {
      if (!done) rej(signal.reason || undefined);
      done = true;
    });

    return promise.then(
      (v) => {
        if (!done) res(v);
        done = true;
      },
      (err) => {
        if (!done) rej(err);
        done = true;
      },
    );
  });
}

/** An error thrown when a signer is used with the wrong pubkey */
export class SignerMismatchError extends Error {}

/** A base class for all accounts */
export class BaseAccount<Signer extends ISigner, SignerData, Metadata extends unknown>
  implements IAccount<Signer, SignerData, Metadata>
{
  id = nanoid(8);

  get type() {
    const cls = Reflect.getPrototypeOf(this)!.constructor as IAccountConstructor<Signer, SignerData, Metadata>;
    return cls.type;
  }

  /** Disable request queueing */
  disableQueue?: boolean;

  metadata$ = new BehaviorSubject<Metadata | undefined>(undefined);
  get metadata(): Metadata | undefined {
    return this.metadata$.value;
  }
  set metadata(metadata: Metadata) {
    this.metadata$.next(metadata);
  }

  get nip04(): ISigner["nip04"] | undefined {
    if (!this.signer.nip04) return undefined;
    return {
      encrypt: async (pubkey, plaintext) => this.operation(() => this.signer.nip04!.encrypt(pubkey, plaintext)),
      decrypt: async (pubkey, plaintext) => this.operation(() => this.signer.nip04!.decrypt(pubkey, plaintext)),
    };
  }

  get nip44(): ISigner["nip44"] | undefined {
    if (!this.signer.nip44) return undefined;
    return {
      encrypt: async (pubkey, plaintext) => this.operation(() => this.signer.nip44!.encrypt(pubkey, plaintext)),
      decrypt: async (pubkey, plaintext) => this.operation(() => this.signer.nip44!.decrypt(pubkey, plaintext)),
    };
  }

  constructor(
    public pubkey: string,
    public signer: Signer,
  ) {}

  // This should be overwritten by a sub class
  toJSON(): SerializedAccount<SignerData, Metadata> {
    throw new Error("Not implemented");
  }

  /** A method that wraps any signer interaction, this allows the account to wait for unlock or queue requests */
  protected operation<T extends unknown>(operation: () => Promise<T>): Promise<T> {
    // If the queue is enabled, wait our turn in the queue
    return this.waitForQueue(operation);
  }

  /** Adds the common fields to the serialized output of a toJSON method */
  protected saveCommonFields(
    json: Omit<SerializedAccount<SignerData, Metadata>, "id" | "type" | "metadata" | "pubkey">,
  ): SerializedAccount<SignerData, Metadata> {
    return { ...json, id: this.id, pubkey: this.pubkey, metadata: this.metadata, type: this.type };
  }

  /** Sets an accounts id and metadata. NOTE: This should only be used in fromJSON methods */
  static loadCommonFields<T extends IAccount>(account: T, json: SerializedAccount<any, any>): T {
    if (json.id) account.id = json.id;
    if (json.metadata) account.metadata = json.metadata;
    return account;
  }

  /** Gets the pubkey from the signer */
  getPublicKey(): Promise<string> {
    return this.operation(async () => {
      const result = await this.signer.getPublicKey();
      if (this.pubkey !== result) throw new SignerMismatchError("Account signer mismatch");
      return result;
    });
  }

  /** sign the event and make sure its signed with the correct pubkey */
  signEvent(template: EventTemplate): Promise<NostrEvent> {
    // If the template does not have a pubkey, set it to the accounts pubkey
    if (!Reflect.has(template, "pubkey")) Reflect.set(template, "pubkey", this.pubkey);

    return this.operation(async () => {
      const id = getEventHash(template as UnsignedEvent);
      const result = await this.signer.signEvent(template);

      if (result.pubkey !== this.pubkey) throw new SignerMismatchError("Signer signed with wrong pubkey");
      if (result.id !== id) throw new SignerMismatchError("Signer modified event");

      return result;
    });
  }

  /** Aborts all pending requests in the queue */
  abortQueue(reason: Error) {
    if (this.abort) this.abort.abort(reason);
  }

  /** internal queue */
  protected queueLength = 0;
  protected lock: Promise<any> | null = null;
  protected abort: AbortController | null = null;
  protected reduceQueue() {
    // shorten the queue
    this.queueLength--;

    // if this was the last request, remove the lock
    if (this.queueLength === 0) {
      this.lock = null;
      this.abort = null;
    }
  }
  protected waitForQueue<T extends unknown>(operation: () => Promise<T>): Promise<T> {
    if (this.disableQueue) return operation();

    // if there is already a pending request, wait for it
    if (this.lock && this.abort) {
      // create a new promise that runs after the lock
      const p = wrapInSignal(
        this.lock.then(() => {
          // if the abort signal is triggered, don't call the signer
          this.abort?.signal.throwIfAborted();

          return operation();
        }),
        this.abort.signal,
      );

      // set the lock the new promise that ignores errors
      this.lock = p.catch(() => {}).finally(this.reduceQueue.bind(this));
      this.queueLength++;

      return p;
    } else {
      const result = operation();

      // if the result is async, set the new lock
      if (result instanceof Promise) {
        this.abort = new AbortController();

        const p = wrapInSignal(result, this.abort.signal);

        // set the lock the new promise that ignores errors
        this.lock = p.catch(() => {}).finally(this.reduceQueue.bind(this));
        this.queueLength = 1;
      }

      return result;
    }
  }
}
