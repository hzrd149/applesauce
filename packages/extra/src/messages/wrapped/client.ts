import { castUser } from "applesauce-common/casts";
import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  getGiftWrapRumor,
  getGiftWrapSeal,
  isGiftWrapUnlocked,
} from "applesauce-common/helpers";
import { WrappedMessagesGroups, WrappedMessagesModel } from "applesauce-common/models";
import {
  kinds,
  mergeRelaySets,
  notifyEventUpdate,
  unixNow,
  type Filter,
  type NostrEvent,
  type Rumor,
} from "applesauce-core/helpers";
import { watchEventsUpdates } from "applesauce-core/observable";
import { createSyncLoader } from "applesauce-loaders/loaders";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  firstValueFrom,
  fromEvent,
  isObservable,
  lastValueFrom,
  map,
  Observable,
  of,
  ReplaySubject,
  shareReplay,
  startWith,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  timeout,
} from "rxjs";
import { restoreMessageContent } from "../common/encryption.js";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";
import { configured$, settle } from "../common/helpers.js";
import type { MessageClientError, MessageOperationOptions, MessagesRelayStatus } from "../common/types.js";
import type {
  WrappedMessageAvailability,
  WrappedMessageHistoryOptions,
  WrappedMessageSendRequest,
  WrappedMessagesClientOptions,
  WrappedMessagesSyncStatus,
  PreparedWrappedMessage,
} from "./types.js";
import { WrappedMessageSession } from "./session.js";

const TWO_DAYS = 2 * 24 * 60 * 60;

/** An account-scoped NIP-17 inbox with per-recipient gift wraps and resumable publication */
export class WrappedMessagesClient {
  /** The immutable owner pubkey */
  readonly pubkey: string;
  /** The shared event store containing encrypted envelopes */
  readonly eventStore;
  /** The shared relay pool */
  readonly pool;
  /** The account signer */
  readonly signer;
  /** The validated, deduplicated kind-14 rumors */
  readonly messages$: Observable<Rumor[]>;
  /** The conversations discovered after decryption */
  readonly conversations$: Observable<{ id: string; participants: string[]; lastMessage: Rumor }[]>;
  /** The owner's read relays */
  readonly relays$: Observable<string[]>;
  /** The inbox relay connection states */
  readonly relayStatus$: Observable<MessagesRelayStatus[]>;
  /** The owner's encrypted gift wraps */
  readonly giftWraps$: Observable<NostrEvent[]>;
  /** The pending, unlocked and failed decryption counts */
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
  private readonly syncState = new BehaviorSubject<WrappedMessagesSyncStatus | undefined>(undefined);
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
  private readonly session: WrappedMessageSession;
  private readonly authentication: MessageAuthentication;
  /** The pending relay authentication requests */
  readonly authRequests$;
  private readonly inboxFilter: Filter;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;

  /** Creates a stopped wrapped client using shared application dependencies */
  constructor(private readonly options: WrappedMessagesClientOptions) {
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
    this.session = new WrappedMessageSession(options, owner, (error, event) => this.report("decrypt", error, event.id));

    const user = castUser(this.pubkey, this.eventStore);
    const fallback$ = configured$(options.fallbackRelays, []).pipe(catchError(() => of([])));
    this.relays$ = combineLatest([user.directMessageRelays$.pipe(startWith(undefined)), fallback$]).pipe(
      map(([advertised, fallback]) => mergeRelaySets(advertised?.length ? advertised : fallback)),
      // Stable normalized sets keep unrelated store updates from restarting network work.
      map((relays) => relays.sort()),
      distinctUntilChanged((a, b) => a.join() === b.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.inboxFilter = { kinds: [kinds.GiftWrap], "#p": [this.pubkey] };
    this.giftWraps$ = this.eventStore.timeline(this.inboxFilter).pipe(watchEventsUpdates(this.eventStore));
    this.relayStatus$ = combineLatest([this.relays$, this.pool.status$ ?? of({})]).pipe(
      map(([relays, connections]) => relays.map((url) => ({ url, connection: connections[url] }))),
    );
    this.messages$ = this.eventStore.model(WrappedMessagesModel, this.pubkey);
    this.conversations$ = this.eventStore.model(WrappedMessagesGroups, this.pubkey);
    this.decryptionState$ = combineLatest([this.giftWraps$, this.failed, this.pending]).pipe(
      map(([events, failed, pending]) => ({
        total: events.length,
        unlocked: events.filter(isGiftWrapUnlocked).length,
        locked: events.filter((event) => !isGiftWrapUnlocked(event) && !failed.has(event.id)).length,
        failed: [...failed],
        pending,
      })),
    );
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

  /** Returns decrypted messages for a participant set or conversation identifier */
  conversation$(participants: string | string[]): Observable<Rumor[]> {
    const id = createConversationIdentifier(this.pubkey, getConversationParticipants(participants));
    return this.messages$.pipe(
      map((messages) => messages.filter((message) => getConversationIdentifierFromMessage(message) === id)),
    );
  }

  /** Starts cache restoration, recent history reconciliation and live inbox loading */
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
          .filters(this.inboxFilter)
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
                ? this.eventStore.filters(this.inboxFilter).pipe(
                    concatMap((event) =>
                      defer(async () => {
                        if (context.signal.aborted || isGiftWrapUnlocked(event) || this.failed.value.has(event.id))
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
      background.add(
        this.relays$
          .pipe(
            switchMap((relays) =>
              relays.length
                ? withMessageAuth$(this.options, (auth) =>
                    this.pool.subscription(
                      relays,
                      { ...this.inboxFilter, since: Math.max(0, since - TWO_DAYS) },
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
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (!this.disposed) this.lifecycle.next("idle");
  }

  /** Permanently releases this client's subscriptions and retained envelopes */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.session.close();
    this.destroyed.next();
    this.destroyed.complete();
    this.lifecycle.next("disposed");
    this.publications.next({});
  }

  /** Enables or disables signer-backed decryption of arriving envelopes */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
  }

  private async hydrate(signal: AbortSignal) {
    if (!this.options.cacheRequest) return;
    // CacheRequest may return either a promise or an observable of events.
    await lastValueFrom(
      defer(() => {
        signal.throwIfAborted();
        const result = this.options.cacheRequest!([this.inboxFilter]);
        return isObservable(result) ? result : Promise.resolve(result);
      }).pipe(
        timeout({ each: this.options.timeout ?? 4000 }),
        tap((value) => {
          signal.throwIfAborted();
          for (const event of Array.isArray(value) ? value : [value]) this.eventStore.add(event);
        }),
        takeUntil(fromEvent(signal, "abort")),
        catchError((error) => {
          if (!signal.aborted) this.report("restore", error);
          return EMPTY;
        }),
      ),
      { defaultValue: undefined },
    );
  }

  private async restore(event: NostrEvent) {
    await restoreMessageContent(event, this.options.decryptionCache);
    const seal = getGiftWrapSeal(event);
    if (seal) await restoreMessageContent(seal, this.options.decryptionCache);
    if (getGiftWrapRumor(event)) notifyEventUpdate(event);

    // Restored plaintext must also contribute to optional conversation lifetime mirroring.
    if (this.options.mirrorExpiration && isGiftWrapUnlocked(event)) {
      await firstValueFrom(this.session.read$(event), { defaultValue: undefined });
    }
  }

  /** Decrypts one envelope or all currently loaded pending envelopes */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    const events = event ? [event] : [...this.eventStore.getByFilters(this.inboxFilter)];
    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && (isGiftWrapUnlocked(item) || this.failed.value.has(item.id))) continue;
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

  /** Retries a failed envelope explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
  }

  /** Reconciles inbox history with randomized-timestamp overlap */
  sync$(options: WrappedMessageHistoryOptions = {}): Observable<WrappedMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      const sync = createSyncLoader({ pool: this.pool, eventStore: this.eventStore });
      return defer(async () => {
        await this.hydrate(context.signal);
        context.signal.throwIfAborted();
        return settle(this.relays$.pipe(filter((relays) => relays.length > 0)), [], this.options.timeout ?? 4000);
      }).pipe(
        switchMap((relays) => {
          const filter: Filter = { ...this.inboxFilter, since: Math.max(0, (options.since ?? 0) - TWO_DAYS) };
          if (options.until !== undefined) filter.until = options.until;
          return withMessageAuth$(
            this.options,
            (auth) =>
              sync({
                relays,
                filter,
                ...auth,
              }).status$,
          );
        }),
        map((mailbox) => ({ mailboxes: [mailbox], done: mailbox.done, loaded: mailbox.loaded })),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Loads a finite inbox range; conversations are filtered locally after decryption */
  async loadHistory(options: WrappedMessageHistoryOptions = {}): Promise<WrappedMessagesSyncStatus> {
    return lastValueFrom(this.sync$(options));
  }

  /** Reads decrypted messages with a finite history or live lifetime */
  readMessages$(options: MessageOperationOptions & { history?: boolean } = {}): Observable<Rumor> {
    return defer(() => {
      const context = this.context(options);
      return this.session
        .messages$({ ...context, history: options.history ?? false })
        .pipe(takeUntil(fromEvent(context.signal, "abort")), takeUntil(this.destroyed));
    });
  }

  /** Discovers kind-10050 relays for every participant, including the owner */
  async discover(
    request: WrappedMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<WrappedMessageAvailability> {
    const context = this.context(options);
    return firstValueFrom(this.session.discover$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))));
  }

  /** Prepares every encrypted envelope without publishing */
  async prepareSend(
    request: WrappedMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedWrappedMessage> {
    const context = this.context(options);
    if (!this.signer?.nip44) throw new Error("Signer does not support this message protocol");
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
      get publications() {
        return prepared.publications;
      },
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

  /** Publishes one envelope per participant and retains failed envelopes for retry */
  async send(request: WrappedMessageSendRequest, options: MessageOperationOptions = {}): Promise<Rumor> {
    return (await this.prepareSend(request, options)).publish(options);
  }

  /** Replies to every participant in a wrapped conversation */
  async reply(
    parent: Rumor,
    content: string,
    options: MessageOperationOptions & { expiration?: number; envelopeExpiration?: number } = {},
  ): Promise<Rumor> {
    return this.send(
      {
        recipients: getConversationParticipants(parent),
        content,
        replyTo: parent.id,
        expiration: options.expiration,
        envelopeExpiration: options.envelopeExpiration,
      },
      options,
    );
  }
}
