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
}

/** An application-scoped string key/value adapter with synchronous or asynchronous methods */
export interface MessageStorage {
  /** Returns a serialized value, or null when the key is absent */
  getItem(key: string): string | null | Promise<string | null>;
  /** Stores a serialized value synchronously or asynchronously */
  setItem(key: string, value: string): unknown;
  /** Removes a value synchronously or asynchronously */
  removeItem(key: string): unknown;
}

/** An editable plaintext message retained independently of preparation and publication */
export interface MessageDraft {
  /** The unmodified message text, including an empty draft */
  content: string;
  /** The parent message ID when composing a reply */
  replyTo?: string;
  /** The absolute message expiration timestamp in seconds */
  expiration?: number;
}
