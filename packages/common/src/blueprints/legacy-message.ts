import { buildEvent, EventFactoryServices } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setEncryptedContent } from "applesauce-core/operations/encrypted-content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { setMessageAddress, setMessageParent } from "../operations/legacy-message.js";

export type LegacyMessageBlueprintOptions = MetaTagOptions;

/** A blueprint to create a nip-04 encrypted direct message */
export function LegacyMessageBlueprint(recipient: string, message: string, opts?: LegacyMessageBlueprintOptions) {
  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: kinds.EncryptedDirectMessage },
      services,
      // Encrypt the contents of the message to the recipient
      setEncryptedContent(recipient, message, services.signer),
      // Include the necessary "p" tag of the recipient
      setMessageAddress(recipient),
      // Include the meta tags
      setMetaTags(opts),
    );
  };
}

/** Creates a reply to a legacy message */
export function LegacyMessageReplyBlueprint(parent: NostrEvent, message: string, opts?: LegacyMessageBlueprintOptions) {
  if (parent.kind !== kinds.EncryptedDirectMessage) throw new Error("Parent message must be a legacy message (kind 4)");

  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: kinds.EncryptedDirectMessage },
      services,
      // Encrypt the contents of the message to the recipient
      setEncryptedContent(parent.pubkey, message, services.signer),
      // Include the necessary "p" tag of the recipient
      setMessageAddress(parent.pubkey),
      // Include the parent message id
      setMessageParent(parent),
      // Include the meta tags
      setMetaTags(opts),
    );
  };
}
