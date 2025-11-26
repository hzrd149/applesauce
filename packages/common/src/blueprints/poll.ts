import { blueprint } from "applesauce-core";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { MetaTagOptions, setContent, setMetaTags } from "applesauce-core/operations";
import { POLL_KIND, POLL_RESPONSE_KIND, PollType } from "../helpers/poll.js";
import * as PollResponse from "../operations/poll-response.js";
import * as Poll from "../operations/poll.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

export interface PollOption {
  id: string;
  label: string;
}

export type PollBlueprintOptions = MetaTagOptions &
  ZapOptions & {
    /** Poll type - singlechoice or multiplechoice. Defaults to singlechoice */
    pollType?: PollType;
    /** Unix timestamp when the poll ends */
    endsAt?: number;
    /** Relay URLs where responses should be published */
    relays?: string[];
  };

/**
 * NIP-88 Poll event (kind 1068) blueprint
 * Creates a poll event with question and options
 */
export function PollBlueprint(question: string, options: PollOption[], opts?: PollBlueprintOptions) {
  return blueprint(
    POLL_KIND,
    Poll.setQuestion(question),
    Poll.setOptions(options),
    opts?.pollType ? Poll.setType(opts.pollType) : undefined,
    opts?.endsAt ? Poll.setEndsAt(opts.endsAt) : undefined,
    opts?.relays ? Poll.setRelays(opts.relays) : undefined,
    setZapSplit(opts),
    setMetaTags({ ...opts, alt: opts?.alt ?? `Poll: ${question}` }),
  );
}

export type PollResponseBlueprintOptions = MetaTagOptions & { comment?: string };

/**
 * NIP-88 Poll Response event (kind 1018) blueprint
 * Creates a response to a poll event
 */
export function PollResponseBlueprint(
  poll: NostrEvent | EventPointer | string,
  optionIds: string[],
  opts?: PollResponseBlueprintOptions,
) {
  return blueprint(
    POLL_RESPONSE_KIND,
    PollResponse.setPollEvent(poll),
    PollResponse.setChoices(optionIds),
    opts?.comment ? setContent(opts.comment) : undefined,
    setMetaTags({ ...opts, alt: opts?.alt ?? "Poll response" }),
  );
}

/**
 * Convenience blueprint for single-choice poll responses
 * Creates a response to a poll event with a single option
 */
export function SingleChoicePollResponseBlueprint(
  poll: NostrEvent | EventPointer | string,
  optionId: string,
  opts?: PollResponseBlueprintOptions,
) {
  return blueprint(
    POLL_RESPONSE_KIND,
    PollResponse.setPollEvent(poll),
    PollResponse.setChoice(optionId),
    opts?.comment ? setContent(opts.comment) : undefined,
    setMetaTags({ ...opts, alt: opts?.alt ?? "Poll response" }),
  );
}

// Register this blueprint with EventFactory
EventFactory.prototype.poll = function (question: string, options: PollOption[], opts?: PollBlueprintOptions) {
  return this.create(PollBlueprint, question, options, opts);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a NIP-88 poll event */
    poll(question: string, options: PollOption[], opts?: PollBlueprintOptions): Promise<EventTemplate>;
  }
}
