import { getDecodedToken, getEncodedToken, Token } from "@cashu/cashu-ts";
import { ActionRunner } from "applesauce-actions";
import type { EventSigner } from "applesauce-core";
import { EventStore, logger as baseLogger } from "applesauce-core";
import { castUser, User } from "applesauce-core/casts";
import type { NostrEvent } from "applesauce-core/helpers";
import { getOutboxes, kinds, normalizeURL, notifyEventUpdate, relaySet } from "applesauce-core/helpers";
import type { RelayPool, RelayStatus } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Debugger } from "debug";
import {
  BehaviorSubject,
  combineLatest,
  firstValueFrom,
  isObservable,
  Observable,
  of,
  Subscription,
  timeout,
} from "rxjs";
import { map, startWith, switchMap } from "rxjs/operators";

import {
  ConsolidateTokens,
  CreateWallet,
  ReceiveToken,
  RecoverFromCouch,
  SetWalletMints,
  SetWalletRelays,
  TokensOperation,
  UnlockWallet,
} from "../actions/index.js";
import type { Wallet } from "../casts/wallet.js";
import type { WalletHistory } from "../casts/wallet-history.js";
import type { WalletToken } from "../casts/wallet-token.js";
import type { Couch } from "../helpers/couch.js";
import { lockHistoryContent, WALLET_HISTORY_KIND } from "../helpers/history.js";
import { lockTokenContent, WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { getWalletRelays, lockWallet, WALLET_KIND } from "../helpers/wallet.js";
import { loadWalletEvents, WalletLoaderStatus } from "./loading.js";
import {
  type CreateWalletOptions,
  type NutWalletOperation,
  type NutWalletOptions,
  type RelayStatusInfo,
  type TokenRelayCoverage,
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

  protected user: User;
  protected actions: ActionRunner;
  protected log: Debugger;
  /** Static relays passed by the caller, used as a publishing fallback before the wallet loads */
  protected fallbackRelays?: string[];

  // ---- Internal state subjects ----
  protected started$ = new BehaviorSubject<boolean>(false);
  protected loading$ = new BehaviorSubject<boolean>(false);
  protected loaded$ = new BehaviorSubject<boolean>(false);
  protected syncing$ = new BehaviorSubject<boolean>(false);
  protected error$ = new BehaviorSubject<Error | null>(null);
  protected operations$ = new BehaviorSubject<Partial<Record<NutWalletOperation, boolean>>>({});
  protected negentropy$ = new BehaviorSubject<Record<string, boolean>>({});
  protected autoUnlock$ = new BehaviorSubject<boolean>(false);
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
  /** The mints configured on the wallet (undefined until unlocked) */
  readonly mints$;
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
  /** Whether auto-unlock is enabled */
  readonly autoUnlockState$ = this.autoUnlock$.asObservable();
  /** A map of relay url to whether it supports NIP-77 negentropy sync */
  readonly negentropySupport$ = this.negentropy$.asObservable();
  /** Per-relay connection status for the wallet's relays */
  readonly relayStatus$: Observable<RelayStatusInfo[]>;
  /** The tokens currently held in the couch (refreshed after operations and via refreshCouch) */
  readonly couchTokens$ = this.couch$.asObservable();

  protected loadingSub?: Subscription;
  protected autoUnlockSub?: Subscription;
  protected unlocking = false;

  constructor(options: NutWalletOptions) {
    this.pubkey = options.pubkey;
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore;
    this.couch = options.couch;
    this.autoUnlock$.next(options.autoUnlock ?? false);
    this.log = options.logger ?? baseLogger.extend("nut-wallet").extend(this.pubkey.slice(0, 8));

    this.user = castUser(this.pubkey, this.eventStore);

    // The action runner publishes events to the wallet's relays + the user's outboxes
    this.actions = new ActionRunner(this.eventStore, this.signer as EventSigner, (event, relays) =>
      this.publish(event, relays),
    );

    // Wallet state observables (derived from the registered user.wallet$ cast)
    this.wallet$ = this.user.wallet$;
    this.balance$ = this.wallet$.pipe(switchMap((w) => (w ? w.balance$ : of(undefined))));
    this.totalBalance$ = this.balance$.pipe(
      map((balance) => (balance ? Object.values(balance).reduce((sum, amount) => sum + amount, 0) : 0)),
    );
    this.tokens$ = this.wallet$.pipe(switchMap((w) => (w ? w.tokens$ : of(undefined))));
    this.history$ = this.wallet$.pipe(switchMap((w) => (w ? w.history$ : of(undefined))));
    this.mints$ = this.wallet$.pipe(switchMap((w) => (w ? w.mints$ : of(undefined))));
    this.walletRelays$ = this.wallet$.pipe(switchMap((w) => (w ? w.relays$ : of(undefined))));
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
      this.relays$ = isObservable(options.relays) ? options.relays : of(options.relays);
      if (Array.isArray(options.relays)) this.fallbackRelays = options.relays;
    } else {
      this.relays$ = combineLatest([
        this.walletRelays$.pipe(
          map((r) => r ?? []),
          startWith([] as string[]),
        ),
        this.user.outboxes$.pipe(
          map((r) => r ?? []),
          startWith([] as string[]),
        ),
      ]).pipe(map(([wallet, outboxes]) => relaySet(wallet, outboxes)));
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
    this.autoUnlock$.next(enabled);
  }

  /** Unlocks the wallet event and all of its token and history events */
  async unlock(): Promise<void> {
    if (this.unlocking) return;
    this.unlocking = true;
    try {
      await this.track("unlock", async () => {
        this.log("Unlocking wallet, tokens and history");
        await this.actions.run(UnlockWallet, { history: true, tokens: true });
      });
    } finally {
      this.unlocking = false;
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
      let encoded: string | undefined;
      await this.actions.run(
        TokensOperation,
        amount,
        async ({ selectedProofs, mint, cashuWallet }) => {
          const { keep, send } = await cashuWallet.ops.send(amount, selectedProofs).run();
          encoded = getEncodedToken({ mint, proofs: send, unit: "sat" });
          return { change: keep.length > 0 ? keep : undefined };
        },
        { mint: options?.mint, couch: this.couch },
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
      await this.actions.run(ReceiveToken, decoded, { couch: this.couch });
      await this.refreshCouch();
    });
  }

  /** Combines all unlocked token events into a single event per mint */
  async consolidateTokens(): Promise<void> {
    await this.track("consolidate", async () => {
      this.log("Consolidating tokens");
      await this.actions.run(ConsolidateTokens, { unlockTokens: true });
      await this.refreshCouch();
    });
  }

  /** Recovers any unspent tokens left in the couch back into the wallet */
  async recoverFromCouch(): Promise<void> {
    await this.track("recover", async () => {
      this.log("Recovering tokens from couch");
      await this.actions.run(RecoverFromCouch, this.couch);
      await this.refreshCouch();
    });
  }

  /** Re-publishes all token events to the wallet's relays */
  async syncTokens(): Promise<void> {
    await this.track("sync", async () => {
      const tokens = await firstValueFrom(this.tokens$.pipe(timeout({ first: 5_000, with: () => of(undefined) })));
      const relays = await firstValueFrom(this.relays$.pipe(timeout({ first: 5_000, with: () => of([] as string[]) })));

      if (!tokens?.length) return this.log("No tokens to sync");
      if (relays.length === 0) throw new Error("No relays configured to sync tokens");

      this.log("Syncing %d tokens to %d relays", tokens.length, relays.length);
      for (const token of tokens) {
        try {
          await this.pool.publish(relays, token.event);
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

  /** Watches for locked wallet, token and history events and unlocks them when auto-unlock is enabled */
  protected subscribeAutoUnlock(): void {
    if (this.autoUnlockSub) return;
    this.autoUnlockSub = combineLatest([
      this.wallet$.pipe(startWith(undefined)),
      this.tokens$.pipe(startWith(undefined)),
      this.history$.pipe(startWith(undefined)),
      this.autoUnlock$,
    ]).subscribe(([wallet, tokens, history, autoUnlock]) => {
      if (!autoUnlock || this.unlocking || !wallet) return;

      const needsUnlock =
        !wallet.unlocked ||
        !!tokens?.some((token) => token.unlocked === false) ||
        !!history?.some((entry) => entry.unlocked === false);

      if (needsUnlock) this.unlock().catch((error) => this.log("Auto-unlock failed: %s", error?.message ?? error));
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
    await this.pool.publish(targets, event);
  }
}

export type {
  CreateWalletOptions,
  NutWalletOperation,
  NutWalletOptions,
  RelayStatusInfo,
  TokenCoverage,
  TokenRelayCoverage,
} from "./types.js";
export { WalletStatus };
export type { Wallet, WalletHistory, WalletToken };
