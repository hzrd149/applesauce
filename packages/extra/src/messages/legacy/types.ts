import type { EventStore } from "applesauce-core";
import type { EncryptedContentCache, NostrEvent } from "applesauce-core/helpers";
import type { CacheRequest } from "applesauce-loaders";
import type { SyncAuthHandler, SyncLoaderStatus } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { MessageStorage, MessageOperationOptions } from "../common/types.js";

/** Dependencies and policies for a NIP-04 inbox */
export interface LegacyMessagesClientOptions {
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
  /** The optional index of known correspondents, keyed by the owner pubkey */
  conversationStorage?: MessageStorage;
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
  /** The initial history lookback in seconds (default 30 days) */
  historySpan?: number;
  /** The relay authentication callback for live reads and sync */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum wait for an authentication phase, or false */
  authTimeout?: number | false;
  /** Whether to mirror the newest loaded conversation message lifetime on sends */
  mirrorExpiration?: boolean;
}

/** A plaintext NIP-04 message to one correspondent */
export interface LegacyMessageSendRequest {
  /** The recipient pubkey, which may be the owner for self-messages */
  recipient: string;
  /** The unmodified plaintext */
  content: string;
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

/** A signed legacy message retained for retry without re-signing */
export interface PreparedLegacyMessage {
  /** The native encrypted kind-4 event with cached plaintext */
  message: NostrEvent;
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
  /** The results for each mailbox */
  mailboxes: SyncLoaderStatus[];
  /** Whether both mailboxes finished, including failures */
  done: boolean;
  /** The sum of mailbox event counts */
  loaded: number;
}
