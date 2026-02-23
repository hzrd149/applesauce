import { EMPTY, race, takeWhile, timeout } from "rxjs";
import type { CompleteOperator } from "../types.js";

/**
 * Namespace for pre-built request complete operators.
 * These helpers provide RxJS operators that determine when a relay pool request should complete.
 *
 * @example
 * import { RequestComplete } from "applesauce-relay";
 *
 * pool.request(relays, filters, {
 *   complete: RequestComplete.onFirstEose()
 * })
 */
export const RequestComplete = {
  /**
   * Complete when all relays in the group have sent EOSE.
   * This is the default behavior when no complete operator is provided.
   *
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onAllEose()
   * })
   */
  onAllEose(): CompleteOperator {
    return (source) => {
      const eoseRelays = new Set<string>();
      let allRelays: Set<string> | null = null;

      return source.pipe(
        takeWhile(([type, relay, message]) => {
          if (type !== "EOSE") return true;

          // Track all relays we've seen
          if (allRelays === null) allRelays = new Set();

          allRelays.add(relay);

          // Track EOSE from this relay
          if (message === "EOSE") eoseRelays.add(relay);

          // Continue while not all relays have sent EOSE
          return !(allRelays.size > 0 && eoseRelays.size === allRelays.size);
        }, true),
      );
    };
  },

  /**
   * Complete when the first relay sends EOSE.
   * Useful for quick queries where you only need one relay's response.
   *
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Get results from the fastest relay
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onFirstEose()
   * })
   */
  onFirstEose(): CompleteOperator {
    return (source) =>
      source.pipe(
        takeWhile(([_relay, message]) => {
          return message !== "EOSE";
        }, true),
      );
  },

  /**
   * Complete after a specific number of relays have sent EOSE.
   *
   * @param count - Number of relays to wait for
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Complete after 3 relays send EOSE (even if more are in the pool)
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onEoseCount(3)
   * })
   */
  onEoseCount(count: number): CompleteOperator {
    return (source) => {
      const eoseRelays = new Set<string>();

      return source.pipe(
        takeWhile(([type, relay]) => {
          if (type === "EOSE") eoseRelays.add(relay);

          return eoseRelays.size < count;
        }, true),
      );
    };
  },

  /**
   * Complete after receiving a specific number of events.
   * Note: Events are counted before deduplication if eventStore is enabled.
   *
   * @param count - Number of events to receive before completing
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Get first 10 events then complete
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onEventCount(10)
   * })
   */
  onEventCount(count: number): CompleteOperator {
    return (source) => {
      let eventCount = 0;

      return source.pipe(
        takeWhile(([_relay, message]) => {
          if (message !== "EOSE") {
            eventCount++;
          }
          return eventCount < count;
        }, true),
      );
    };
  },

  /**
   * Complete when a specific relay sends EOSE.
   * Useful when you have one authoritative relay.
   *
   * @param targetRelayUrl - The relay URL to wait for
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Only wait for EOSE from a specific relay
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onRelayEose("wss://relay.example.com")
   * })
   */
  onRelayEose(targetRelayUrl: string): CompleteOperator {
    return (source) =>
      source.pipe(
        takeWhile(([relay, message]) => {
          return !(relay.url === targetRelayUrl && message === "EOSE");
        }, true),
      );
  },

  /**
   * Complete after a timeout, regardless of messages received.
   *
   * @param ms - Timeout in milliseconds
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Complete after 5 seconds
   * pool.request(relays, filters, {
   *   complete: RequestComplete.onTimeout(5000)
   * })
   */
  onTimeout(ms: number): CompleteOperator {
    return (source) =>
      source.pipe(
        timeout({
          first: ms,
          with: () => EMPTY,
        }),
      );
  },

  /**
   * Combine multiple complete operators with OR logic.
   * Complete when ANY operator completes its stream.
   *
   * @param operators - Array of complete operators
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Complete on first EOSE OR after 5 seconds
   * pool.request(relays, filters, {
   *   complete: RequestComplete.any([
   *     RequestComplete.onFirstEose(),
   *     RequestComplete.onTimeout(5000)
   *   ])
   * })
   *
   * @example
   * // Complete after 50 events OR first EOSE
   * pool.request(relays, filters, {
   *   complete: RequestComplete.any([
   *     RequestComplete.onEventCount(50),
   *     RequestComplete.onFirstEose()
   *   ])
   * })
   */
  any(operators: CompleteOperator[]): CompleteOperator {
    return (source) => race(...operators.map((op) => source.pipe(op)));
  },

  /**
   * Combine multiple complete operators in sequence (AND logic).
   * All operators are applied one after another.
   *
   * @param operators - Array of complete operators to apply in sequence
   * @returns A complete operator
   *
   * @example
   * import { RequestComplete } from "applesauce-relay";
   *
   * // Complete when we have 100 events AND then wait for first EOSE after that
   * pool.request(relays, filters, {
   *   complete: RequestComplete.all([
   *     RequestComplete.onEventCount(100),
   *     RequestComplete.onFirstEose()
   *   ])
   * })
   */
  all(operators: CompleteOperator[]): CompleteOperator {
    return (source) => {
      let result = source;
      for (const op of operators) {
        result = result.pipe(op);
      }
      return result;
    };
  },
};
