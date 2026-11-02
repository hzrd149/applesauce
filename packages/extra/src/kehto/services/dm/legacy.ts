import { DmPreparationCache } from "./preparation-cache.js";
import type { PreparedLegacyMessage } from "../../../messages/index.js";
import { createClientProtocol } from "./client-protocol.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import type { DmSendRequest } from "@kehto/services";
import { getConversationParticipants, isValidLegacyMessage } from "applesauce-common/helpers";
import { getEncryptedContent, isHexKey, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import {
  concat,
  defer,
  distinct,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  fromEvent,
  ignoreElements,
  isObservable,
  map,
  merge,
  mergeMap,
  NEVER,
  Observable,
  of,
  ReplaySubject,
  share,
  shareReplay,
  switchMap,
  take,
  takeUntil,
} from "rxjs";
import {
  LegacyMessagesClient,
  type LegacyMessageSendRequest,
  type LegacyMessagesClientOptions,
} from "../../../messages/index.js";
import { approveMessage } from "./approval.js";
import type { DmProtocolAdapter, DmProtocolMessage, DmProtocolSession } from "./types.js";

/** Options for wrapping an app-owned legacy client or constructing a protocol-owned client */
export type LegacyMessageProtocolOptions = Pick<NostrMessageProtocolOptions, "approve" | "actionTimeout"> &
  (
    | {
        /** The app-owned client or active account's client stream */
        client: LegacyMessagesClient | Observable<LegacyMessagesClient | undefined>;
        /** Client construction is exclusive with supplying a client */
        clientOptions?: never;
      }
    | {
        /** Options for a client started and disposed by the protocol */
        clientOptions: LegacyMessagesClientOptions;
        /** An existing client is exclusive with construction options */
        client?: never;
      }
  );

/** A legacy protocol exposing its client for authentication and unlocking */
export interface LegacyMessageProtocol extends DmProtocolAdapter {
  /** The active client, shared with protocol sessions */
  client$: Observable<LegacyMessagesClient | undefined>;
}

/** Creates a legacy protocol with explicit client ownership */
export function createLegacyMessageProtocol(config: LegacyMessageProtocolOptions): LegacyMessageProtocol;
/** Creates a legacy protocol from reactive Nostr dependencies */
export function createLegacyMessageProtocol(config: NostrMessageProtocolOptions): DmProtocolAdapter;

/** Creates a NIP-04 protocol backed by an account-scoped legacy messages client */
export function createLegacyMessageProtocol(
  config: NostrMessageProtocolOptions | LegacyMessageProtocolOptions,
): DmProtocolAdapter | LegacyMessageProtocol {
  if ("client" in config || "clientOptions" in config)
    return createLegacyClientProtocol(config as LegacyMessageProtocolOptions);

  return createClientProtocol(config, "nip04", (account) => {
    if (!account.signer.nip04) return;
    const client = new LegacyMessagesClient({
      ...config,
      pubkey: account.pubkey,
      signer: account.signer,
    });
    return createLegacySession(client, config, true);
  });
}

function createLegacyClientProtocol(config: LegacyMessageProtocolOptions): LegacyMessageProtocol {
  const closed$ = new ReplaySubject<void>(1);
  let closed = false;
  const clientOptions = config.clientOptions;
  const source$ = clientOptions
    ? defer(() => {
        const client = new LegacyMessagesClient(clientOptions);

        return concat(of(client), defer(() => client.start()).pipe(ignoreElements()), NEVER).pipe(
          finalize(() => client.dispose()),
        );
      })
    : isObservable(config.client)
      ? config.client
      : of(config.client);
  // Invalidate sessions before disposing owned clients; retain ownership until close.
  const client$ = merge(
    closed$.pipe(map(() => undefined)),
    defer(() => (closed ? of(undefined) : source$)).pipe(takeUntil(closed$)),
  ).pipe(shareReplay({ bufferSize: 1, refCount: false }));
  const session$ = client$.pipe(
    distinctUntilChanged(),
    switchMap((client) =>
      client
        ? client.lifecycle$.pipe(
            distinctUntilChanged(),
            map((lifecycle) => (lifecycle === "running" ? createLegacySession(client, config, false) : undefined)),
          )
        : of(undefined),
    ),
    distinctUntilChanged(),
    // Keep retry handles between independent Kehto calls; close completes the client stream.
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  return {
    id: "nip04",
    client$,
    session$,
    close: () => {
      if (closed) return;
      closed = true;
      closed$.next();
      closed$.complete();
    },
  };
}

function createLegacySession(
  client: LegacyMessagesClient,
  config: Pick<NostrMessageProtocolOptions, "approve" | "actionTimeout">,
  manageLoading: boolean,
): DmProtocolSession & { dispose(): void } {
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
      status: event.pubkey === client.pubkey ? "sent" : "received",
    };
  };
  const translateRequest = (request: DmSendRequest): LegacyMessageSendRequest => {
    if (!request.recipients.length || request.recipients.some((recipient) => !isHexKey(recipient)))
      throw new Error("Invalid recipients");
    const peers = [...new Set(request.recipients.filter((recipient) => recipient !== client.pubkey))];
    if (peers.length > 1) throw new Error("Legacy messages require one recipient");
    return {
      recipient: peers[0] ?? client.pubkey,
      content: request.content,
    };
  };
  // Only the dependency-based compatibility API ties loading to Kehto subscriptions.
  const liveLoading$ = concat(defer(() => client.start()).pipe(ignoreElements()), NEVER).pipe(
    finalize(() => client.stop()),
    share(),
  );
  return {
    ownerPubkey: client.pubkey,
    discover$: (request, context) =>
      defer(async () => {
        const availability = await client.discover(translateRequest(request), { signal: context.signal });
        return {
          ...availability,
          canSend: !!client.signer?.nip04 && availability.canSend,
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
      defer(() => {
        context.signal.throwIfAborted();
        const messages$ = context.history ? client.messages$.pipe(take(1)) : client.messages$;
        const read$ = manageLoading
          ? client.readMessages$(context)
          : messages$.pipe(
              mergeMap((events) => events),
              filter((event) => isValidLegacyMessage(event) && getEncryptedContent(event) !== undefined),
              distinct((event) => event.id),
            );
        const loading$ = context.history
          ? defer(() => client.loadHistory({ signal: context.signal })).pipe(ignoreElements())
          : manageLoading
            ? liveLoading$
            : EMPTY;
        return (context.history ? concat(loading$, read$) : merge(read$, loading$)).pipe(
          map(normalize),
          takeUntil(fromEvent(context.signal, "abort")),
        );
      }),
    prepareSend$: (request, context) =>
      defer(async () => {
        context.signal.throwIfAborted();
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
      if (manageLoading) client.dispose();
    },
  };
}
