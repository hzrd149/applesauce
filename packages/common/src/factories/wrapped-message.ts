import { blankEventTemplate, EventFactory, type EventFactoryServices } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { Rumor } from "../helpers/gift-wrap.js";

export type WrappedMessageTemplate = KnownEventTemplate<kinds.PrivateDirectMessage>;
export type WrappedMessageBlueprintOptions = TextContentOptions;

export class WrappedMessageFactory extends EventFactory<kinds.PrivateDirectMessage, WrappedMessageTemplate> {
  static create(recipient: string, message: string): WrappedMessageFactory {
    return new WrappedMessageFactory((res) => res(blankEventTemplate(kinds.PrivateDirectMessage))).encryptedContent(
      recipient,
      message,
    );
  }

  static reply(_parent: NostrEvent | string, recipient: string, message: string): WrappedMessageFactory {
    return new WrappedMessageFactory((res) => res(blankEventTemplate(kinds.PrivateDirectMessage))).encryptedContent(
      recipient,
      message,
    );
  }

  text(content: string, options?: TextContentOptions) {
    return this.chain((draft) => setShortTextContent(content, options)(draft));
  }
}

// Legacy blueprint functions for backwards compatibility
export function WrappedMessageBlueprint(
  participants: string | string[],
  message: string,
  _options?: WrappedMessageBlueprintOptions,
) {
  return async (services: EventFactoryServices): Promise<Rumor> => {
    const recipient = typeof participants === "string" ? participants : participants[0];
    const factory = WrappedMessageFactory.create(recipient, message);
    if (services.signer) factory.as(services.signer);
    return factory.stamp() as any;
  };
}

export function WrappedMessageReplyBlueprint(
  parent: Rumor | string,
  recipient: string,
  message: string,
  _options?: WrappedMessageBlueprintOptions,
) {
  return async (services: EventFactoryServices): Promise<Rumor> => {
    const factory = WrappedMessageFactory.reply(parent as any, recipient, message);
    if (services.signer) factory.as(services.signer);
    return factory.stamp() as any;
  };
}
