import {
  getDecodedToken,
  getEncodedToken,
  type MeltProofsResponse,
  type MeltQuoteBaseResponse,
  Mint,
  type MintQuoteBolt11Response,
  MintQuoteState,
  type Proof,
  Token,
  Wallet as CashuWallet,
} from "@cashu/cashu-ts";
import { ActionRunner } from "applesauce-actions";
import type { EventSigner } from "applesauce-core";
import { ChainableObservable, logger as baseLogger, chainable, EventStore } from "applesauce-core";
import { castUser, User } from "applesauce-core/casts";
import type { NostrEvent } from "applesauce-core/helpers";
import {
  addSeenRelay,
  canHaveEncryptedContent,
  getEncryptedContent,
  getOutboxes,
  getSeenRelays,
  isEncryptedContentUnlocked,
  kinds,
  normalizeURL,
  notifyEventUpdate,
  relaySet,
  setEncryptedContentCache,
} from "applesauce-core/helpers";
import {
  type EncryptedContentCache,
  isEncryptedContentFromCache,
  markEncryptedContentFromCache,
} from "applesauce-common/helpers";
import type { RelayPool, RelayStatus } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Debugger } from "debug";
import { BehaviorSubject, combineLatest, isObservable, Observable, of, Subscription } from "rxjs";
import { distinctUntilChanged, map, shareReplay, startWith } from "rxjs/operators";

// Ensure the User.wallet$ is setup
import "../casts/__register__";

import {
  CleanupDeletedTokens,
  ConsolidateTokens,
  CreateWallet,
  MintTokens,
  ReceiveToken,
  ReceiveNutzaps,
  RecoverFromCouch,
  RolloverTokens,
  SetWalletMints,
  SetWalletRelays,
  TokensOperation,
  UnlockWallet,
} from "../actions/index.js";
import type { WalletHistory } from "../casts/wallet-history.js";
import type { WalletToken } from "../casts/wallet-token.js";
import type { Wallet } from "../casts/wallet.js";
import type { Couch } from "../helpers/couch.js";
import { lockHistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { lockTokenContent, WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { getWalletRelays, lockWallet, WALLET_KIND } from "../helpers/wallet.js";
import { WalletDeletedTokensModel } from "../models/tokens.js";
import { loadWalletEvents, WalletLoaderStatus } from "./loading.js";
import {
  type Bolt11WithdrawResponse,
  type CreateWalletOptions,
  type DepositOptions,
  type NutWalletOperation,
  type NutWalletOptions,
  type RelayStatusInfo,
  type TokenRelayCoverage,
  type WithdrawOptions,
  WalletStatus,
} from "./types.js";

// Ensure the user.wallet$ observable is registered
import "../casts/__register__.js";

/** Computes how a set of token events are spread across a set of target relays */
export function computeTokenRelayCoverage(tokens: WalletToken[], walletRelays: string[]): TokenRelayCoverage {
  // The relays tokens should be stored on, falling back to the union of seen relays
  const relays = new Set(walletRelays.map(normalizeURL));
  if (relays.size === 0) for (const token of tokens) token.seen?.forEach((url) => relays.add(normalizeURL(url)));
  const relayList = [...relays];

  const perRelay: Record<string, number> = Object.fromEntries(relayList.map((url) => [url, 0]));
  const coverage = tokens.map((token) => {
    const seen = [...(token.seen ?? [])].map(normalizeURL);
    const seenSet = new Set(seen);
    const stored = relayList.filter((url) => seenSet.has(url));
    const missing = relayList.filter((url) => !seenSet.has(url));
    for (const url of stored) perRelay[url]++;
    return { token, seen, stored, missing };
  });

  return { relays: relayList, total: tokens.length, perRelay, tokens: coverage };
}

/** Stable comparison for two string arrays (order dependent, matches the wallet's tag order) */
function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Sleeps for a number of milliseconds, rejecting early with an AbortError if the signal aborts */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A reusable NIP-60 / Cashu wallet.
 *
 * Wraps a signer, relay pool, event store and couch, exposes RxJS observable fields for wallet state and
 * status, and async methods for the common wallet operations. Robustly loads wallet events using an initial
 * request, negentropy sync where available, and a live subscription (see {@link loadWalletEvents}).
 *
 * @example
 * const wallet = new NutWallet({ pubkey, signer, pool, eventStore, couch, autoUnlock: true });
 * await wallet.start();
 * wallet.balance$.subscribe((balance) => console.log(balance));
 */
export class NutWallet {
  readonly pubkey: string;
  readonly signer: ISigner;
  readonly pool: RelayPool;
  readonly eventStore: EventStore;
  readonly couch: Couch;

  /** Whether to automatically unlock the wallet, tokens and history as they load */
  autoUnlock: boolean;
  /**
   * Whether the wallet loads, subscribes to and publishes NIP-09 delete events for its events. When false the
   * wallet completely ignores kind-5 delete events for its wallet, token and history events (see
   * {@link NutWalletOptions.useDeleteEvents}). The loading half is fixed when the wallet starts; toggling at
   * runtime with {@link setUseDeleteEvents} only affects publishing until the next {@link resync}.
   */
  useDeleteEvents: boolean;
  /** An optional persistent cache of decrypted event content, consulted before decrypting and written to after */
  protected decryptionCache?: EncryptedContentCache;

  protected user: User;
  protected actions: ActionRunner;
  protected log: Debugger;
  /** Static relays passed by the caller, used as a publishing fallback before the wallet loads */
  protected fallbackRelays?: string[];
  /**
   * A cache of cashu-ts {@link Mint} instances keyed by normalized url, reused across mint list changes.
   * A {@link Mint} caches the mint's info and owns a single WebSocket connection, so reusing instances
   * avoids re-fetching mint info and keeps one socket per mint.
   */
  protected mints = new Map<string, Mint>();
  /** A cache of loaded cashu Wallet instances keyed by normalized mint url (wallets are specific to this wallet) */
  protected wallets = new Map<string, Promise<CashuWallet>>();

  // ---- Internal state subjects ----
  protected started$ = new BehaviorSubject<boolean>(false);
  protected loading$ = new BehaviorSubject<boolean>(false);
  protected loaded$ = new BehaviorSubject<boolean>(false);
  protected syncing$ = new BehaviorSubject<boolean>(false);
  protected error$ = new BehaviorSubject<Error | null>(null);
  protected operations$ = new BehaviorSubject<Partial<Record<NutWalletOperation, boolean>>>({});
  protected negentropy$ = new BehaviorSubject<Record<string, boolean>>({});
  protected couch$ = new BehaviorSubject<Token[]>([]);

  // ---- Wallet state observables ----
  /** The relays used for loading and publishing wallet events */
  readonly relays$;
  /** The NIP-60 wallet cast (undefined until it loads) */
  readonly wallet$;
  /** A map of mint url to balance in sats */
  readonly balance$;
  /** The total balance across all mints in sats */
  readonly totalBalance$;
  /** The wallet's token events */
  readonly tokens$;
  /** The wallet's history events */
  readonly history$;
  /** The mint urls configured on the wallet (undefined until unlocked) */
  readonly mintUrls$;
  /** The cached cashu-ts Mint instances for the wallet's mints (reused across mint list changes) */
  readonly mints$: ChainableObservable<Mint[]>;
  /** The relays configured on the wallet (undefined until unlocked) */
  readonly walletRelays$;
  /** Whether the wallet event is currently unlocked */
  readonly unlocked$;
  /** The number of token events */
  readonly tokenCount$;
  /** The number of history events */
  readonly historyCount$;
  /** How the wallet's token events are spread across its relays */
  readonly tokenRelayCoverage$: Observable<TokenRelayCoverage>;
  /** Token events marked as deleted by a newer token event but still present (cleanup candidates) */
  readonly staleTokens$: Observable<NostrEvent[]>;
  /** The number of token events that are marked deleted but still present */
  readonly staleTokenCount$: Observable<number>;

  // ---- Status / debugging observables ----
  /** The high-level lifecycle status of the wallet */
  readonly status$;
  /** Whether the initial load is in progress */
  readonly loadingState$ = this.loading$.asObservable();
  /** Whether a negentropy sync is in progress */
  readonly syncingState$ = this.syncing$.asObservable();
  /** The most recent error (cleared at the start of each operation) */
  readonly errorState$ = this.error$.asObservable();
  /** A map of operation name to whether it is currently running */
  readonly operationsState$ = this.operations$.asObservable();
  /** Whether any async operation is currently running */
  readonly busy$;
  /** A map of relay url to whether it supports NIP-77 negentropy sync */
  readonly negentropySupport$ = this.negentropy$.asObservable();
  /** Per-relay connection status for the wallet's relays */
  readonly relayStatus$: Observable<RelayStatusInfo[]>;
  /** The tokens currently held in the couch (refreshed after operations and via refreshCouch) */
  readonly couchTokens$ = this.couch$.asObservable();

  protected loadingSub?: Subscription;
  protected autoUnlockSub?: Subscription;
  protected unlocking = false;
  protected backupPromise?: Promise<void>;

  constructor(options: NutWalletOptions) {
    this.pubkey = options.pubkey;
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore;
    this.couch = options.couch;
    this.autoUnlock = options.autoUnlock ?? false;
    this.useDeleteEvents = options.useDeleteEvents ?? false;
    this.decryptionCache = options.decryptionCache;
    this.log = options.logger ?? baseLogger.extend("nut-wallet").extend(this.pubkey.slice(0, 8));

    this.user = castUser(this.pubkey, this.eventStore);

    // The action runner publishes events to the wallet's relays + the user's outboxes
    this.actions = new ActionRunner(this.eventStore, this.signer as EventSigner, (event, relays) =>
      this.publish(event, relays),
    );

    // Wallet state observables (derived from the registered user.wallet$ cast)
    this.wallet$ = this.user.wallet$;
    this.balance$ = this.wallet$.balance$;
    this.totalBalance$ = this.balance$.pipe(
      map((balance) => (balance ? Object.values(balance).reduce((sum, amount) => sum + amount, 0) : 0)),
    );
    this.tokens$ = this.wallet$.tokens$;
    this.history$ = this.wallet$.history$;
    this.mintUrls$ = this.wallet$.mints$;
    // Map the mint urls to cached Mint instances, reusing instances for urls that haven't changed
    this.mints$ = chainable(
      this.mintUrls$.pipe(
        map((urls) => urls ?? []),
        distinctUntilChanged(sameStringSet),
        map((urls) => {
          // Drop cached wallets for mints that are no longer configured
          const keys = new Set(urls.map(normalizeURL));
          for (const key of this.wallets.keys()) if (!keys.has(key)) this.wallets.delete(key);
          return this.syncMints(urls);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      ),
    );
    this.walletRelays$ = this.wallet$.relays$;
    this.unlocked$ = this.wallet$.pipe(map((w) => w?.unlocked ?? false));
    this.tokenCount$ = this.tokens$.pipe(map((tokens) => tokens?.length ?? 0));
    this.historyCount$ = this.history$.pipe(map((history) => history?.length ?? 0));

    // Coverage of token events across the wallet's relays
    this.tokenRelayCoverage$ = combineLatest([
      this.tokens$.pipe(map((tokens) => tokens ?? [])),
      this.walletRelays$.pipe(
        map((relays) => relays ?? []),
        startWith([] as string[]),
      ),
    ]).pipe(map(([tokens, walletRelays]) => computeTokenRelayCoverage(tokens, walletRelays)));

    // Token events that newer token events have marked as deleted but are still present
    this.staleTokens$ = this.eventStore.model(WalletDeletedTokensModel, this.pubkey);
    this.staleTokenCount$ = this.staleTokens$.pipe(map((tokens) => tokens.length));

    // Status enum derived from the lifecycle subjects and the wallet
    this.status$ = combineLatest([this.started$, this.loaded$, this.wallet$.pipe(startWith(undefined))]).pipe(
      map(([started, loaded, wallet]) => {
        if (!started) return WalletStatus.Idle;
        if (!loaded) return WalletStatus.Loading;
        return wallet ? WalletStatus.Ready : WalletStatus.Missing;
      }),
    );

    this.busy$ = this.operations$.pipe(map((operations) => Object.values(operations).some(Boolean)));

    // Resolve the relays used for loading and publishing
    if (options.relays) {
      this.relays$ = isObservable(options.relays) ? chainable(options.relays) : chainable(of(options.relays));
      if (Array.isArray(options.relays)) this.fallbackRelays = options.relays;
    } else {
      this.relays$ = chainable(
        combineLatest([
          this.walletRelays$.pipe(
            map((r) => r ?? []),
            startWith([] as string[]),
          ),
          this.user.outboxes$.pipe(
            map((r) => r ?? []),
            startWith([] as string[]),
          ),
        ]).pipe(map(([wallet, outboxes]) => relaySet(wallet, outboxes))),
      );
    }

    // Per-relay connection status
    this.relayStatus$ = combineLatest([
      this.relays$,
      this.pool.status$.pipe(startWith({} as Record<string, RelayStatus>)),
      this.negentropy$,
    ]).pipe(
      map(([relays, statuses, support]) =>
        relays.map((url) => {
          const status = statuses[normalizeURL(url)] ?? statuses[url];
          return {
            url,
            connected: status?.connected ?? false,
            ready: status?.ready ?? false,
            authenticated: status?.authenticated ?? false,
            negentropy: support[url],
          } satisfies RelayStatusInfo;
        }),
      ),
    );
  }

  /** Creates a new NIP-60 wallet and returns a started {@link NutWallet} */
  static async create(options: NutWalletOptions, wallet: CreateWalletOptions): Promise<NutWallet> {
    const instance = new NutWallet(options);
    await instance.createWallet(wallet);
    await instance.start();
    return instance;
  }

  /** Creates and publishes a new NIP-60 wallet event for this pubkey */
  async createWallet(wallet: CreateWalletOptions): Promise<void> {
    await this.track("create", async () => {
      this.log("Creating wallet with %d mints", wallet.mints.length);
      await this.actions.run(CreateWallet, {
        mints: wallet.mints,
        privateKey: wallet.privateKey,
        relays: wallet.relays,
      });
    });
  }

  /** Begins loading wallet events and watching for auto-unlock */
  async start(): Promise<void> {
    if (this.started$.value) return;
    this.log("Starting wallet");
    this.started$.next(true);

    this.subscribeLoader();
    this.subscribeAutoUnlock();
    await this.refreshCouch();
  }

  /** Stops all loading and auto-unlocking */
  stop(): void {
    this.log("Stopping wallet");
    this.started$.next(false);
    this.loadingSub?.unsubscribe();
    this.loadingSub = undefined;
    this.autoUnlockSub?.unsubscribe();
    this.autoUnlockSub = undefined;
    this.wallets.clear();
    this.disposeMints();
  }

  /** Alias for {@link stop} */
  dispose(): void {
    this.stop();
  }

  /** Re-runs the initial load and negentropy sync against the current relay set */
  resync(): void {
    if (!this.started$.value) {
      void this.start();
      return;
    }
    this.log("Resyncing wallet");
    this.loaded$.next(false);
    this.subscribeLoader();
  }

  /** Reloads the list of tokens currently held in the couch */
  async refreshCouch(): Promise<void> {
    try {
      const tokens = await this.couch.getAll();
      this.couch$.next(tokens);
    } catch (error) {
      this.log("Failed to read couch: %s", (error as Error)?.message ?? error);
    }
  }

  /** Enables or disables automatic unlocking */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock = enabled;
  }

  /**
   * Enables or disables publishing NIP-09 delete events for old token events during spend, rollover and
   * consolidate operations. When disabled, spent token events are left on relays until
   * {@link cleanupDeletedTokens} removes them in a single batched delete. This only affects publishing; to
   * also change whether the wallet loads and subscribes to delete events, call {@link resync} afterwards.
   */
  setUseDeleteEvents(enabled: boolean): void {
    this.useDeleteEvents = enabled;
  }

  /** Unlocks the wallet event and all of its token and history events */
  async unlock(): Promise<void> {
    if (this.unlocking) return;
    this.unlocking = true;
    try {
      await this.track("unlock", async () => {
        this.log("Unlocking wallet, tokens and history");

        // Restore any cached content before decrypting so the action only decrypts cache misses
        const events = this.getEncryptedEvents();
        await this.restoreFromCache(events);

        await this.actions.run(UnlockWallet, { history: true, tokens: true });

        // Persist any newly decrypted content back to the cache
        await this.persistToCache(events);
      });
    } finally {
      this.unlocking = false;
    }
  }

  /** Collects the wallet, token and history events that can hold encrypted content */
  protected getEncryptedEvents(): NostrEvent[] {
    const events: NostrEvent[] = [];
    const wallet = this.eventStore.getReplaceable(WALLET_KIND, this.pubkey);
    if (wallet) events.push(wallet);
    events.push(...this.eventStore.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [this.pubkey] }));
    events.push(...this.eventStore.getByFilters({ kinds: [WALLET_HISTORY_KIND], authors: [this.pubkey] }));
    return events;
  }

  /**
   * Restores decrypted content from the {@link decryptionCache} onto locked events. Setting the content
   * cache lets the unlock helpers short-circuit before performing the expensive NIP-44 decryption.
   */
  protected async restoreFromCache(events: NostrEvent[]): Promise<void> {
    const cache = this.decryptionCache;
    if (!cache) return;

    for (const event of events) {
      // Skip events that cannot have encrypted content or are already unlocked
      if (!canHaveEncryptedContent(event.kind) || isEncryptedContentUnlocked(event)) continue;

      try {
        const content = await cache.getItem(event.id);
        if (typeof content !== "string") continue;

        // Mark as from cache so it is not persisted again, then restore the content
        markEncryptedContentFromCache(event);
        setEncryptedContentCache(event, content);
        this.log("Restored encrypted content for %s from cache", event.id.slice(0, 8));
      } catch (error) {
        this.log(
          "Failed to restore encrypted content for %s: %s",
          event.id.slice(0, 8),
          (error as Error)?.message ?? error,
        );
      }
    }
  }

  /** Persists the decrypted content of unlocked events to the {@link decryptionCache} */
  protected async persistToCache(events: NostrEvent[]): Promise<void> {
    const cache = this.decryptionCache;
    if (!cache) return;

    for (const event of events) {
      // Only persist content that is unlocked and did not come from the cache
      if (!isEncryptedContentUnlocked(event) || isEncryptedContentFromCache(event)) continue;

      const content = getEncryptedContent(event);
      if (!content) continue;

      try {
        await cache.setItem(event.id, content);
        // Mark as from cache so repeated unlock cycles do not persist it again
        markEncryptedContentFromCache(event);
        this.log("Persisted encrypted content for %s to cache", event.id.slice(0, 8));
      } catch (error) {
        this.log(
          "Failed to persist encrypted content for %s: %s",
          event.id.slice(0, 8),
          (error as Error)?.message ?? error,
        );
      }
    }
  }

  /** Locks the wallet, token and history events in the event store */
  async lock(): Promise<void> {
    await this.track("lock", async () => {
      this.log("Locking wallet, tokens and history");
      const wallet = this.eventStore.getReplaceable(WALLET_KIND, this.pubkey);
      if (wallet) {
        lockWallet(wallet);
        notifyEventUpdate(wallet);
      }
      for (const token of this.eventStore.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [this.pubkey] })) {
        lockTokenContent(token);
        notifyEventUpdate(token);
      }
      for (const entry of this.eventStore.getByFilters({ kinds: [WALLET_HISTORY_KIND], authors: [this.pubkey] })) {
        lockHistoryContent(entry);
        notifyEventUpdate(entry);
      }
    });
  }

  /**
   * Creates a Cashu token to send and returns the encoded token string.
   * @param amount the amount to send in sats
   * @param options.mint restrict the send to a specific mint (otherwise any mint with enough balance is used)
   */
  async sendToken(amount: number, options?: { mint?: string }): Promise<string> {
    return this.track("send", async () => {
      // Reuse a single loaded wallet instance when the mint is known up front
      const wallet = options?.mint ? await this.getCashuWallet(options.mint) : undefined;
      let encoded: string | undefined;
      await this.actions.run(
        TokensOperation,
        amount,
        async ({ selectedProofs, mint, cashuWallet }) => {
          const { keep, send } = await cashuWallet.ops.send(amount, selectedProofs).run();
          encoded = getEncodedToken({ mint, proofs: send, unit: "sat" });
          return { change: keep.length > 0 ? keep : undefined };
        },
        {
          mint: options?.mint,
          couch: this.couch,
          wallet,
          getCashuWallet: this.getCashuWallet,
          createDeleteEvents: this.useDeleteEvents,
        },
      );
      if (!encoded) throw new Error("Failed to create token");
      this.log("Created token for %d sats", amount);
      await this.refreshCouch();
      return encoded;
    });
  }

  /** Receives a Cashu token (encoded string or decoded {@link Token}) into the wallet */
  async receiveToken(token: string | Token): Promise<void> {
    await this.track("receive", async () => {
      const decoded = typeof token === "string" ? getDecodedToken(token, []) : token;
      if (!decoded) throw new Error("Failed to decode token");
      this.log("Receiving token from mint %s", decoded.mint);
      const wallet = await this.getCashuWallet(decoded.mint);
      await this.actions.run(ReceiveToken, decoded, { couch: this.couch, wallet, getCashuWallet: this.getCashuWallet });
      await this.refreshCouch();
    });
  }

  /** Receives one or more NIP-61 nutzap events into the wallet */
  async receiveNutzaps(events: NostrEvent | NostrEvent[]): Promise<void> {
    await this.track("receive", async () => {
      const count = Array.isArray(events) ? events.length : 1;
      this.log("Receiving %d nutzap event%s", count, count === 1 ? "" : "s");
      await this.actions.run(ReceiveNutzaps, events, this.couch);
      await this.refreshCouch();
    });
  }

  /**
   * Creates a bolt11 mint quote (lightning invoice) to deposit `amount` sats into a mint.
   * Pay the returned `request` invoice, then wait for it with {@link waitForMintQuote} and redeem it
   * with {@link redeemMintQuote} (or use {@link mint} to do all three in one call).
   */
  async createMintQuote(mint: string, amount: number, description?: string): Promise<MintQuoteBolt11Response> {
    return this.track("mintQuote", async () => {
      this.log("Creating mint quote for %d sats at %s", amount, mint);
      const cashuWallet = await this.getCashuWallet(mint);
      return cashuWallet.createMintQuoteBolt11(amount, description);
    });
  }

  /**
   * Waits for a bolt11 mint quote to be paid. Uses a NIP-17 WebSocket subscription when the mint
   * supports it and falls back to polling the quote otherwise.
   * @param options.signal aborts the wait
   * @param options.timeoutMs rejects after this many milliseconds
   * @param options.interval polling interval in ms when the mint does not support NIP-17 (default 3000)
   */
  async waitForMintQuote(
    mint: string,
    quote: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; interval?: number },
  ): Promise<MintQuoteBolt11Response> {
    const cashuWallet = await this.getCashuWallet(mint);
    if (await this.mintSupports(mint, 17)) {
      this.log("Waiting for mint quote %s via websocket", quote);
      return cashuWallet.on.onceMintPaid(quote, { signal: options?.signal, timeoutMs: options?.timeoutMs });
    }
    this.log("Waiting for mint quote %s via polling", quote);
    return this.pollMintQuote(cashuWallet, quote, options);
  }

  /** Redeems an already-paid bolt11 mint quote, minting proofs and adding them to the wallet */
  async redeemMintQuote(mint: string, amount: number, quote: string | MintQuoteBolt11Response): Promise<void> {
    await this.track("mint", async () => {
      this.log("Redeeming mint quote for %d sats at %s", amount, mint);
      const wallet = await this.getCashuWallet(mint);
      await this.actions.run(MintTokens, mint, amount, quote, {
        couch: this.couch,
        wallet,
        getCashuWallet: this.getCashuWallet,
      });
      await this.refreshCouch();
    });
  }

  /**
   * Deposits funds into a mint using the given payment method, minting the resulting proofs into the
   * wallet. This is the method-agnostic entry point; new payment methods are added as additional
   * {@link DepositOptions} variants without changing this signature.
   *
   * For bolt11 it creates a mint quote, surfaces the invoice via `onQuote`, waits for it to be paid,
   * and redeems the proofs.
   */
  async deposit(options: DepositOptions): Promise<void> {
    const method = options.method ?? "bolt11";
    switch (method) {
      case "bolt11": {
        const { mint, amount, description, onQuote, signal, timeoutMs } = options;
        const quote = await this.createMintQuote(mint, amount, description);
        onQuote?.(quote);
        await this.waitForMintQuote(mint, quote.quote, { signal, timeoutMs });
        await this.redeemMintQuote(mint, amount, quote);
        return;
      }
      default:
        throw new Error(`Unsupported deposit method: ${method}`);
    }
  }

  /**
   * Withdraws funds from a mint's balance using the given payment method (melts ecash). This is the
   * method-agnostic entry point; {@link payInvoice} is the bolt11 alias. New payment methods are added
   * as additional {@link WithdrawOptions} variants without changing this signature.
   * @returns the cashu melt response, including any change proofs returned by the mint
   */
  async withdraw(options: WithdrawOptions): Promise<Bolt11WithdrawResponse> {
    const method = options.method ?? "bolt11";
    switch (method) {
      case "bolt11": {
        const { mint, invoice } = options;
        return this.performMelt(
          mint,
          async (cashuWallet) => {
            const quote = await cashuWallet.createMeltQuoteBolt11(invoice);
            return { quote, amount: quote.amount.toNumber(), feeReserve: quote.fee_reserve.toNumber() };
          },
          (cashuWallet, quote, send) => cashuWallet.meltProofsBolt11(quote, send),
        );
      }
      default:
        throw new Error(`Unsupported withdraw method: ${method}`);
    }
  }

  /**
   * Pays a bolt11 lightning invoice from a specific mint's balance (melts ecash to lightning). A thin
   * alias for {@link withdraw} with `method: "bolt11"`.
   * @returns the cashu melt response, including any change proofs returned by the mint
   */
  async payInvoice(mint: string, invoice: string): Promise<Bolt11WithdrawResponse> {
    return this.withdraw({ method: "bolt11", mint, invoice });
  }

  /** Combines all unlocked token events into a single event per mint */
  async consolidateTokens(): Promise<void> {
    await this.track("consolidate", async () => {
      this.log("Consolidating tokens");
      await this.actions.run(ConsolidateTokens, {
        unlockTokens: true,
        getCashuWallet: this.getCashuWallet,
        createDeleteEvents: this.useDeleteEvents,
      });
      await this.refreshCouch();
    });
  }

  /**
   * Rolls every unlocked token over to a fresh cashu token. For each mint the proofs are swapped at the mint
   * (rotating the secrets) and a single new token event is created whose `del` field references the
   * rolled-over token events. Unlike {@link consolidateTokens}, this swaps the proofs at the mint even when a
   * mint only has a single token event, so it is a good way to exercise the `del` reconciliation flow end to
   * end. Every new token event is published together with a single batched delete event covering all mints,
   * keeping signer operations to a minimum.
   */
  async rollover(): Promise<void> {
    await this.track("rollover", async () => {
      this.log("Rolling over tokens");
      await this.actions.run(RolloverTokens, {
        unlockTokens: true,
        couch: this.couch,
        getCashuWallet: this.getCashuWallet,
        createDeleteEvents: this.useDeleteEvents,
      });
      await this.refreshCouch();
    });
  }

  /**
   * Publishes a single NIP-09 delete event for every token event that a newer token event has marked as
   * deleted but is still present. Cleans up the spent token events left on relays when operations run
   * with {@link setUseDeleteEvents} disabled.
   */
  async cleanupDeletedTokens(): Promise<void> {
    await this.track("cleanup", async () => {
      this.log("Cleaning up deleted token events");
      await this.actions.run(CleanupDeletedTokens);
      await this.refreshCouch();
    });
  }

  /** Recovers any unspent tokens left in the couch back into the wallet */
  async recoverFromCouch(): Promise<void> {
    await this.track("recover", async () => {
      this.log("Recovering tokens from couch");
      await this.actions.run(RecoverFromCouch, this.couch, { getCashuWallet: this.getCashuWallet });
      await this.refreshCouch();
    });
  }

  /** Re-publishes all token events to the wallet's relays */
  async syncTokens(): Promise<void> {
    await this.track("sync", async () => {
      const [tokens, relays] = await Promise.all([
        this.tokens$.$first(5_000, undefined),
        this.relays$.$first(5_000, [] as string[]),
      ]);

      if (!tokens?.length) return this.log("No tokens to sync");
      if (relays.length === 0) throw new Error("No relays configured to sync tokens");

      this.log("Syncing %d tokens to %d relays", tokens.length, relays.length);
      for (const token of tokens) {
        try {
          const responses = await this.pool.publish(relays, token.event);
          for (const response of responses) if (response.ok) addSeenRelay(token.event, response.from);
        } catch (error) {
          this.log("Failed to sync token %s: %s", token.id.slice(0, 8), (error as Error)?.message ?? error);
        }
      }
    });
  }

  /** Sets the mints configured on the wallet */
  async setMints(mints: string[]): Promise<void> {
    await this.track("setMints", async () => {
      this.log("Setting %d wallet mints", mints.length);
      await this.actions.run(SetWalletMints, mints);
    });
  }

  /** Sets the relays configured on the wallet */
  async setRelays(relays: string[]): Promise<void> {
    await this.track("setRelays", async () => {
      this.log("Setting %d wallet relays", relays.length);
      await this.actions.run(SetWalletRelays, relays);
    });
  }

  // ---- Internal helpers ----

  /** Subscribes to the loading stream and maps its status to the lifecycle subjects */
  protected subscribeLoader(): void {
    this.loadingSub?.unsubscribe();
    this.loadingSub = loadWalletEvents({
      pool: this.pool,
      eventStore: this.eventStore,
      pubkey: this.pubkey,
      relays$: this.relays$,
      useDeleteEvents: this.useDeleteEvents,
      logger: this.log,
    }).subscribe({
      next: (status) => this.applyStatus(status),
      error: (error) => {
        this.log("Loading stream errored: %s", (error as Error)?.message ?? error);
        this.error$.next(error as Error);
      },
    });
  }

  /** Applies a {@link WalletLoaderStatus} update to the lifecycle subjects */
  protected applyStatus(status: WalletLoaderStatus): void {
    switch (status.type) {
      case "loading":
        this.loading$.next(true);
        break;
      case "loaded":
        this.loading$.next(false);
        this.loaded$.next(true);
        void this.backupWalletEvents();
        break;
      case "syncing":
        this.syncing$.next(true);
        break;
      case "synced":
        this.syncing$.next(false);
        break;
      case "negentropy-support":
        this.negentropy$.next(status.support);
        break;
      case "error":
        this.error$.next(status.error);
        break;
      case "relays":
        break;
    }
  }

  /** Publishes loaded wallet events only to configured relays that are missing them */
  protected async backupWalletEvents(): Promise<void> {
    if (this.backupPromise) return this.backupPromise;

    this.backupPromise = this.track("sync", async () => {
      const relays = relaySet(await this.relays$.$first(5_000, [] as string[]));
      if (relays.length === 0) return;

      const events = this.getWalletBackupEvents();
      let published = 0;

      for (const event of events) {
        const seen = new Set([...(getSeenRelays(event) ?? [])].map(normalizeURL));
        const missing = relays.filter((relay) => !seen.has(normalizeURL(relay)));
        if (missing.length === 0) continue;

        try {
          const responses = await this.pool.publish(missing, event);
          for (const response of responses) {
            if (response.ok) addSeenRelay(event, response.from);
          }
          published++;
        } catch (error) {
          this.log("Failed to backup event %s: %s", event.id.slice(0, 8), (error as Error)?.message ?? error);
        }
      }

      if (published > 0) this.log("Backed up %d wallet events", published);
    }).finally(() => {
      this.backupPromise = undefined;
    });

    return this.backupPromise;
  }

  /** Returns wallet-owned events that should be backed up to every wallet relay */
  protected getWalletBackupEvents(): NostrEvent[] {
    const wallet = this.eventStore.getReplaceable(WALLET_KIND, this.pubkey);
    return [
      ...(wallet ? [wallet] : []),
      ...this.eventStore.getByFilters({ kinds: [WALLET_TOKEN_KIND], authors: [this.pubkey] }),
      ...this.eventStore.getByFilters({ kinds: [WALLET_HISTORY_KIND], authors: [this.pubkey] }),
      ...this.eventStore.getByFilters({
        kinds: [kinds.EventDeletion],
        authors: [this.pubkey],
        "#k": [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND].map(String),
      }),
    ];
  }

  /** Watches for locked wallet, token and history events and unlocks them when auto-unlock is enabled */
  protected subscribeAutoUnlock(): void {
    if (this.autoUnlockSub) return;
    this.autoUnlockSub = combineLatest([
      this.wallet$.pipe(startWith(undefined)),
      this.tokens$.pipe(startWith(undefined)),
      this.history$.pipe(startWith(undefined)),
    ]).subscribe(([wallet, tokens, history]) => {
      if (!this.autoUnlock || this.unlocking || !wallet) return;

      const needsUnlock =
        !wallet.unlocked ||
        !!tokens?.some((token) => token.unlocked === false) ||
        !!history?.some((entry) => entry.unlocked === false);

      if (needsUnlock) this.unlock().catch((error) => this.log("Auto-unlock failed: %s", error?.message ?? error));
    });
  }

  /**
   * Returns a cached, loaded cashu {@link CashuWallet} for a mint, building it from the cached {@link Mint}.
   * Bound to the instance so it can be passed to actions as a wallet provider.
   */
  protected getCashuWallet = (mint: string): Promise<CashuWallet> => {
    const key = normalizeURL(mint);
    let wallet = this.wallets.get(key);
    if (!wallet) {
      wallet = (async () => {
        const instance = new CashuWallet(this.getMint(mint));
        await instance.loadMint();
        return instance;
      })();
      // Drop the cache entry if loading fails so the next call retries
      wallet.catch(() => this.wallets.delete(key));
      this.wallets.set(key, wallet);
    }
    return wallet;
  };

  /** Returns whether the mint at a url supports a given NUT number */
  protected async mintSupports(mint: string, nut: number): Promise<boolean> {
    const info = await this.getMint(mint).getLazyMintInfo();
    return info.isSupported(nut as Parameters<typeof info.isSupported>[0]).supported;
  }

  /** Returns the cached {@link Mint} for a url, creating it if it does not exist */
  protected getMint(url: string): Mint {
    const key = normalizeURL(url);
    let mint = this.mints.get(key);
    if (!mint) {
      mint = new Mint(key);
      this.mints.set(key, mint);
    }
    return mint;
  }

  /**
   * Reconciles the mint cache to a set of urls and returns the matching {@link Mint} instances.
   * Mints that are no longer in the list have their WebSocket disconnected and are dropped.
   */
  protected syncMints(urls: string[]): Mint[] {
    const keys = new Set(urls.map(normalizeURL));
    for (const [key, mint] of this.mints) {
      if (!keys.has(key)) {
        mint.disconnectWebSocket();
        this.mints.delete(key);
      }
    }
    return urls.map((url) => this.getMint(url));
  }

  /** Disconnects every cached mint's WebSocket and clears the mint cache */
  protected disposeMints(): void {
    for (const mint of this.mints.values()) mint.disconnectWebSocket();
    this.mints.clear();
  }

  /** Polls a bolt11 mint quote until it is paid (fallback for mints without NIP-17 support) */
  protected async pollMintQuote(
    cashuWallet: CashuWallet,
    quote: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; interval?: number },
  ): Promise<MintQuoteBolt11Response> {
    const interval = options?.interval ?? 3_000;
    const deadline = options?.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined;

    for (;;) {
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const status = await cashuWallet.checkMintQuoteBolt11(quote);
      if (status.state === MintQuoteState.PAID || status.state === MintQuoteState.ISSUED) return status;

      if (deadline !== undefined && Date.now() + interval > deadline)
        throw new Error(`Mint quote ${quote} was not paid within the timeout`);

      await sleep(interval, options?.signal);
    }
  }

  /**
   * Shared melt orchestration for every payment method. Creates a method-specific melt quote, selects
   * proofs for the amount + fee reserve (under couch safety), melts them via the method-specific call,
   * and keeps any remainder plus the mint's change. The two callbacks isolate the only
   * payment-method-specific steps so new methods (bolt12, onchain) reuse this body.
   */
  protected async performMelt<Q extends Pick<MeltQuoteBaseResponse, "quote">>(
    mint: string,
    createQuote: (cashuWallet: CashuWallet) => Promise<{ quote: Q; amount: number; feeReserve: number }>,
    melt: (cashuWallet: CashuWallet, quote: Q, send: Proof[]) => Promise<MeltProofsResponse<Q>>,
  ): Promise<MeltProofsResponse<Q>> {
    return this.track("melt", async () => {
      // Create the melt quote first so we know the exact amount + fee reserve to select
      const quoteWallet = await this.getCashuWallet(mint);
      const { quote, amount, feeReserve } = await createQuote(quoteWallet);
      this.log("Melting %d sats (+%d fee reserve) at %s", amount, feeReserve, mint);

      let response: MeltProofsResponse<Q> | undefined;
      await this.actions.run(
        TokensOperation,
        amount + feeReserve,
        async ({ selectedProofs, cashuWallet }) => {
          // Set aside the amount + fee reserve to melt and keep any remainder as change
          const { keep, send } = await cashuWallet.ops
            .send(amount + feeReserve, selectedProofs)
            .includeFees(true)
            .run();
          response = await melt(cashuWallet, quote, send);
          return { change: [...keep, ...response.change] };
        },
        {
          mint,
          couch: this.couch,
          wallet: quoteWallet,
          getCashuWallet: this.getCashuWallet,
          createDeleteEvents: this.useDeleteEvents,
        },
      );
      if (!response) throw new Error("Failed to melt token");
      this.log("Melted token at %s", mint);
      await this.refreshCouch();
      return response;
    });
  }

  /** Runs an async operation while tracking its busy state and surfacing any error */
  protected async track<T>(name: NutWalletOperation, fn: () => Promise<T>): Promise<T> {
    this.setOperation(name, true);
    this.error$.next(null);
    try {
      return await fn();
    } catch (error) {
      this.error$.next(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this.setOperation(name, false);
    }
  }

  /** Sets the running state of a named operation */
  protected setOperation(name: NutWalletOperation, value: boolean): void {
    this.operations$.next({ ...this.operations$.value, [name]: value });
  }

  /**
   * Resolves the relays an event should be published to: the relays passed by the action, plus the wallet's
   * own relays and the user's outbox relays. Read synchronously so publishing is never blocked on loading.
   */
  protected resolvePublishRelays(extra?: string[]): string[] {
    const wallet = this.eventStore.getReplaceable(WALLET_KIND, this.pubkey);
    const mailboxes = this.eventStore.getReplaceable(kinds.RelayList, this.pubkey);
    return relaySet(extra, wallet && getWalletRelays(wallet), mailboxes && getOutboxes(mailboxes), this.fallbackRelays);
  }

  /** Publishes a single event to the resolved relay set */
  protected async publish(event: NostrEvent, relays?: string[]): Promise<void> {
    const targets = this.resolvePublishRelays(relays);
    if (targets.length === 0) throw new Error("No relays available to publish event");
    this.log("Publishing event %s (kind %d) to %d relays", event.id.slice(0, 8), event.kind, targets.length);
    const responses = await this.pool.publish(targets, event);
    for (const response of responses) if (response.ok) addSeenRelay(event, response.from);
  }
}

export type {
  Bolt11DepositOptions,
  Bolt11WithdrawOptions,
  Bolt11WithdrawResponse,
  CreateWalletOptions,
  DepositOptions,
  NutWalletOperation,
  NutWalletOptions,
  RelayStatusInfo,
  TokenCoverage,
  TokenRelayCoverage,
  WithdrawOptions,
} from "./types.js";
export { WalletStatus };
export type { Wallet, WalletHistory, WalletToken };
