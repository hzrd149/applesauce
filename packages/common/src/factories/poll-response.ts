import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { setContent } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { POLL_RESPONSE_KIND } from "../helpers/poll.js";
import * as PollResponse from "../operations/poll-response.js";

export type PollResponseTemplate = KnownEventTemplate<typeof POLL_RESPONSE_KIND>;

export type PollResponseBlueprintOptions = MetaTagOptions & { comment?: string };

/** A factory class for building NIP-88 poll response events (kind 1018) */
export class PollResponseFactory extends EventFactory<typeof POLL_RESPONSE_KIND, PollResponseTemplate> {
  /**
   * Creates a new poll response factory for multiple choices
   * @param poll - The poll event, pointer, or ID
   * @param optionIds - The selected option IDs
   * @returns A new poll response factory
   */
  static create(poll: NostrEvent | EventPointer | string, optionIds: string[]): PollResponseFactory {
    return new PollResponseFactory((res) => res(blankEventTemplate(POLL_RESPONSE_KIND))).poll(poll).choices(optionIds);
  }

  /**
   * Creates a new poll response for a single choice
   * @param poll - The poll event, pointer, or ID
   * @param optionId - The selected option ID
   * @returns A new poll response factory
   */
  static single(poll: NostrEvent | EventPointer | string, optionId: string): PollResponseFactory {
    return new PollResponseFactory((res) => res(blankEventTemplate(POLL_RESPONSE_KIND))).poll(poll).choice(optionId);
  }

  /** Sets the poll being responded to */
  poll(poll: NostrEvent | EventPointer | string) {
    return this.chain((draft) => PollResponse.setPollEvent(poll)(draft));
  }

  /** Sets multiple choice selections */
  choices(optionIds: string[]) {
    return this.chain((draft) => PollResponse.setChoices(optionIds)(draft));
  }

  /** Sets a single choice selection */
  choice(optionId: string) {
    return this.chain((draft) => PollResponse.setChoice(optionId)(draft));
  }

  /** Sets an optional comment */
  comment(comment: string) {
    return this.chain((draft) => setContent(comment)(draft));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain((draft) => setMetaTags(options)(draft));
  }
}
