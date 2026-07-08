import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { ensureProfilePointerTag } from "applesauce-core/helpers/factory";
import { includeEmojis, setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { includeChatReply } from "../operations/chat-message.js";
import { addMediaAttachments } from "../operations/media-attachment.js";
import { FileMetadataFields } from "../helpers/file-metadata.js";
import { Emoji } from "../helpers/emoji.js";

export type ChatMessageTemplate = KnownEventTemplate<kinds.ChatMessage>;
export type ChatMessageFactoryOptions = TextContentOptions;

/**
 * A factory class for building NIP-C7 kind 9 chat message events. Replies are
 * additional kind 9 events that quote their parent with a `q` tag.
 */
export class ChatMessageFactory extends EventFactory<kinds.ChatMessage, ChatMessageTemplate> {
  /**
   * Creates a new chat message factory
   * @param content - Optional initial message content
   * @param options - Optional content options
   */
  static create(content?: string, options?: ChatMessageFactoryOptions): ChatMessageFactory {
    let factory = new ChatMessageFactory((res) => res(blankEventTemplate(kinds.ChatMessage)));
    if (content !== undefined) factory = factory.text(content, options);
    return factory;
  }

  /**
   * Creates a chat message factory configured as a reply to another chat message
   * @param parent - The parent chat message being replied to
   * @param content - Optional initial message content
   * @param options - Optional content options
   */
  static reply(parent: NostrEvent | EventPointer, content?: string, options?: ChatMessageFactoryOptions): ChatMessageFactory {
    let factory = new ChatMessageFactory((res) => res(blankEventTemplate(kinds.ChatMessage))).replyTo(parent);
    if (content !== undefined) factory = factory.text(content, options);
    return factory;
  }

  /** Sets the message content, tagging mentions (NIP-C7), quotes (NIP-18), and custom emojis (NIP-30) */
  text(content: string, options?: ChatMessageFactoryOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Adds the NIP-C7 `q` reply tag pointing at the parent message */
  replyTo(parent: NostrEvent | EventPointer) {
    return this.chain(includeChatReply(parent));
  }

  /** Adds a "p" mention tag for a pubkey or ProfilePointer */
  mention(pubkey: string | ProfilePointer) {
    const pointer = typeof pubkey === "string" ? { pubkey } : pubkey;
    return this.modifyPublicTags((tags) => ensureProfilePointerTag(tags, pointer));
  }

  /** Adds NIP-92 "imeta" tags for media attachments */
  attachments(attachments: FileMetadataFields[]) {
    return this.chain(addMediaAttachments(attachments));
  }

  /** Adds NIP-30 "emoji" tags for custom emojis */
  emojis(emojis: Emoji[]) {
    return this.chain(includeEmojis(emojis));
  }
}
