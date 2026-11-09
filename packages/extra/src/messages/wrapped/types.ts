import type { EventStore } from "applesauce-core";
import type { Emoji } from "applesauce-core/factories";
import type { AsyncRumorStore, RumorStore } from "applesauce-core/event-store";
import type { EncryptedContentCache, Rumor } from "applesauce-core/helpers";
import type { CacheRequest } from "applesauce-loaders";
import type { SyncAuthHandler, SyncLoaderStatus } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import type { MessageFileUploader } from "../common/attachments.js";
import type {
  ConversationIndexStore,
  MessageFileStorage,
  MessageStorage,
  MessageOperationOptions,
} from "../common/types.js";
import type { GiftWrapReceiver } from "../../gift-wrap/receiver.js";
import type { GiftWrapReceiverOptions } from "../../gift-wrap/types.js";

/** Dependencies and policies for a NIP-17 inbox */
export type WrappedMessagesClientOptions = WrappedMessagesClientDependencies &
  (
    | {
        /** The application-managed receiver with matching account, store, and pool */
        receiver: GiftWrapReceiver;
        /** Receiver construction options are unavailable for an injected receiver */
        receiverOptions?: never;
      }
    | {
        /** Omit to create a client-owned receiver */
        receiver?: undefined;
        /** Incoming policies overriding client defaults; historySpan is an envelope lookback */
        receiverOptions?: Omit<GiftWrapReceiverOptions, "pubkey" | "eventStore" | "pool" | "rumorStore">;
      }
  );

/** Shared dependencies and messaging policies for a NIP-17 client */
export interface WrappedMessagesClientDependencies {
  /** The immutable owner pubkey */
  pubkey: string;
  /** The NIP-44 signer, omitted when restoring cached plaintext only */
  signer?: ISigner;
  /** The shared store with profile and relay-list loaders configured */
  eventStore: EventStore;
  /** The shared plaintext destination; defaults to the receiver's store or an owned in-memory store */
  rumorStore?: RumorStore | AsyncRumorStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The encrypted gift-wrap cache */
  cacheRequest?: CacheRequest;
  /** The plaintext cache keyed by gift-wrap and seal IDs */
  decryptionCache?: EncryptedContentCache;
  /** The optional plaintext draft storage, separated by account and protocol by the application */
  draftStorage?: MessageStorage;
  /** The optional storage for files staged in drafts, which receives them unencrypted */
  draftFileStorage?: MessageFileStorage;
  /** The conversation index store, separated by account by the application; defaults to an in-memory store */
  conversationIndex?: ConversationIndexStore;
  /** Whether to decrypt arriving envelopes with the signer (default false) */
  autoUnlock?: boolean;
  /** The fallback read relays, never publication targets */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The relay discovery and finite read timeout in milliseconds (default 4000) */
  timeout?: number;
  /** The timeout for decrypting an envelope in milliseconds (default 60000) */
  decryptionTimeout?: number;
  /** The envelope preparation timeout in milliseconds (default 120000) */
  actionTimeout?: number;
  /** The initial logical history lookback in seconds (default 30 days) */
  historySpan?: number;
  /** The relay authentication callback for live reads and sync */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum wait for an authentication phase, or false */
  authTimeout?: number | false;
  /** The uploader for encrypted file attachments, such as a Blossom client */
  upload?: MessageFileUploader;
}

/** A known conversation and its newest activity */
export interface WrappedConversationSummary {
  /** The canonical conversation identifier */
  id: string;
  /** The canonical participant set including the client owner */
  participants: string[];
  /** The newest message, or undefined when it is not in the rumor store */
  lastMessage?: Rumor;
  /** The newest message timestamp */
  lastActivity: number;
}

/** A plaintext NIP-17 message with explicit recipients */
export interface WrappedMessageSendRequest {
  /** The recipient pubkeys, with the sender copy added automatically */
  recipients: readonly string[];
  /** The unmodified plaintext, ignored when a file is sent */
  content: string;
  /** Custom emojis used in the encrypted plaintext, ignored when a file is sent */
  emojis?: Emoji[];
  /** An uploaded file to send as a kind-15 file message instead of the text content */
  file?: FileMetadataFields;
  /** The parent rumor ID */
  replyTo?: string;
  /** The absolute rumor expiration timestamp in seconds */
  expiration?: number;
  /** The independent absolute envelope expiration timestamp in seconds */
  envelopeExpiration?: number;
}

/** A participant's advertised NIP-17 inbox */
export interface WrappedMessageRecipientSupport {
  /** The participant pubkey */
  recipient: string;
  /** The advertised kind-10050 support */
  support: "supported" | "unsupported" | "unknown";
  /** The advertised delivery relays */
  relays?: readonly string[];
}

/** Delivery availability for every NIP-17 participant, including the sender */
export interface WrappedMessageAvailability {
  /** Whether every participant has advertised delivery relays */
  canSend: boolean;
  /** The aggregate advertised support */
  support: WrappedMessageRecipientSupport["support"];
  /** The individual participant results */
  recipients: WrappedMessageRecipientSupport[];
}

/** Prepared gift wraps retained for per-recipient retries */
export interface PreparedWrappedMessage {
  /** The native kind-14 or kind-15 rumor */
  message: Rumor;
  /** The current relay acceptance outcomes for each participant */
  readonly publications: readonly WrappedMessagePublicationResult[];
  /** Publishes pending envelopes and returns the rumor after relay acceptance */
  publish(options?: MessageOperationOptions): Promise<Rumor>;
}

/** A finite NIP-17 inbox range, filtered by conversation after decryption */
export interface WrappedMessageHistoryOptions extends MessageOperationOptions {
  /** The inclusive logical starting timestamp, default zero */
  since?: number;
  /** The inclusive envelope ending timestamp */
  until?: number;
}

/** Reconciliation progress for the wrapped inbox */
export interface WrappedMessagesSyncStatus {
  /** The inbox reconciliation result */
  mailboxes: SyncLoaderStatus[];
  /** Whether reconciliation finished, including failures */
  done: boolean;
  /** The number of envelopes loaded */
  loaded: number;
}

/** The relay acceptance result for one participant's encrypted envelope */
export interface WrappedMessagePublicationResult {
  /** The participant receiving the envelope */
  recipient: string;
  /** The encrypted event identifier retained for retries */
  eventId: string;
  /** Whether a relay accepted this envelope, not a recipient delivery receipt */
  accepted: boolean;
  /** The publication error when no relay accepted the envelope */
  error?: unknown;
}

/** Internal prepared envelope publication stream */
export interface WrappedMessagePreparation {
  /** The native kind-14 rumor */
  message: Rumor;
  /** The current per-participant relay acceptance outcomes */
  readonly publications: readonly WrappedMessagePublicationResult[];
  /** The cold publication operation */
  publish$(context: { signal: AbortSignal }): Observable<Rumor>;
}
