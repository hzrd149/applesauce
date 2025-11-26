import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  LegacyMessageBlueprint,
  LegacyMessageBlueprintOptions,
  LegacyMessageReplyBlueprint,
} from "applesauce-common/blueprints";

import { Action } from "../action-hub.js";

/** Sends a legacy NIP-04 message to a recipient */
export function SendLegacyMessage(recipient: string, message: string, opts?: LegacyMessageBlueprintOptions): Action {
  return async function* ({ factory }) {
    const draft = await factory.create(LegacyMessageBlueprint, recipient, message, opts);

    // Return the signed message
    yield await factory.sign(draft);
  };
}

/** Send a reply to a legacy message */
export function ReplyToLegacyMessage(
  parent: NostrEvent,
  message: string,
  opts?: LegacyMessageBlueprintOptions,
): Action {
  return async function* ({ factory }) {
    if (parent.kind !== kinds.EncryptedDirectMessage)
      throw new Error("Legacy messages can only reply to other legacy messages");
    const draft = await factory.create(LegacyMessageReplyBlueprint, parent, message, opts);

    // Return the signed message
    yield await factory.sign(draft);
  };
}
