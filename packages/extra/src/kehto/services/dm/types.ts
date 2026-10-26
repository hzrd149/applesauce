import type { DmMessage, DmSendRequest } from "@kehto/services";
import type { Observable } from "rxjs";

/** A protocol's evidence that a recipient supports its messages */
export type DmProtocolSupport = "supported" | "unsupported" | "unknown";

/** A protocol message before the composer assigns its conversation and public message id */
export interface DmProtocolMessage extends Omit<DmMessage, "conversationId"> {
  /** All conversation participants, including the owner */
  participants: readonly string[];
  /** The protocol-owned conversation identity when participant-based merging is inappropriate */
  conversation?: DmProtocolConversation;
}

/** An opaque protocol-owned conversation, such as a coordinator group */
export interface DmProtocolConversation {
  /** The native conversation id passed back to this protocol for subsequent sends */
  id: string;
  /** The conversation kind exposed to Kehto */
  kind: "direct" | "group";
}

/** Cancellation and request identity supplied to protocol operations */
export interface DmOperationContext {
  /** The signal aborted when the operation ends, the session changes, or the service closes */
  signal: AbortSignal;
  /** The napplet window requesting the operation */
  windowId?: string;
}

/** Options for reading a protocol's normalized message stream */
export interface DmReadContext extends DmOperationContext {
  /** Whether to complete after currently available history has been read */
  history: boolean;
}

/** A recipient's discovered protocol support */
export interface DmRecipientSupport {
  /** The recipient being inspected */
  recipient: string;
  /** The evidence of protocol support */
  support: DmProtocolSupport;
  /** The advertised delivery relays, when the protocol uses relays */
  relays?: readonly string[];
}

/** A resolved protocol candidate for routing one send */
export interface DmProtocolAvailability {
  /** Whether this session can send the requested message */
  canSend: boolean;
  /** The aggregate recipient support, separate from local sending capability */
  support: DmProtocolSupport;
  /** The individual recipient discovery results */
  recipients?: readonly DmRecipientSupport[];
  /** Whether the protocol has configured fallback delivery targets */
  hasFallback?: boolean;
}

/** A prepared message whose publication has not started */
export interface DmPreparedSend {
  /** The optional preview available before publication */
  message?: DmProtocolMessage;
  /** The cold publication stream, emitting the final message once after successful publication */
  publish$: Observable<DmProtocolMessage>;
}

/** An authenticated protocol session bound to one stable owner identity */
export interface DmProtocolSession {
  /** The owner identity used in normalized Kehto conversations */
  ownerPubkey: string;
  /** Discovers recipient support without publishing the message */
  discover$(request: DmSendRequest, context: DmOperationContext): Observable<DmProtocolAvailability>;
  /** Streams messages and completes after history when requested */
  messages$(context: DmReadContext): Observable<DmProtocolMessage>;
  /** Prepares an approved message without starting publication */
  prepareSend$(request: DmSendRequest, context: DmOperationContext): Observable<DmPreparedSend>;
}

/** A pluggable message protocol with reactive authentication and availability */
export interface DmProtocolAdapter {
  /** The unique protocol identifier used by send routers */
  id: string;
  /** The current session, emitting undefined immediately when its identity is invalidated */
  session$: Observable<DmProtocolSession | undefined>;
  /** Releases resources owned by this adapter */
  close?(): void;
}

/** Metadata retained for selecting the next protocol in a conversation */
export interface DmRoutingMessage {
  /** The protocol that produced the message */
  protocol: string;
  /** The original protocol message id */
  id: string;
  /** The message author */
  senderPubkey: string;
  /** The message timestamp in seconds */
  createdAt: number;
}

/** A bounded discovery snapshot supplied to functional send routers */
export interface DmRoutingContext {
  /** The message requested by the consuming napplet */
  request: DmSendRequest;
  /** The eligible sessions' common owner identity */
  ownerPubkey: string;
  /** The discovered candidates keyed by registered protocol id */
  protocols: ReadonlyMap<string, DmProtocolAvailability>;
  /** The latest message observed in this conversation */
  lastMessage?: DmRoutingMessage;
  /** The latest incoming message observed in this conversation */
  lastIncomingMessage?: DmRoutingMessage;
  /** The operation cancellation signal */
  signal: AbortSignal;
}

/** A routing function that selects a registered protocol or defers to another rule */
export type DmRouteRule = (context: DmRoutingContext) => string | undefined | Promise<string | undefined>;

/** A routing function that selects a registered message protocol */
export type DmSendRouter = (context: DmRoutingContext) => string | Promise<string>;
