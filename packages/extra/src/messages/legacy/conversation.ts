import { logger } from "applesauce-core";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import {
  createFilterMapTimelineLoader,
  createSyncLoader,
  type FilterMap,
  type TimelineLoader,
  type TimelineLoaderOptions,
} from "applesauce-loaders/loaders";
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
  type Filter,
} from "applesauce-core/helpers";
import { mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import {
  BehaviorSubject,
  concat,
  concatMap,
  take,
  ignoreElements,
  of,
  filter,
  distinctUntilChanged,
  shareReplay,
  startWith,
  merge,
  catchError,
  combineLatest,
  defer,
  share,
  EMPTY,
  finalize,
  firstValueFrom,
  fromEvent,
  lastValueFrom,
  map,
  Observable,
  Subject,
  ReplaySubject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
  timeout,
} from "rxjs";
import { withMessageAuth$ } from "../common/authentication.js";
import { configured$, withFallback$ } from "../common/helpers.js";
import type { MessageDraft, MessageClientError, MessageOperationOptions } from "../common/types.js";
import type { LegacyMessagesClient } from "./client.js";
import type {
  LegacyMessageAvailability,
  PreparedLegacyMessage,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
} from "./types.js";

const log = logger.extend("LegacyMessages");
type Mailbox = { filter: Filter; relays$: Observable<string[]> };

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

/** A signed message retained for publish retries */
interface LegacyDelivery extends StoredLegacyPublication {
  accepted: boolean;
  publishing: boolean;
  discarded?: boolean;
}

/** An independently loaded NIP-04 conversation belonging to one fixed-account client */
export class LegacyConversation {
  /** The stable conversation identifier */
  readonly id: string;

  private readonly drafts: ConversationDraftState;
  /** The current plaintext draft, restored from storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;

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

  private readonly pendingPublications = new BehaviorSubject<readonly PreparedLegacyMessage[]>([]);
  private readonly publicationDestroyed = new ReplaySubject<void>(1);
  /** The unpublished messages, restored on subscription without publishing or starting message loading */
  readonly pendingPublications$ = defer(() => this.loadPublications()).pipe(
    switchMap(() => this.pendingPublications.asObservable()),
    takeUntil(this.publicationDestroyed),
  );
  private readonly pendingDeliveries = new Map<string, LegacyDelivery>();
  private publicationOperations: Promise<unknown> = Promise.resolve();
  private publicationsLoaded = false;
  private readonly mailboxes: Mailbox[];
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
    this.drafts = new ConversationDraftState(`draft:${this.id}`, options.draftStorage);
    this.draft$ = this.drafts.draft$;
    this.autoUnlock = new BehaviorSubject(options.autoUnlock ?? false);
    const owner = castUser(options.pubkey, options.eventStore);
    const peer = castUser(correspondent, options.eventStore);
    this.mailboxes = [
      {
        filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [options.pubkey], authors: [correspondent] },
        relays$: this.mailboxRelays$([owner.inboxes$, owner.directMessageRelays$, peer.outboxes$]),
      },
      {
        filter: { kinds: [kinds.EncryptedDirectMessage], authors: [options.pubkey], "#p": [correspondent] },
        relays$: this.mailboxRelays$([owner.outboxes$, peer.inboxes$, peer.directMessageRelays$]),
      },
    ];
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((lists) => mergeRelaySets(...lists)),
    );

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = client.eventStore.timeline(this.filters).pipe(watchEventsUpdates(client.eventStore));

    this.decryptionState$ = client.observeDecryption$(this.messages$, correspondent);
  }

  private get relayTimeout() {
    return this.options.timeout ?? 4000;
  }

  private get filters() {
    return this.mailboxes.map((mailbox) => mailbox.filter);
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
   * Starts live loading and optional recent history without starting the client's inbox
   * @throws if the conversation is disposed
   */
  async start(
    options: { /** Whether to reconcile recent history, default true */ history?: boolean } = {},
  ): Promise<void> {
    this.context();
    if (this.background) return;

    const background = (this.background = new Subscription());
    this.lifecycle.next("loading");
    const since = unixNow() - (this.options.historySpan ?? 30 * 86400);

    background.add(
      this.client
        .watchDecryption$(this.client.eventStore.filters(this.filters), this.autoUnlock, (error) =>
          this.errors.next(error),
        )
        .subscribe(),
    );
    background.add(merge(...this.mailboxes.map((mailbox) => this.watchMailbox$(mailbox, since))).subscribe());

    if (options.history !== false) {
      background.add(
        this.sync$({ since })
          .pipe(
            catchError((error) => {
              this.errors.next({ operation: "sync", error });
              return EMPTY;
            }),
          )
          .subscribe((progress) => {
            if (progress.done) this.lifecycle.next("ready");
          }),
      );
    } else {
      this.lifecycle.next("ready");
    }
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
    this.drafts.dispose();
    this.stop();
    this.publicationDestroyed.next();
    this.publicationDestroyed.complete();
    this.pendingPublications.next([]);
    this.pendingPublications.complete();
    this.pendingDeliveries.clear();
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

  /**
   * Creates an independent viewport loader whose subscriptions stop with this conversation
   * @throws if the conversation is disposed or timeline options are invalid
   */
  createTimelineLoader(options: Omit<TimelineLoaderOptions, "eventStore" | "cache"> = {}): TimelineLoader {
    this.context();
    const relayMap$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((lists): FilterMap => {
        const routes: Record<string, Filter[]> = {};
        lists.forEach((relays, index) => {
          for (const relay of relays) (routes[relay] ??= []).push(this.mailboxes[index].filter);
        });
        return routes;
      }),
    );
    const request = (relays: string[], filters: Parameters<typeof this.client.pool.request>[1]) =>
      withMessageAuth$(this.options, (auth) => this.client.pool.request(relays, filters, auth));
    const loader = createFilterMapTimelineLoader(request, relayMap$, {
      ...options,
      eventStore: this.client.eventStore,
      cache: this.options.cacheRequest,
      cacheFilters: this.filters,
    });
    const load: TimelineLoader = Object.assign(
      (windows: Parameters<TimelineLoader>[0]) =>
        defer(() => {
          const context = this.context();
          return loader(windows).pipe(takeUntil(fromEvent(context.signal, "abort")));
        }).pipe(share()),
      { status$: loader.status$ },
    );
    return load;
  }

  private mailboxRelays$(sources: Observable<string[] | undefined>[]) {
    const fallback$ = configured$(this.options.fallbackRelays, []).pipe(catchError(() => of([])));
    return combineLatest([...sources.map((source) => source.pipe(startWith(undefined))), fallback$]).pipe(
      map((lists) => {
        const advertised = mergeRelaySets(...lists.slice(0, -1));
        return mergeRelaySets(advertised.length ? advertised : lists[lists.length - 1]).sort();
      }),
      distinctUntilChanged((previous, next) => previous.join() === next.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  private hydrate$(filters: Filter[], signal: AbortSignal): Observable<NostrEvent> {
    return defer(() => {
      signal.throwIfAborted();
      if (!this.options.cacheRequest) return EMPTY;

      return makeCacheRequest(this.options.cacheRequest, filters).pipe(
        timeout({ each: this.options.timeout ?? 4000 }),
        mapEventsToStore(this.options.eventStore),
        catchError((error) => {
          this.errors.next({ operation: "restore", error });
          return EMPTY;
        }),
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  private watchMailbox$(mailbox: Mailbox, since: number) {
    return mailbox.relays$.pipe(
      switchMap((relays) => {
        if (!relays.length) return EMPTY;
        return withMessageAuth$(this.options, (auth) =>
          this.options.pool.subscription(
            relays,
            { ...mailbox.filter, since },
            { eventStore: this.options.eventStore, reconnect: true, ...auth },
          ),
        ).pipe(
          mapEventsToStore(this.options.eventStore),
          catchError((error) => {
            this.errors.next({ operation: "read", error });
            return EMPTY;
          }),
        );
      }),
    );
  }

  private syncRelays$(relays$: Observable<string[]>, followRelays = true) {
    if (followRelays) return relays$;
    return withFallback$(relays$.pipe(filter((relays) => relays.length > 0)), [], this.relayTimeout).pipe(take(1));
  }

  /** Reconciles this conversation's history while following mailbox relay changes by default */
  sync$(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      const filters = this.mailboxes.map((mailbox) => ({
        ...mailbox.filter,
        since: Math.max(0, options.since ?? 0),
        ...(options.until !== undefined ? { until: options.until } : {}),
      }));
      const sync = createSyncLoader({ pool: this.options.pool, eventStore: this.options.eventStore });
      const reconciliation$ = combineLatest(
        this.mailboxes.map((mailbox, index) =>
          withMessageAuth$(
            this.options,
            (auth) =>
              sync({
                filter: filters[index],
                relays: this.syncRelays$(mailbox.relays$, options.followRelays),
                ...auth,
              }).status$,
          ),
        ),
      );

      return concat(this.hydrate$(filters, context.signal).pipe(ignoreElements()), reconciliation$).pipe(
        map((mailboxes) => ({
          mailboxes,
          done: mailboxes.every((mailbox) => mailbox.done),
          loaded: mailboxes.reduce((sum, mailbox) => sum + mailbox.loaded, 0),
        })),
        tap((progress) => this.syncState.next(progress)),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Loads a finite conversation history range */
  loadHistory(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$({ ...options, followRelays: false }));
  }

  /** Decrypts one event or all currently loaded pending events in this conversation */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    if (event && getLegacyMessageCorrespondent(event, this.client.pubkey) !== this.correspondent)
      throw new Error("Message does not belong to this conversation");
    const events = event ? [event] : [...this.client.eventStore.getByFilters(this.filters)];

    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && !this.client.shouldUnlock(item)) continue;

      try {
        await this.client.unlock(item, context);
      } catch (error) {
        if (!context.signal.aborted) {
          this.errors.next({ operation: "decrypt", error, eventId: item.id });
        }
        if (event || context.signal.aborted) throw error;
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

  private enqueuePublication<T>(operation: () => Promise<T>): Promise<T> {
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
      [...this.pendingDeliveries.values()]
        .filter((delivery) => !delivery.accepted)
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
            accepted: false,
            publishing: false,
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
      this.pendingDeliveries.set(delivery.event.id, delivery);
      this.publications.next({ ...this.publications.value, [delivery.event.id]: "prepared" });
    }
    this.publicationsLoaded = true;
    this.emitPendingPublications();
  }

  private async writePublications(deliveries: Map<string, LegacyDelivery>): Promise<void> {
    const storage = this.options.publicationStorage;
    if (!storage) return;
    const key = `publication:${this.id}`;
    if (!deliveries.size) {
      await storage.removeItem(key);
      return;
    }
    const messages = [...deliveries.values()].map((delivery) => ({
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
   * Removes an unpublished message and invalidates its retained publication handles
   * @throws if disposed, the message is being published, or storage fails
   */
  discardPublication(eventId: string): Promise<void> {
    return this.enqueuePublication(async () => {
      await this.restorePublications();
      const delivery = this.pendingDeliveries.get(eventId);
      if (!delivery) return;
      if (delivery.publishing) throw new Error("DM message is already being published");
      // Prevent publication from starting while removal is waiting on storage.
      delivery.discarded = true;
      try {
        const next = new Map(this.pendingDeliveries);
        next.delete(eventId);
        await this.writePublications(next);
        this.pendingDeliveries.delete(eventId);
        const publications = { ...this.publications.value };
        delete publications[eventId];
        this.publications.next(publications);
        this.emitPendingPublications();
      } catch (error) {
        delivery.discarded = false;
        throw error;
      }
    });
  }

  private async removeAcceptedPublication(delivery: LegacyDelivery): Promise<void> {
    await this.enqueuePublication(async () => {
      const next = new Map(this.pendingDeliveries);
      next.delete(delivery.event.id);
      await this.writePublications(next);
      this.pendingDeliveries.delete(delivery.event.id);
      this.emitPendingPublications();
    });
  }

  private fallbackRelays$() {
    return withFallback$(configured$(this.options.fallbackRelays, []), [], this.relayTimeout);
  }

  private deliveryRelays$(pubkey: string) {
    const user = castUser(pubkey, this.options.eventStore);
    return combineLatest([
      withFallback$(user.directMessageRelays$, undefined, this.relayTimeout),
      withFallback$(user.inboxes$, undefined, this.relayTimeout),
    ]).pipe(
      map(([direct, inboxes]) => mergeRelaySets(direct, inboxes)),
      switchMap((advertised) => (advertised.length ? of(advertised) : this.fallbackRelays$())),
    );
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
        this.fallbackRelays$(),
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
            this.deliveryRelays$(this.correspondent),
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
                accepted: false,
                publishing: false,
              };
              await this.enqueuePublication(async () => {
                assertCurrent();
                const next = new Map(this.pendingDeliveries);
                next.set(event.id, delivery);
                await this.writePublications(next);
                // A completed durable write remains pending even if its caller was cancelled while writing.
                if (!this.disposed) {
                  this.pendingDeliveries.set(event.id, delivery);
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
      if (delivery.discarded) throw new Error("DM publication discarded");
      if (delivery.publishing) throw new Error("DM message is already being published");
      if (delivery.accepted) {
        await this.cleanupAcceptedPublication(delivery);
        return delivery.event;
      }

      delivery.publishing = true;
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

        delivery.accepted = true;
        this.emitPendingPublications();
        await this.cleanupAcceptedPublication(delivery);
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
    this.publications.next({
      ...this.publications.value,
      [delivery.event.id]: delivery.accepted ? "accepted" : "prepared",
    });
    return this.preparedDelivery(delivery);
  }

  private preparedDelivery(delivery: LegacyDelivery): PreparedLegacyMessage {
    const generation = this.generation.signal;
    const setState = (state: "prepared" | "publishing" | "accepted" | "failed") =>
      this.publications.next({ ...this.publications.value, [delivery.event.id]: state });

    return {
      message: delivery.event,
      publish: async (publishOptions = {}) => {
        const publication = this.context(publishOptions);
        generation.throwIfAborted();
        if (delivery.discarded) throw new Error("DM publication discarded");
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
          setState(delivery.accepted ? "accepted" : "failed");
          this.errors.next({ operation: "send", error, eventId: delivery.event.id });
          throw error;
        } finally {
          this.sending.next(this.sending.value - 1);
        }
      },
    };
  }

  /**
   * Prepares a new message and publishes it to this conversation
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
