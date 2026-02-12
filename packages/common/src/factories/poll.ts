import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { POLL_KIND, PollType } from "../helpers/poll.js";
import * as Poll from "../operations/poll.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export interface PollOption {
  id: string;
  label: string;
}

export type PollTemplate = KnownEventTemplate<typeof POLL_KIND>;

/** A factory class for building NIP-88 poll events (kind 1068) */
export class PollFactory extends EventFactory<typeof POLL_KIND, PollTemplate> {
  /**
   * Creates a new poll factory
   * @param question - The poll question
   * @param options - The poll options
   * @returns A new poll factory
   */
  static create(question: string, options: PollOption[]): PollFactory {
    return new PollFactory((res) => res(blankEventTemplate(POLL_KIND))).question(question).options(options);
  }

  /** Sets the poll question */
  question(question: string) {
    return this.chain((draft) => Poll.setQuestion(question)(draft));
  }

  /** Sets the poll options */
  options(options: PollOption[]) {
    return this.chain((draft) => Poll.setOptions(options)(draft));
  }

  /** Sets the poll type (singlechoice or multiplechoice) */
  pollType(type: PollType) {
    return this.chain((draft) => Poll.setType(type)(draft));
  }

  /** Sets when the poll ends */
  endsAt(timestamp: number) {
    return this.chain((draft) => Poll.setEndsAt(timestamp)(draft));
  }

  /** Sets relay URLs where responses should be published */
  relays(urls: string[]) {
    return this.chain((draft) => Poll.setRelays(urls)(draft));
  }

  /** Sets zap split configuration */
  zapSplit(options: ZapOptions) {
    return this.chain((draft) => setZapSplit(options, undefined)(draft));
  }
}
