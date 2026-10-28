import { logger } from "applesauce-core";
import { isNIP04Encrypted } from "applesauce-core/helpers/encryption";
import { castUser } from "applesauce-common/casts";
import {
  createConversationIdentifier,
  getLegacyMessageCorrespondent,
  isValidLegacyMessage,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { LegacyMessagesGroups } from "applesauce-common/models";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { createSyncLoader } from "applesauce-loaders/loaders";
import { configured$, withFallback$ } from "../common/helpers.js";
import {
  isHexKey,
  mergeRelaySets,
  unixNow,
  kinds,
  isEncryptedContentFromCache,
  isEncryptedContentUnlocked,
  isPTag,
  restoreEncryptedContent,
  saveEncryptedContent,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { combineLatestByValue, mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import {
  BehaviorSubject,
  concat,
  finalize,
  ignoreElements,
  shareReplay,
  startWith,
  switchMap,
  timeout,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinct,
  distinctUntilChanged,
  EMPTY,
  filter,
  take,
  firstValueFrom,
  from,
  fromEvent,
  lastValueFrom,
  map,
  merge,
  Observable,
  of,
  Subscription,
  takeUntil,
  tap,
} from "rxjs";
import { MessageAuthentication, withMessageAuth$ } from "../common/authentication.js";
import type { MessageClientError, MessageOperationOptions, MessagesRelayStatus } from "../common/types.js";
import { LegacyConversation } from "./conversation.js";
import type {
  LegacyMessageAvailability,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
  PreparedLegacyMessage,
} from "./types.js";

const log = logger.extend("LegacyMessages");
type DecryptionActivity = { event: NostrEvent; readers: number; failed: boolean; error?: unknown };
type Mailbox = { filter: Filter; relays$: Observable<string[]> };

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

  /** The known conversations, including saved correspondents whose messages are not loaded */
  readonly conversations$: Observable<{ id: string; participants: string[]; lastMessage?: NostrEvent }[]>;

  /** The combined mailbox relay set */
  readonly relays$: Observable<string[]>;

  /** The mailbox relay connection states */
  readonly relayStatus$: Observable<MessagesRelayStatus[]>;

  /** The current decryption counts and failed event IDs */
  readonly decryptionState$;

  private readonly lifecycle = new BehaviorSubject<"idle" | "loading" | "ready" | "disposed">("idle");

  /** The background loading lifecycle, independent of decryption */
  readonly status$ = this.lifecycle.asObservable();

  private readonly cacheState = new BehaviorSubject<{ error?: unknown }>({});

  /** The latest event-cache hydration result */
  readonly cacheState$ = this.cacheState.asObservable();

  private readonly conversationStorageState = new BehaviorSubject<{ error?: unknown }>({});

  /** The latest conversation-index persistence result */
  readonly conversationStorageState$ = this.conversationStorageState.asObservable();

  private readonly mailboxFailures = new BehaviorSubject<Record<string, unknown>>({});

  private readonly autoUnlock = new BehaviorSubject(false);
  private readonly syncState = new BehaviorSubject<LegacyMessagesSyncStatus | undefined>(undefined);

  /** The latest background history reconciliation progress */
  readonly syncStatus$ = this.syncState.asObservable();

  private readonly conversations = new BehaviorSubject<readonly LegacyConversation[]>([]);

  /** Whether one or more send operations are in progress */
  readonly busy$ = this.conversations.pipe(
    combineLatestByValue((conversation) => conversation.busy$),
    map((busy) => [...busy.values()].some(Boolean)),
    distinctUntilChanged(),
  );

  /** The publication states of messages in the client's current conversations */
  readonly publications$ = this.conversations.pipe(
    combineLatestByValue((conversation) => conversation.publications$),
    map(
      (publications) =>
        Object.assign({}, ...publications.values()) as Record<
          string,
          "prepared" | "publishing" | "accepted" | "failed"
        >,
    ),
  );

  private readonly decryptionActivity = new BehaviorSubject<ReadonlyMap<string, DecryptionActivity>>(new Map());
  private readonly pendingDecryptions = new Map<string, Promise<NostrEvent | undefined>>();
  private signerDecryptionQueue: Promise<void> = Promise.resolve();
  private readonly knownCorrespondents = new BehaviorSubject<readonly string[]>([]);
  private conversationRestoration?: Promise<void>;

  private readonly authentication: MessageAuthentication;

  /** The pending relay authentication requests */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly mailboxes: Mailbox[];
  private readonly lifetime = new Subscription();

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

    const owner = castUser(this.pubkey, this.eventStore);
    this.mailboxes = [
      {
        filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [this.pubkey] },
        relays$: this.mailboxRelays$([owner.inboxes$, owner.directMessageRelays$]),
      },
      {
        filter: { kinds: [kinds.EncryptedDirectMessage], authors: [this.pubkey] },
        relays$: this.mailboxRelays$([owner.outboxes$]),
      },
    ];
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((relays) => mergeRelaySets(...relays)),
      distinctUntilChanged((a, b) => a.join() === b.join()),
    );

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = this.eventStore.timeline(this.filters).pipe(watchEventsUpdates(this.eventStore));
    this.relayStatus$ = combineLatest([this.relays$, this.pool.status$ ?? of({}), this.mailboxFailures]).pipe(
      map(([relays, connections, failures]) =>
        relays.map((url) => ({ url, connection: connections[url], error: failures[url] })),
      ),
    );

    this.decryptionState$ = this.observeDecryption$(this.messages$);
    this.conversations$ = combineLatest([
      defer(() => this.restoreConversationIndex()).pipe(switchMap(() => this.knownCorrespondents)),
      this.eventStore.model(LegacyMessagesGroups, this.pubkey),
    ]).pipe(
      map(([known, loaded]) => {
        const conversations = new Map<string, { id: string; participants: string[]; lastMessage?: NostrEvent }>();
        for (const correspondent of known) {
          const id = createConversationIdentifier(this.pubkey, [correspondent]);
          conversations.set(id, { id, participants: [...new Set([this.pubkey, correspondent])] });
        }
        for (const conversation of loaded) conversations.set(conversation.id, conversation);
        return [...conversations.values()];
      }),
    );

    this.lifetime.add(
      this.eventStore
        .filters(this.filters)
        .pipe(
          concatMap((event) =>
            defer(() => this.rememberCorrespondent(event)).pipe(
              catchError((error) => {
                this.conversationStorageState.next({ error });
                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe(),
    );
  }

  private get filters() {
    return this.mailboxes.map((mailbox) => mailbox.filter);
  }

  private restoreConversationIndex(): Promise<void> {
    return (this.conversationRestoration ??= Promise.resolve()
      .then(async () => {
        const serialized = await this.options.conversationStorage?.getItem(`conversations:${this.pubkey}`);
        if (serialized == null) return;

        const record = JSON.parse(serialized);
        if (record?.version !== 1 || !Array.isArray(record.correspondents) || !record.correspondents.every(isHexKey))
          throw new Error("Invalid legacy conversation index");
        this.knownCorrespondents.next([...new Set<string>(record.correspondents)]);
      })
      .catch((error) => {
        this.conversationRestoration = undefined;
        throw error;
      }));
  }

  private async rememberCorrespondent(event: NostrEvent) {
    if (!isValidLegacyMessage(event)) return;
    const correspondent = getLegacyMessageCorrespondent(event, this.pubkey);
    if (!correspondent || !isHexKey(correspondent)) return;
    await this.restoreConversationIndex();
    if (this.knownCorrespondents.value.includes(correspondent)) return;

    const next = [...this.knownCorrespondents.value, correspondent];
    await this.options.conversationStorage?.setItem(
      `conversations:${this.pubkey}`,
      JSON.stringify({ version: 1, correspondents: next }),
    );
    this.knownCorrespondents.next(next);
    this.conversationStorageState.next({});
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

  /** Returns the native messages in one conversation */
  conversation$(correspondent: string): Observable<NostrEvent[]> {
    return this.conversation(correspondent).messages$;
  }

  /** Returns a stable, independently loadable conversation with one correspondent */
  conversation(correspondent: string): LegacyConversation {
    this.assertActive();
    if (!isHexKey(correspondent)) throw new Error("Invalid correspondent");
    let conversation = this.conversations.value.find((conversation) => conversation.correspondent === correspondent);
    if (!conversation || conversation.isDisposed) {
      conversation = new LegacyConversation(this, correspondent, {
        ...this.options,
        autoUnlock: this.autoUnlock.value,
      });
      this.conversations.next([...this.conversations.value.filter((item) => !item.isDisposed), conversation]);
      this.observeConversation(conversation);
    }

    return conversation;
  }

  private observeConversation(conversation: LegacyConversation): void {
    const disposed$ = conversation.status$.pipe(filter((lifecycle) => lifecycle === "disposed"));
    this.lifetime.add(
      disposed$.pipe(take(1)).subscribe(() => {
        this.conversations.next(this.conversations.value.filter((item) => item !== conversation));
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
      await lastValueFrom(this.hydrate$(this.filters, context.signal), { defaultValue: undefined });
      if (context.signal.aborted || background.closed) return;

      const since = unixNow() - (this.options.historySpan ?? 30 * 86400);
      const decryption$ = this.watchDecryption$(this.eventStore.filters(this.filters), this.autoUnlock);
      const live$ = merge(...this.mailboxes.map((mailbox) => this.watchMailbox$(mailbox, since)));
      const reconciliation$ = this.sync$({ since }).pipe(
        tap((progress) => {
          this.syncState.next(progress);
          if (progress.done) this.lifecycle.next("ready");
        }),
        catchError((error) => {
          this.syncState.next({ mailboxes: [], done: true, loaded: 0, error });
          return EMPTY;
        }),
      );
      background.add(merge(decryption$, live$, reconciliation$).subscribe());
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Stops background work and invalidates outstanding operations without disposing shared dependencies */
  stop(): void {
    this.authentication.clear();
    for (const conversation of this.conversations.value) conversation.stop();
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

    for (const conversation of this.conversations.value) conversation.dispose();
    this.conversations.next([]);
    this.lifetime.unsubscribe();
    this.lifecycle.next("disposed");
  }

  /** Releases this client and its conversations through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed decryption of arriving messages */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
    for (const conversation of this.conversations.value) conversation.setAutoUnlock(enabled);
  }

  private updateDecryption(event: NostrEvent, change: (previous: DecryptionActivity) => DecryptionActivity) {
    const next = new Map(this.decryptionActivity.value);
    const updated = change(next.get(event.id) ?? { event, readers: 0, failed: false });
    if (!updated.readers && !updated.failed) next.delete(event.id);
    else next.set(event.id, updated);
    this.decryptionActivity.next(next);
  }

  private async restore(event: NostrEvent) {
    if (!this.options.decryptionCache || isEncryptedContentUnlocked(event)) return;
    await restoreEncryptedContent(event, this.options.decryptionCache).catch((error) => {
      log("Failed to restore encrypted content for %s", event.id, error);
    });
  }

  private async decrypt(event: NostrEvent) {
    await this.restore(event);
    // Cache reads cannot be cancelled, but abandoned readers must not prompt the signer afterward.
    if (!this.decryptionActivity.value.get(event.id)?.readers) return undefined;

    if (!isEncryptedContentUnlocked(event)) {
      if (!isNIP04Encrypted(event.content)) throw new Error("Invalid NIP-04 encrypted message content");

      const unlocking = this.signerDecryptionQueue.then(async () => {
        // Readers may leave while waiting behind another event's signer prompt.
        if (!this.decryptionActivity.value.get(event.id)?.readers || isEncryptedContentUnlocked(event)) return;
        if (!this.options.signer) throw new Error("A signer is required");
        await unlockLegacyMessage(event, this.pubkey, this.options.signer);
      });

      // Keep the queue usable after a rejection, and occupied until the signer actually settles.
      this.signerDecryptionQueue = unlocking.catch(() => undefined);
      await unlocking;
      if (!isEncryptedContentUnlocked(event)) return undefined;
    }
    if (this.options.decryptionCache && !isEncryptedContentFromCache(event)) {
      await saveEncryptedContent(event, this.options.decryptionCache).catch((error) => {
        log("Failed to persist encrypted content for %s", event.id, error);
      });
    }
    return event;
  }

  private read$(event: NostrEvent): Observable<NostrEvent> {
    return defer(() => {
      if (!isValidLegacyMessage(event)) return EMPTY;
      const addressedToOwner = event.tags.some((tag) => isPTag(tag) && tag[1] === this.options.pubkey);
      if (event.pubkey !== this.options.pubkey && !addressedToOwner) return EMPTY;

      let decryption = this.pendingDecryptions.get(event.id);
      if (!decryption) {
        decryption = this.decrypt(event);
        this.pendingDecryptions.set(event.id, decryption);
        // A timed-out or cancelled reader must still share an unresolved signer call.
        const release = () => this.pendingDecryptions.delete(event.id);
        void decryption.then(release, release);
      }
      this.updateDecryption(event, (previous) => ({ ...previous, readers: previous.readers + 1 }));

      return defer(() => decryption).pipe(
        filter((message): message is NostrEvent => message !== undefined),
        timeout({ first: this.options.decryptionTimeout ?? 60000 }),
        tap({
          next: () => this.updateDecryption(event, (previous) => ({ ...previous, failed: false, error: undefined })),
          error: (error) => {
            this.updateDecryption(event, (previous) => ({ ...previous, failed: true, error }));
          },
        }),
        finalize(() => this.updateDecryption(event, (previous) => ({ ...previous, readers: previous.readers - 1 }))),
      );
    });
  }

  /**
   * Checks whether an event needs an automatic or bulk decryption attempt
   * @internal
   */
  shouldUnlock(event: NostrEvent) {
    return !isEncryptedContentUnlocked(event) && !this.decryptionActivity.value.get(event.id)?.failed;
  }

  /**
   * Derives decryption counts for the account or one conversation
   * @internal
   */
  observeDecryption$(messages$: Observable<NostrEvent[]>, correspondent?: string) {
    return combineLatest([messages$, this.decryptionActivity]).pipe(
      map(([events, operations]) => {
        const relevant = [...operations.values()].filter(
          ({ event }) => !correspondent || getLegacyMessageCorrespondent(event, this.options.pubkey) === correspondent,
        );
        const failed = relevant.filter((operation) => operation.failed).map(({ event }) => event.id);
        const failedIds = new Set(failed);
        return {
          total: events.length,
          unlocked: events.filter(isEncryptedContentUnlocked).length,
          locked: events.filter((event) => !isEncryptedContentUnlocked(event) && !failedIds.has(event.id)).length,
          failed,
          errors: Object.fromEntries(
            relevant.filter((operation) => operation.failed).map(({ event, error }) => [event.id, error]),
          ),
          pending: relevant.filter((operation) => operation.readers > 0).length,
        };
      }),
    );
  }

  private processStoredMessage$(event: NostrEvent, autoUnlock: boolean, onError?: (error: MessageClientError) => void) {
    const unlock = autoUnlock && this.shouldUnlock(event);
    const operation = unlock ? "decrypt" : "restore";
    const processing$: Observable<unknown> = unlock
      ? this.read$(event)
      : defer(() => this.restore(event)).pipe(timeout({ first: this.options.decryptionTimeout ?? 60000 }));

    return processing$.pipe(
      catchError((error) => {
        onError?.({ operation, error, eventId: event.id });
        return EMPTY;
      }),
    );
  }

  /**
   * Restores cached plaintext and optionally decrypts stored arrivals in order
   * @internal
   */
  watchDecryption$(
    events$: Observable<NostrEvent>,
    autoUnlock$: Observable<boolean>,
    onError?: (error: MessageClientError) => void,
  ) {
    return autoUnlock$.pipe(
      distinctUntilChanged(),
      // Replacing the stream drops queued work; already-running signer promises remain shared.
      switchMap((autoUnlock) =>
        events$.pipe(concatMap((event) => this.processStoredMessage$(event, autoUnlock, onError))),
      ),
    );
  }

  /** Decrypts one event or all currently loaded pending events */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    const events = event ? [event] : [...this.eventStore.getByFilters(this.filters)];

    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && !this.shouldUnlock(item)) continue;

      try {
        await firstValueFrom(this.read$(item).pipe(takeUntil(fromEvent(context.signal, "abort"))), {
          defaultValue: undefined,
        });
        context.signal.throwIfAborted();
      } catch (error) {
        if (event || context.signal.aborted) throw error;
      }
    }
  }

  /** Retries a failed decryption explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
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
        tap({ complete: () => this.cacheState.next({}) }),
        catchError((error) => {
          this.cacheState.next({ error });
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
        this.mailboxFailures.next(
          Object.fromEntries(Object.entries(this.mailboxFailures.value).filter(([url]) => !relays.includes(url))),
        );
        return withMessageAuth$(this.options, (auth) =>
          this.options.pool.subscription(
            relays,
            { ...mailbox.filter, since },
            { eventStore: this.options.eventStore, reconnect: true, ...auth },
          ),
        ).pipe(
          mapEventsToStore(this.options.eventStore),
          catchError((error) => {
            this.mailboxFailures.next({
              ...this.mailboxFailures.value,
              ...Object.fromEntries(relays.map((url) => [url, error])),
            });
            return EMPTY;
          }),
        );
      }),
    );
  }

  private syncRelays$(relays$: Observable<string[]>, followRelays = true) {
    if (followRelays) return relays$;
    return withFallback$(relays$.pipe(filter((relays) => relays.length > 0)), [], this.options.timeout ?? 4000).pipe(
      take(1),
    );
  }

  /** Reconciles a history range while following mailbox relay changes by default */
  sync$(options: LegacyMessageHistoryOptions = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      if (options.correspondent)
        return this.conversation(options.correspondent).sync$({ ...options, signal: context.signal });

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
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Loads a finite history range and returns its final reconciliation status */
  async loadHistory(options: LegacyMessageHistoryOptions = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$({ ...options, followRelays: false }));
  }

  /** Reads decrypted messages from a stored snapshot or watches the store for additions */
  readMessages$(options: MessageOperationOptions & { history?: boolean } = {}): Observable<NostrEvent> {
    return defer(() => {
      const context = this.context(options);
      const events$ = options.history
        ? from(this.eventStore.getByFilters(this.filters))
        : this.eventStore.filters(this.filters);

      return events$.pipe(
        distinct((event) => event.id),
        concatMap((event) => this.read$(event).pipe(catchError(() => EMPTY))),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Observes recipient relay support and follows relay configuration changes */
  discover$(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Observable<LegacyMessageAvailability> {
    return defer(() => {
      const context = this.context(options);
      validateRecipient(request);
      return this.conversation(request.recipient).discover$(context);
    });
  }

  /** Discovers relay support before preparing a send */
  discover(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<LegacyMessageAvailability> {
    return firstValueFrom(this.discover$(request, options));
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
