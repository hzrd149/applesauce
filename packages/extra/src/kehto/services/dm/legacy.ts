import { createClientProtocol } from "./client-protocol.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import type { DmSendRequest } from "@kehto/services";
import { getConversationParticipants } from "applesauce-common/helpers";
import { getEncryptedContent, type NostrEvent } from "applesauce-core/helpers";
import { defer, map } from "rxjs";
import { LegacyMessagesClient, type LegacyMessageSendRequest } from "../../../messages/index.js";
import type { DmProtocolMessage } from "./types.js";

/** Creates a NIP-04 protocol backed by an account-scoped legacy messages client */
export function createLegacyMessageProtocol(config: NostrMessageProtocolOptions) {
  return createClientProtocol(config, "nip04", (account) => {
    if (!account.signer.nip04) return;
    const client = new LegacyMessagesClient({
      ...config,
      pubkey: account.pubkey,
      signer: account.signer,
      approve: config.approve ? ({ template, scope }) => config.approve!({ template, windowId: scope }) : undefined,
    });
    const normalize = (event: NostrEvent): DmProtocolMessage => {
      const content = getEncryptedContent(event);
      if (content === undefined) throw new Error("Legacy message has not been decrypted");
      return {
        id: event.id,
        participants: getConversationParticipants(event),
        senderPubkey: event.pubkey,
        createdAt: event.created_at,
        content,
        status: event.pubkey === account.pubkey ? "sent" : "received",
      };
    };
    const translateRequest = (request: DmSendRequest): LegacyMessageSendRequest => {
      if (!request.recipients.length || request.recipients.some((recipient) => !/^[0-9a-f]{64}$/.test(recipient)))
        throw new Error("Invalid recipients");
      const peers = [...new Set(request.recipients.filter((recipient) => recipient !== account.pubkey))];
      if (peers.length > 1) throw new Error("Legacy messages require one recipient");
      return {
        recipient: peers[0] ?? account.pubkey,
        content: request.content,
        clientMessageId: request.clientMessageId,
      };
    };
    return {
      ownerPubkey: account.pubkey,
      discover$: (request, context) =>
        defer(async () => {
          const availability = await client.discover(translateRequest(request), { signal: context.signal });
          return {
            ...availability,
            recipients: [
              {
                recipient: availability.recipient,
                support: availability.support,
                relays: availability.relays,
              },
            ],
          };
        }),
      messages$: (context) => client.readMessages$(context).pipe(map(normalize)),
      prepareSend$: (request, context) =>
        defer(async () => {
          const prepared = await client.prepareSend(translateRequest(request), {
            signal: context.signal,
            scope: context.windowId,
          });
          return {
            message: normalize(prepared.message),
            publish$: defer(() => prepared.publish({ signal: context.signal })).pipe(map(normalize)),
          };
        }),
      dispose: () => client.dispose(),
    };
  });
}
