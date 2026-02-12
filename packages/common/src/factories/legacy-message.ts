import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent, EventTemplate } from "applesauce-core/helpers";

export type LegacyMessageTemplate = KnownEventTemplate<kinds.EncryptedDirectMessage>;
export type LegacyMessageBlueprintOptions = {};

export class LegacyMessageFactory extends EventFactory<kinds.EncryptedDirectMessage, LegacyMessageTemplate> {
  static create(recipient: string, message: string): LegacyMessageFactory {
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage)))
      .encryptedContent(recipient, message, "nip04");
  }

  static reply(parent: NostrEvent, recipient: string, message: string): LegacyMessageFactory {
    if (parent.kind !== kinds.EncryptedDirectMessage) throw new Error("Parent must be a legacy message (kind 4)");
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage)))
      .encryptedContent(recipient, message, "nip04");
  }
}

// Legacy blueprint functions for backwards compatibility
export function LegacyMessageBlueprint(
  recipient: string,
  message: string,
  _options?: LegacyMessageBlueprintOptions,
) {
  return async (_services: any): Promise<EventTemplate> => LegacyMessageFactory.create(recipient, message);
}

export function LegacyMessageReplyBlueprint(
  parent: NostrEvent,
  message: string,
  _options?: LegacyMessageBlueprintOptions,
) {
  return async (services: any): Promise<EventTemplate> => {
    if (!services.signer) throw new Error("Missing signer");
    const self = await services.signer.getPublicKey();
    const recipient = parent.pubkey === self ? parent.tags.find(t => t[0] === "p")?.[1] : parent.pubkey;
    if (!recipient) throw new Error("Could not determine recipient");
    return LegacyMessageFactory.reply(parent, recipient, message);
  };
}
