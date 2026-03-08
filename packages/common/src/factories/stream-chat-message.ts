import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { setMessage, setStream } from "../operations/stream-chat.js";
import { AddressPointer } from "applesauce-core/helpers/pointers";

export type StreamChatMessageTemplate = KnownEventTemplate<kinds.LiveChatMessage>;

/** A factory class for building NIP-53 stream chat message events (kind 1311) */
export class StreamChatMessageFactory extends EventFactory<kinds.LiveChatMessage, StreamChatMessageTemplate> {
  /**
   * Creates a new stream chat message factory
   * @param stream - The stream event or address pointer
   * @param content - The message content
   * @returns A new stream chat message factory
   */
  static create(
    stream: NostrEvent | AddressPointer,
    content: string,
    options?: TextContentOptions,
  ): StreamChatMessageFactory {
    let factory = new StreamChatMessageFactory((res) => res(blankEventTemplate(kinds.LiveChatMessage)))
      .stream(stream)
      .message(content, options);
    return factory;
  }

  /** Sets the stream for this chat message */
  stream(stream: NostrEvent | AddressPointer) {
    return this.chain(setStream(stream));
  }

  /** Sets the message content */
  message(content: string, options?: TextContentOptions) {
    return this.chain(setMessage(content, options));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
