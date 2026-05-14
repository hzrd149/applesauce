import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { POLL_KIND, PollType } from "../helpers/poll.js";
import * as Poll from "../operations/poll.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type PollFactoryCreateOptions = TextContentOptions & MetaTagOptions;

export interface PollOption {
  id: string;
  label: string;
}

export type PollTemplate = KnownEventTemplate<typeof POLL_KIND>;

/** A factory class for building NIP-88 poll events (kind 1068) */
export class PollFactory extends EventFactory<typeof POLL_KIND, PollTemplate> {
  /**
   * Creates a new poll factory
   * @param question - The poll question (content); hashtags and `:shortcode:` emojis are reflected in tags when using {@link TextContentOptions}
   * @param pollOptions - The poll answer options
   * @param options - Text content options (custom emojis, content warning) and/or meta tags (e.g. `alt`)
   */
  static create(question: string, pollOptions: PollOption[], options?: PollFactoryCreateOptions): PollFactory {
    return new PollFactory((res) => res(blankEventTemplate(POLL_KIND)))
      .question(question, options)
      .options(pollOptions)
      .meta({ alt: "A poll", ...options });
  }

  /** Sets the poll question as event content (hashtags, nostr links, custom emojis) */
  question(question: string, options?: TextContentOptions) {
    return this.chain(Poll.setQuestion(question, options));
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

  /** Adds a single option to the poll */
  addOption(id: string, label: string) {
    return this.chain((draft) => Poll.addOption(id, label)(draft));
  }

  /** Sets relay URLs where responses should be published */
  relays(urls: string[]) {
    return this.chain((draft) => Poll.setRelays(urls)(draft));
  }

  /** Adds a single relay URL where responses should be published */
  addRelay(url: string) {
    return this.chain((draft) => Poll.addRelay(url)(draft));
  }

  /** Sets zap split configuration */
  zapSplit(options: ZapOptions) {
    return this.chain((draft) => setZapSplit(options, undefined)(draft));
  }
}
