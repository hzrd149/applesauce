// import { Emoji } from "applesauce-common/helpers/emoji";
import { EventTemplate, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import { AddressPointer } from "../helpers/pointers.js";
import { ModifyTagsOptions } from "../operations/tags.js";
import { EventFactoryTemplate } from "./methods.js";

/** Nostr event signer */
export interface EventSigner {
  getPublicKey: () => Promise<string> | string;
  signEvent: (draft: EventTemplate | UnsignedEvent) => Promise<NostrEvent> | NostrEvent;
  nip04?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };
  nip44?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };
}

/** A context with optional methods for getting relay hints */
export interface RelayHintContext {
  getEventRelayHint?: (event: string) => string | undefined | Promise<string> | Promise<undefined>;
  getPubkeyRelayHint?: (pubkey: string) => string | undefined | Promise<string> | Promise<undefined>;
}

/** A context with an optional signer */
export interface EventSignerContext {
  signer?: EventSigner;
}

export interface EventFactoryClient {
  name: string;
  address?: Omit<AddressPointer, "kind" | "relays">;
}

/** A context with an optional NIP-89 app pointer */
export interface ClientPointerContext {
  client?: EventFactoryClient;
}

/** NIP-30 emoji type. this should be moved out of the core package to common */
export type Emoji = {
  /** The emoji shortcode (without the ::) */
  shortcode: string;
  /** The URL to the emoji image */
  url: string;
};

export interface EmojiContext {
  /** An array of custom emojis that will be used for text notes */
  emojis?: Emoji[];
}

/** All options that can be passed when building an event */
export interface EventFactoryContext extends ClientPointerContext, EventSignerContext, RelayHintContext, EmojiContext {}

/**
 * Services that can be provided to EventFactory for automatic injection into operations
 * This replaces EventFactoryContext for the new context-free API
 */
export interface EventFactoryServices {
  /** Event signer for signing and stamping events */
  signer?: EventSigner;
  /** Function to get relay hint for an event ID */
  getEventRelayHint?: (eventId: string) => Promise<string | undefined>;
  /** Function to get relay hint for a pubkey */
  getPubkeyRelayHint?: (pubkey: string) => Promise<string | undefined>;
  /** Custom emojis for NIP-30 emoji tags */
  emojis?: Emoji[];
  /** NIP-89 client pointer */
  client?: EventFactoryClient;
}

/** A single operation that transforms a value (context-free) */
export type Operation<I extends unknown = unknown, R extends unknown = unknown> = (value: I) => R | Promise<R>;

/** A single operation that modifies an events public or hidden tags array */
export type TagOperation = Operation<string[][], string[][]>;

/** A single operation that modifies an event */
export type EventOperation<
  I extends EventTemplate | UnsignedEvent | NostrEvent = EventTemplate,
  R extends EventTemplate | UnsignedEvent | NostrEvent = EventTemplate,
> = Operation<I, R>;

/** A method that creates a new event based on a set of operations */
export type EventBlueprint<T extends EventTemplate | UnsignedEvent | NostrEvent = EventTemplate> = (
  services: EventFactoryServices,
) => Promise<T>;

/**
 * Core helpful event creation interface.
 * Contains only methods that use blueprints from the core package.
 * Other packages (like applesauce-common) can extend this interface via module augmentation.
 */
export interface IEventFactory {
  /** Build an event template with operations */
  build(template: EventFactoryTemplate, ...operations: (EventOperation | undefined)[]): Promise<EventTemplate>;
  /** Create an event from a blueprint */
  create<T extends EventTemplate | UnsignedEvent | NostrEvent>(blueprint: EventBlueprint<T>): Promise<T>;
  create<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
    blueprint: (...args: Args) => EventBlueprint<T>,
    ...args: Args
  ): Promise<T>;
  /** Modify an existing event with operations and updated the created_at */
  modify(
    draft: EventTemplate | UnsignedEvent | NostrEvent,
    ...operations: (EventOperation | undefined)[]
  ): Promise<EventTemplate>;
  /** Modify a lists public and hidden tags and updated the created_at */
  modifyTags(
    event: EventTemplate | UnsignedEvent | NostrEvent,
    tagOperations?: ModifyTagsOptions,
    eventOperations?: EventOperation | (EventOperation | undefined)[],
  ): Promise<EventTemplate>;
  /** Attaches the signers pubkey to an event template */
  stamp(draft: EventTemplate | UnsignedEvent): Promise<UnsignedEvent>;
  /** Signs a event template with the signer */
  sign(draft: EventTemplate | UnsignedEvent): Promise<NostrEvent>;
}
