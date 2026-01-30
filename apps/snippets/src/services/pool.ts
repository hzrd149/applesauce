import { relaySet } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { RelayPool } from "applesauce-relay";
import { DEFAULT_RELAYS } from "../helpers/nostr";
import { eventStore } from "./event-store";

export const pool = new RelayPool();

export async function publish(event: NostrEvent, relays?: string[]): Promise<void> {
  console.log("Publishing", event);

  // dynamically import user$ to avoid circular dependency
  const { user$ } = await import("./user");
  // Get the current user's outboxes
  const outboxes = await user$.outboxes$.$first(5_000, undefined);

  eventStore.add(event);
  await pool.publish(relaySet(relays, outboxes, DEFAULT_RELAYS), event);
}
