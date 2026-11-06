import type { RelayStatus } from "applesauce-relay";

/** Cancellation options for a client operation */
export interface MessageOperationOptions {
  /** The caller's cancellation signal */
  signal?: AbortSignal;
}

/** A contextual client failure that does not terminate sibling work */
export interface MessageClientError {
  /** The failed operation */
  operation: "read" | "decrypt" | "restore" | "send" | "sync" | "storage";
  /** The encrypted event ID when applicable */
  eventId?: string;
  /** The original failure */
  error: unknown;
}

/** A mailbox relay's current connection state */
export interface MessagesRelayStatus {
  /** The normalized relay URL */
  url: string;
  /** The connection state, absent before the pool has opened this relay */
  connection?: RelayStatus;
  /** The latest live mailbox subscription failure */
  error?: unknown;
}

/** An application-scoped key/value adapter with synchronous or asynchronous methods, satisfied by a localForage instance */
export interface MessageStorage<T = string> {
  /** Returns a stored value, or null when the key is absent */
  getItem(key: string): T | null | Promise<T | null>;
  /** Stores a value synchronously or asynchronously */
  setItem(key: string, value: T): unknown;
  /** Removes a value synchronously or asynchronously */
  removeItem(key: string): unknown;
}

/** An application-scoped adapter for plaintext draft files, satisfied by a localForage instance */
export type MessageFileStorage = MessageStorage<Blob>;

/** An editable plaintext message retained independently of preparation and publication */
export interface MessageDraft {
  /** The unmodified message text, including an empty draft */
  content: string;
  /** The parent message ID when composing a reply */
  replyTo?: string;
  /** The absolute message expiration timestamp in seconds */
  expiration?: number;
  /** Files staged for sending, persisted only when the client has draft file storage */
  files?: readonly File[];
}

/** A saved conversation and a reference to its newest message */
export interface ConversationIndexEntry {
  /** The canonical conversation identifier */
  id: string;
  /** The id of the newest message */
  lastMessageId: string;
  /** The newest message timestamp */
  lastActivity: number;
}

/** Options for listing conversation index entries */
export interface ConversationIndexListOptions {
  /** Only list entries whose newest activity is at or before this timestamp */
  until?: number;
}

/** Application-scoped storage for a conversation index, with one record per conversation */
export interface ConversationIndexStore {
  /** Returns one conversation entry */
  get(id: string): ConversationIndexEntry | undefined | Promise<ConversationIndexEntry | undefined>;
  /**
   * Replaces one conversation entry
   * @throws if the entry cannot be persisted
   */
  set(entry: ConversationIndexEntry): void | Promise<void>;
  /** Iterates entries newest activity first */
  list(
    options?: ConversationIndexListOptions,
  ): Iterable<ConversationIndexEntry> | AsyncIterable<ConversationIndexEntry>;
}

/** Options for paging through conversations */
export type ConversationListOptions = ConversationIndexListOptions & MessageOperationOptions;

/** Options for indexing messages that arrived before the conversation index existed */
export interface ConversationIndexingOptions extends MessageOperationOptions {
  /** Only index messages at or after this timestamp */
  since?: number;
  /** Only index messages at or before this timestamp */
  until?: number;
}
