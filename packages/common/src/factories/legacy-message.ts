import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";

export type LegacyMessageTemplate = KnownEventTemplate<kinds.EncryptedDirectMessage>;
export type LegacyMessageBlueprintOptions = {};

export class LegacyMessageFactory extends EventFactory<kinds.EncryptedDirectMessage, LegacyMessageTemplate> {
  static create(recipient: string, message: string): LegacyMessageFactory {
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage))).encryptedContent(
      recipient,
      message,
      "nip04",
    );
  }

  static reply(parent: NostrEvent, recipient: string, message: string): LegacyMessageFactory {
    if (parent.kind !== kinds.EncryptedDirectMessage) throw new Error("Parent must be a legacy message (kind 4)");
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage))).encryptedContent(
      recipient,
      message,
      "nip04",
    );
  }
}
