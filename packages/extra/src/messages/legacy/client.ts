import { getLegacyMessageCorrespondent, isValidLegacyMessage, unlockLegacyMessage } from "applesauce-common/helpers";
import { LegacyMessagesGroups } from "applesauce-common/models";
import {
  isEncryptedContentUnlocked,
  isHexKey,
  isPTag,
  mergeRelaySets,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { watchEventsUpdates } from "applesauce-core/observable";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  firstValueFrom,
  fromEvent,
  lastValueFrom,
  map,
  merge,
  Observable,
  of,
  ReplaySubject,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  takeWhile,
  timeout,
} from "rxjs";
import { restoreMessageContent, saveMessageContent } from "../common/encryption.js";
import { settle } from "../common/helpers.js";
import { subscribeThroughStore } from "../common/loading.js";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";
import { createLegacyMailboxes, hydrateLegacyMessages, syncLegacyMessages$, type LegacyMailbox } from "./loading.js";
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

function validateRecipient(request: LegacyMessageSendRequest) {
  if (!isHexKey(request.recipient)) throw new Error("Invalid recipient");
}

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

  private readonly authentication: MessageAuthentication;

  /** The pending relay authentication requests */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly conversations = new Map<string, LegacyConversation>();
  private readonly mailboxes: LegacyMailbox[];
  private readonly pendingDecryptions = new Map<string, Promise<NostrEvent | undefined>>();
  private readonly conversationSubscriptions = new Subscription();

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

    this.mailboxes = createLegacyMailboxes(options);
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((relays) => mergeRelaySets(...relays)),
      distinctUntilChanged((a, b) => a.join() === b.join()),
    );

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = this.eventStore.timeline(this.filters).pipe(watchEventsUpdates(this.eventStore));
    this.relayStatus$ = combineLatest([this.relays$, this.pool.status$ ?? of({})]).pipe(
      map(([relays, connections]) => relays.map((url) => ({ url, connection: connections[url] }))),
    );

    this.conversations$ = this.eventStore.model(LegacyMessagesGroups, this.pubkey);

    // Combine store contents with operation counters so failures remain visible.
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

  private get relayTimeout() {
    return this.options.timeout ?? 4000;
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
    if (!isHexKey(correspondent)) throw new Error("Invalid correspondent");
    let conversation = this.conversations.get(correspondent);
    if (!conversation || conversation.isDisposed) {
      conversation = new LegacyConversation(this, correspondent, {
        ...this.options,
        autoUnlock: this.autoUnlock.value,
      });
      this.conversations.set(correspondent, conversation);
      this.observeConversation(conversation);
    }

    return conversation;
  }

  // Observe children for their entire lifetime, including sends made while inbox loading is stopped.
  private observeConversation(conversation: LegacyConversation): void {
    const subscriptions = new Subscription();
    this.conversationSubscriptions.add(subscriptions);
    let wasBusy = false;

    subscriptions.add(
      conversation.busy$.pipe(distinctUntilChanged()).subscribe((busy) => {
        this.sending.next(this.sending.value + Number(busy) - Number(wasBusy));
        wasBusy = busy;
      }),
    );
    subscriptions.add(() => {
      if (wasBusy) this.sending.next(this.sending.value - 1);
    });
    subscriptions.add(
      conversation.publications$.subscribe((publications) => {
        this.publications.next({ ...this.publications.value, ...publications });
      }),
    );
    subscriptions.add(
      conversation.errors$.subscribe((error) => {
        if (error.operation === "send") this.errors.next(error);
      }),
    );
    subscriptions.add(
      conversation.status$.subscribe((lifecycle) => {
        if (lifecycle === "disposed") subscriptions.unsubscribe();
      }),
    );
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

      // Restore cached plaintext in order; one failed event must not stop later restores.
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

      // Disabling auto-unlock unsubscribes the current queue; signer work runs sequentially.
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
      // Each mailbox follows its own relay changes and stores events before consumers read them.
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
      // Reconcile history again when relay selection changes, replacing the previous sync.
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
    this.conversationSubscriptions.unsubscribe();
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
  }

  private async decrypt(event: NostrEvent): Promise<NostrEvent | undefined> {
    const { options } = this;
    if (!isValidLegacyMessage(event)) return;
    const isAddressedToOwner = event.tags.some((tag) => isPTag(tag) && tag[1] === this.pubkey);
    if (event.pubkey !== this.pubkey && !isAddressedToOwner) return;

    await restoreMessageContent(event, options.decryptionCache);
    if (!isEncryptedContentUnlocked(event)) {
      if (!this.signer) throw new Error("A signer is required");
      await unlockLegacyMessage(event, this.pubkey, this.signer);
    }
    await saveMessageContent(event, options.decryptionCache);

    return event;
  }

  /** Decrypts one event while sharing outstanding signer calls */
  private read$(event: NostrEvent) {
    return defer(() => {
      let decryption = this.pendingDecryptions.get(event.id);
      if (!decryption) {
        decryption = this.decrypt(event);
        this.pendingDecryptions.set(event.id, decryption);
        // Unresolved signer promises stay shared when an individual reader times out.
        const release = () => this.pendingDecryptions.delete(event.id);
        void decryption.then(release, release);
      }
      return decryption;
    }).pipe(
      timeout({ first: this.options.decryptionTimeout ?? 60000 }),
      filter((message): message is NostrEvent => !!message),
    );
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
        await firstValueFrom(this.read$(item).pipe(takeUntil(fromEvent(context.signal, "abort"))), {
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
      const history = options.history ?? false;
      let active = true;
      const seen = new Set<string>();

      const events$ = merge(
        ...this.mailboxes.map(({ relays$, filter: mailboxFilter }) => {
          const targets$ = history
            ? defer(() => settle(relays$.pipe(filter((relays) => relays.length > 0)), [], this.relayTimeout))
            : relays$;

          return targets$.pipe(
            // Live reads follow relay changes; history reads stop after the EOSE marker.
            switchMap((relays) => {
              const source$ = subscribeThroughStore(this.options, relays, [mailboxFilter]);
              return history ? source$.pipe(takeWhile((event) => event !== "EOSE", true)) : source$;
            }),
          );
        }),
      );

      // Deduplicate overlapping mailboxes before queueing signer prompts.
      return events$.pipe(
        filter((event): event is NostrEvent => event !== "EOSE"),
        filter((event) => {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        }),
        // Preserve arrival order and isolate decryption failures to one event.
        concatMap((event) =>
          defer(() => {
            context.signal.throwIfAborted();
            if (!active) return EMPTY;
            return this.read$(event).pipe(
              catchError((error) => {
                this.report("decrypt", error, event.id);
                return EMPTY;
              }),
            );
          }),
        ),
        // Unsubscription stops queued work; an already-running signer promise may still settle.
        finalize(() => {
          active = false;
        }),
        takeUntil(fromEvent(context.signal, "abort")),
        takeUntil(this.destroyed),
      );
    });
  }

  /** Discovers relay support before preparing a send */
  async discover(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<LegacyMessageAvailability> {
    const context = this.context(options);
    validateRecipient(request);
    return this.conversation(request.recipient).discover(context);
  }

  /** Prepares an encrypted event through its recipient's conversation */
  async prepareSend(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedLegacyMessage> {
    const context = this.context(options);
    validateRecipient(request);
    return this.conversation(request.recipient).prepareSend(request, context);
  }

  /** Prepares and publishes a message through its recipient's conversation */
  async send(request: LegacyMessageSendRequest, options: MessageOperationOptions = {}): Promise<NostrEvent> {
    const context = this.context(options);
    validateRecipient(request);
    return this.conversation(request.recipient).send(request, context);
  }

  /** Replies to a legacy message */
  async reply(
    parent: NostrEvent,
    content: string,
    options: MessageOperationOptions & { expiration?: number } = {},
  ): Promise<NostrEvent> {
    const recipient = getLegacyMessageCorrespondent(parent, this.pubkey);
    if (!recipient) throw new Error("Message does not belong to this owner");
    return this.conversation(recipient).reply(parent, content, {
      ...this.context(options),
      expiration: options.expiration,
    });
  }
}
