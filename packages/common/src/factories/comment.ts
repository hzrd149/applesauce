import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { COMMENT_KIND } from "../helpers/comment.js";
import { CommentParent, setParent } from "../operations/comment.js";
import { GroupPointer } from "../helpers/groups.js";
import { setGroupPointer } from "../operations/group.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";

export type CommentTemplate = KnownEventTemplate<typeof COMMENT_KIND>;
export type CommentFactoryOptions = TextContentOptions & MetaTagOptions;

export class CommentFactory extends EventFactory<typeof COMMENT_KIND, CommentTemplate> {
  /** Creates a new comment event */
  static create(parent: CommentParent, content: string, options?: CommentFactoryOptions): CommentFactory {
    let factory = new CommentFactory((res) => res(blankEventTemplate(COMMENT_KIND)))
      .parent(parent)
      .text(content, options);
    if (options) factory.meta(options);
    return factory;
  }

  /** Creates a new comment that is replying to a parent event, rumor, or pointer */
  static reply(parent: CommentParent, content: string, options?: CommentFactoryOptions): CommentFactory {
    let factory = new CommentFactory((res) => res(blankEventTemplate(COMMENT_KIND)))
      .parent(parent)
      .text(content, options);
    if (options) factory.meta(options);
    return factory;
  }

  /** Sets the parent event, rumor, or pointer that this comment is replying to */
  parent(parent: CommentParent) {
    return this.chain(setParent(parent));
  }

  /** Sets the text content of the comment */
  text(content: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Sets the NIP-29 group pointer "h" tag for this comment */
  group(pointer: GroupPointer) {
    return this.chain(setGroupPointer(pointer));
  }

  /** Adds a hashtag "t" tag to the comment */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags as "t" tags */
  hashtags(tags: string[]) {
    return this.chain(includeHashtags(tags));
  }
}
