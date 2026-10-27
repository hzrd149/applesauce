import { getLegacyMessageCorrespondent } from "applesauce-common/helpers";
import { LegacyMessagesGroups } from "applesauce-common/models";
import { isEncryptedContentUnlocked, mergeRelaySets, unixNow, type NostrEvent } from "applesauce-core/helpers";
import { watchEventsUpdates } from "applesauce-core/observable";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  firstValueFrom,
  fromEvent,
  lastValueFrom,
  map,
  Observable,
  of,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs";
import { restoreMessageContent } from "../common/encryption.js";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";
import { createLegacyMailboxes, hydrateLegacyMessages, syncLegacyMessages$, type LegacyMailbox } from "./loading.js";
import { LegacyMessageSession } from "./session.js";
import { LegacyConversation } from "./conversation.js";
import type { MessageClientError, MessageOperationOptions, MessagesRelayStatus } from "../common/types.js";
import type {
  LegacyMessageAvailability,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
  PreparedLegacyMessage,
} from "./types.js";

/** An account-scoped NIP-04 inbox with loading, decryption and reliable publication */
export class LegacyMessagesClient {
  /** The immutable owner pubkey */
  readonly pubkey: string;
  /** The shared event store */
  readonly eventStore;
  /** The shared relay pool */
  readonly pool;
  /** The account signer, absent for read-only browsing */
  readonly signer;
  /** The native encrypted kind-4 events, including sent messages */
  readonly messages$: Observable<NostrEvent[]>;
  /** The conversations discovered in the shared store */
  readonly conversations$: Observable<{ id: string; participants: string[]; lastMessage: NostrEvent }[]>;
  /** The combined mailbox relay set */
  readonly relays$: Observable<string[]>;
  /** The mailbox relay connection states */
  readonly relayStatus$: Observable<MessagesRelayStatus[]>;
  /** The current decryption counts and failed event IDs */
  readonly decryptionState$;

  private readonly lifecycle = new BehaviorSubject<"idle" | "loading" | "ready" | "disposed">("idle");
  /** The background loading lifecycle, independent of decryption */
  readonly status$ = this.lifecycle.asObservable();
  private readonly errors = new Subject<MessageClientError>();
  /** Nonterminal failures from individual operations */
  readonly errors$ = this.errors.asObservable();
  private readonly failed = new BehaviorSubject<ReadonlySet<string>>(new Set());
  private readonly pending = new BehaviorSubject<number>(0);
  private readonly autoUnlock = new BehaviorSubject(false);
  private readonly destroyed = new ReplaySubject<void>(1);
  private readonly syncState = new BehaviorSubject<LegacyMessagesSyncStatus | undefined>(undefined);
  /** The latest background history reconciliation progress */
  readonly syncStatus$ = this.syncState.asObservable();
  private readonly sending = new BehaviorSubject(0);
  /** Whether one or more send operations are in progress */
  readonly busy$ = this.sending.pipe(map((count) => count > 0));
  private readonly publications = new BehaviorSubject<
    Record<string, "prepared" | "publishing" | "accepted" | "failed">
  >({});
  /** The publication states of messages sent during this client lifetime */
  readonly publications$ = this.publications.asObservable();
  private readonly session: LegacyMessageSession;
  private readonly authentication: MessageAuthentication;
  /** The pending relay authentication requests */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly conversations = new Map<string, LegacyConversation>();
  private readonly mailboxes: LegacyMailbox[];

  /** Creates a stopped legacy client using shared application dependencies */
  constructor(private readonly options: LegacyMessagesClientOptions) {
    this.authentication = new MessageAuthentication(options.pool, options.pubkey, options.signer);
    this.authRequests$ = this.authentication.requests$;
    options = this.options = { ...options, ...this.authentication.configure(options) };
    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.signer = options.signer;
    this.autoUnlock.next(options.autoUnlock ?? false);

    const signer = options.signer ?? {
      getPublicKey: async () => options.pubkey,
      signEvent: async () => {
        throw new Error("A signer is required");
      },
    };
    const owner = { pubkey: this.pubkey, signer };
    const onReadError = (error: unknown, event: NostrEvent) => this.report("decrypt", error, event.id);
    this.session = new LegacyMessageSession(options, owner, onReadError);

    this.mailboxes = createLegacyMailboxes(options);
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((relays) => mergeRelaySets(...relays)),
      distinctUntilChanged((a, b) => a.join() === b.join()),
    );
    this.messages$ = this.eventStore.timeline(this.filters).pipe(watchEventsUpdates(this.eventStore));
    this.relayStatus$ = combineLatest([this.relays$, this.pool.status$ ?? of({})]).pipe(
      map(([relays, connections]) => relays.map((url) => ({ url, connection: connections[url] }))),
    );
    this.conversations$ = this.eventStore.model(LegacyMessagesGroups, this.pubkey);
    this.decryptionState$ = combineLatest([this.messages$, this.failed, this.pending]).pipe(
      map(([events, failed, pending]) => ({
        total: events.length,
        unlocked: events.filter(isEncryptedContentUnlocked).length,
        locked: events.filter((event) => !isEncryptedContentUnlocked(event) && !failed.has(event.id)).length,
        failed: [...failed],
        pending,
      })),
    );
  }

  private get filters() {
    return this.mailboxes.map((mailbox) => mailbox.filter);
  }
  private assertActive() {
    if (this.disposed) throw new Error("Messages client disposed");
  }

  /**
   * Authenticates a pending relay using this client's signer
   * @throws if the client is disposed, no matching signer or request exists, or authentication fails
   */
  authenticate(url: string): Promise<void> {
    this.assertActive();
    return this.authentication.authenticate(url);
  }
  private context(options: MessageOperationOptions = {}) {
    this.assertActive();
    const signal = options.signal ? AbortSignal.any([this.generation.signal, options.signal]) : this.generation.signal;
    signal.throwIfAborted();
    return { ...options, signal };
  }
  private report(operation: MessageClientError["operation"], error: unknown, eventId?: string) {
    this.errors.next({ operation, error, eventId });
  }

  /** Returns the native messages in one conversation */
  conversation$(correspondent: string): Observable<NostrEvent[]> {
    return this.conversation(correspondent).messages$;
  }

  /** Returns a stable, independently loadable conversation with one correspondent */
  conversation(correspondent: string): LegacyConversation {
    this.assertActive();
    if (!/^[0-9a-f]{64}$/.test(correspondent)) throw new Error("Invalid correspondent");
    let conversation = this.conversations.get(correspondent);
    if (!conversation || conversation.isDisposed) {
      conversation = new LegacyConversation(this, correspondent, {
        ...this.options,
        autoUnlock: this.autoUnlock.value,
      });
      this.conversations.set(correspondent, conversation);
    }
    return conversation;
  }

  /** Starts cache restoration, recent history reconciliation and live mailbox loading */
  async start(): Promise<void> {
    this.assertActive();
    if (this.background) return;
    const background = (this.background = new Subscription());
    const context = this.context();
    this.lifecycle.next("loading");
    try {
      await this.hydrate(context.signal);
      if (context.signal.aborted || background.closed) return;
      background.add(
        this.eventStore
          .filters(this.filters)
          .pipe(
            concatMap((event) =>
              defer(() => this.restore(event)).pipe(
                timeout({ first: this.options.decryptionTimeout ?? 60000 }),
                catchError((error) => {
                  this.report("restore", error, event.id);
                  return EMPTY;
                }),
              ),
            ),
          )
          .subscribe(),
      );
      background.add(
        this.autoUnlock
          .pipe(
            switchMap((enabled) =>
              enabled
                ? this.eventStore.filters(this.filters).pipe(
                    concatMap((event) =>
                      defer(async () => {
                        if (
                          context.signal.aborted ||
                          isEncryptedContentUnlocked(event) ||
                          this.failed.value.has(event.id)
                        )
                          return;
                        await this.unlock(event, context);
                      }).pipe(catchError(() => EMPTY)),
                    ),
                  )
                : EMPTY,
            ),
          )
          .subscribe(),
      );
      const since = unixNow() - (this.options.historySpan ?? 30 * 86400);
      for (const mailbox of this.mailboxes) {
        background.add(
          mailbox.relays$
            .pipe(
              switchMap((relays) =>
                relays.length
                  ? withMessageAuth$(this.options, (auth) =>
                      this.pool.subscription(
                        relays,
                        {
                          ...mailbox.filter,
                          since,
                        },
                        {
                          eventStore: this.eventStore,
                          reconnect: true,
                          ...auth,
                        },
                      ),
                    ).pipe(
                      catchError((error) => {
                        this.report("read", error);
                        return EMPTY;
                      }),
                    )
                  : EMPTY,
              ),
            )
            .subscribe(),
        );
      }
      background.add(
        this.relays$
          .pipe(
            switchMap(() =>
              this.sync$({ since }).pipe(
                catchError((error) => {
                  this.report("sync", error);
                  return EMPTY;
                }),
              ),
            ),
          )
          .subscribe((status) => {
            this.syncState.next(status);
            if (status.done) this.lifecycle.next("ready");
          }),
      );
    } catch (error) {
      this.stop();
      this.report("read", error);
      throw error;
    }
  }

  /** Stops background work and invalidates outstanding operations without disposing shared dependencies */
  stop(): void {
    this.authentication.clear();
    for (const conversation of this.conversations.values()) conversation.stop();
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (!this.disposed) this.lifecycle.next("idle");
  }

  /** Permanently releases this client's subscriptions and retry state */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const conversation of this.conversations.values()) conversation.dispose();
    this.conversations.clear();
    this.session.close();
    this.destroyed.next();
    this.destroyed.complete();
    this.lifecycle.next("disposed");
    this.publications.next({});
  }

  /** Releases this client and its conversations through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed decryption of arriving messages */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
    for (const conversation of this.conversations.values()) conversation.setAutoUnlock(enabled);
  }

  private async hydrate(signal: AbortSignal) {
    try {
      await hydrateLegacyMessages(this.options, this.filters, signal);
    } catch (error) {
      if (!signal.aborted) this.report("restore", error);
    }
  }

  private async restore(event: NostrEvent) {
    await restoreMessageContent(event, this.options.decryptionCache);
    // Restored plaintext must also contribute to optional conversation lifetime mirroring.
    if (this.options.mirrorExpiration && isEncryptedContentUnlocked(event)) {
      await firstValueFrom(this.session.read$(event), { defaultValue: undefined });
    }
  }

  /** Decrypts one event or all currently loaded pending events */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    const events = event ? [event] : [...this.eventStore.getByFilters(this.filters)];
    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && (isEncryptedContentUnlocked(item) || this.failed.value.has(item.id))) continue;
      this.pending.next(this.pending.value + 1);
      try {
        await firstValueFrom(this.session.read$(item).pipe(takeUntil(fromEvent(context.signal, "abort"))), {
          defaultValue: undefined,
        });
        context.signal.throwIfAborted();
        const failed = new Set(this.failed.value);
        failed.delete(item.id);
        this.failed.next(failed);
      } catch (error) {
        if (!context.signal.aborted) {
          this.failed.next(new Set([...this.failed.value, item.id]));
          this.report("decrypt", error, item.id);
        }
        if (event || context.signal.aborted) throw error;
      } finally {
        this.pending.next(this.pending.value - 1);
      }
    }
  }

  /** Retries a failed decryption explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
  }

  /** Reconciles a finite history range using negentropy or paginated requests */
  sync$(options: LegacyMessageHistoryOptions = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      if (options.correspondent)
        return this.conversation(options.correspondent).sync$({ ...options, signal: context.signal });
      return syncLegacyMessages$(this.options, this.mailboxes, options, context.signal, (error) =>
        this.report("restore", error),
      );
    });
  }

  /** Loads a finite history range and returns its final reconciliation status */
  async loadHistory(options: LegacyMessageHistoryOptions = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$(options));
  }

  /** Reads decrypted messages with a finite history or live lifetime */
  readMessages$(options: MessageOperationOptions & { history?: boolean } = {}): Observable<NostrEvent> {
    return defer(() => {
      const context = this.context(options);
      return this.session
        .messages$({ ...context, history: options.history ?? false })
        .pipe(takeUntil(fromEvent(context.signal, "abort")), takeUntil(this.destroyed));
    });
  }

  /** Discovers relay support before preparing a send */
  async discover(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<LegacyMessageAvailability> {
    const context = this.context(options);
    return firstValueFrom(this.session.discover$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))));
  }

  /** Prepares encrypted events without publishing them */
  async prepareSend(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedLegacyMessage> {
    const context = this.context(options);
    if (!this.signer?.nip04) throw new Error("Signer does not support this message protocol");
    const signerPubkey = await firstValueFrom(
      defer(() => this.signer!.getPublicKey()).pipe(
        timeout({ first: this.options.actionTimeout ?? 120000 }),
        takeUntil(fromEvent(context.signal, "abort")),
      ),
    );
    if (signerPubkey !== this.pubkey) throw new Error("Signer does not match the messages client owner");
    context.signal.throwIfAborted();
    const prepared = await firstValueFrom(
      this.session.prepareSend$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))),
    );
    const setState = (state: "prepared" | "publishing" | "accepted" | "failed") =>
      this.publications.next({ ...this.publications.value, [prepared.message.id]: state });
    setState("prepared");
    return {
      message: prepared.message,
      publish: async (publishOptions = {}) => {
        const publication = this.context(publishOptions);
        context.signal.throwIfAborted();
        this.sending.next(this.sending.value + 1);
        setState("publishing");
        try {
          const message = await firstValueFrom(
            prepared.publish$(publication).pipe(takeUntil(fromEvent(publication.signal, "abort"))),
          );
          publication.signal.throwIfAborted();
          setState("accepted");
          return message;
        } catch (error) {
          setState("failed");
          this.report("send", error);
          throw error;
        } finally {
          this.sending.next(this.sending.value - 1);
        }
      },
    };
  }

  /** Prepares and publishes a message, retaining the signed event for client-ID retries */
  async send(request: LegacyMessageSendRequest, options: MessageOperationOptions = {}): Promise<NostrEvent> {
    return (await this.prepareSend(request, options)).publish(options);
  }

  /** Replies to a legacy message */
  async reply(
    parent: NostrEvent,
    content: string,
    options: MessageOperationOptions & { expiration?: number } = {},
  ): Promise<NostrEvent> {
    const recipient = getLegacyMessageCorrespondent(parent, this.pubkey);
    if (!recipient) throw new Error("Message does not belong to this owner");
    return this.send(
      {
        recipient,
        content,
        replyTo: parent.id,
        expiration: options.expiration,
      },
      options,
    );
  }
}
