import type { Rumor } from "applesauce-core/helpers";
import type { WrappedMessagePublicationResult } from "./types.js";

/** A failed or partially accepted wrapped publication with per-participant outcomes */
export class WrappedMessagePublicationError extends Error {
  /** Creates a failure retaining the native rumor and envelope outcomes */
  constructor(
    /** The native kind-14 rumor whose envelopes were published */
    public readonly rumor: Rumor,
    /** The relay acceptance outcomes for all participants */
    public readonly publications: readonly WrappedMessagePublicationResult[],
  ) {
    const accepted = publications.filter((publication) => publication.accepted).length;
    super(`DM publication incomplete: ${accepted}/${publications.length} envelopes accepted`);
    this.name = "WrappedMessagePublicationError";
  }
}
