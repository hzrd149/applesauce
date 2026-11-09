import type { DmSendRequest } from "@kehto/services";
import { unixNow } from "applesauce-core/helpers";
import { CHAT_MESSAGE_KIND } from "nostr-double-ratchet";
import {
  concat,
  defer,
  distinctUntilChanged,
  filter,
  finalize,
  ignoreElements,
  isObservable,
  map,
  merge,
  mergeMap,
  NEVER,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  timeout,
} from "rxjs";
import { NdrMessagesClient } from "../../../messages/ndr/client.js";
import { getNdrGroupId } from "../../../messages/ndr/history.js";
import type { NdrMessage, NdrMessagesClientOptions } from "../../../messages/ndr/types.js";
import { approveMessage } from "./approval.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import { DmPreparationCache } from "./preparation-cache.js";
import type { DmProtocolAdapter, DmProtocolMessage, DmProtocolSession } from "./types.js";

/** Options for wrapping an app-owned NDR client or constructing a protocol-owned client */
export type NdrMessageProtocolOptions = Pick<NostrMessageProtocolOptions, "approve" | "actionTimeout"> & {
  /** The maximum wait for peer device discovery in milliseconds (default 3000) */
  discoveryTimeout?: number;
} & (
    | {
        /** The host-started client, or an account-scoped stream that emits undefined on logout */
        client: NdrMessagesClient | Observable<NdrMessagesClient | undefined>;
        /** Client construction is exclusive with supplying a client */
        clientOptions?: never;
      }
    | {
        /** Options for a client started and disposed by the protocol */
        clientOptions: NdrMessagesClientOptions;
        /** An existing client is exclusive with construction options */
        client?: never;
      }
  );

/** An NDR protocol exposing its current client for device setup and host controls */
export interface NdrMessageProtocol extends DmProtocolAdapter {
  /** The active client, shared with protocol sessions */
  client$: Observable<NdrMessagesClient | undefined>;
}

/** Creates a Kehto protocol that owns only clients constructed from clientOptions */
export function createNdrMessageProtocol(config: NdrMessageProtocolOptions): NdrMessageProtocol {
  const closed$ = new ReplaySubject<void>(1);
  const sessions = new WeakMap<NdrMessagesClient, DmProtocolSession>();
  let closed = false;

  function createSession(client: NdrMessagesClient): DmProtocolSession {
    const preparations = new DmPreparationCache<() => Promise<DmProtocolMessage>>();

    function normalize(message: NdrMessage): DmProtocolMessage {
      const groupId = getNdrGroupId(message.conversationId);
      const members = groupId ? client.history.group(groupId)?.data.members : undefined;
      if (groupId && !members) throw new Error("NDR group roster is unavailable");

      return {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt,
        senderPubkey: message.sender,
        participants: [...new Set([client.pubkey, ...(members ?? [message.conversationId])])],
        ...(groupId ? { conversation: { id: message.conversationId, kind: "group" as const } } : {}),
        // Kehto's sent status means submitted; only peer receipts establish delivery.
        status:
          message.delivery === "received"
            ? "received"
            : message.delivery === "delivered" || message.delivery === "seen"
              ? "delivered"
              : "sent",
      };
    }

    function target(request: DmSendRequest) {
      const groupId = request.conversationId && getNdrGroupId(request.conversationId);
      if (groupId) {
        const record = client.history.group(groupId);
        if (!record || record.removed || record.data.accepted === false) throw new Error("NDR group is not joined");
        const participants = new Set([client.pubkey, ...request.recipients]);
        if (
          participants.size !== record.data.members.length ||
          record.data.members.some((peer) => !participants.has(peer))
        )
          throw new Error("NDR group does not match recipients");
        return client.group(groupId);
      }

      const peers = [...new Set(request.recipients)].filter((peer) => peer !== client.pubkey);
      if (peers.length !== 1) throw new Error("NDR direct messages require one other recipient");
      if (request.conversationId && request.conversationId !== peers[0])
        throw new Error("NDR conversation does not match recipients");
      return client.conversation(peers[0]);
    }

    return {
      ownerPubkey: client.pubkey,
      discover$: (request, context) =>
        defer(() => {
          context.signal.throwIfAborted();
          let conversation: ReturnType<typeof target>;
          try {
            conversation = target(request);
          } catch {
            return of({ canSend: false, support: "unknown" as const });
          }
          if (!("peerDevices$" in conversation))
            return conversation.canSend$.pipe(
              take(1),
              map((canSend) => ({ canSend, support: "supported" as const })),
            );

          return conversation.peerDevices$.pipe(
            filter((devices) => devices !== undefined),
            take(1),
            map((devices) => devices.length > 0),
            timeout({ first: config.discoveryTimeout ?? 3000, with: () => of(undefined) }),
            switchMap((supported) =>
              client.state$.pipe(
                take(1),
                map((state) => ({
                  canSend: state.canSendPrivateMessages && supported !== false,
                  support:
                    supported === undefined
                      ? ("unknown" as const)
                      : supported
                        ? ("supported" as const)
                        : ("unsupported" as const),
                })),
              ),
            ),
          );
        }),
      messages$: (context) =>
        defer(() => {
          context.signal.throwIfAborted();
          const changes$ = context.history ? client.history.changes$.pipe(take(1)) : client.history.changes$;
          const seen = new Map<string, string>();
          return changes$.pipe(
            mergeMap(() =>
              client.history.conversations().flatMap((conversation) => client.history.messages(conversation.id)),
            ),
            map(normalize),
            filter((message) => {
              const key = JSON.stringify([message.conversation?.id, message.id]);
              const fingerprint = JSON.stringify(message);
              if (seen.get(key) === fingerprint) return false;
              seen.set(key, fingerprint);
              return true;
            }),
          );
        }),
      prepareSend$: (request, context) =>
        defer(async () => {
          context.signal.throwIfAborted();
          const conversation = target(request);
          const publish = await preparations.prepare(
            request,
            JSON.stringify([context.windowId, conversation.id]),
            async () => {
              await approveMessage(
                config,
                {
                  kind: CHAT_MESSAGE_KIND,
                  content: request.content,
                  created_at: unixNow(),
                  tags: request.recipients.map((peer) => ["p", peer]),
                },
                context,
              );
              let sent: Promise<DmProtocolMessage> | undefined;
              return () => {
                // Retain the result, including ambiguous failures, so a retry cannot advance the ratchet twice.
                sent ??= conversation.send({ content: request.content }).then((message) => {
                  if (!message) throw new Error("NDR did not retain the sent message");
                  return normalize(message);
                });
                return sent;
              };
            },
          );
          return {
            publish$: defer(() => {
              context.signal.throwIfAborted();
              // Membership can change while the host is displaying the approval prompt.
              target(request);
              return publish();
            }),
          };
        }),
    };
  }

  const clientOptions = config.clientOptions;
  const source$ = clientOptions
    ? defer(() => {
        const client = new NdrMessagesClient(clientOptions);

        return concat(of(client), defer(() => client.start()).pipe(ignoreElements()), NEVER).pipe(
          finalize(() => client.dispose()),
        );
      })
    : isObservable(config.client)
      ? config.client
      : of(config.client);
  // Invalidate sessions before disposing owned clients; retain ownership until close.
  const clients$ = merge(
    closed$.pipe(map(() => undefined)),
    defer(() => (closed ? of(undefined) : source$)).pipe(takeUntil(closed$)),
  ).pipe(shareReplay({ bufferSize: 1, refCount: false }));
  const session$ = clients$.pipe(
    distinctUntilChanged(),
    switchMap((client) =>
      client
        ? client.lifecycle$.pipe(
            map((lifecycle) => {
              if (lifecycle !== "ready") return undefined;
              let session = sessions.get(client);
              if (!session) {
                session = createSession(client);
                sessions.set(client, session);
              }
              return session;
            }),
          )
        : of(undefined),
    ),
    distinctUntilChanged(),
    takeUntil(closed$),
  );

  return {
    id: "ndr",
    client$: clients$,
    session$: merge(closed$.pipe(map(() => undefined)), session$).pipe(shareReplay({ bufferSize: 1, refCount: true })),
    close: () => {
      if (closed) return;
      closed = true;
      closed$.next();
      closed$.complete();
    },
  };
}
