import { DmPreparationCache } from "./preparation-cache.js";
import type { PreparedWrappedMessage } from "../../../messages/index.js";
import { createClientProtocol } from "./client-protocol.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import { getConversationParticipants } from "applesauce-common/helpers";
import { kinds, unixNow, type Rumor } from "applesauce-core/helpers";
import { catchError, concat, defer, finalize, ignoreElements, map, merge, NEVER, share } from "rxjs";
import { WrappedMessagesClient, WrappedMessagePublicationError } from "../../../messages/index.js";
import { DmPublicationError } from "./publication.js";
import { approveMessage } from "./approval.js";
import type { DmProtocolMessage } from "./types.js";

/** Creates a NIP-17 protocol backed by an account-scoped wrapped messages client */
export function createWrappedMessageProtocol(config: NostrMessageProtocolOptions) {
  return createClientProtocol(config, "nip17", (account) => {
    if (!account.signer.nip44) return;
    const client = new WrappedMessagesClient({
      ...config,
      pubkey: account.pubkey,
      signer: account.signer,
    });
    const preparations = new DmPreparationCache<PreparedWrappedMessage>();
    const normalize = (rumor: Rumor): DmProtocolMessage => ({
      id: rumor.id,
      participants: getConversationParticipants(rumor),
      senderPubkey: rumor.pubkey,
      createdAt: rumor.created_at,
      content: rumor.content,
      status: rumor.pubkey === account.pubkey ? "sent" : "received",
    });
    // Kehto subscriptions own loading; message readers only observe the store.
    const liveLoading$ = concat(defer(() => client.start()).pipe(ignoreElements()), NEVER).pipe(
      finalize(() => client.stop()),
      share(),
    );
    return {
      ownerPubkey: account.pubkey,
      discover$: (request, context) => defer(() => client.discover(request, { signal: context.signal })),
      messages$: (context) =>
        (context.history
          ? concat(
              defer(() => client.loadHistory({ signal: context.signal })).pipe(ignoreElements()),
              client.readMessages$(context),
            )
          : merge(client.readMessages$(context), liveLoading$)
        ).pipe(map(normalize)),
      prepareSend$: (request, context) =>
        defer(async () => {
          const prepared = await preparations.prepare(request, context.windowId, async () => {
            const template = {
              kind: kinds.PrivateDirectMessage,
              created_at: unixNow(),
              content: request.content,
              tags: [...new Set(request.recipients)].map((recipient) => ["p", recipient]),
            };
            await approveMessage(config, template, context);

            return client.prepareSend(
              {
                recipients: request.recipients,
                content: request.content,
              },
              { signal: context.signal },
            );
          });
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
      dispose: () => {
        preparations.clear();
        client.dispose();
      },
    };
  });
}
