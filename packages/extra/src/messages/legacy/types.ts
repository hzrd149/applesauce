import type { EventStore } from "applesauce-core";
import type { Emoji } from "applesauce-core/factories";
import type { EncryptedContentCache, NostrEvent } from "applesauce-core/helpers";
import type { CacheRequest } from "applesauce-loaders";
import type { SyncAuthHandler, SyncLoaderStatus } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { ConversationIndexStore, MessageStorage, MessageOperationOptions } from "../common/types.js";
import type { LegacyMessageDecryptor } from "./decryptor.js";
import type { LegacyInboxReceiver } from "./inbox-receiver.js";

/** The current decryption snapshot for loaded legacy messages */
export interface LegacyDecryptionState {
  /** The number of messages currently loaded in this scope */
  readonly total: number;
  /** The number of loaded messages with available plaintext */
  readonly unlocked: number;
  /** The number of loaded messages without plaintext, including failures */
  readonly locked: number;
  /** The number of distinct loaded locked messages with active readers */
  readonly pending: number;
  /** The latest failures for loaded still-locked messages, retained during retries */
  readonly errors: ReadonlyMap<string, unknown>;
}

/** Dependencies and policies for a NIP-04 inbox */
export interface LegacyMessagesClientOptions {
  /** Default custom emojis, exposed as public tags; streams use their latest list or an empty list before emitting */
  emojis?: Emoji[] | Observable<Emoji[]>;
  /** The immutable owner pubkey */
  pubkey: string;
  /** The NIP-04 signer, omitted for read-only browsing */
  signer?: ISigner;
  /** The shared store with profile and relay-list loaders configured */
  eventStore: EventStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The encrypted kind-4 event cache */
  cacheRequest?: CacheRequest;
  /** The plaintext cache keyed by kind-4 event ID */
  decryptionCache?: EncryptedContentCache;
  /** The optional plaintext draft storage, separated by account and protocol by the application */
  draftStorage?: MessageStorage;
  /** The optional unpublished event storage, separated by account and protocol by the application */
  publicationStorage?: MessageStorage;
  /** The conversation index store, separated by account by the application; defaults to an in-memory store */
  conversationIndex?: ConversationIndexStore;
  /** Whether to decrypt arriving events with the signer (default false) */
  autoUnlock?: boolean;
  /** The fallback relays for reading and delivery */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The relay discovery and finite read timeout in milliseconds (default 4000) */
  timeout?: number;
  /** The timeout for one decryption including its signer queue wait, in milliseconds (default 60000) */
  decryptionTimeout?: number;
  /** The send preparation timeout in milliseconds (default 120000) */
  actionTimeout?: number;
  /** The live subscription lookback in seconds (default 30 days) */
  historySpan?: number;
  /** The relay authentication callback for live reads and sync */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum wait for an authentication phase, or false */
  authTimeout?: number | false;
  /** Whether to mirror the newest loaded conversation message lifetime on sends */
  mirrorExpiration?: boolean;
  /** An application-managed inbox receiver sharing this client's account, store and pool */
  receiver?: LegacyInboxReceiver;
  /** Overrides for the internally created inbox receiver */
  receiverOptions?: Partial<Omit<LegacyInboxReceiverOptions, "pubkey" | "eventStore" | "pool">>;
}

/** Dependencies and policies for an account-wide NIP-04 inbox receiver */
export interface LegacyInboxReceiverOptions {
  /** The immutable owner pubkey */
  pubkey: string;
  /** The shared store with profile and relay-list loaders configured */
  eventStore: EventStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The NIP-04 signer, omitted for cache-only processing */
  signer?: ISigner;
  /** The shared decryptor, created by the receiver when omitted */
  decryptor?: LegacyMessageDecryptor;
  /** The encrypted kind-4 event cache */
  cacheRequest?: CacheRequest;
  /** The plaintext cache keyed by kind-4 event ID */
  decryptionCache?: EncryptedContentCache;
  /** The fallback relays used when no mailbox relays are advertised */
  fallbackRelays?: string[] | Observable<string[]>;
  /** Whether background processing may invoke the signer, default false */
  autoUnlock?: boolean;
  /** Whether relay authentication starts automatically, default false */
  autoAuth?: boolean;
  /** The application callback invoked after an authentication requirement is recorded */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum wait for an authentication phase, or false */
  authTimeout?: number | false;
  /** The relay discovery and cache timeout in milliseconds (default 4000) */
  timeout?: number;
  /** The timeout for one decryption including its signer queue wait, in milliseconds (default 60000) */
  decryptionTimeout?: number;
  /** The live subscription lookback in seconds (default 30 days) */
  historySpan?: number;
}

/** The stable NIP-04 decryption failure codes */
export type LegacyMessageFailureCode = "invalid-message" | "signer-unavailable" | "decryption-failed" | "timeout";

/** A classified NIP-04 decryption failure */
export interface LegacyMessageFailure {
  /** The affected kind-4 event ID */
  eventId: string;
  /** The stable failure category */
  code: LegacyMessageFailureCode;
  /** The original failure */
  cause: unknown;
  /** The number of decryption attempts */
  attempts: number;
  /** The permitted retry behavior */
  retry: "never" | "manual";
}

/** The outcome of decrypting one kind-4 event */
export type LegacyReadResult =
  | {
      /** The successful outcome */ status: "success";
      /** The kind-4 event with plaintext */ event: NostrEvent;
    }
  | {
      /** The unsuccessful outcome */ status: "failed";
      /** The kind-4 event */ event: NostrEvent;
      /** The decryption failure */ failure: LegacyMessageFailure;
    };

/** A contextual NIP-04 receiving failure */
export interface LegacyReceiverError {
  /** The failed receiving stage */
  operation: "read" | "cache" | "decrypt";
  /** The original failure */
  error: unknown;
  /** The affected kind-4 event, when applicable */
  eventId?: string;
  /** The mailbox direction of a live subscription failure */
  mailbox?: "incoming" | "outgoing";
  /** The relays requested by a failed live subscription */
  relays?: readonly string[];
  /** The structured decryption failure, when applicable */
  failure?: LegacyMessageFailure;
}

/** A known legacy conversation and its newest activity */
export interface LegacyConversationSummary {
  /** The canonical conversation identifier */
  id: string;
  /** The other participant, or the owner for notes to self */
  correspondent: string;
  /** The canonical participant set including the client owner */
  participants: string[];
  /** The newest message, or undefined when it is not in the event store */
  lastMessage?: NostrEvent;
  /** The newest message timestamp */
  lastActivity: number;
}

/** A plaintext NIP-04 message to one correspondent */
export interface LegacyMessageSendRequest {
  /** The recipient pubkey, which may be the owner for self-messages */
  recipient: string;
  /** The unmodified plaintext */
  content: string;
  /** Custom emojis used in the plaintext, exposed as public event tags */
  emojis?: Emoji[];
  /** The parent kind-4 event ID */
  replyTo?: string;
  /** The absolute event expiration timestamp in seconds */
  expiration?: number;
}

/** Delivery availability for one NIP-04 recipient */
export interface LegacyMessageAvailability {
  /** Whether advertised or fallback relays permit delivery */
  canSend: boolean;
  /** The recipient pubkey */
  recipient: string;
  /** The recipient's advertised inbox support */
  support: "supported" | "unsupported" | "unknown";
  /** The advertised delivery relays */
  relays?: readonly string[];
  /** Whether fallback delivery relays are configured */
  hasFallback: boolean;
}

/** The conversation-owned publication state, with acceptance indicating a relay acknowledgement rather than recipient receipt */
export type LegacyPublicationState =
  | {
      /** The signed event awaiting publication */
      readonly status: "prepared";
    }
  | {
      /** The active relay publication */
      readonly status: "publishing";
    }
  | {
      /** The failed relay publication awaiting retry */
      readonly status: "failed";
      /** The original publication rejection, including undefined */
      readonly error: unknown;
    }
  | {
      /** The relay-acknowledged publication, independent of storage cleanup */
      readonly status: "accepted";
    }
  | {
      /** The unpublished event removed from the durable outbox */
      readonly status: "discarded";
    };

/** A conversation-owned prepared handle or its signed message ID */
export type LegacyPublicationReference = PreparedLegacyMessage | string;

/** A convenience handle for a conversation-owned signed legacy publication */
export interface PreparedLegacyMessage {
  /** The native encrypted kind-4 event with cached plaintext */
  readonly message: NostrEvent;
  /** The owning conversation's publication state, completing when its handle generation stops */
  readonly state$: Observable<LegacyPublicationState>;
  /** Publishes the signed event and returns it after relay acceptance */
  publish(options?: MessageOperationOptions): Promise<NostrEvent>;
}

/** A finite NIP-04 history range */
export interface LegacyMessageHistoryOptions extends MessageOperationOptions {
  /** Whether sync follows mailbox relay changes until unsubscribed, default true; loadHistory always uses false */
  followRelays?: boolean;
  /** The inclusive starting timestamp, default zero */
  since?: number;
  /** The inclusive ending timestamp */
  until?: number;
  /** The correspondent to restrict both incoming and outgoing history */
  correspondent?: string;
}

/** Reconciliation progress for the incoming and outgoing legacy mailboxes */
export interface LegacyMessagesSyncStatus {
  /** The reconciliation failure, when reconciliation could not complete */
  error?: unknown;
  /** The results for each mailbox */
  mailboxes: SyncLoaderStatus[];
  /** Whether both mailboxes finished, including failures */
  done: boolean;
  /** The sum of mailbox event counts */
  loaded: number;
}

/** A live legacy mailbox subscription failure */
export interface LegacyMailboxError {
  /** The mailbox direction relative to the owner */
  mailbox: "incoming" | "outgoing";
  /** The relay set requested by the failed subscription */
  relays: readonly string[];
  /** The subscription failure */
  error: unknown;
}
