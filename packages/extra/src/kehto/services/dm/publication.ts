import type { DmProtocolMessage } from "./types.js";
import type { NostrEvent } from "applesauce-core/helpers";
import type { KehtoPoolContext } from "../../foundation/pool.js";

/**
 * Publishes an encrypted message and stores it only after a relay accepts it
 * @throws if publishing fails or no relay accepts the event
 */
export async function publishAcceptedMessage(context: KehtoPoolContext, relays: string[], event: NostrEvent) {
  const results = await context.pool.publish(relays, event);
  if (!results.some((result) => result.ok)) throw new Error(results[0]?.message ?? "No relay accepted the event");
  context.eventStore.add(event);
}

/** The relay acceptance result for one participant's encrypted envelope */
export interface DmPublicationResult {
  /** The participant receiving the envelope */
  recipient: string;
  /** The encrypted event identifier retained for retries */
  eventId: string;
  /** Whether a relay accepted this envelope, without implying recipient delivery */
  accepted: boolean;
  /** The publication error when no relay accepted the envelope */
  error?: unknown;
}

/** A failed or partially accepted wrapped publication with per-participant outcomes */
export class DmPublicationError extends Error {
  /** Creates a publication failure retaining the original logical message and envelope outcomes */
  constructor(
    /** The logical message whose envelopes were published */
    public readonly protocolMessage: DmProtocolMessage,
    /** The relay acceptance outcomes for all participants */
    public readonly publications: readonly DmPublicationResult[],
  ) {
    const accepted = publications.filter((publication) => publication.accepted).length;
    super(`DM publication incomplete: ${accepted}/${publications.length} envelopes accepted`);
    this.name = "DmPublicationError";
  }
}
