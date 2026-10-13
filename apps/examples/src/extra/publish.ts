import type { NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";

/** Publishes an event and requires at least one relay to accept it */
export async function publishEvent(pool: RelayPool, relays: string[], event: NostrEvent) {
  const targets = [...new Set(relays.filter(Boolean))];
  if (targets.length === 0) throw new Error("No publishing relays available");
  const responses = await pool.publish(targets, event);
  if (!responses.some((response) => response.ok)) {
    throw new Error(
      responses
        .map((response) => `${response.from}: ${response.message ?? String(response.error ?? "Rejected")}`)
        .join("; ") || "No relay accepted the event",
    );
  }
  return responses;
}
