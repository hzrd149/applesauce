import { createConversationIdentifier, getLegacyMessageCorrespondent } from "applesauce-common/helpers";
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
  fromEvent,
  lastValueFrom,
  map,
  Observable,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  timeout,
} from "rxjs";
import { restoreMessageContent } from "../common/encryption.js";
import { withMessageAuth$ } from "../common/authentication.js";
import { createLegacyMailboxes, syncLegacyMessages$, type LegacyMailbox } from "./loading.js";
import type { MessageClientError, MessageOperationOptions } from "../common/types.js";
import type { LegacyMessagesClient } from "./client.js";
import type {
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
} from "./types.js";

/** An independently loaded NIP-04 conversation belonging to one fixed-account client */
export class LegacyConversation {
  /** The stable conversation identifier */
  readonly id: string;
  /** The native incoming and outgoing kind-4 events in the shared store */
  readonly messages$: Observable<NostrEvent[]>;
  /** The relays used for incoming and outgoing messages */
  readonly relays$: Observable<string[]>;
  private readonly lifecycle = new BehaviorSubject<"idle" | "loading" | "ready" | "disposed">("idle");
  /** The conversation loading lifecycle */
  readonly status$ = this.lifecycle.asObservable();
  private readonly syncState = new BehaviorSubject<LegacyMessagesSyncStatus | undefined>(undefined);
  /** The latest conversation history reconciliation progress */
  readonly syncStatus$ = this.syncState.asObservable();
  private readonly errors = new Subject<MessageClientError>();
  /** Nonterminal conversation loading and decryption failures */
  readonly errors$ = this.errors.asObservable();
  private readonly autoUnlock: BehaviorSubject<boolean>;
  private readonly failed = new BehaviorSubject<ReadonlySet<string>>(new Set());
  private readonly pending = new BehaviorSubject(0);
  /** The decryption counts and failed event IDs for this conversation */
  readonly decryptionState$;
  private readonly mailboxes: LegacyMailbox[];
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;

  /** Whether this conversation has been permanently released */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Creates a stopped conversation using its owner's shared dependencies */
  constructor(
    /** The fixed-account client owning this conversation */
    readonly client: LegacyMessagesClient,
    /** The other participant, or the owner for self-messages */
    readonly correspondent: string,
    private readonly options: LegacyMessagesClientOptions,
  ) {
    this.id = createConversationIdentifier(client.pubkey, [correspondent]);
    this.autoUnlock = new BehaviorSubject(options.autoUnlock ?? false);
    this.mailboxes = createLegacyMailboxes(options, correspondent);
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((lists) => mergeRelaySets(...lists)),
    );
    this.messages$ = client.eventStore.timeline(this.filters).pipe(watchEventsUpdates(client.eventStore));
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

  private context(options: MessageOperationOptions = {}) {
    if (this.disposed) throw new Error("Conversation disposed");
    const signal = options.signal ? AbortSignal.any([options.signal, this.generation.signal]) : this.generation.signal;
    signal.throwIfAborted();
    return { ...options, signal };
  }

  /** Starts recent conversation history and live loading without starting the client's inbox */
  async start(): Promise<void> {
    const context = this.context();
    if (this.background) return;
    const background = (this.background = new Subscription());
    this.lifecycle.next("loading");
    const since = unixNow() - (this.options.historySpan ?? 30 * 86400);
    background.add(
      this.autoUnlock
        .pipe(
          switchMap((autoUnlock) =>
            this.client.eventStore.filters(this.filters).pipe(
              concatMap((event) =>
                defer(async () => {
                  await restoreMessageContent(event, this.options.decryptionCache);
                  context.signal.throwIfAborted();
                  if (this.options.mirrorExpiration && isEncryptedContentUnlocked(event))
                    await this.client.unlock(event, context);
                  if (autoUnlock && !isEncryptedContentUnlocked(event) && !this.failed.value.has(event.id))
                    await this.unlock(event, context);
                }).pipe(
                  timeout({ first: this.options.decryptionTimeout ?? 60000 }),
                  catchError((error) => {
                    this.errors.next({ operation: "restore", error, eventId: event.id });
                    return EMPTY;
                  }),
                ),
              ),
            ),
          ),
        )
        .subscribe(),
    );
    for (const mailbox of this.mailboxes) {
      background.add(
        mailbox.relays$
          .pipe(
            switchMap((relays) =>
              relays.length
                ? withMessageAuth$(this.options, (auth) =>
                    this.client.pool.subscription(
                      relays,
                      { ...mailbox.filter, since },
                      {
                        eventStore: this.client.eventStore,
                        reconnect: true,
                        ...auth,
                      },
                    ),
                  ).pipe(
                    catchError((error) => {
                      this.errors.next({ operation: "read", error });
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
          distinctUntilChanged((previous, next) => previous.join() === next.join()),
          switchMap(() =>
            this.sync$({ since }).pipe(
              catchError((error) => {
                this.errors.next({ operation: "sync", error });
                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe((progress) => {
          if (progress.done) this.lifecycle.next("ready");
        }),
    );
  }

  /** Stops only this conversation's loading and outstanding operations */
  stop(): void {
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (!this.disposed) this.lifecycle.next("idle");
  }

  /** Permanently releases this conversation without disposing the shared store or pool */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.lifecycle.next("disposed");
  }

  /** Releases this conversation through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed decryption for this conversation */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
  }

  /** Reconciles only this conversation's cache and relay history */
  sync$(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      return syncLegacyMessages$(this.options, this.mailboxes, options, context.signal, (error) => {
        this.errors.next({ operation: "restore", error });
      }).pipe(
        tap((progress) => this.syncState.next(progress)),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Loads a finite conversation history range */
  loadHistory(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$(options));
  }

  /** Decrypts one event or all currently loaded pending events in this conversation */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    if (event && getLegacyMessageCorrespondent(event, this.client.pubkey) !== this.correspondent)
      throw new Error("Message does not belong to this conversation");
    const events = event ? [event] : [...this.client.eventStore.getByFilters(this.filters)];
    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && (isEncryptedContentUnlocked(item) || this.failed.value.has(item.id))) continue;
      this.pending.next(this.pending.value + 1);
      try {
        await this.client.unlock(item, context);
        const failed = new Set(this.failed.value);
        failed.delete(item.id);
        this.failed.next(failed);
      } catch (error) {
        if (!context.signal.aborted) {
          this.failed.next(new Set([...this.failed.value, item.id]));
          this.errors.next({ operation: "decrypt", error, eventId: item.id });
        }
        if (event || context.signal.aborted) throw error;
      } finally {
        this.pending.next(this.pending.value - 1);
      }
    }
  }

  /** Prepares a signed event addressed to this correspondent */
  prepareSend(request: Omit<LegacyMessageSendRequest, "recipient">, options: MessageOperationOptions = {}) {
    return this.client
      .prepareSend({ ...request, recipient: this.correspondent }, this.context(options))
      .then((prepared) => ({
        message: prepared.message,
        publish: (publishOptions: MessageOperationOptions = {}) => prepared.publish(this.context(publishOptions)),
      }));
  }

  /** Publishes a message to this correspondent */
  send(
    request: Omit<LegacyMessageSendRequest, "recipient">,
    options: MessageOperationOptions = {},
  ): Promise<NostrEvent> {
    return this.client.send({ ...request, recipient: this.correspondent }, this.context(options));
  }
}
