import { POLL_KIND, POLL_RESPONSE_KIND, PollType } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { EventPointer } from "nostr-tools/nip19";

import { blueprint } from "../event-factory.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setContent } from "../operations/content.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";
import { PollResponse, Poll } from "../operations/index.js";

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
