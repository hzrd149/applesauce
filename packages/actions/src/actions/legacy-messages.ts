import {
  LegacyMessageBlueprint,
  LegacyMessageBlueprintOptions,
  LegacyMessageReplyBlueprint,
} from "applesauce-common/factories";
import { castUser } from "applesauce-common/casts";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";

import { Action } from "../action-runner.js";

/** Sends a legacy NIP-04 message to a recipient */
export function SendLegacyMessage(recipient: string, message: string, opts?: LegacyMessageBlueprintOptions): Action {
  return async ({ factory, sign, publish, events }) => {
    const signed = await factory.create(LegacyMessageBlueprint, recipient, message, opts).then(sign);

    // Get the recipient's inbox relays
    const receiver = castUser(recipient, events);
    const [inboxes, directMessageRelays] = await Promise.all([
      receiver.inboxes$.$first(1_000, undefined),
      receiver.directMessageRelays$.$first(1_000, undefined),
    ]);

    // Use the dm relays or inboxes as the inbox relays for the recipient
    const relays = directMessageRelays ?? inboxes ?? undefined;
    await publish(signed, relays);
  };
}

/** Send a reply to a legacy message */
export function ReplyToLegacyMessage(
  parent: NostrEvent,
  message: string,
  opts?: LegacyMessageBlueprintOptions,
): Action {
  return async ({ factory, sign, publish, events }) => {
    if (parent.kind !== kinds.EncryptedDirectMessage)
      throw new Error("Legacy messages can only reply to other legacy messages");

    const signed = await factory.create(LegacyMessageReplyBlueprint, parent, message, opts).then(sign);

    // Get the recipient's inbox relays (the sender of the parent message)
    const receiver = castUser(parent.pubkey, events);
    const [inboxes, directMessageRelays] = await Promise.all([
      receiver.inboxes$.$first(1_000, undefined),
      receiver.directMessageRelays$.$first(1_000, undefined),
    ]);

    // Use the dm relays or inboxes as the inbox relays for the recipient
    const relays = directMessageRelays ?? inboxes ?? undefined;
    await publish(signed, relays);
  };
}
