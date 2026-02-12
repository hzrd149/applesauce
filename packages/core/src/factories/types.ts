import { EventTemplate, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import { AddressPointer } from "../helpers/pointers.js";

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

/** A single operation that transforms a value (context-free) */
export type Operation<I extends unknown = unknown, R extends unknown = unknown> = (value: I) => R | Promise<R>;

/** A single operation that modifies an events public or hidden tags array */
export type TagOperation = Operation<string[][], string[][]>;

/** A single operation that modifies an event */
export type EventOperation<
  I extends EventTemplate | UnsignedEvent | NostrEvent = EventTemplate,
  R extends EventTemplate | UnsignedEvent | NostrEvent = EventTemplate,
> = Operation<I, R>;

/** NIP-30 emoji type */
export type Emoji = {
  /** The emoji shortcode (without the ::) */
  shortcode: string;
  /** The URL to the emoji image */
  url: string;
};

/** A context with optional methods for getting relay hints */
export interface RelayHintContext {
  getEventRelayHint?: (event: string) => string | undefined | Promise<string> | Promise<undefined>;
  getPubkeyRelayHint?: (pubkey: string) => string | undefined | Promise<string> | Promise<undefined>;
}

export interface EventFactoryClient {
  name: string;
  address?: Omit<AddressPointer, "kind" | "relays">;
}

export interface EmojiContext {
  /** An array of custom emojis that will be used for text notes */
  emojis?: Emoji[];
}

/** Services that can be provided to event operations */
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
