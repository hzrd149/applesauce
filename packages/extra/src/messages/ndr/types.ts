import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { GroupData, StorageAdapter } from "nostr-double-ratchet";
import type { MessageFileUploader } from "../common/attachments.js";
import type { MessageFileStorage } from "../common/types.js";

/** The lifecycle of an NDR client's runtime, lock, and persistence */
export type NdrClientLifecycle = "idle" | "starting" | "ready" | "locked" | "error" | "disposed";

/**
 * The delivery progress of a message
 * @note `queued` is a durable local handoff, `published` means at least one relay accepted an envelope, and `delivered`/`seen` come from peer receipts
 */
export type NdrDeliveryState = "queued" | "published" | "delivered" | "seen" | "received";

/** Options for an account's NDR messages client */
export interface NdrMessagesClientOptions {
  /** The account's owner pubkey */
  pubkey: string;
  /** The account signer; omit it for a device that is linked by another device */
  signer?: ISigner;
  /** The shared event store for signed relay envelopes */
  eventStore: EventStore;
  /** The shared relay pool, owned by the application */
  pool: RelayPool;
  /** The explicit discovery and delivery relays for device invites and envelopes */
  relays: string[];
  /** The durable, account-scoped storage for ratchet state, the outbox, and decrypted history */
  storage: StorageAdapter;
  /** The maximum fetch duration in milliseconds (default 4000) */
  fetchTimeoutMs?: number;
  /** The signing and publication deadline in milliseconds (default 60000) */
  actionTimeoutMs?: number;
  /** How long to wait for an app-key roster from relays in milliseconds (default 10000) */
  appKeysTimeoutMs?: number;
  /** The Web Lock that keeps one writer per account, or false to skip locking (default `ndr:<pubkey>`) */
  lockName?: string | false;
  /** Whether to send a delivered receipt when an incoming message is first stored (default true) */
  deliveredReceipts?: boolean;
  /** The uploader for encrypted file attachments, such as a Blossom client */
  upload?: MessageFileUploader;
  /** The optional storage for files staged in drafts, which receives them unencrypted */
  draftFileStorage?: MessageFileStorage;
}

/** A decrypted chat message with its aggregated reactions and delivery state */
export interface NdrMessage {
  /** The inner rumor ID */
  id: string;
  /** The peer pubkey for direct chats, or `group:<id>` for groups */
  conversationId: string;
  /** The plaintext message */
  content: string;
  /** The sender's owner pubkey */
  sender: string;
  /** The sender's device identity pubkey when known */
  senderDevice?: string;
  /** The rumor creation time in seconds */
  createdAt: number;
  /** The parent message ID when this is a reply */
  replyTo?: string;
  /** The expiration time in seconds when the message disappears */
  expiresAt?: number;
  /** The delivery progress, or `received` for incoming messages */
  delivery: NdrDeliveryState;
  /** The files attached to the message, encrypted when they carry a decryption key */
  attachments?: FileMetadataFields[];
  /** The owner pubkeys that reacted, grouped by reaction content */
  reactions: Record<string, string[]>;
}

/** A conversation entry for an inbox list */
export interface NdrConversationSummary {
  /** The peer pubkey for direct chats, or `group:<id>` for groups */
  id: string;
  /** Whether this is a direct chat or a group */
  type: "direct" | "group";
  /** The group ID for group conversations */
  groupId?: string;
  /** The newest message */
  lastMessage?: NdrMessage;
  /** The number of incoming messages newer than the last seen message */
  unread: number;
}

/** A device registered in the owner's app keys */
export interface NdrDevice {
  /** The device identity pubkey */
  identityPubkey: string;
  /** The registration time in seconds */
  createdAt: number;
  /** Whether this is the device running the client */
  current: boolean;
  /** The local label for the device */
  label?: string;
}

/** A persisted group roster and its revision */
export interface NdrGroupRecord {
  /** The group roster and metadata */
  data: GroupData;
  /** The roster revision, increased by each admin update */
  revision: number;
  /** The owner pubkey that created the group */
  createdBy: string;
  /** Whether this account was removed from the group */
  removed?: boolean;
}

/** A failure from background NDR work that does not stop the client */
export interface NdrClientError {
  /** The failed operation */
  operation: "start" | "subscribe" | "publish" | "receive" | "receipt" | "storage";
  /** The original failure */
  error: unknown;
}

/** A plaintext message to send */
export interface NdrSendRequest {
  /** The message text, which may be empty when there are attachments */
  content: string;
  /** Uploaded files to attach, from `uploadFile` */
  attachments?: FileMetadataFields[];
  /** The parent message ID when replying */
  replyTo?: string;
}
