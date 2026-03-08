import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent, UnsignedEvent } from "applesauce-core/helpers";
import { includeNameValueTag } from "applesauce-core/operations/tags";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";

export type WrappedMessageTemplate = KnownEventTemplate<kinds.PrivateDirectMessage>;
export type WrappedMessageBlueprintOptions = TextContentOptions;

export class WrappedMessageFactory extends EventFactory<kinds.PrivateDirectMessage, WrappedMessageTemplate> {
  /**
   * Creates a new wrapped message.
   * @param recipients - A single recipient pubkey or an array of recipient pubkeys
   * @param message - The plaintext message content
   */
  static create(recipients: string | string[], message: string): WrappedMessageFactory {
    const recipientList = typeof recipients === "string" ? [recipients] : recipients;
    let factory: WrappedMessageFactory = new WrappedMessageFactory((res) =>
      res(blankEventTemplate(kinds.PrivateDirectMessage)),
    ).chain(setShortTextContent(message));
    for (const recipient of recipientList) {
      factory = factory.chain(includeNameValueTag(["p", recipient])) as WrappedMessageFactory;
    }
    return factory;
  }

  /** Creates a reply to a wrapped message */
  static reply(
    _parent: NostrEvent | UnsignedEvent | string,
    recipient: string,
    message: string,
  ): WrappedMessageFactory {
    return new WrappedMessageFactory((res) => res(blankEventTemplate(kinds.PrivateDirectMessage)))
      .chain(setShortTextContent(message))
      .chain(includeNameValueTag(["p", recipient])) as WrappedMessageFactory;
  }

  /** Sets the text content of the message */
  text(content: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(content, options));
  }
}
