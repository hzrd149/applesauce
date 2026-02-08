import { isKind } from "nostr-tools/kinds";
import { EventTemplate, KnownEvent, KnownEventTemplate, KnownUnsignedEvent, NostrEvent } from "../helpers/event.js";
import { unixNow } from "../helpers/time.js";

/** A loose type for the input of an event factory */
type EventTemplateInput<
  K extends number = number,
  T extends EventTemplate | KnownEventTemplate<K> = KnownEventTemplate<K>,
> =
  // Make created_at, tags, and content optional
  Omit<T, "created_at" | "tags" | "content"> & Partial<Pick<T, "created_at" | "tags" | "content">>;

/** The first argument of an event factory constructor */
export type EventFactoryExecutor<K extends number = number, T extends KnownEventTemplate<K> = KnownEventTemplate<K>> =
  | EventTemplateInput<K, T>
  | Promise<EventTemplateInput<K, T>>
  | ((resolve: (value: EventTemplateInput<K, T>) => void, reject: (reason: any) => void) => void);

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
  static fromEvent<T extends KnownEvent<number>>(event: T): EventFactory<T["kind"], T> {
    return new EventFactory((res) => res(event));
  }

  /** Creates a new event factory from a nostr event and updates its created_at timestamp */
  static modify<T extends NostrEvent>(event: T): EventFactory<T["kind"]> {
    // NOTE: not passing the T type here because strip() will return a EventTemplate
    return new EventFactory((res) => res(event)).strip().created();
  }

  /** Custom .then method that wraps the resulting promise in a new event factory */
  chain<RT extends T = T>(
    onfulfilled?: ((value: T) => RT | PromiseLike<RT>) | undefined | null,
  ): EventFactory<RT["kind"], RT> {
    console.log(this.constructor);
    return new EventFactory((res) => res(this.then(onfulfilled)));
  }

  /** Sets the event kind and casts the result to a {@link KnownEventTemplate<Kind>} */
  kind<Kind extends number>(kind: Kind): EventFactory<Kind, KnownEventTemplate<Kind>> {
    return this.chain((res) => ({ ...res, kind }));
  }

  /** Sets the event content */
  content(content: string) {
    return this.chain<T>((res) => ({ ...res, content }));
  }

  /** Set the event created_at timestamp in seconds. if no value is provided, the current unix timestamp will be used */
  created(created: number | Date = unixNow()) {
    if (created instanceof Date) created = Math.floor(created.getTime() / 1000);
    return this.chain((res) => ({ ...res, created_at: created }));
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
  stamp(signer: { getPublicKey: () => Promise<string> | string }): EventFactory<K, KnownUnsignedEvent<K>> {
    return new EventFactory((res) =>
      res(
        this.then(async (v) => {
          const pubkey = await signer.getPublicKey();
          return { ...v, pubkey };
        }),
      ),
    );
  }

  /** Signs the event using a signer interface and returns a Promise */
  async sign(signer: { signEvent: (event: T) => NostrEvent | Promise<NostrEvent> }): Promise<KnownEvent<K>> {
    const template = await this;
    const signed = await signer.signEvent(template);

    // Verify the pubkey has not changed
    if (Reflect.has(template, "pubkey") && Reflect.get(template, "pubkey") !== signed.pubkey)
      throw new Error("Signer modified pubkey");

    // If its the same kind, return the signed event
    if (isKind(signed, template.kind)) return signed;
    else throw new Error("Signer modified event kind");
  }
}
