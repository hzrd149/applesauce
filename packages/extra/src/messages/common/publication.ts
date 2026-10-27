import type { MessageTransport } from "./types.js";
import { addSeenRelay, type NostrEvent } from "applesauce-core/helpers";
import { defer, firstValueFrom } from "rxjs";
import { withMessageAuth$ } from "./authentication.js";

/**
 * Publishes an encrypted event and stores it only after a relay accepts it
 * @throws if publishing fails or no relay accepts the event
 */
export async function publishAcceptedMessage(
  context: MessageTransport,
  relays: string[],
  event: NostrEvent,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  // Release auth prompts on cancellation, but retain a late acceptance so retries do not resend this event.
  const results = await firstValueFrom(
    withMessageAuth$(context, (auth) => defer(() => context.pool.publish(relays, event, auth)), signal),
  );
  if (!results.some((result) => result.ok)) throw new Error(results[0]?.message ?? "No relay accepted the event");
  for (const result of results) if (result.ok) addSeenRelay(event, result.from);
  context.eventStore.add(event);
}
