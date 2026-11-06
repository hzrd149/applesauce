import { logger } from "applesauce-core";
import type { TimelineLoader, TimelineLoaderOptions } from "applesauce-loaders/loaders";
import { ConversationDraftState } from "../common/drafts.js";
import { castUser } from "applesauce-common/casts";
import { LegacyMessageFactory } from "applesauce-common/factories";
import { createConversationIdentifier, getLegacyMessageCorrespondent } from "applesauce-common/helpers";
import {
  restoreEncryptedContent,
  saveEncryptedContent,
  isEncryptedContentFromCache,
  addSeenRelay,
  isHexKey,
  verifyEvent,
  kinds,
  setEncryptedContentCache,
  mergeRelaySets,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  BehaviorSubject,
  concatMap,
  take,
  ignoreElements,
  of,
  distinctUntilChanged,
  combineLatest,
  defer,
  filter,
  finalize,
  firstValueFrom,
  from,
  fromEvent,
  map,
  merge,
  Observable,
  Subject,
  ReplaySubject,
  share,
  shareReplay,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs";
import { withMessageAuth$ } from "../common/authentication.js";
import { configured$, withFallback$ } from "../common/helpers.js";
import type { MessageDraft, MessageClientError, MessageOperationOptions } from "../common/types.js";
import type { LegacyMessagesClient } from "./client.js";
import { LegacyConversationReceiver } from "./conversation-receiver.js";
import type {
  LegacyDecryptionState,
  LegacyPublicationReference,
  LegacyPublicationState,
  LegacyMessageAvailability,
  PreparedLegacyMessage,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
  LegacyReceiverError,
} from "./types.js";

const log = logger.extend("LegacyMessages");

/** A serializable signed legacy message retained for publication */
interface StoredLegacyPublication {
  /** The preparation timestamp in seconds */
  preparedAt: number;
  /** The native encrypted and signed kind-4 event */
  event: NostrEvent;
  /** The publication target relays */
  relays: string[];
}

function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["ws:", "wss:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Maps a receiver failure to a conversation error, dropping decryption failures already reported by decryptionState$ */
function toConversationError(error: LegacyReceiverError): MessageClientError | undefined {
  if (error.operation === "decrypt") return undefined;

  const operation = error.operation === "cache" ? "restore" : error.operation;
  return error.eventId ? { operation, error: error.error, eventId: error.eventId } : { operation, error: error.error };
}

/** A signed message retained for publish retries */
interface LegacyDelivery extends StoredLegacyPublication {
  state: BehaviorSubject<LegacyPublicationState>;
  // This mutex outlives cancelled readers until uncancellable relay work settles.
  publishing: boolean;
  removing?: boolean;
  durable: boolean;
  handle?: { value: PreparedLegacyMessage; generation: AbortSignal };
}

/** An independently loaded NIP-04 conversation belonging to one fixed-account client */
export class LegacyConversation {
  /** The stable conversation identifier */
  readonly id: string;

  /** The receiver loading and decrypting this conversation from both participants' relays */
  readonly receiver: LegacyConversationReceiver;

  private readonly drafts: ConversationDraftState;
  /** The current plaintext draft, restored from storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;

  /** The native incoming and outgoing kind-4 events in the shared store */
  readonly messages$: Observable<NostrEvent[]>;

  /** The newest in-memory or cached message, restoring cached plaintext without relay requests or signer prompts */
  readonly lastMessage$: Observable<NostrEvent | undefined>;

  /** The relays used for incoming and outgoing messages */
  readonly relays$: Observable<string[]>;
  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");

  /** The explicit start/stop lifecycle, independent of subscription-owned watchers and history success */
  readonly lifecycle$ = this.lifecycle.asObservable();

  private readonly errors = new Subject<MessageClientError>();

  /** Nonterminal conversation loading, cache restoration, and storage failures */
  readonly errors$: Observable<MessageClientError>;

  /** Whether this conversation's stored messages are automatically unlocked, disabled by default */
  readonly autoUnlock$: Observable<boolean>;

  /** The current decryption snapshot for loaded conversation messages */
  readonly decryptionState$: Observable<LegacyDecryptionState>;
  private readonly sending = new BehaviorSubject(0);

  /** Whether message preparation or publication is active, excluding pending messages awaiting retry */
  readonly sending$ = this.sending.asObservable().pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
  );

  private readonly pendingPublications = new BehaviorSubject<readonly PreparedLegacyMessage[]>([]);
  private readonly publicationDestroyed = new ReplaySubject<void>(1);
  /** The unpublished messages, restored on subscription without publishing or starting message loading */
  readonly pendingPublications$ = defer(() => this.loadPublications()).pipe(
    switchMap(() => this.pendingPublications.asObservable()),
    takeUntil(this.publicationDestroyed),
  );
  // Terminal records remain owned for ID lookup; only durable entries are written to storage.
  private readonly deliveries = new Map<string, LegacyDelivery>();
  private readonly preparedHandles = new WeakMap<
    PreparedLegacyMessage,
    { delivery: LegacyDelivery; generation: AbortSignal }
  >();
  private publicationOperations: Promise<unknown> = Promise.resolve();
  private publicationsLoaded = false;
  /** Watches live arrivals and processes stored plaintext while subscribed, sharing work with start() and other watchers */
  readonly watch$: Observable<never>;
  /** The configured fallback relays, shared by delivery and discovery */
  private readonly fallbackRelays$: Observable<string[]>;
  /** The correspondent's advertised delivery relays, or the fallback relays when none are advertised */
  private readonly deliveryRelays$: Observable<string[]>;
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
    this.drafts = new ConversationDraftState(`draft:${this.id}`, options.draftStorage);
    this.draft$ = this.drafts.draft$;

    this.receiver = new LegacyConversationReceiver({
      pubkey: client.pubkey,
      correspondent,
      eventStore: options.eventStore,
      pool: options.pool,
      decryptor: client.receiver.decryptor,
      authOptions: client.receiver.authOptions,
      cacheRequest: options.cacheRequest,
      decryptionCache: options.decryptionCache,
      fallbackRelays: options.fallbackRelays,
      autoUnlock: options.autoUnlock,
      timeout: options.timeout,
      historySpan: options.historySpan,
    });

    this.messages$ = this.receiver.messages$;
    this.lastMessage$ = this.receiver.lastMessage$;
    this.relays$ = this.receiver.relays$;
    this.autoUnlock$ = this.receiver.autoUnlock$;
    this.decryptionState$ = this.receiver.decryptionState$;
    this.watch$ = this.receiver.watch$.pipe(ignoreElements(), share());

    this.fallbackRelays$ = withFallback$(configured$(options.fallbackRelays, []), [], this.relayTimeout).pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const recipient = castUser(correspondent, options.eventStore);
    this.deliveryRelays$ = combineLatest([
      withFallback$(recipient.directMessageRelays$, undefined, this.relayTimeout),
      withFallback$(recipient.inboxes$, undefined, this.relayTimeout),
    ]).pipe(
      map(([direct, inboxes]) => mergeRelaySets(direct, inboxes)),
      switchMap((advertised) => (advertised.length ? of(advertised) : this.fallbackRelays$)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const receiverErrors$ = this.receiver.errors$.pipe(
      map(toConversationError),
      filter((error): error is MessageClientError => error !== undefined),
    );
    this.errors$ = merge(this.errors, receiverErrors$);
  }

  private get relayTimeout() {
    return this.options.timeout ?? 4000;
  }

  private get filters() {
    return this.receiver.filters;
  }

  /**
   * Restores the saved draft without starting message loading
   * @throws if disposed, storage fails, or the saved draft is invalid
   */
  loadDraft(): Promise<Readonly<MessageDraft> | undefined> {
    return this.drafts.load();
  }

  /**
   * Saves the conversation's plaintext draft before notifying subscribers
   * @throws if disposed, the draft is invalid, or storage fails
   */
  setDraft(draft: MessageDraft): Promise<void> {
    return this.drafts.set(draft);
  }

  /**
   * Removes the conversation's saved draft before notifying subscribers
   * @throws if disposed or storage fails
   */
  clearDraft(): Promise<void> {
    return this.drafts.clear();
  }

  private context(options: MessageOperationOptions = {}) {
    if (this.disposed) throw new Error("Conversation disposed");
    const signal = options.signal ? AbortSignal.any([options.signal, this.generation.signal]) : this.generation.signal;
    signal.throwIfAborted();

    return { ...options, signal };
  }

  /**
   * Starts live loading and stored plaintext processing without reconciling history or starting the client's inbox
   * @throws if the conversation is disposed
   */
  async start(): Promise<void> {
    this.context();
    if (this.lifecycle.value === "running") return;

    this.lifecycle.next("running");
    this.receiver.start();
  }

  /** Stops only this conversation's loading and outstanding operations */
  stop(): void {
    this.generation.abort();
    this.generation = new AbortController();
    this.emitPendingPublications();
    this.receiver.stop();

    if (!this.disposed && this.lifecycle.value !== "idle") this.lifecycle.next("idle");
  }

  /** Permanently releases this conversation without disposing the shared store or pool */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.drafts.dispose();
    this.stop();
    this.receiver.dispose();
    this.publicationDestroyed.next();
    this.publicationDestroyed.complete();
    this.pendingPublications.next([]);
    this.pendingPublications.complete();
    for (const delivery of this.deliveries.values()) delivery.state.complete();
    this.deliveries.clear();
    this.lifecycle.next("disposed");
  }

  /** Releases this conversation through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed decryption for this conversation */
  setAutoUnlock(enabled: boolean): void {
    this.receiver.setAutoUnlock(enabled);
  }

  /**
   * Creates an independent viewport loader whose subscriptions stop with this conversation
   * @throws if the conversation is disposed or timeline options are invalid
   */
  createTimelineLoader(options: Omit<TimelineLoaderOptions, "eventStore" | "cache"> = {}): TimelineLoader {
    this.context();
    return this.receiver.createTimelineLoader(options);
  }

  /** Reconciles this conversation's history while following mailbox relay changes by default */
  sync$(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      return this.receiver.sync$({ ...options, signal: context.signal });
    });
  }

  /** Loads a finite conversation history range */
  loadHistory(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Promise<LegacyMessagesSyncStatus> {
    return this.receiver.loadHistory({ ...options, signal: this.context(options).signal });
  }

  /** Decrypts one event or all currently loaded pending events in this conversation */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    await this.receiver.unlock(event, context);
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

  private enqueuePublication<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Conversation disposed"));

    const result = this.publicationOperations.then(async () => {
      this.context();
      return operation();
    });
    // Keep subsequent writes usable after a storage failure.
    this.publicationOperations = result.catch(() => undefined);
    return result;
  }

  private emitPendingPublications(): void {
    if (this.disposed) return;
    this.pendingPublications.next(
      [...this.deliveries.values()]
        .filter((delivery) => !["accepted", "discarded"].includes(delivery.state.value.status))
        .map((delivery) => this.preparedDelivery(delivery)),
    );
  }

  private async restorePublications(): Promise<void> {
    if (this.publicationsLoaded) return;
    const serialized = await this.options.publicationStorage?.getItem(`publication:${this.id}`);
    this.context();
    const restored: LegacyDelivery[] =
      serialized == null
        ? []
        : this.parsePublications(serialized).map((entry) => ({
            ...entry,
            state: new BehaviorSubject<LegacyPublicationState>({ status: "prepared" }),
            publishing: false,
            durable: true,
          }));
    // Validate the complete record before making any restored handle available.
    for (const delivery of restored) {
      if (this.options.decryptionCache) {
        await restoreEncryptedContent(delivery.event, this.options.decryptionCache).catch((error) => {
          log("Failed to restore encrypted content for %s", delivery.event.id, error);
        });
      }
      this.context();
    }
    for (const delivery of restored) {
      this.deliveries.set(delivery.event.id, delivery);
    }
    this.publicationsLoaded = true;
    this.emitPendingPublications();
  }

  private async writePublications(deliveries: Map<string, LegacyDelivery>): Promise<void> {
    const storage = this.options.publicationStorage;
    if (!storage) return;
    const key = `publication:${this.id}`;
    const retained = [...deliveries.values()].filter((delivery) => delivery.durable);
    if (!retained.length) {
      await storage.removeItem(key);
      return;
    }
    const messages = retained.map((delivery) => ({
      event: delivery.event,
      relays: delivery.relays,
      preparedAt: delivery.preparedAt,
    }));
    await storage.setItem(key, JSON.stringify({ version: 1, messages }));
  }

  private parsePublications(serialized: string): StoredLegacyPublication[] {
    const record = JSON.parse(serialized);
    if (record?.version !== 1 || !Array.isArray(record.messages))
      throw new Error("Invalid conversation publication record");

    const publications: StoredLegacyPublication[] = [];
    const eventIds = new Set<string>();
    for (const entry of record.messages) {
      if (!entry || typeof entry !== "object") throw new Error("Invalid conversation publication entry");
      if (
        !Number.isSafeInteger(entry.preparedAt) ||
        entry.preparedAt < 0 ||
        !Array.isArray(entry.relays) ||
        !entry.relays.length ||
        !entry.relays.every(isRelayUrl)
      )
        throw new Error("Invalid conversation publication metadata");

      const event = entry.event;
      if (
        !event ||
        event.kind !== kinds.EncryptedDirectMessage ||
        event.pubkey !== this.client.pubkey ||
        getLegacyMessageCorrespondent(event, this.client.pubkey) !== this.correspondent ||
        !verifyEvent(event)
      )
        throw new Error("Invalid conversation publication event");
      if (eventIds.has(event.id)) throw new Error("Duplicate conversation publication entry");

      eventIds.add(event.id);
      publications.push({
        preparedAt: entry.preparedAt,
        event,
        relays: entry.relays,
      });
    }
    return publications;
  }

  /**
   * Restores unpublished signed events and returns handles that can publish without signing again
   * @throws if disposed, reading fails, or a saved publication is invalid
   */
  loadPublications(): Promise<readonly PreparedLegacyMessage[]> {
    return this.enqueuePublication(async () => {
      await this.restorePublications();
      this.emitPendingPublications();
      return this.pendingPublications.value;
    });
  }

  /**
   * Discards an unpublished message after removing its durable record, retaining its terminal state in memory
   * @throws if disposed, the reference is unknown, foreign or stale, publication is active, or storage fails
   */
  discardPublication(reference: LegacyPublicationReference): Promise<void> {
    return this.enqueuePublication(async () => {
      const delivery = await this.resolvePublication(reference);
      if (delivery.publishing) throw new Error("DM message is already being published");
      if (["accepted", "discarded"].includes(delivery.state.value.status)) return;
      // Prevent publication from starting while removal is waiting on storage.
      delivery.removing = true;
      try {
        const next = new Map(this.deliveries);
        next.delete(delivery.event.id);
        await this.writePublications(next);
        delivery.durable = false;
        delivery.state.next({ status: "discarded" });
        this.emitPendingPublications();
      } finally {
        delivery.removing = false;
      }
    });
  }

  private async removeAcceptedPublication(delivery: LegacyDelivery): Promise<void> {
    if (!delivery.durable) return;
    await this.enqueuePublication(async () => {
      const next = new Map(this.deliveries);
      next.delete(delivery.event.id);
      await this.writePublications(next);
      delivery.durable = false;
    });
  }

  /** Observes relay support and follows changes to advertised and fallback relays */
  discover$(options: MessageOperationOptions = {}): Observable<LegacyMessageAvailability> {
    return defer(() => {
      const context = this.context(options);
      if (!isHexKey(this.correspondent)) throw new Error("Invalid recipient");

      const user = castUser(this.correspondent, this.options.eventStore);
      return combineLatest([
        withFallback$(user.inboxes$, undefined, this.relayTimeout),
        withFallback$(user.directMessageRelays$, undefined, this.relayTimeout),
        this.fallbackRelays$,
      ]).pipe(
        map(([inboxes, direct, fallback]): LegacyMessageAvailability => {
          const relays = mergeRelaySets(inboxes, direct);
          return {
            recipient: this.correspondent,
            support: inboxes === undefined ? "unknown" : inboxes.length ? "supported" : "unsupported",
            relays,
            canSend: relays.length > 0 || fallback.length > 0,
            hasFallback: fallback.length > 0,
          };
        }),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /**
   * Discovers relay support for this correspondent before preparing a send
   * @throws if disposed, cancelled, or the correspondent is invalid
   */
  discover(options: MessageOperationOptions = {}): Promise<LegacyMessageAvailability> {
    return firstValueFrom(this.discover$(options));
  }

  /** Signs a new legacy event and saves it for publication */
  private prepareDelivery$(request: Omit<LegacyMessageSendRequest, "recipient">, context: { signal: AbortSignal }) {
    const { options } = this;
    return defer(() => {
      // Keep cancellation guards local to this preparation.
      let active = true;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || this.disposed) throw new Error("DM protocol operation ended");
      };

      return defer(async (): Promise<NostrEvent> => {
        if (!isHexKey(this.correspondent)) throw new Error("Invalid recipient");
        assertCurrent();
        await this.loadPublications();
        assertCurrent();
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
          if (options.decryptionCache && !isEncryptedContentFromCache(event)) {
            await saveEncryptedContent(event, options.decryptionCache).catch((error) => {
              log("Failed to persist encrypted content for %s", event.id, error);
            });
          }
          assertCurrent();
        }

        return event;
      }).pipe(
        concatMap((event) =>
          combineLatest([
            this.deliveryRelays$,
            withFallback$(castUser(this.options.pubkey, this.options.eventStore).outboxes$, [], this.relayTimeout),
          ]).pipe(
            // Freeze publication targets once; relay updates must not sign or persist another message.
            take(1),
            concatMap(async ([inboxes, outboxes]): Promise<LegacyDelivery> => {
              assertCurrent();
              const relays = mergeRelaySets(inboxes, outboxes);
              if (!relays.length) throw new Error("No legacy DM relays");

              const delivery: LegacyDelivery = {
                preparedAt: unixNow(),
                event,
                relays,
                state: new BehaviorSubject<LegacyPublicationState>({ status: "prepared" }),
                publishing: false,
                durable: true,
              };
              await this.enqueuePublication(async () => {
                assertCurrent();
                const next = new Map(this.deliveries);
                next.set(event.id, delivery);
                await this.writePublications(next);
                // A completed durable write remains pending even if its caller was cancelled while writing.
                if (!this.disposed) {
                  this.deliveries.set(event.id, delivery);
                  this.emitPendingPublications();
                }
              });
              assertCurrent();
              return delivery;
            }),
          ),
        ),
        timeout({ first: options.actionTimeout ?? 120000 }),
        // Invalidate late signer results when preparation ends.
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  private async cleanupAcceptedPublication(delivery: LegacyDelivery): Promise<void> {
    try {
      await this.removeAcceptedPublication(delivery);
    } catch (error) {
      if (!this.disposed) this.errors.next({ operation: "storage", error, eventId: delivery.event.id });
    }
  }

  /** Publishes a prepared delivery once, returning the event after relay acceptance */
  private publishDelivery$(delivery: LegacyDelivery, context: { signal: AbortSignal }) {
    return defer(async () => {
      context.signal.throwIfAborted();
      if (delivery.state.value.status === "discarded" || delivery.removing) throw new Error("DM publication discarded");
      if (delivery.publishing) throw new Error("DM message is already being published");
      if (delivery.state.value.status === "accepted") {
        await this.cleanupAcceptedPublication(delivery);
        return delivery.event;
      }

      const previousState = delivery.state.value;
      delivery.publishing = true;
      delivery.state.next({ status: "publishing" });
      try {
        // Release auth prompts on cancellation, but retain late acceptance to prevent resending.
        const results = await firstValueFrom(
          withMessageAuth$(
            this.options,
            (auth) => defer(() => this.options.pool.publish(delivery.relays, delivery.event, auth)),
            context.signal,
          ),
        );

        if (!results.some((result) => result.ok)) {
          throw new Error(results[0]?.message ?? "No relay accepted the event");
        }

        for (const result of results) {
          if (result.ok) addSeenRelay(delivery.event, result.from);
        }
        this.options.eventStore.add(delivery.event);

        if (this.disposed) return delivery.event;
        delivery.state.next({ status: "accepted" });
        this.emitPendingPublications();
        await this.cleanupAcceptedPublication(delivery);
        context.signal.throwIfAborted();
        return delivery.event;
      } catch (error) {
        if (!this.disposed && delivery.state.getValue().status !== "accepted") {
          // Cancellation ends the reader, not delivery; only an actual noncancelled failure is recorded.
          delivery.state.next(context.signal.aborted ? previousState : { status: "failed", error });
        }
        throw error;
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
    this.sending.next(this.sending.value + 1);

    try {
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
      return this.preparedDelivery(delivery);
    } finally {
      this.sending.next(this.sending.value - 1);
    }
  }

  /**
   * Prepares the current draft and removes only its unchanged revision before publication.
   * Returns the prepared handle even if removal fails, reporting storage failures through errors$.
   * @throws if disposed, cancelled before preparation succeeds, no draft exists, or preparation fails
   */
  async prepareDraft(options: MessageOperationOptions = {}): Promise<PreparedLegacyMessage> {
    const context = this.context(options);
    // Keep activity continuous through restoration, preparation, and draft removal.
    this.sending.next(this.sending.value + 1);

    try {
      const snapshot = await this.drafts.load();
      context.signal.throwIfAborted();
      if (!snapshot) throw new Error("No conversation draft to prepare");

      const prepared = await this.prepareSend(snapshot, context);
      // Once prepared, never lose the caller's access to the retained signed event.
      if (!context.signal.aborted && !this.disposed) {
        try {
          await this.drafts.clearIfCurrent(snapshot, context.signal);
        } catch (error) {
          if (!this.disposed && (!context.signal.aborted || error !== context.signal.reason)) {
            this.errors.next({
              operation: "storage",
              error: new Error("Failed to remove prepared conversation draft", { cause: error }),
              eventId: prepared.message.id,
            });
          }
        }
      }
      return prepared;
    } finally {
      this.sending.next(this.sending.value - 1);
    }
  }

  private preparedDelivery(delivery: LegacyDelivery): PreparedLegacyMessage {
    if (delivery.handle?.generation === this.generation.signal) return delivery.handle.value;

    const prepared: PreparedLegacyMessage = {
      message: delivery.event,
      state$: defer(() => this.publicationState$(prepared)),
      publish: (options) => this.publish(prepared, options),
    };
    this.preparedHandles.set(prepared, { delivery, generation: this.generation.signal });
    delivery.handle = { value: prepared, generation: this.generation.signal };
    return prepared;
  }

  private resolvePublication(reference: LegacyPublicationReference): LegacyDelivery | Promise<LegacyDelivery> {
    this.context();
    if (typeof reference !== "string") {
      const handle = this.preparedHandles.get(reference);
      if (!handle) throw new Error("DM publication does not belong to this conversation");
      handle.generation.throwIfAborted();
      return handle.delivery;
    }

    const delivery = this.deliveries.get(reference);
    if (delivery) return delivery;

    return this.restorePublications().then(() => {
      const restored = this.deliveries.get(reference);
      if (!restored) throw new Error("Unknown DM publication");
      return restored;
    });
  }

  /** Observes a publication lazily, restoring IDs as needed and completing on stop or disposal */
  publicationState$(reference: LegacyPublicationReference): Observable<LegacyPublicationState> {
    return defer(() => {
      const context = this.context();
      // Serialize restoration with durable outbox writes, without retaining a subscription after stop.
      const resolve = () => this.resolvePublication(reference);
      const delivery =
        typeof reference === "string" && !this.deliveries.has(reference)
          ? this.enqueuePublication(async () => resolve())
          : resolve();
      const delivery$ = delivery instanceof Promise ? from(delivery) : of(delivery);
      return delivery$.pipe(
        switchMap((delivery) => delivery.state.asObservable()),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /**
   * Publishes or retries a conversation-owned handle or message ID without signing again
   * @throws if disposed, cancelled, the reference is unknown, foreign, stale, discarded, already publishing, or publication fails
   */
  async publish(reference: LegacyPublicationReference, options: MessageOperationOptions = {}): Promise<NostrEvent> {
    const publication = this.context(options);
    const delivery =
      typeof reference === "string" && !this.deliveries.has(reference)
        ? this.enqueuePublication(async () => this.resolvePublication(reference))
        : this.resolvePublication(reference);
    if (!(delivery instanceof Promise)) {
      if (delivery.state.value.status === "discarded" || delivery.removing) throw new Error("DM publication discarded");
      if (delivery.publishing) throw new Error("DM message is already being published");
    }
    const delivery$ = delivery instanceof Promise ? from(delivery) : of(delivery);
    this.sending.next(this.sending.value + 1);

    try {
      const message = await firstValueFrom(
        delivery$.pipe(
          switchMap((delivery) => this.publishDelivery$(delivery, publication)),
          takeUntil(fromEvent(publication.signal, "abort")),
        ),
      );
      publication.signal.throwIfAborted();
      return message;
    } finally {
      this.sending.next(this.sending.value - 1);
    }
  }

  /**
   * Prepares a new message and publishes it to this conversation
   * @throws if preparation or publication fails
   */
  async send(
    request: Omit<LegacyMessageSendRequest, "recipient">,
    options: MessageOperationOptions = {},
  ): Promise<NostrEvent> {
    this.context(options);
    // Retain activity across the handoff between preparation and publication.
    this.sending.next(this.sending.value + 1);

    try {
      const prepared = await this.prepareSend(request, options);
      return await this.publish(prepared, options);
    } finally {
      this.sending.next(this.sending.value - 1);
    }
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
