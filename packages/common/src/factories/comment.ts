import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { COMMENT_KIND, CommentPointer } from "../helpers/comment.js";
import { setParent } from "../operations/comment.js";

export type CommentTemplate = KnownEventTemplate<typeof COMMENT_KIND>;
export type CommentBlueprintOptions = TextContentOptions & MetaTagOptions;

export class CommentFactory extends EventFactory<typeof COMMENT_KIND, CommentTemplate> {
  /** Creates a new comment event */
  static create(parent: NostrEvent | CommentPointer, content: string): CommentFactory {
    return new CommentFactory((res) => res(blankEventTemplate(COMMENT_KIND))).parent(parent).text(content);
  }

  /** Creates a new comment that is replying to a parent event or pointer */
  static reply(parent: NostrEvent | CommentPointer, content: string): CommentFactory {
    return new CommentFactory((res) => res(blankEventTemplate(COMMENT_KIND))).parent(parent).text(content);
  }

  /** Sets the parent event or pointer that this comment is replying to */
  parent(parent: NostrEvent | CommentPointer) {
    return this.chain(setParent(parent));
  }

  /** Sets the text content of the comment */
  text(content: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Sets meta tags like title, summary, image */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
