import { LegacyMessageFactory, LegacyMessageBlueprintOptions } from "applesauce-common/factories";
import { castUser } from "applesauce-common/casts";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";

import { Action } from "../action-runner.js";

/** Sends a legacy NIP-04 message to a recipient */
export function SendLegacyMessage(recipient: string, message: string, _opts?: LegacyMessageBlueprintOptions): Action {
  return async ({ signer, publish, events }) => {
    if (!signer) throw new Error("Missing signer");
    const signed = await LegacyMessageFactory.create(recipient, message).sign(signer);

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
  _opts?: LegacyMessageBlueprintOptions,
): Action {
  return async ({ signer, publish, events }) => {
    if (!signer) throw new Error("Missing signer");
    if (parent.kind !== kinds.EncryptedDirectMessage)
      throw new Error("Legacy messages can only reply to other legacy messages");

    // Determine the reply recipient: if we sent the parent, reply to the tagged p; otherwise reply to the sender
    const self = await signer.getPublicKey();
    const recipient = parent.pubkey === self ? parent.tags.find((t) => t[0] === "p")?.[1] : parent.pubkey;
    if (!recipient) throw new Error("Could not determine reply recipient");

    const signed = await LegacyMessageFactory.reply(parent, recipient, message).sign(signer);

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
