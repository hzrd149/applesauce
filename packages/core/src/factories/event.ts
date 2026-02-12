import { isKind } from "nostr-tools/kinds";
import { EventSigner } from "../event-factory/types.js";
import { EncryptionMethod } from "../helpers/encrypted-content.js";
import { EventTemplate, KnownEvent, KnownEventTemplate, KnownUnsignedEvent } from "../helpers/event.js";
import { unixNow } from "../helpers/time.js";
import { setEncryptedContent } from "../operations/encrypted-content.js";
import { sign, stamp } from "../operations/event.js";
import { modifyHiddenTags, modifyPublicTags, modifyTags } from "../operations/tags.js";

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

/** A single operation that modifies an event */
export type EventOperation<T extends KnownEventTemplate<number> = EventTemplate> = (
  draft: T,
) => T | EventTemplate | PromiseLike<T | EventTemplate>;

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

  // /** Creates a new event factory from a nostr event and updates its created_at timestamp */
  // static modify<T extends NostrEvent>(event: T): EventFactory<T["kind"]> {
  //   // NOTE: not passing the T type here because strip() will return a EventTemplate
  //   return new EventFactory((res) => res(event)).strip().created();
  // }

  /** The signer used to sign the event */
  protected signer?: EventSigner;

  /** Custom .then method that wraps the resulting promise in a new event factory */
  protected chain(operation: EventOperation<T>): this {
    const Constructor = this.constructor as typeof EventFactory;
    const next = new Constructor((res) => res(this.then(operation)));

    // transfer the signer if set
    if (this.signer) return next.as(this.signer) as this;
    else return next as this;
  }

  /** Sets the event signer to use when building this event */
  as(signer: EventSigner): this {
    this.signer = signer;
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

  /** Modifies the events public and optional hidden tags */
  modifyTags(...args: Parameters<typeof modifyTags>) {
    return this.chain((e) => modifyTags(args[0], this.signer)(e));
  }

  /** Modifies the events public tags array */
  modifyPublicTags(...args: Parameters<typeof modifyPublicTags>) {
    return this.chain((e) => modifyPublicTags(...args)(e));
  }

  /** Modifies the events hidden tags array */
  modifyHiddenTags(...args: Exclude<Parameters<typeof modifyHiddenTags>[1], undefined>[]) {
    return this.chain((e) => modifyHiddenTags(this.signer, ...args)(e));
  }

  /** Sets the encrypted content of the event */
  encryptedContent(target: string, content: string, override?: EncryptionMethod, signer = this.signer) {
    if (!signer) throw new Error("Signer required for encrypted content");

    return this.chain((draft) => setEncryptedContent(target, content, signer, override)(draft));
  }
}
