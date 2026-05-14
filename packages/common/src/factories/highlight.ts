// highlight.ts
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { HighlightAttribution } from "../helpers/index.js";
import {
  addAttribution,
  setAttributions,
  setComment,
  setContext,
  setHighlightContent,
  setSource,
} from "../operations/highlight.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type HighlightTemplate = KnownEventTemplate<kinds.Highlights>;

export class HighlightFactory extends EventFactory<kinds.Highlights, HighlightTemplate> {
  /** Creates a new highlight factory from content and source */
  static create(content: string, source: NostrEvent | AddressPointer | string): HighlightFactory {
    return new HighlightFactory((res) => res(blankEventTemplate(kinds.Highlights))).highlight(content).source(source);
  }

  /** Sets the content of the highlight */
  highlight(content: string) {
    return this.chain(setHighlightContent(content));
  }

  /** Sets the source event that was highlighted using an 'e' tag */
  source(source: NostrEvent | AddressPointer | string) {
    return this.chain(setSource(source));
  }

  /** Adds a single attribution for the highlight */
  addAttribution(attribution: HighlightAttribution) {
    return this.chain(addAttribution(attribution));
  }

  /** Sets multiple attributions at once for the highlight */
  attributions(attrs: HighlightAttribution[]) {
    return this.chain(setAttributions(attrs));
  }

  /** Sets the surrounding context for the highlight */
  context(context: string) {
    return this.chain(setContext(context));
  }

  /** Sets the comment for the highlight */
  comment(comment: string) {
    return this.chain(setComment(comment));
  }

  /** Sets the zap split for the highlight */
  zapSplit(options: ZapOptions) {
    return this.chain(setZapSplit(options, undefined));
  }
}
