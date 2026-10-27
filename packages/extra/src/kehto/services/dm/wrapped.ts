import { createClientProtocol } from "./client-protocol.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import { getConversationParticipants } from "applesauce-common/helpers";
import type { Rumor } from "applesauce-core/helpers";
import { catchError, defer, map } from "rxjs";
import { WrappedMessagesClient, WrappedMessagePublicationError } from "../../../messages/index.js";
import { DmPublicationError } from "./publication.js";
import type { DmProtocolMessage } from "./types.js";

/** Creates a NIP-17 protocol backed by an account-scoped wrapped messages client */
export function createWrappedMessageProtocol(config: NostrMessageProtocolOptions) {
  return createClientProtocol(config, "nip17", (account) => {
    if (!account.signer.nip44) return;
    const client = new WrappedMessagesClient({
      ...config,
      pubkey: account.pubkey,
      signer: account.signer,
      approve: config.approve ? ({ template, scope }) => config.approve!({ template, windowId: scope }) : undefined,
    });
    const normalize = (rumor: Rumor): DmProtocolMessage => ({
      id: rumor.id,
      participants: getConversationParticipants(rumor),
      senderPubkey: rumor.pubkey,
      createdAt: rumor.created_at,
      content: rumor.content,
      status: rumor.pubkey === account.pubkey ? "sent" : "received",
    });
    return {
      ownerPubkey: account.pubkey,
      discover$: (request, context) => defer(() => client.discover(request, { signal: context.signal })),
      messages$: (context) => client.readMessages$(context).pipe(map(normalize)),
      prepareSend$: (request, context) =>
        defer(async () => {
          const prepared = await client.prepareSend(
            {
              recipients: request.recipients,
              content: request.content,
              clientMessageId: request.clientMessageId,
            },
            { signal: context.signal, scope: context.windowId },
          );
          return {
            message: normalize(prepared.message),
            publish$: defer(() => prepared.publish({ signal: context.signal })).pipe(
              map(normalize),
              catchError((error) => {
                if (error instanceof WrappedMessagePublicationError)
                  throw new DmPublicationError(normalize(error.rumor), error.publications);
                throw error;
              }),
            ),
          };
        }),
      dispose: () => client.dispose(),
    };
  });
}
