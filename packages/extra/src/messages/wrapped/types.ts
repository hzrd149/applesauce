import type { EventStore } from "applesauce-core";
import type { EncryptedContentCache, Rumor } from "applesauce-core/helpers";
import type { CacheRequest } from "applesauce-loaders";
import type { SyncAuthHandler, SyncLoaderStatus } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { MessageStorage, MessageOperationOptions } from "../common/types.js";

/** Dependencies and policies for a NIP-17 inbox */
export interface WrappedMessagesClientOptions {
  /** The immutable owner pubkey */
  pubkey: string;
  /** The NIP-44 signer, omitted when restoring cached plaintext only */
  signer?: ISigner;
  /** The shared store with profile and relay-list loaders configured */
  eventStore: EventStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The encrypted gift-wrap cache */
  cacheRequest?: CacheRequest;
  /** The plaintext cache keyed by gift-wrap and seal IDs */
  decryptionCache?: EncryptedContentCache;
  /** The optional plaintext draft storage, separated by account and protocol by the application */
  draftStorage?: MessageStorage;
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
  /** Whether to mirror the newest conversation rumor lifetime on sends */
  mirrorExpiration?: boolean;
}

/** A plaintext NIP-17 message with explicit recipients */
export interface WrappedMessageSendRequest {
  /** The recipient pubkeys, with the sender copy added automatically */
  recipients: readonly string[];
  /** The unmodified plaintext */
  content: string;
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
  /** The native kind-14 rumor */
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
