import type { EventStore } from "applesauce-core";
import type { AsyncRumorStore, RumorStore } from "applesauce-core/event-store";
import type { EncryptedContentCache, NostrEvent, Rumor } from "applesauce-core/helpers";
import type { CacheRequest } from "applesauce-loaders";
import type { SyncAuthHandler } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";

/** Dependencies and policies for a fixed-account NIP-59 receiver */
export interface GiftWrapReceiverOptions {
  /** The immutable recipient pubkey */
  pubkey: string;
  /** The application-owned encrypted envelope store and reconciliation inventory */
  eventStore: EventStore;
  /** The application-owned relay pool */
  pool: RelayPool;
  /** The account signer, omitted for cache-only processing */
  signer?: ISigner;
  /** The account-scoped rumor destination, defaulting to an owned RumorStore */
  rumorStore?: RumorStore | AsyncRumorStore;
  /** The application-scoped durable processing checkpoints */
  processingStore?: GiftWrapProcessingStore;
  /** The explicit inbox relays, otherwise discovered from kind 10050 */
  relays?: string[] | Observable<string[]>;
  /** The read relays used when no inbox relays are advertised */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The encrypted envelope cache reader */
  cacheRequest?: CacheRequest;
  /** The plaintext cache for both encryption layers */
  decryptionCache?: EncryptedContentCache;
  /** Whether background receiving may invoke NIP-44 decryption, default false */
  autoUnlock?: boolean;
  /** Whether relay authentication starts automatically, default false */
  autoAuth?: boolean;
  /** The application callback invoked after an authentication requirement is recorded */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum simultaneous decryption calls, default 4 */
  decryptionConcurrency?: number;
  /** The maximum background envelope workers, defaulting to decryptionConcurrency */
  processingConcurrency?: number;
  /** The cache and relay discovery timeout in milliseconds, default 10000 */
  timeout?: number;
  /** The per-reader processing timeout in milliseconds, default 60000 */
  decryptionTimeout?: number;
  /** The maximum concurrent envelope processing requests, default 64 */
  maxQueued?: number;
  /** The authentication approval timeout, default false */
  authTimeout?: number | false;
  /** The live envelope lookback in seconds, default 30 days */
  historySpan?: number;
  /** The optional bounded automatic retry policy */
  retryPolicy?: GiftWrapRetryPolicy;
}

/** Cancellation for one receiver operation */
export interface GiftWrapOperationOptions {
  /** The caller's cancellation signal */
  signal?: AbortSignal;
}

/** An inclusive envelope timestamp range */
export interface GiftWrapHistoryOptions extends GiftWrapOperationOptions {
  /** The oldest envelope timestamp, default zero */
  since?: number;
  /** The newest envelope timestamp */
  until?: number;
  /** Whether reconciliation follows relay changes, default true */
  followRelays?: boolean;
}

/** A contextual processing or loading failure */
export interface GiftWrapReceiverError {
  /** The failed processing stage */
  operation: "read" | "cache" | "decrypt" | "storage" | "persistence";
  /** The original failure */
  error: unknown;
  /** The affected envelope, when applicable */
  eventId?: string;
  /** The structured envelope processing failure, when applicable */
  failure?: GiftWrapFailure;
}

/** The stable processing failure codes */
export type GiftWrapFailureCode =
  | "invalid-envelope"
  | "invalid-seal"
  | "invalid-rumor"
  | "signer-unavailable"
  | "signer-mismatch"
  | "signer-rejected"
  | "decryption-failed"
  | "timeout"
  | "storage-failed"
  | "persistence-failed";

/** A classified envelope processing failure */
export interface GiftWrapFailure {
  /** The affected encrypted envelope ID */
  eventId: string;
  /** The stage that failed */
  stage: "envelope" | "wrap" | "seal" | "rumor" | "storage" | "checkpoint";
  /** The stable failure category */
  code: GiftWrapFailureCode;
  /** The original failure */
  cause: unknown;
  /** The number of processing attempts */
  attempts: number;
  /** The permitted retry behavior */
  retry: "never" | "manual" | "automatic";
}

/** The outcome of processing one inbox envelope */
export type GiftWrapReadResult =
  | {
      /** The successful outcome */ status: "success";
      /** The encrypted envelope */ event: NostrEvent;
      /** The stored rumor */ rumor: Rumor;
    }
  | {
      /** The unsuccessful outcome */ status: "failed";
      /** The encrypted envelope */ event: NostrEvent;
      /** The processing failure */ failure: GiftWrapFailure;
    };

/** Options for bounded automatic retries and signer-specific classification */
export interface GiftWrapRetryPolicy {
  /** The maximum attempts per envelope, including the initial attempt; defaults to 1 */
  maxAttempts?: number;
  /** The initial exponential backoff in milliseconds, default 1000 */
  delay?: number;
  /** The maximum backoff in milliseconds, default 30000 */
  maxDelay?: number;
  /** The classifier for otherwise ambiguous signer failures; defaults to manual retry */
  classify?: (cause: unknown) => { code: "signer-rejected" | "decryption-failed"; retry: "manual" | "automatic" };
}

/** A versioned, JSON-compatible envelope processing checkpoint */
export interface GiftWrapProcessingRecord {
  /** The record schema version */
  version: 1;
  /** The encrypted envelope ID */
  eventId: string;
  /** The last committed processing state */
  status: "processing" | "failed" | "completed";
  /** The number of processing attempts, excluding passive cache misses */
  attempts: number;
  /** The last processing stage */
  stage: GiftWrapFailure["stage"];
  /** The stored rumor ID, when rumor storage has succeeded */
  rumorId?: string;
  /** The serializable failure details */
  failure?: Omit<GiftWrapFailure, "cause"> & {
    /** The error description */
    message: string;
  };
  /** The absolute automatic retry time in Unix milliseconds */
  retryAt?: number;
}

/** Application-scoped storage with atomic replacement of individual checkpoints */
export interface GiftWrapProcessingStore {
  /** Lists account checkpoints as an array or a paged async iterable */
  list():
    | GiftWrapProcessingRecord[]
    | AsyncIterable<GiftWrapProcessingRecord>
    | Promise<GiftWrapProcessingRecord[] | AsyncIterable<GiftWrapProcessingRecord>>;
  /**
   * Durably replaces a checkpoint
   * @throws if the checkpoint cannot be persisted
   */
  set(record: GiftWrapProcessingRecord): void | Promise<void>;
}

/** Processing counts scoped to currently loaded account envelopes */
export interface GiftWrapDecryptionState {
  /** The loaded envelope count */
  total: number;
  /** The envelopes containing validated plaintext */
  unlocked: number;
  /** The envelopes still lacking validated plaintext */
  locked: number;
  /** The distinct envelopes with active processing readers */
  pending: number;
  /** The most recent processing failures, including rumor storage failures */
  errors: ReadonlyMap<string, GiftWrapFailure>;
}
