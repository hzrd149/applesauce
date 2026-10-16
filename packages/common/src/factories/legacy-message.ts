import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { setMessageAddress, setMessageParent } from "../operations/legacy-message.js";

export type LegacyMessageTemplate = KnownEventTemplate<kinds.EncryptedDirectMessage>;

export class LegacyMessageFactory extends EventFactory<kinds.EncryptedDirectMessage, LegacyMessageTemplate> {
  static create(recipient: string, message: string): LegacyMessageFactory {
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage)))
      .recipient(recipient)
      .encryptedContent(recipient, message, "nip04");
  }

  static reply(parent: NostrEvent, recipient: string, message: string): LegacyMessageFactory {
    if (parent.kind !== kinds.EncryptedDirectMessage) throw new Error("Parent must be a legacy message (kind 4)");
    return new LegacyMessageFactory((res) => res(blankEventTemplate(kinds.EncryptedDirectMessage)))
      .recipient(recipient)
      .encryptedContent(recipient, message, "nip04")
      .replyTo(parent);
  }

  /** Sets the "p" tag of the user the message is addressed to */
  recipient(pubkey: string) {
    return this.chain(setMessageAddress(pubkey));
  }

  /** Sets the parent message "e" tag for NIP-04 reply threading */
  replyTo(parent: NostrEvent | string) {
    return this.chain(setMessageParent(parent));
  }
}
