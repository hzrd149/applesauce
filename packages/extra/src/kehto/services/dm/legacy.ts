import { DmPreparationCache } from "./preparation-cache.js";
import type { PreparedLegacyMessage } from "../../../messages/index.js";
import { createClientProtocol } from "./client-protocol.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import type { DmSendRequest } from "@kehto/services";
import { getConversationParticipants } from "applesauce-common/helpers";
import { getEncryptedContent, isHexKey, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import { concat, defer, finalize, ignoreElements, map, merge, NEVER, share } from "rxjs";
import { LegacyMessagesClient, type LegacyMessageSendRequest } from "../../../messages/index.js";
import { approveMessage } from "./approval.js";
import type { DmProtocolMessage } from "./types.js";

/** Creates a NIP-04 protocol backed by an account-scoped legacy messages client */
export function createLegacyMessageProtocol(config: NostrMessageProtocolOptions) {
  return createClientProtocol(config, "nip04", (account) => {
    if (!account.signer.nip04) return;
    const client = new LegacyMessagesClient({
      ...config,
      pubkey: account.pubkey,
      signer: account.signer,
    });
    const preparations = new DmPreparationCache<PreparedLegacyMessage>();
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
      if (!request.recipients.length || request.recipients.some((recipient) => !isHexKey(recipient)))
        throw new Error("Invalid recipients");
      const peers = [...new Set(request.recipients.filter((recipient) => recipient !== account.pubkey))];
      if (peers.length > 1) throw new Error("Legacy messages require one recipient");
      return {
        recipient: peers[0] ?? account.pubkey,
        content: request.content,
      };
    };
    // Kehto subscriptions own loading; message readers only observe the store.
    const liveLoading$ = concat(defer(() => client.start()).pipe(ignoreElements()), NEVER).pipe(
      finalize(() => client.stop()),
      share(),
    );
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
          const legacyRequest = translateRequest(request);
          const prepared = await preparations.prepare(request, context.windowId, async () => {
            const template = {
              kind: kinds.EncryptedDirectMessage,
              created_at: unixNow(),
              content: legacyRequest.content,
              tags: [["p", legacyRequest.recipient]],
            };
            await approveMessage(config, template, context);

            return client.prepareSend(legacyRequest, {
              signal: context.signal,
            });
          });
          return {
            message: normalize(prepared.message),
            publish$: defer(() => prepared.publish({ signal: context.signal })).pipe(map(normalize)),
          };
        }),
      dispose: () => {
        preparations.clear();
        client.dispose();
      },
    };
  });
}
