import type { DmAdapter, DmConversation, DmMessage, DmSendRequest } from "@kehto/services";
import {
  catchError,
  concatMap,
  defer,
  distinctUntilChanged,
  from,
  isObservable,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
} from "rxjs";
import type {
  DmOperationContext,
  DmProtocolAdapter,
  DmProtocolAvailability,
  DmProtocolMessage,
  DmProtocolSession,
} from "./types.js";

/** Options for including an existing Kehto DM adapter in protocol composition */
export interface DmAdapterProtocolOptions {
  /** The unique routing identifier for this adapter */
  id: string;
  /** The existing adapter or reactive authenticated adapter instance */
  adapter: DmAdapter | Observable<DmAdapter | undefined>;
  /** The optional recipient discovery policy, defaulting to unknown support */
  discover$?: (request: DmSendRequest, context: DmOperationContext) => Observable<DmProtocolAvailability>;
  /** Whether multiple recipients are supported, overriding the adapter's group capability */
  supportsGroups?: boolean;
  /** Whether closing the protocol closes the wrapped adapters (default true) */
  closeAdapter?: boolean;
}

/** Creates a composable protocol around an existing Kehto DM adapter */
export function createDmAdapterProtocol(config: DmAdapterProtocolOptions): DmProtocolAdapter {
  const closed$ = new ReplaySubject<void>(1);
  const adapters = new Set<DmAdapter>();
  let closed = false;
  let currentAdapter: DmAdapter | undefined;
  let currentOwner: string | undefined;
  let currentSession: DmProtocolSession | undefined;

  function createSession(adapter: DmAdapter, ownerPubkey: string, supportsGroups: boolean): DmProtocolSession {
    const conversations = new Map<string, DmConversation>();
    const directConversations = new Map<string, string>();

    function participantKey(participants: readonly string[]) {
      return JSON.stringify([...new Set(participants)].sort());
    }

    async function* conversationPages(context: DmOperationContext) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        context.signal.throwIfAborted();
        const page = await adapter.conversations({ cursor });
        context.signal.throwIfAborted();
        for (const conversation of page.conversations) {
          conversations.set(conversation.id, conversation);
          if (conversation.kind === "direct") {
            const participants = [...new Set([ownerPubkey, ...conversation.participants.map((peer) => peer.pubkey)])];
            directConversations.set(participantKey(participants), conversation.id);
          }
          yield conversation;
        }
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error("DM adapter repeated a conversation cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
    }

    async function normalize(
      message: DmMessage,
      context: DmOperationContext,
      recipients: string[] = [],
    ): Promise<DmProtocolMessage> {
      context.signal.throwIfAborted();
      let conversation = conversations.get(message.conversationId);
      if (!conversation) {
        for await (const candidate of conversationPages(context)) {
          if (candidate.id === message.conversationId) {
            conversation = candidate;
            break;
          }
        }
      }
      context.signal.throwIfAborted();
      const participants = [
        ...new Set([
          ownerPubkey,
          message.senderPubkey,
          ...(conversation ? conversation.participants.map((peer) => peer.pubkey) : recipients),
        ]),
      ];
      if (!conversation && participants.length < 2 && !recipients.includes(ownerPubkey))
        throw new Error("DM adapter did not provide conversation participants");
      return {
        id: message.id,
        senderPubkey: message.senderPubkey,
        createdAt: message.createdAt,
        content: message.content,
        status: message.status,
        participants,
        ...(conversation?.kind === "group" || (!conversation && message.conversationId.startsWith("group:"))
          ? {
              conversation: { id: message.conversationId, kind: "group" as const },
            }
          : {}),
      };
    }

    async function* history(context: DmOperationContext) {
      for await (const conversation of conversationPages(context)) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          context.signal.throwIfAborted();
          const page = await adapter.messages({ conversationId: conversation.id, cursor });
          context.signal.throwIfAborted();
          for (const message of page.messages) yield await normalize(message, context);
          cursor = page.cursor;
          if (cursor && seen.has(cursor)) throw new Error("DM adapter repeated a message cursor");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
    }

    function live$(context: DmOperationContext) {
      return new Observable<DmMessage>((subscriber) => {
        let active = true;
        let subscriptionId: string | undefined;
        const unsubscribe = (id: string) => {
          // Teardown cannot report async errors through an already closed subscriber.
          void Promise.resolve()
            .then(() => adapter.unsubscribe(id))
            .catch(() => {});
        };
        void Promise.resolve()
          .then(() => {
            context.signal.throwIfAborted();
            return adapter.subscribe({}, (message) => subscriber.next(message));
          })
          .then((subscription) => {
            if (!active) unsubscribe(subscription.subscriptionId);
            else subscriptionId = subscription.subscriptionId;
          })
          .catch((error) => subscriber.error(error));
        return () => {
          active = false;
          if (subscriptionId) unsubscribe(subscriptionId);
        };
      }).pipe(concatMap((message) => defer(() => normalize(message, context))));
    }

    return {
      ownerPubkey,
      discover$: (request, context) => {
        const peers = request.recipients.filter((recipient) => recipient !== ownerPubkey);
        if (peers.length > 1 && !supportsGroups) return of({ canSend: false, support: "unknown" });
        return config.discover$ ? config.discover$(request, context) : of({ canSend: true, support: "unknown" });
      },
      messages$: (context) => (context.history ? from(history(context)) : live$(context)),
      prepareSend$: (request, context) =>
        defer(() => {
          context.signal.throwIfAborted();
          const key = participantKey([ownerPubkey, ...request.recipients]);
          const nativeRequest = { ...request, conversationId: request.conversationId ?? directConversations.get(key) };
          // Existing adapters combine approval, preparation, and publication in send().
          // Invoke it only when the composer subscribes to the selected publication stream.
          return of({
            publish$: defer(async () => {
              context.signal.throwIfAborted();
              const result = await adapter.send(nativeRequest);
              context.signal.throwIfAborted();
              if (!result.ok) throw new Error("DM adapter did not accept the message");
              return normalize(result.message, context, request.recipients);
            }),
          });
        }),
    };
  }

  const adapter$ = isObservable(config.adapter) ? config.adapter : of(config.adapter);
  const session$ = defer(() => {
    let hasAdapter = false;
    return adapter$.pipe(
      distinctUntilChanged(),
      switchMap((adapter) => {
        const invalidate = hasAdapter;
        hasAdapter = true;
        if (!adapter) {
          currentAdapter = undefined;
          currentSession = undefined;
          return of(undefined);
        }
        adapters.add(adapter);
        const resolved$ = defer(() => Promise.resolve(adapter.status())).pipe(
          map((status) => {
            if (closed || !status.available || !status.ownerPubkey) return undefined;
            if (currentAdapter !== adapter || currentOwner !== status.ownerPubkey) {
              currentAdapter = adapter;
              currentOwner = status.ownerPubkey;
              currentSession = createSession(
                adapter,
                status.ownerPubkey,
                config.supportsGroups ?? status.capabilities.includes("group"),
              );
            }
            return currentSession;
          }),
          catchError(() => of(undefined)),
        );
        return invalidate ? resolved$.pipe(startWith(undefined)) : resolved$;
      }),
      takeUntil(closed$),
    );
  });

  return {
    id: config.id,
    session$: merge(session$, closed$.pipe(map(() => undefined))).pipe(shareReplay({ bufferSize: 1, refCount: true })),
    close: () => {
      if (closed) return;
      closed = true;
      closed$.next();
      closed$.complete();
      currentSession = undefined;
      currentAdapter = undefined;
      if (config.closeAdapter !== false) for (const adapter of adapters) adapter.close?.();
      adapters.clear();
    },
  };
}
