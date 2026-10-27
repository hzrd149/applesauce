import type { DmProtocolMessage } from "./types.js";

/** The relay acceptance result for one participant's encrypted envelope */
export interface DmPublicationResult {
  /** The participant receiving the envelope */
  recipient: string;
  /** The encrypted event identifier retained for retries */
  eventId: string;
  /** Whether a relay accepted the envelope */
  accepted: boolean;
  /** The publication error when no relay accepted the envelope */
  error?: unknown;
}

/** A normalized Kehto publication failure with per-participant outcomes */
export class DmPublicationError extends Error {
  /** Creates a failure retaining the normalized message and envelope outcomes */
  constructor(
    /** The normalized message whose envelopes were published */
    public readonly protocolMessage: DmProtocolMessage,
    /** The relay acceptance outcomes for all participants */
    public readonly publications: readonly DmPublicationResult[],
  ) {
    const accepted = publications.filter((publication) => publication.accepted).length;
    super(`DM publication incomplete: ${accepted}/${publications.length} envelopes accepted`);
    this.name = "DmPublicationError";
  }
}
