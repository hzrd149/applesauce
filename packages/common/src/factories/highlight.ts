// highlight.ts
import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { MetaTagOptions, setMetaTags, includeAltTag } from "applesauce-core/operations/event";
import { HighlightAttribution } from "../helpers/index.js";
import { setAttributions, setComment, setContext, setHighlightContent, setSource } from "../operations/highlight.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type HighlightTemplate = KnownEventTemplate<kinds.Highlights>;
export type HighlightBlueprintOptions = MetaTagOptions &
  ZapOptions & {
    context?: string;
    comment?: string;
    attributions?: HighlightAttribution[];
    alt?: string;
  };

export class HighlightFactory extends EventFactory<kinds.Highlights, HighlightTemplate> {
  static create(content: string, source: NostrEvent | AddressPointer | string): HighlightFactory {
    return new HighlightFactory((res) => res(blankEventTemplate(kinds.Highlights)))
      .highlightContent(content)
      .source(source);
  }

  highlightContent(content: string) {
    return this.chain((draft) => setHighlightContent(content)(draft));
  }

  source(source: NostrEvent | AddressPointer | string) {
    return this.chain((draft) => setSource(source)(draft));
  }

  attributions(attrs: HighlightAttribution[]) {
    return this.chain((draft) => setAttributions(attrs)(draft));
  }

  context(context: string) {
    return this.chain((draft) => setContext(context)(draft));
  }

  comment(comment: string) {
    return this.chain((draft) => setComment(comment)(draft));
  }

  zapSplit(options: ZapOptions) {
    return this.chain((draft) => setZapSplit(options, undefined)(draft));
  }

  meta(options: MetaTagOptions) {
    return this.chain((draft) => setMetaTags(options)(draft));
  }
}
