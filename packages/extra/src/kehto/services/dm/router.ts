import type { DmRouteRule, DmSendRouter } from "./types.js";

/**
 * Creates a router that tries rules in order until one selects a protocol
 * @throws if no rule selects a protocol or the operation is cancelled
 */
export function firstMatchingRoute(...rules: DmRouteRule[]): DmSendRouter {
  return async (context) => {
    for (const rule of rules) {
      context.signal.throwIfAborted();
      const protocol = await rule(context);
      context.signal.throwIfAborted();
      if (protocol !== undefined) return protocol;
    }
    throw new Error("No eligible DM protocol found");
  };
}

/** Creates a router that explicitly selects a protocol without requiring detected recipient support */
export function useProtocol(protocol: string): DmSendRouter {
  return () => protocol;
}

/** Creates a rule that selects a locally eligible protocol when every recipient supports it */
export function useProtocolWhenSupported(protocol: string): DmRouteRule {
  return (context) => {
    const candidate = context.protocols.get(protocol);
    return candidate?.canSend && candidate.support === "supported" ? protocol : undefined;
  };
}

/** Options for routing by the last observed conversation message */
export interface LastMessageProtocolOptions {
  /** Whether to consider every message or only incoming messages */
  direction?: "any" | "incoming";
}

/** Creates a rule that continues the protocol of the last observed eligible message */
export function useLastMessageProtocol(options: LastMessageProtocolOptions = {}): DmRouteRule {
  return (context) => {
    const message = options.direction === "incoming" ? context.lastIncomingMessage : context.lastMessage;
    return message && context.protocols.get(message.protocol)?.canSend ? message.protocol : undefined;
  };
}

/** Creates a rule that selects NIP-17 when recipients advertise DM relays */
export function useWrappedWhenAdvertised(): DmRouteRule {
  return useProtocolWhenSupported("nip17");
}

/** Creates a rule that selects NIP-04 when the recipient advertises inbox relays */
export function useLegacyWhenInboxAdvertised(): DmRouteRule {
  return useProtocolWhenSupported("nip04");
}

/**
 * Creates a rule that selects protocols advertising explicit fallback delivery support
 * @deprecated Use useWrappedWhenAdvertised instead for standard NIP-17 delivery
 */
export function useWrappedFallback(): DmRouteRule {
  return (context) => {
    const wrapped = context.protocols.get("nip17");
    return wrapped?.canSend && wrapped.hasFallback ? "nip17" : undefined;
  };
}

/** Routes by conversation history, advertised wrapped support, then legacy inboxes */
export const defaultDmRouter: DmSendRouter = firstMatchingRoute(
  useLastMessageProtocol(),
  useWrappedWhenAdvertised(),
  useLegacyWhenInboxAdvertised(),
);
