import type { EventStore } from "applesauce-core";
import type { RelayPool, RelayStatus } from "applesauce-relay";
import type { SyncAuthHandler } from "applesauce-loaders/loaders";

/** Cancellation and optional retry namespace for a client operation */
export interface MessageOperationOptions {
  /** The caller's cancellation signal */
  signal?: AbortSignal;
  /** The caller's retry namespace */
  scope?: string;
}

/** Internal operation context with a required cancellation signal */
export interface MessageOperationContext extends MessageOperationOptions {
  /** The operation lifetime */
  signal: AbortSignal;
}

/** Dependencies used by encrypted-event loading and publication helpers */
export interface MessageTransport {
  /** The handler for relay authentication requirements */
  onAuthRequired?: SyncAuthHandler;
  /** The maximum wait for relay authentication */
  authTimeout?: number | false;
  /** The shared encrypted-event store */
  eventStore: EventStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The finite read timeout in milliseconds */
  timeout?: number;
}

/** A contextual client failure that does not terminate sibling work */
export interface MessageClientError {
  /** The failed operation */
  operation: "read" | "decrypt" | "restore" | "send" | "sync";
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
