import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { ensureProfilePointerTag } from "applesauce-core/helpers/factory";
import { includeEmojis, setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { FORUM_THREAD_KIND } from "../helpers/forum-thread.js";
import { setTitle } from "../operations/forum-thread.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";
import { Emoji } from "../helpers/emoji.js";

export type ForumThreadTemplate = KnownEventTemplate<typeof FORUM_THREAD_KIND>;
export type ForumThreadFactoryOptions = TextContentOptions;

/**
 * A factory class for building NIP-7D forum thread events (kind 11). Replies to
 * a thread are NIP-22 kind 1111 comments to the root — build them with the
 * `CommentFactory` (`CommentFactory.create(thread, body)`).
 */
export class ForumThreadFactory extends EventFactory<typeof FORUM_THREAD_KIND, ForumThreadTemplate> {
  /**
   * Creates a new forum thread factory
   * @param title - The thread title (NIP-7D `title` tag)
   * @param content - Optional initial thread body
   * @param options - Optional content options
   */
  static create(title: string, content?: string, options?: ForumThreadFactoryOptions): ForumThreadFactory {
    let factory = new ForumThreadFactory((res) => res(blankEventTemplate(FORUM_THREAD_KIND))).title(title);
    if (content !== undefined) factory = factory.text(content, options);
    return factory;
  }

  /** Sets the NIP-7D `title` tag */
  title(title: string) {
    return this.chain(setTitle(title));
  }

  /** Sets the thread body, tagging mentions, quotes, hashtags, and custom emojis */
  text(content: string, options?: ForumThreadFactoryOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Adds a "p" mention tag for a pubkey or ProfilePointer */
  mention(pubkey: string | ProfilePointer) {
    const pointer = typeof pubkey === "string" ? { pubkey } : pubkey;
    return this.modifyPublicTags((tags) => ensureProfilePointerTag(tags, pointer));
  }

  /** Adds a hashtag "t" tag */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags as "t" tags */
  hashtags(tags: string[]) {
    return this.chain(includeHashtags(tags));
  }

  /** Adds NIP-30 "emoji" tags for custom emojis */
  emojis(emojis: Emoji[]) {
    return this.chain(includeEmojis(emojis));
  }
}
