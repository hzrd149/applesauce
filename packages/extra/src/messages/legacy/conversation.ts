import { castUser } from "applesauce-common/casts";
import { LegacyMessageFactory } from "applesauce-common/factories";
import { createConversationIdentifier, getLegacyMessageCorrespondent } from "applesauce-common/helpers";
import {
  isEncryptedContentUnlocked,
  isHexKey,
  setEncryptedContentCache,
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
  finalize,
  firstValueFrom,
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
import { restoreMessageContent, saveMessageContent } from "../common/encryption.js";
import { withMessageAuth$ } from "../common/authentication.js";
import { createLegacyMailboxes, syncLegacyMessages$, type LegacyMailbox } from "./loading.js";
import { configured$, settle } from "../common/helpers.js";
import { publishAcceptedMessage } from "../common/publication.js";
import type { MessageClientError, MessageOperationContext, MessageOperationOptions } from "../common/types.js";
import type { LegacyMessagesClient } from "./client.js";
import type {
  LegacyMessageAvailability,
  PreparedLegacyMessage,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
} from "./types.js";

/** A signed message retained for publish retries */
interface LegacyDelivery {
  fingerprint: string;
  event: NostrEvent;
  relays: string[];
  accepted: boolean;
  publishing: boolean;
}

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

  /** Nonterminal conversation loading, decryption, and publication failures */
  readonly errors$ = this.errors.asObservable();

  private readonly autoUnlock: BehaviorSubject<boolean>;
  private readonly failed = new BehaviorSubject<ReadonlySet<string>>(new Set());
  private readonly pending = new BehaviorSubject(0);

  /** The decryption counts and failed event IDs for this conversation */
  readonly decryptionState$;
  private readonly sending = new BehaviorSubject(0);

  /** Whether one or more send operations are in progress */
  readonly busy$ = this.sending.pipe(map((count) => count > 0));

  private readonly publications = new BehaviorSubject<
    Record<string, "prepared" | "publishing" | "accepted" | "failed">
  >({});

  /** The publication states of messages sent during this conversation's lifetime */
  readonly publications$ = this.publications.asObservable();

  private readonly deliveries = new Map<string, LegacyDelivery>();
  private readonly preparing = new Set<string>();
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

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = client.eventStore.timeline(this.filters).pipe(watchEventsUpdates(client.eventStore));

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

  private get relayTimeout() {
    return this.options.timeout ?? 4000;
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

    // Changing auto-unlock replaces the queue while still restoring cached plaintext.
    background.add(
      this.autoUnlock
        .pipe(
          switchMap((autoUnlock) =>
            this.client.eventStore.filters(this.filters).pipe(
              // Serialize cache restoration and signer prompts; skip failures per event.
              concatMap((event) =>
                defer(async () => {
                  await restoreMessageContent(event, this.options.decryptionCache);
                  context.signal.throwIfAborted();
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

    // Each mailbox follows its own relay changes and stores events before consumers read them.
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

    // Restart finite reconciliation only when the combined mailbox relay set changes.
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
    this.deliveries.clear();
    this.preparing.clear();
    this.publications.next({});
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

  /** Returns an outgoing expiration using the newest loaded message lifetime when mirroring is enabled */
  getExpiration(createdAt: number = unixNow()): number | undefined {
    if (!this.options.mirrorExpiration) return;

    let latest: NostrEvent | undefined;
    for (const event of this.client.eventStore.getByFilters(this.filters)) {
      if (
        !latest ||
        event.created_at > latest.created_at ||
        (event.created_at === latest.created_at && event.id < latest.id)
      ) {
        latest = event;
      }
    }
    if (!latest) return;

    const value = latest.tags.find((tag) => tag[0] === "expiration")?.[1];
    const expiration = value && /^\d+$/.test(value) ? Number(value) : NaN;
    const duration = expiration - latest.created_at;
    return Number.isSafeInteger(expiration) && duration > 0 ? createdAt + duration : undefined;
  }

  private fallbackRelays() {
    return settle(configured$(this.options.fallbackRelays, []), [], this.relayTimeout);
  }

  private async deliveryRelays(pubkey: string) {
    const user = castUser(pubkey, this.options.eventStore);
    const [direct, inboxes] = await Promise.all([
      settle(user.directMessageRelays$, undefined, this.relayTimeout),
      settle(user.inboxes$, undefined, this.relayTimeout),
    ]);

    const advertised = mergeRelaySets(direct, inboxes);
    return advertised.length ? advertised : this.fallbackRelays();
  }

  /**
   * Discovers relay support for this correspondent before preparing a send
   * @throws if disposed, cancelled, or the correspondent is invalid
   */
  async discover(options: MessageOperationOptions = {}): Promise<LegacyMessageAvailability> {
    const context = this.context(options);

    const availability$ = defer(async (): Promise<LegacyMessageAvailability> => {
      if (!isHexKey(this.correspondent)) throw new Error("Invalid recipient");
      const user = castUser(this.correspondent, this.options.eventStore);
      const [inboxes, direct, fallback] = await Promise.all([
        settle(user.inboxes$, undefined, this.relayTimeout),
        settle(user.directMessageRelays$, undefined, this.relayTimeout),
        this.fallbackRelays(),
      ]);
      context.signal.throwIfAborted();

      const relays = mergeRelaySets(inboxes, direct);
      return {
        recipient: this.correspondent,
        support: inboxes === undefined ? "unknown" : inboxes.length ? "supported" : "unsupported",
        relays,
        canSend: relays.length > 0 || fallback.length > 0,
        hasFallback: fallback.length > 0,
      };
    });

    return firstValueFrom(availability$.pipe(takeUntil(fromEvent(context.signal, "abort"))));
  }

  /** Signs a legacy event and caches it for client-ID retries without publishing it */
  private prepareDelivery$(request: Omit<LegacyMessageSendRequest, "recipient">, context: MessageOperationContext) {
    const { options } = this;
    return defer(() => {
      // Keep cancellation guards and retry ownership local to this subscription.
      let active = true;
      const key = request.clientMessageId ? JSON.stringify([context.scope, request.clientMessageId]) : undefined;
      const fingerprint = JSON.stringify([this.correspondent, request.content, request.replyTo, request.expiration]);
      let ownsPreparation = false;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || this.disposed) throw new Error("DM protocol operation ended");
      };

      return defer(async (): Promise<LegacyDelivery> => {
        if (!isHexKey(this.correspondent)) throw new Error("Invalid recipient");
        assertCurrent();
        if (key) {
          const previous = this.deliveries.get(key);
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new Error("DM clientMessageId belongs to another message");
            return previous;
          }
          if (this.preparing.has(key)) throw new Error("DM message is already being prepared");
          this.preparing.add(key);
          ownsPreparation = true;
        }

        const recipient = this.correspondent;
        const createdAt = unixNow();
        const expiration = request.expiration ?? this.getExpiration(createdAt);

        let factory = LegacyMessageFactory.create(recipient, request.content).created(createdAt);
        if (request.replyTo) factory = factory.replyTo(request.replyTo);
        if (expiration !== undefined) factory = factory.expiration(expiration);
        const event = await factory.sign(this.options.signer!);
        assertCurrent();

        setEncryptedContentCache(event, request.content);
        if (options.decryptionCache) {
          await saveMessageContent(event, options.decryptionCache);
          assertCurrent();
        }

        const [inboxes, outboxes] = await Promise.all([
          this.deliveryRelays(recipient),
          settle(castUser(this.options.pubkey, this.options.eventStore).outboxes$, [], this.relayTimeout),
        ]);
        assertCurrent();
        const relays = mergeRelaySets(inboxes, outboxes);
        if (!relays.length) throw new Error("No legacy DM relays");

        const delivery: LegacyDelivery = { fingerprint, event, relays, accepted: false, publishing: false };
        if (key) {
          if (this.deliveries.size >= 100) {
            const oldest = [...this.deliveries].find(([, delivery]) => !delivery.publishing);
            if (!oldest) throw new Error("DM retry cache is busy");
            this.deliveries.delete(oldest[0]);
          }
          this.deliveries.set(key, delivery);
        }
        return delivery;
      }).pipe(
        timeout({ first: options.actionTimeout ?? 120000 }),
        // Invalidate late signer results and release preparation ownership on every exit.
        finalize(() => {
          active = false;
          if (key && ownsPreparation) this.preparing.delete(key);
        }),
      );
    });
  }

  /** Publishes a prepared delivery once, returning the event after relay acceptance */
  private publishDelivery$(delivery: LegacyDelivery, context: MessageOperationContext) {
    return defer(async () => {
      context.signal.throwIfAborted();
      if (delivery.publishing) throw new Error("DM message is already being published");
      if (delivery.accepted) return delivery.event;

      delivery.publishing = true;
      try {
        await publishAcceptedMessage(this.options, delivery.relays, delivery.event, context.signal);
        delivery.accepted = true;
        context.signal.throwIfAborted();
        return delivery.event;
      } finally {
        delivery.publishing = false;
      }
    });
  }

  /**
   * Prepares an encrypted event without publishing it
   * @throws if disposed, cancelled, the signer is invalid, or preparation fails
   */
  async prepareSend(
    request: Omit<LegacyMessageSendRequest, "recipient">,
    options: MessageOperationOptions = {},
  ): Promise<PreparedLegacyMessage> {
    const context = this.context(options);
    if (!this.options.signer?.nip04) throw new Error("Signer does not support this message protocol");
    const signerPubkey = await firstValueFrom(
      defer(() => this.options.signer!.getPublicKey()).pipe(
        timeout({ first: this.options.actionTimeout ?? 120000 }),
        takeUntil(fromEvent(context.signal, "abort")),
      ),
    );
    if (signerPubkey !== this.options.pubkey) throw new Error("Signer does not match the messages client owner");
    context.signal.throwIfAborted();

    const delivery = await firstValueFrom(
      this.prepareDelivery$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))),
    );
    const setState = (state: "prepared" | "publishing" | "accepted" | "failed") =>
      this.publications.next({ ...this.publications.value, [delivery.event.id]: state });
    setState("prepared");

    return {
      message: delivery.event,
      publish: async (publishOptions = {}) => {
        const publication = this.context(publishOptions);
        context.signal.throwIfAborted();
        this.sending.next(this.sending.value + 1);
        setState("publishing");

        try {
          const message = await firstValueFrom(
            this.publishDelivery$(delivery, publication).pipe(takeUntil(fromEvent(publication.signal, "abort"))),
          );
          publication.signal.throwIfAborted();
          setState("accepted");
          return message;
        } catch (error) {
          setState("failed");
          this.errors.next({ operation: "send", error, eventId: delivery.event.id });
          throw error;
        } finally {
          this.sending.next(this.sending.value - 1);
        }
      },
    };
  }

  /**
   * Prepares and publishes a message, retaining the signed event for conversation-scoped client-ID retries
   * @throws if preparation or publication fails
   */
  async send(
    request: Omit<LegacyMessageSendRequest, "recipient">,
    options: MessageOperationOptions = {},
  ): Promise<NostrEvent> {
    return (await this.prepareSend(request, options)).publish(options);
  }

  /**
   * Publishes a reply to a message in this conversation
   * @throws if the parent belongs to another conversation or sending fails
   */
  async reply(
    parent: NostrEvent,
    content: string,
    options: MessageOperationOptions & { expiration?: number } = {},
  ): Promise<NostrEvent> {
    if (getLegacyMessageCorrespondent(parent, this.options.pubkey) !== this.correspondent)
      throw new Error("Message does not belong to this conversation");
    return this.send({ content, replyTo: parent.id, expiration: options.expiration }, options);
  }
}
