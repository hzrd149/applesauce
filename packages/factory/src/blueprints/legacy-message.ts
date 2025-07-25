import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../event-factory.js";
import { setEncryptedContent } from "../operations/content.js";
import { setMessageAddress, setMessageParent } from "../operations/legacy-message.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";

export type LegacyMessageBlueprintOptions = MetaTagOptions;

/** A blueprint to create a nip-04 encrypted direct message */
export function LegacyMessageBlueprint(recipient: string, message: string, opts?: LegacyMessageBlueprintOptions) {
  return blueprint(
    kinds.EncryptedDirectMessage,
    // Encrypt the contents of the message to the recipient
    setEncryptedContent(recipient, message),
    // Include the nessiary "p" tag of the recipient
    setMessageAddress(recipient),
    // Include the meta tags
    setMetaTags(opts),
  );
}

/** Creates a reply to a legacy message */
export function LegacyMessageReplyBlueprint(parent: NostrEvent, message: string, opts?: LegacyMessageBlueprintOptions) {
  if (parent.kind !== kinds.EncryptedDirectMessage) throw new Error("Parent message must be a legacy message (kind 4)");

  return blueprint(
    kinds.EncryptedDirectMessage,
    // Encrypt the contents of the message to the recipient
    setEncryptedContent(parent.pubkey, message),
    // Include the nessiary "p" tag of the recipient
    setMessageAddress(parent.pubkey),
    // Include the parent message id
    setMessageParent(parent),
    // Include the meta tags
    setMetaTags(opts),
  );
}
