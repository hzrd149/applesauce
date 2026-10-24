import { DmMemoryStore, type DmAdapter, type DmMessage } from "@kehto/services";
import { logger } from "applesauce-core";
import {
  catchError,
  combineLatest,
  defaultIfEmpty,
  defer,
  filter,
  endWith,
  ignoreElements,
  finalize,
  firstValueFrom,
  forkJoin,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  retry,
  shareReplay,
  single,
  Subscription,
  switchMap,
  take,
  takeUntil,
  tap,
  timer,
  throwIfEmpty,
  timeout,
} from "rxjs";
import { defaultDmRouter } from "./router.js";
import type {
  DmOperationContext,
  DmProtocolAdapter,
  DmProtocolAvailability,
  DmProtocolMessage,
  DmProtocolConversation,
  DmProtocolSession,
  DmRoutingMessage,
  DmSendRouter,
} from "./types.js";

const log = logger.extend("KehtoDm");

/** Options for composing message protocols into a Kehto DM service */
export interface KehtoDmOptions {
  /** The protocols available for reading and sending, with no implicit implementations */
  protocols: readonly DmProtocolAdapter[];
  /** The send routing policy, defaulting to defaultDmRouter */
  routeSend?: DmSendRouter;
  /** The maximum wait for session resolution, discovery, or routing in milliseconds (default 4000) */
  routingTimeout?: number;
  /** The maximum wait for a finite history or send operation in milliseconds (default 120000) */
  operationTimeout?: number;
  /** The age of a completed history snapshot before refreshing in milliseconds (default 30000) */
  historyMaxAge?: number;
  /** The delay before reconnecting a failed live protocol in milliseconds (default 1000) */
  retryDelay?: number;
  /** The callback reporting isolated protocol history or live failures */
  onProtocolError?: (failure: DmProtocolFailure) => void;
  /** The napplet window making the current request */
  getWindowId?: () => string | undefined;
}

/** A protocol failure isolated from the other message backends */
export interface DmProtocolFailure {
  /** The failed protocol identifier */
  protocol: string;
  /** The operation that failed */
  operation: "history" | "subscribe";
  /** The original backend error */
  error: unknown;
}

interface ActiveProtocol {
  protocol: DmProtocolAdapter;
  session: DmProtocolSession;
}

interface ConversationRoutingHistory {
  lastMessage?: DmRoutingMessage;
  lastIncomingMessage?: DmRoutingMessage;
}

interface SessionHistory {
  messages: Map<string, DmProtocolMessage>;
  loadedAt?: number;
  loading$?: Observable<void>;
}

function conversationIdFor(store: DmMemoryStore, participants: readonly string[]) {
  const unique = [...new Set(participants)];
  const id = store.conversationIdFor(unique);
  return unique.length > 2 ? id.replace(/^direct:/, "group:") : id;
}

function protocolConversationId(protocol: string, conversation: DmProtocolConversation) {
  return `${conversation.kind}:${encodeURIComponent(protocol)}:${encodeURIComponent(conversation.id)}`;
}

function parseProtocolConversation(id: string | undefined) {
  const match = id?.match(/^(direct|group):([^:]+):(.*)$/);
  if (!match) return undefined;
  return { protocol: decodeURIComponent(match[2]), id: decodeURIComponent(match[3]) };
}

/**
 * Composes pluggable message protocols into a normalized Kehto DM adapter
 * @throws if protocol ids are empty or duplicated
 */
export function createMultiProtocolDmAdapter(config: KehtoDmOptions): DmAdapter {
  const protocols = [...config.protocols];
  const ids = new Set<string>();
  for (const protocol of protocols) {
    if (!protocol.id || ids.has(protocol.id)) throw new Error("DM protocol ids must be nonempty and unique");
    ids.add(protocol.id);
  }

  const subscriptions = new Map<string, Subscription>();
  const closed$ = new ReplaySubject<void>(1);
  const routingHistory = new WeakMap<DmProtocolSession, Map<string, ConversationRoutingHistory>>();
  const sessionHistories = new WeakMap<DmProtocolSession, SessionHistory>();
  const routingTimeout = config.routingTimeout ?? 4000;
  const operationTimeout = config.operationTimeout ?? 120000;
  let nextSubscriptionId = 0;
  let closed = false;

  function sessionHistory(session: DmProtocolSession): SessionHistory {
    let history = sessionHistories.get(session);
    if (!history) {
      history = { messages: new Map() };
      sessionHistories.set(session, history);
    }
    return history;
  }

  function reportFailure(protocol: ActiveProtocol, operation: DmProtocolFailure["operation"], error: unknown) {
    log("Protocol %s %s failed", protocol.protocol.id, operation, error);
    try {
      config.onProtocolError?.({ protocol: protocol.protocol.id, operation, error });
    } catch (callbackError) {
      log("Protocol failure callback failed", callbackError);
    }
  }

  function withSessions$<T>(work: (active: ActiveProtocol[], context: DmOperationContext) => Observable<T>) {
    return defer(() => {
      if (closed) throw new Error("DM service closed");
      const controller = new AbortController();
      const snapshots$ = protocols.length
        ? combineLatest(
            protocols.map((protocol) =>
              protocol.session$.pipe(
                timeout({ first: routingTimeout }),
                defaultIfEmpty(undefined),
                catchError(() => of(undefined)),
              ),
            ),
          )
        : of([] as (DmProtocolSession | undefined)[]);
      const sessions$ = snapshots$.pipe(shareReplay({ bufferSize: 1, refCount: true }));

      return sessions$.pipe(
        take(1),
        switchMap((snapshot) => {
          const active = protocols.flatMap((protocol, index) => {
            const session = snapshot[index];
            return session ? [{ protocol, session }] : [];
          });
          const owners = new Set(active.map(({ session }) => session.ownerPubkey));
          if (owners.size > 1) throw new Error("DM protocols must share the same owner identity");

          return defer(() => work(active, { signal: controller.signal, windowId: config.getWindowId?.() })).pipe(
            takeUntil(
              sessions$.pipe(filter((current) => current.some((session, index) => session !== snapshot[index]))),
            ),
          );
        }),
        takeUntil(closed$),
        throwIfEmpty(() => new Error("Account changed or DM service closed")),
        finalize(() => controller.abort(new Error("Account changed or DM operation ended"))),
      );
    });
  }

  function storeMessage(protocol: ActiveProtocol, message: DmProtocolMessage, store: DmMemoryStore): DmMessage {
    if (!message.participants.includes(protocol.session.ownerPubkey)) throw new Error("DM message excludes its owner");
    const participants = [...new Set(message.participants)].sort();
    const conversationId = message.conversation
      ? protocolConversationId(protocol.protocol.id, message.conversation)
      : conversationIdFor(store, participants);
    // Namespacing prevents unrelated protocols with identical native ids from overwriting one another.
    const nativeMessageId = message.conversation
      ? `${encodeURIComponent(message.conversation.id)}:${encodeURIComponent(message.id)}`
      : encodeURIComponent(message.id);
    const normalized: DmMessage = {
      id: `${encodeURIComponent(protocol.protocol.id)}:${nativeMessageId}`,
      conversationId,
      senderPubkey: message.senderPubkey,
      createdAt: message.createdAt,
      content: message.content,
      status: message.status,
    };
    sessionHistory(protocol.session).messages.set(normalized.id, message);
    let conversations = routingHistory.get(protocol.session);
    if (!conversations) {
      conversations = new Map();
      routingHistory.set(protocol.session, conversations);
    }
    const history = conversations.get(conversationId) ?? {};
    const metadata = {
      protocol: protocol.protocol.id,
      id: message.id,
      senderPubkey: message.senderPubkey,
      createdAt: message.createdAt,
    };
    if (
      !history.lastMessage ||
      metadata.createdAt > history.lastMessage.createdAt ||
      (metadata.createdAt === history.lastMessage.createdAt && metadata.id > history.lastMessage.id)
    )
      history.lastMessage = metadata;
    if (
      message.senderPubkey !== protocol.session.ownerPubkey &&
      (!history.lastIncomingMessage ||
        metadata.createdAt > history.lastIncomingMessage.createdAt ||
        (metadata.createdAt === history.lastIncomingMessage.createdAt && metadata.id > history.lastIncomingMessage.id))
    )
      history.lastIncomingMessage = metadata;
    conversations.set(conversationId, history);
    return store.upsertMessage(normalized, participants);
  }

  function lastMessage(active: ActiveProtocol[], conversationId: string, incoming: boolean) {
    return active
      .map(({ session }) => {
        const history = routingHistory.get(session)?.get(conversationId);
        return incoming ? history?.lastIncomingMessage : history?.lastMessage;
      })
      .filter((message): message is DmRoutingMessage => !!message)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
  }

  function loadHistory$(protocol: ActiveProtocol, windowId: string | undefined): Observable<void> {
    const history = sessionHistory(protocol.session);
    if (history.loading$) return history.loading$;
    if (history.loadedAt !== undefined && Date.now() - history.loadedAt < (config.historyMaxAge ?? 30000))
      return of(undefined);

    const loading$ = defer(() => {
      const controller = new AbortController();
      const store = new DmMemoryStore();
      return defer(() => protocol.session.messages$({ signal: controller.signal, windowId, history: true })).pipe(
        tap((message) => storeMessage(protocol, message, store)),
        ignoreElements(),
        endWith(undefined),
        timeout({ first: operationTimeout }),
        tap(() => {
          history.loadedAt = Date.now();
        }),
        finalize(() => {
          history.loading$ = undefined;
          controller.abort(new Error("DM history operation ended"));
        }),
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    history.loading$ = loading$;
    return loading$;
  }

  function history$() {
    return withSessions$((active, context) => {
      if (!active.length) return of(new DmMemoryStore());
      const failures: unknown[] = [];
      return forkJoin(
        active.map((protocol) =>
          loadHistory$(protocol, context.windowId).pipe(
            catchError((error) => {
              failures.push(error);
              reportFailure(protocol, "history", error);
              return of(undefined);
            }),
          ),
        ),
      ).pipe(
        map(() => {
          if (failures.length === active.length) throw failures[0];
          const store = new DmMemoryStore();
          for (const protocol of active) {
            for (const message of sessionHistory(protocol.session).messages.values()) {
              storeMessage(protocol, message, store);
            }
          }
          return store;
        }),
      );
    });
  }

  const adapter: DmAdapter = {
    status: async () => {
      if (closed) return { available: false, implementations: [], capabilities: [] };
      return firstValueFrom(
        withSessions$((active) =>
          of({
            available: active.length > 0,
            ownerPubkey: active[0]?.session.ownerPubkey,
            implementations: active.map(({ protocol }) => protocol.id),
            capabilities: active.length ? ["send", "history", "subscribe"] : [],
          }),
        ),
      );
    },
    conversations: async (query) => (await firstValueFrom(history$())).conversations(query),
    messages: async (query) => (await firstValueFrom(history$())).messages(query),
    send: (input) => {
      const request = { ...input, recipients: [...new Set(input.recipients)] };
      // Capture the requesting window before resolving sessions or discovery asynchronously.
      const windowId = config.getWindowId?.();
      return firstValueFrom(
        withSessions$((active, operation) => {
          if (!active.length) throw new Error("No available DM protocol");
          if (!request.recipients.length) throw new Error("Invalid recipients");
          const context = { ...operation, windowId };
          const ownerPubkey = active[0].session.ownerPubkey;
          const store = new DmMemoryStore();
          const conversationId = conversationIdFor(store, [...request.recipients, ownerPubkey]);
          const nativeConversation = parseProtocolConversation(request.conversationId);
          if (nativeConversation && !active.some(({ protocol }) => protocol.id === nativeConversation.protocol))
            throw new Error("Conversation belongs to an unavailable DM protocol");
          if (request.conversationId && !nativeConversation && request.conversationId !== conversationId)
            throw new Error("Conversation does not match recipients");
          const requestFor = (protocol: DmProtocolAdapter) => ({
            ...request,
            conversationId: nativeConversation?.protocol === protocol.id ? nativeConversation.id : undefined,
          });

          return forkJoin(
            active.map(({ protocol, session }) =>
              defer(() =>
                nativeConversation && nativeConversation.protocol !== protocol.id
                  ? of({ canSend: false, support: "unknown" } as DmProtocolAvailability)
                  : session.discover$(requestFor(protocol), context),
              ).pipe(
                timeout({ first: routingTimeout }),
                take(1),
                defaultIfEmpty({ canSend: false, support: "unknown" } as DmProtocolAvailability),
                catchError(() => of({ canSend: false, support: "unknown" } as DmProtocolAvailability)),
                map((availability) => [protocol.id, availability] as const),
              ),
            ),
          ).pipe(
            switchMap((candidates) => {
              const routing = {
                request,
                ownerPubkey,
                protocols: new Map(candidates),
                signal: context.signal,
                lastMessage: lastMessage(active, request.conversationId ?? conversationId, false),
                lastIncomingMessage: lastMessage(active, request.conversationId ?? conversationId, true),
              };
              return defer(() => Promise.resolve((config.routeSend ?? defaultDmRouter)(routing))).pipe(
                timeout({ first: routingTimeout }),
                map((id) => {
                  const selected = active.find(({ protocol }) => protocol.id === id);
                  if (!selected || !routing.protocols.get(id)?.canSend)
                    throw new Error(`Ineligible DM protocol: ${id}`);
                  return selected;
                }),
              );
            }),
            switchMap((selected) =>
              defer(() => selected.session.prepareSend$(requestFor(selected.protocol), context)).pipe(
                take(1),
                throwIfEmpty(() => new Error("DM protocol did not prepare a message")),
                switchMap((prepared) => {
                  context.signal.throwIfAborted();
                  const validateMessage = (message: DmProtocolMessage) => {
                    const actual = message.conversation
                      ? protocolConversationId(selected.protocol.id, message.conversation)
                      : conversationIdFor(store, message.participants);
                    if (request.conversationId && actual !== request.conversationId)
                      throw new Error("Prepared message does not match conversation");
                    if (!message.conversation && actual !== conversationId)
                      throw new Error("Prepared message does not match recipients");
                  };
                  if (prepared.message) validateMessage(prepared.message);
                  return defer(() => prepared.publish$).pipe(
                    single(),
                    map((message) => {
                      context.signal.throwIfAborted();
                      validateMessage(message);
                      return { ok: true, message: storeMessage(selected, message, store) };
                    }),
                  );
                }),
              ),
            ),
            timeout({ first: operationTimeout }),
          );
        }),
      );
    },
    subscribe: (request, onMessage) =>
      new Promise((resolve, reject) => {
        const subscriptionId = `dm-${++nextSubscriptionId}`;
        const subscription = new Subscription();
        const store = new DmMemoryStore();
        const seen = new Set<string>();
        const conversationId = request.conversationId;
        subscriptions.set(subscriptionId, subscription);
        subscription.add(() => subscriptions.delete(subscriptionId));
        subscription.add(
          withSessions$((active, context) => {
            if (!active.length) throw new Error("No available DM protocol");
            resolve({ subscriptionId });
            return merge(
              ...active.map((protocol) =>
                defer(() => protocol.session.messages$({ ...context, history: false })).pipe(
                  map((message) => storeMessage(protocol, message, store)),
                  retry({
                    delay: (error) => {
                      reportFailure(protocol, "subscribe", error);
                      return timer(config.retryDelay ?? 1000);
                    },
                  }),
                ),
              ),
            ).pipe(
              map((message) => {
                if (seen.has(message.id)) return;
                if (conversationId && message.conversationId !== conversationId) return;
                seen.add(message.id);
                onMessage(message);
              }),
            );
          })
            .pipe(finalize(() => subscription.unsubscribe()))
            .subscribe({ error: reject }),
        );
      }),
    unsubscribe: (id) => {
      subscriptions.get(id)?.unsubscribe();
      return { ok: true };
    },
    close: () => {
      if (closed) return;
      closed = true;
      closed$.next();
      closed$.complete();
      for (const subscription of subscriptions.values()) subscription.unsubscribe();
      subscriptions.clear();
      for (const protocol of protocols) protocol.close?.();
    },
  };
  return adapter;
}
