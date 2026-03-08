import { isKind } from "nostr-tools/kinds";
import { EventSigner } from "./types.js";
import type { EventOperation } from "./types.js";
import { EncryptionMethod } from "../helpers/encrypted-content.js";
import { KnownEvent, KnownEventTemplate, KnownUnsignedEvent } from "../helpers/event.js";
import { unixNow } from "../helpers/time.js";
import { setEncryptedContent } from "../operations/encrypted-content.js";
import {
  includeAltTag,
  MetaTagOptions,
  setExpirationTimestamp,
  setMetaTags,
  setProtected,
  sign,
  stamp,
} from "../operations/event.js";
import { modifyHiddenTags, modifyPublicTags, modifyTags } from "../operations/tags.js";
import { setContentWarning } from "../operations/content.js";

/** Creates a blank event template with the given kind */
export function blankEventTemplate<K extends number = number>(kind: K): KnownEventTemplate<K> {
  return { kind, created_at: unixNow(), tags: [], content: "" };
}

/** Converts a nostr event to an event template and updates the created_at timestamp */
export function toEventTemplate<K extends number>(event: KnownEvent<K>): KnownEventTemplate<K> {
  return {
    kind: event.kind,
    created_at: unixNow(),
    tags: Array.from(event.tags),
    content: event.content,
  };
}

/** Shared mutable signer container passed through the factory chain */
type SignerRef = { signer?: EventSigner };

/** The base class for building or modifying events */
export class EventFactory<
  K extends number = number,
  T extends KnownEventTemplate<K> = KnownEventTemplate<K>,
> extends Promise<T> {
  /** Create a new event factory from a kind */
  static fromKind<K extends number>(kind: K): EventFactory<K> {
    return new EventFactory((res) => res({ kind, created_at: unixNow(), tags: [], content: "" }));
  }

  /** Create a new event factory from a nostr event */
  static fromEvent<K extends number = number>(event: KnownEvent<K>): EventFactory<K, KnownEventTemplate<K>> {
    return new EventFactory((res) => res(toEventTemplate(event)));
  }

  /** Shared mutable reference to the signer, propagated through all chain links */
  protected _signerRef: SignerRef = {};

  /** The signer used to sign the event (reads from shared ref) */
  protected get signer(): EventSigner | undefined {
    return this._signerRef.signer;
  }

  protected set signer(value: EventSigner | undefined) {
    this._signerRef.signer = value;
  }

  /** Custom .then method that wraps the resulting promise in a new event factory */
  protected chain(operation: EventOperation<T>): this {
    const Constructor = this.constructor as typeof EventFactory;
    const next = new Constructor((res) => res(this.then(operation)));

    // Share the same signer reference so setting .as() on any link propagates to all
    (next as EventFactory<K, T>)._signerRef = this._signerRef;

    return next as this;
  }

  /** Sets the event signer to use when building this event */
  as(signer: EventSigner): this {
    this._signerRef.signer = signer;
    return this;
  }

  /** Strips the pubkey, sig, and id from the event */
  strip(): EventFactory<K> {
    return new EventFactory((res) =>
      res(
        this.then((v) => ({
          content: v.content,
          tags: v.tags,
          created_at: v.created_at,
          kind: v.kind,
        })),
      ),
    );
  }

  /** Stamps the pubkey onto the event template */
  stamp(signer = this.signer): EventFactory<K, KnownUnsignedEvent<K>> {
    return new EventFactory((res, rej) => {
      if (!signer) return rej(new Error("Signer required for stamping"));
      else res(this.then((template) => stamp(signer)(template)) as Promise<KnownUnsignedEvent<K>>);
    });
  }

  /** Signs the event using a signer interface and returns a Promise */
  async sign(signer = this.signer): Promise<KnownEvent<K>> {
    if (!signer) throw new Error("Missing signer");

    // Ensure the signer is available to chain operations during resolution
    if (!this.signer) this.signer = signer;

    const template = await this;
    const signed = await sign(signer)(template);

    // Verify the pubkey has not changed
    if (Reflect.has(template, "pubkey") && Reflect.get(template, "pubkey") !== signed.pubkey)
      throw new Error("Signer modified pubkey");

    // If its the same kind, return the signed event
    if (isKind(signed, template.kind)) return signed;
    else throw new Error("Signer modified event kind");
  }

  /** Sets the event kind and casts the result to a {@link KnownEventTemplate<Kind>} */
  kind<Kind extends number>(kind: Kind): EventFactory<Kind, KnownEventTemplate<Kind>> {
    return new EventFactory((e) => ({ ...e, kind }));
  }

  /** Sets the event content */
  content(content: string) {
    return this.chain((e) => ({ ...e, content }));
  }

  /** Set the event created_at timestamp in seconds. if no value is provided, the current unix timestamp will be used */
  created(created: number | Date = unixNow()) {
    if (created instanceof Date) created = Math.floor(created.getTime() / 1000);
    return this.chain((e) => ({ ...e, created_at: created }));
  }

  /** Sets the meta tags for the event */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }

  /** Sets the NIP-31 alt tag for the event */
  alt(alt: string) {
    return this.chain(includeAltTag(alt));
  }

  /** Sets the NIP-40 expiration timestamp for the event */
  expiration(timestamp: number) {
    return this.chain(setExpirationTimestamp(timestamp));
  }

  /** Sets the NIP-36 content-warning tag for the event */
  contentWarning(warning: string | boolean) {
    return this.chain(setContentWarning(warning));
  }

  /** Sets the NIP-70 "-" tag for the event */
  protected(isProtected: boolean) {
    return this.chain(setProtected(isProtected));
  }

  /** Modifies the events public and optional hidden tags */
  modifyTags(...args: Parameters<typeof modifyTags>): this {
    let result: this;
    result = this.chain((e) => modifyTags(args[0], result.signer)(e));
    return result;
  }

  /** Modifies the events public tags array */
  modifyPublicTags(...args: Parameters<typeof modifyPublicTags>): this {
    return this.chain(modifyPublicTags(...args));
  }

  /** Modifies the events hidden tags array */
  modifyHiddenTags(...args: Exclude<Parameters<typeof modifyHiddenTags>[1], undefined>[]): this {
    let result: this;
    result = this.chain((e) => modifyHiddenTags(result.signer, ...args)(e));
    return result;
  }

  /** Sets the encrypted content of the event */
  encryptedContent(target: string, content: string, override?: EncryptionMethod): this {
    let result: this;
    result = this.chain((draft) => {
      const signer = result.signer;
      if (!signer) throw new Error("Signer required for encrypted content");
      return setEncryptedContent(target, content, signer, override)(draft);
    });
    return result;
  }
}
