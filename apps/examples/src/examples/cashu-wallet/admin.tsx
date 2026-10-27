/**
 * Admin dashboard for the NIP-60 Cashu wallet implementation with management and debugging panels
 * @tags nip-60, nip-61, wallet, cashu, admin, debugging
 * @related cashu-wallet/cashu-wallet
 */
import { getEncodedToken, MintQuoteBolt11Response, normalizeProofAmounts } from "@cashu/cashu-ts";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { castUser } from "applesauce-common/casts";
import { parseBolt11, persistEncryptedContent } from "applesauce-common/helpers";
import { defined, EventStore } from "applesauce-core";
import { Filter, NostrEvent, persistEventsToCache, unixNow, generateSecretKey } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner, PrivateKeySigner } from "applesauce-signers";

import { WalletService, WalletServiceHandlers } from "applesauce-wallet-connect";
import { CashuWalletMethods, CommonWalletMethods, Transaction } from "applesauce-wallet-connect/helpers";
import { InsufficientBalanceError, NotFoundError } from "applesauce-wallet-connect/helpers/error";

import { NutWallet, WalletStatus } from "applesauce-wallet/wallet";
import { KeyValueCouch, IndexedDBCouch, migrateCouch } from "applesauce-wallet/helpers";
import { NostrIDB } from "nostr-idb";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
  BehaviorSubject,
  combineLatest,
  firstValueFrom,
  Observable,
  switchMap,
  map,
  of,
  shareReplay,
  Subject,
  exhaustMap,
  defer,
  startWith,
  catchError,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import QRCode from "../../components/qr-code";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.ditto.pub"];
const SUGGESTED_MINTS = ["https://mint.minibits.cash/Bitcoin", "https://mint2.nutmix.cash", "https://21mint.me"];
const SECTIONS = [
  "Overview",
  "Send",
  "Receive",
  "Deposit",
  "Withdraw",
  "Tokens",
  "History",
  "Connect",
  "Settings",
] as const;
type Section = (typeof SECTIONS)[number];

// ---- Application infrastructure (owned by the app, not the wallet) ----
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const session$ = new BehaviorSubject<{ signer: ISigner; pubkey: string } | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
async function importLegacyDeposit(storage: SecureStorage, wallet: NutWallet) {
  if (wallet.couch instanceof KeyValueCouch)
    await wallet.couch.importLegacy(storage, `example-encrypted-couch:wallet-proofs:${wallet.pubkey}`);
  return wallet.importLegacyDeposit(`wallet-deposit:${wallet.pubkey}`, storage);
}

// Decrypt hidden content using the encrypted storage
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Local event cache
const cache = new NostrIDB<NostrEvent>();
const cacheRequest = (filters: Filter[]) => cache.query(filters);
persistEventsToCache(eventStore, (events) => Promise.all(events.map((event) => cache.add(event))));

// Bootstrap loader for wallet + mailbox events
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: FALLBACK_RELAYS,
  cacheRequest,
});

// ---- Nostr Wallet Connect service (lets external NWC apps use this cashu wallet) ----
// Bind the wallet service transport to the shared relay pool
WalletService.pool = pool;

/** The wallet methods exposed over NWC */
type NwcMethods = CommonWalletMethods | CashuWalletMethods;

/** Persisted connection config so the service survives a page reload */
type ConnectConfig = { key: string; secret: string; relays: string[] };

/** The currently running wallet service (kept at module scope so it survives tab switches) */
const service$ = new BehaviorSubject<WalletService<NwcMethods> | null>(null);

/** In-memory lightning transactions, so list_transactions and lookup_invoice have something to return */
const nwcTransactions$ = new BehaviorSubject<Transaction[]>([]);
const depositControllers = new Map<AbortController, string>();

/** A simple in-memory request log for the NWC service, so you can see it working */
const requestLog$ = new BehaviorSubject<string[]>([]);

/** Appends a line to the request log (keeping the last 100) */
function logRequest(line: string) {
  const time = new Date().toLocaleTimeString();
  requestLog$.next([...requestLog$.value, `${time}  ${line}`].slice(-100));
}

/** Inserts or replaces a transaction (keyed by payment hash, falling back to the invoice) */
function upsertNwcTransaction(tx: Transaction): Transaction {
  const key = tx.payment_hash || tx.invoice;
  const rest = nwcTransactions$.value.filter((t) => (t.payment_hash || t.invoice) !== key);
  nwcTransactions$.next([tx, ...rest]);
  return tx;
}

const connectStorageKey = (pubkey: string) => `nwc-service:${pubkey}`;

async function loadConnectConfig(pubkey: string): Promise<ConnectConfig | null> {
  const storage = storage$.value;
  if (!storage) return null;
  const key = connectStorageKey(pubkey);
  let raw = await storage.getItem(key);
  const legacy = localStorage.getItem(key);
  if (!raw && legacy) {
    // Migrate this account's existing service credential only after its encrypted copy is durable.
    if (!(await storage.setItem(key, legacy))) throw new Error("Could not encrypt the saved service credential");
    localStorage.removeItem(key);
    raw = legacy;
  }
  return raw ? (JSON.parse(raw) as ConnectConfig) : null;
}
async function saveConnectConfig(pubkey: string, config: ConnectConfig | null) {
  const storage = storage$.value;
  if (!storage) throw new Error("Unlock encrypted storage first");
  const key = connectStorageKey(pubkey);
  if (config) {
    if (!(await storage.setItem(key, JSON.stringify(config))))
      throw new Error("Could not save encrypted service credential");
  } else await storage.removeItem(key);
}

/** Maps NWC method calls onto the NutWallet */
function createNwcHandlers(wallet: NutWallet): WalletServiceHandlers<NwcMethods> {
  const handlers: WalletServiceHandlers<NwcMethods> = {
    get_balance: async () => ({ balance: (await firstValueFrom(wallet.totalBalance$)) * 1000 }),
    cashu_list_mints: async () => {
      const balance = (await firstValueFrom(wallet.balance$)) ?? {};
      return { mints: Object.entries(balance).map(([url, amount]) => ({ url, balances: { sat: amount } })) };
    },
    cashu_withdraw: async ({ amount, mints }) => ({ token: await wallet.sendToken(amount, { mint: mints?.[0] }) }),
    cashu_deposit: async ({ token }) => {
      await wallet.receiveToken(token);
      return { success: true as const };
    },

    // ---- bolt11 lightning (mint = receive, melt = send) ----

    // make_invoice mints: create a mint quote, return its invoice, then redeem in the background once paid
    make_invoice: async ({ amount, description, description_hash }) => {
      const mint = (await firstValueFrom(wallet.mintUrls$))?.[0];
      if (!mint) throw new NotFoundError("No mint configured");

      if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 1000 !== 0)
        throw new Error("Cashu invoices require positive whole sats (amount in millisats must be a multiple of 1000)");
      const sats = amount / 1000;
      const storage = storage$.value;
      if (!storage) throw new Error("Unlock encrypted storage first");
      await importLegacyDeposit(storage, wallet);
      const controller = new AbortController();
      depositControllers.set(controller, wallet.pubkey);
      return new Promise<Transaction>((resolve, reject) => {
        let transaction: Transaction | undefined;
        void wallet
          .deposit({
            mint,
            amount: sats,
            signal: controller.signal,
            onQuote: (quote) => {
              const parsed = parseBolt11(quote.request);
              transaction = upsertNwcTransaction({
                type: "incoming",
                state: "pending",
                amount,
                fees_paid: 0,
                created_at: unixNow(),
                invoice: quote.request,
                description,
                description_hash,
                payment_hash: parsed.paymentHash,
                expires_at: parsed.expiry,
              });
              resolve(transaction);
            },
          })
          .then(async () => {
            if (!transaction) return;
            const settled = upsertNwcTransaction({ ...transaction, state: "settled", settled_at: unixNow() });
            if (session$.value?.pubkey === wallet.pubkey) await service$.value?.notify("payment_received", settled);
          })
          .catch((error) => {
            logRequest(`Deposit pending: ${String(error.message ?? error)}`);
            reject(error);
          })
          .finally(() => depositControllers.delete(controller));
      });
    },

    // pay_invoice melts: pick a mint with enough balance and pay the invoice with ecash
    pay_invoice: async ({ invoice, amount }) => {
      const parsed = parseBolt11(invoice);
      const msats = amount ?? parsed.amount ?? 0;
      if (!msats) throw new Error("Missing invoice amount");
      const sats = Math.floor(msats / 1000);

      const balance = (await wallet.balance$.$first()) ?? {};
      const mint = Object.entries(balance)
        .sort(([, a], [, b]) => b - a)
        .find(([, value]) => value >= sats)?.[0];
      if (!mint) throw new InsufficientBalanceError("No mint with enough balance to pay this invoice");

      const response = await wallet.payInvoice(mint, invoice);
      const preimage = response.quote.payment_preimage ?? "";
      upsertNwcTransaction({
        type: "outgoing",
        state: "settled",
        amount: msats,
        fees_paid: 0,
        created_at: unixNow(),
        settled_at: unixNow(),
        invoice,
        description: parsed.description,
        payment_hash: parsed.paymentHash,
        preimage,
      });

      return { preimage };
    },

    lookup_invoice: async ({ payment_hash, invoice }) => {
      const tx = nwcTransactions$.value.find(
        (t) => (payment_hash && t.payment_hash === payment_hash) || (invoice && t.invoice === invoice),
      );
      if (!tx) throw new NotFoundError("Invoice not found");
      return tx;
    },

    list_transactions: async () => ({ transactions: nwcTransactions$.value }),
  };

  // Wrap each handler so every request is appended to the request log
  return Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      async (...args: unknown[]) => {
        logRequest(`→ ${method}`);
        try {
          const result = await (handler as (...a: unknown[]) => Promise<unknown>)(...args);
          logRequest(`✓ ${method}`);
          return result;
        } catch (error) {
          logRequest(`✗ ${method}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      },
    ]),
  ) as WalletServiceHandlers<NwcMethods>;
}

/** Starts (or restarts) the NWC service from a config and persists it */
async function startNwcService(wallet: NutWallet, config: ConnectConfig): Promise<void> {
  service$.value?.stop();
  const service = new WalletService<NwcMethods>({
    relays: config.relays,
    signer: PrivateKeySigner.fromKey(config.key),
    secret: hexToBytes(config.secret),
    handlers: createNwcHandlers(wallet),
    notifications: ["payment_received", "payment_sent"],
  });
  try {
    await saveConnectConfig(wallet.pubkey, config);
    await service.start();
  } catch (error) {
    service.stop();
    throw error;
  }
  service$.next(service);
}

/** Starts or restarts the service on a new relay set, keeping the existing connection identity */
async function setNwcRelays(wallet: NutWallet, relays: string[]): Promise<void> {
  const existing = await loadConnectConfig(wallet.pubkey);
  const config: ConnectConfig = existing
    ? { ...existing, relays }
    : { key: bytesToHex(generateSecretKey()), secret: bytesToHex(generateSecretKey()), relays };
  return startNwcService(wallet, config);
}

/** Stops the NWC service and clears the persisted config */
async function stopNwcService(pubkey: string): Promise<void> {
  service$.value?.stop();
  await saveConnectConfig(pubkey, null);
  service$.next(null);
}

/** Restores a persisted NWC service for a wallet, if one was saved */
async function restoreNwcService(wallet: NutWallet): Promise<void> {
  const config = await loadConnectConfig(wallet.pubkey);
  if (config) await startNwcService(wallet, config);
}

/** NutWallet instance, recreated whenever signer, pubkey, or storage changes */
const wallet$ = combineLatest([session$, storage$]).pipe(
  switchMap(([session, storage]) => {
    if (!session || !storage) return of(null);
    return new Observable<NutWallet>((subscriber) => {
      const instance = new NutWallet({
        ...session,
        pool,
        eventStore,
        couch: new KeyValueCouch(
          storage.createInstance({
            name: "applesauce-examples-wallet",
            storeName: `proofs_${session.pubkey}`,
          }),
        ),
        decryptionCache: storage,
        recovery: storage.createInstance({
          name: "applesauce-examples-wallet",
          storeName: `deposits_${session.pubkey}`,
        }),
      });
      subscriber.next(instance);
      void instance
        .start()
        .then(() => restoreNwcService(instance))
        .catch((error) => logRequest(`Wallet start failed: ${String(error)}`));
      return () => {
        for (const [controller, pubkey] of depositControllers) if (pubkey === instance.pubkey) controller.abort();
        service$.value?.stop();
        service$.next(null);
        instance.stop();
      };
    });
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

// ---- Small presentational helpers ----
function StatusBadge({ status }: { status: WalletStatus }) {
  const map: Record<WalletStatus, string> = {
    [WalletStatus.Idle]: "badge-ghost",
    [WalletStatus.Loading]: "badge-warning",
    [WalletStatus.Ready]: "badge-success",
    [WalletStatus.Missing]: "badge-error",
  };
  return <span className={`badge ${map[status]}`}>{status}</span>;
}

function Indicator({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`badge ${active ? "badge-primary" : "badge-ghost"} gap-2`}>
      {active && <span className="loading loading-spinner loading-sm" />}
      {label}
    </span>
  );
}

function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 border-b border-base-300">
      {(title || action) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          {title && <h2 className="font-semibold">{title}</h2>}
          <span className="flex-1" />
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="p-4">
      <div className="text-sm text-base-content/60">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

// ---- Lock controls ----
function LockControls({ wallet }: { wallet: NutWallet }) {
  const unlocked = use$(wallet.unlocked$);
  const [autoUnlock, setAutoUnlock] = useState(wallet.autoUnlock);

  const ops = use$(wallet.operationsState$) ?? {};

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="label cursor-pointer gap-2">
        <span className="label-text">Auto unlock</span>
        <input
          type="checkbox"
          className="toggle"
          checked={autoUnlock}
          onChange={(e) => {
            wallet.setAutoUnlock(e.target.checked);
            setAutoUnlock(e.target.checked);
          }}
        />
      </label>
      {unlocked ? (
        <button className="btn" onClick={() => wallet.lock()} disabled={ops.lock}>
          {ops.lock ? <span className="loading loading-spinner loading-sm" /> : "Lock"}
        </button>
      ) : (
        <button className="btn btn-primary" onClick={() => wallet.unlock()} disabled={ops.unlock}>
          {ops.unlock ? <span className="loading loading-spinner loading-sm" /> : "Unlock"}
        </button>
      )}
    </div>
  );
}

// ---- Sidebar status and account ----
function WalletControls({ wallet }: { wallet: NutWallet }) {
  const status = use$(wallet.status$) ?? WalletStatus.Idle;
  const loading = use$(wallet.loadingState$);
  const syncing = use$(wallet.syncingState$);
  const busy = use$(wallet.busy$);
  const unlocked = use$(wallet.unlocked$);

  return (
    <div className="space-y-3 border-b border-base-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        <Indicator label="Loading" active={!!loading} />
        <Indicator label="Syncing" active={!!syncing} />
        <Indicator label="Busy" active={!!busy} />
        <span className={`badge ${unlocked ? "badge-success" : "badge-ghost"}`}>
          {unlocked ? "Unlocked" : "Locked"}
        </span>
      </div>
      <LockControls wallet={wallet} />
      <button className="btn btn-sm btn-ghost w-full" onClick={() => wallet.resync()} disabled={!!syncing}>
        Resync
      </button>
    </div>
  );
}

function Account({ wallet }: { wallet: NutWallet }) {
  const profile = use$(() => castUser(wallet.pubkey, eventStore).profile$, [wallet.pubkey]);

  const logout = () => {
    forgetActiveAccount();
    session$.next(null);
  };

  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-3">
      <span className="min-w-0 flex-1 truncate" title={wallet.pubkey}>
        {profile?.displayName || profile?.name || wallet.pubkey.slice(0, 12)}
      </span>
      <button className="btn btn-sm btn-ghost" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

// ---- Relay status table ----
function RelayTable({ wallet }: { wallet: NutWallet }) {
  const relays = use$(wallet.relayStatus$) ?? [];
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Connected</th>
            <th>Ready</th>
            <th>Auth</th>
            <th>NIP-77</th>
          </tr>
        </thead>
        <tbody>
          {relays.map((relay) => (
            <tr key={relay.url}>
              <td className="font-mono">{relay.url}</td>
              <td>{relay.connected ? "Connected" : "Disconnected"}</td>
              <td>{relay.ready ? "Ready" : "Waiting"}</td>
              <td>{relay.authenticated ? "Authenticated" : "—"}</td>
              <td>{relay.negentropy === undefined ? "Unknown" : relay.negentropy ? "Supported" : "Unsupported"}</td>
            </tr>
          ))}
          {relays.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center text-base-content/60">
                No relays
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- Balance by mint ----
function BalanceTable({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const entries = balance ? Object.entries(balance) : [];

  if (entries.length === 0) return <div className="text-base-content/60">No balance</div>;

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Mint</th>
            <th className="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([mint, amount]) => (
            <tr key={mint}>
              <td className="font-mono">{mint}</td>
              <td className="text-right font-medium">{amount} sats</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Overview ----
function OverviewSection({ wallet }: { wallet: NutWallet }) {
  const total = use$(wallet.totalBalance$) ?? 0;
  const balance = use$(wallet.balance$);
  const tokenCount = use$(wallet.tokenCount$) ?? 0;
  const historyCount = use$(wallet.historyCount$) ?? 0;
  const relays = use$(wallet.relayStatus$) ?? [];
  const couchTokens = use$(wallet.couchTokens$) ?? [];
  const staleCount = use$(wallet.staleTokenCount$) ?? 0;
  const ops = use$(wallet.operationsState$) ?? {};
  const [useDeleteEvents, setUseDeleteEvents] = useState(wallet.useDeleteEvents);

  const connected = relays.filter((r) => r.connected).length;

  return (
    <div>
      <div className="grid grid-cols-2 border-b border-base-300 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total balance" value={`${total} sats`} />
        <Stat label="Tokens" value={tokenCount} />
        <Stat label="History" value={historyCount} />
        <Stat label="Mints" value={balance ? Object.keys(balance).length : 0} />
        <Stat label="Relays" value={`${connected}/${relays.length}`} />
        <Stat label="Couch" value={couchTokens.length} />
      </div>

      <div className="grid xl:grid-cols-2">
        <Panel title="Balance by mint">
          <BalanceTable wallet={wallet} />
        </Panel>
        <Panel title="Relays">
          <RelayTable wallet={wallet} />
        </Panel>
      </div>

      <Panel
        title={`Couch (${couchTokens.length})`}
        action={
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => wallet.refreshCouch()}>
              Refresh
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => wallet.recoverFromCouch()}
              disabled={ops.recover || couchTokens.length === 0}
            >
              {ops.recover ? <span className="loading loading-spinner loading-sm" /> : "Recover"}
            </button>
          </div>
        }
      >
        {couchTokens.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Mint</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {couchTokens.map((token, i) => (
                  <tr key={i}>
                    <td className="font-mono">{token.mint}</td>
                    <td className="text-right">{token.proofs.reduce((sum, p) => sum + p.amount.toNumber(), 0)} sats</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-base-content/60">Couch is empty</div>
        )}
      </Panel>

      <Panel
        title={`Deleted tokens (${staleCount})`}
        action={
          <button
            className="btn btn-sm btn-primary"
            onClick={() => wallet.cleanupDeletedTokens()}
            disabled={ops.cleanup || staleCount === 0}
          >
            {ops.cleanup ? <span className="loading loading-spinner loading-sm" /> : "Cleanup"}
          </button>
        }
      >
        <label
          className="label cursor-pointer justify-start gap-2"
          title="When off, spent tokens are marked via each new token's del field. Loading delete events is configured at startup."
        >
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={useDeleteEvents}
            onChange={(e) => {
              wallet.setUseDeleteEvents(e.target.checked);
              setUseDeleteEvents(e.target.checked);
            }}
          />
          <span className="label-text">Publish delete events for spent tokens</span>
        </label>
        {staleCount === 0 && <div className="text-base-content/60">No token events waiting to be cleaned up</div>}
      </Panel>
    </div>
  );
}

// ---- Send ----
function SendSection({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const ops = use$(wallet.operationsState$) ?? {};
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const mints = useMemo(() => (balance ? Object.keys(balance).filter((m) => (balance[m] || 0) > 0) : []), [balance]);

  const handleSend = useCallback(async () => {
    const sats = parseInt(amount, 10);
    if (!sats || sats <= 0) return;
    const encoded = await wallet.sendToken(sats, { mint: mint || undefined });
    setToken(encoded);
    setAmount("");
  }, [wallet, amount, mint]);

  return (
    <div>
      <Panel title="Send a Cashu token">
        {token ? (
          <div className="space-y-3">
            <div className="alert alert-success">Token created</div>
            <textarea className="textarea textarea-bordered w-full h-32 font-mono" value={token} readOnly />
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(token)}>
                Copy
              </button>
              <button className="btn" onClick={() => setToken(null)}>
                New
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="Amount in sats"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {mints.length > 0 && (
              <select className="select select-bordered w-full" value={mint} onChange={(e) => setMint(e.target.value)}>
                <option value="">Auto-select mint</option>
                {mints.map((m) => (
                  <option key={m} value={m}>
                    {m} ({balance?.[m] || 0} sats)
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary" onClick={handleSend} disabled={ops.send || !amount}>
              {ops.send ? <span className="loading loading-spinner loading-sm" /> : "Create token"}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---- Receive ----
function ReceiveSection({ wallet }: { wallet: NutWallet }) {
  const ops = use$(wallet.operationsState$) ?? {};
  const [token, setToken] = useState("");

  const handleReceive = useCallback(async () => {
    if (!token.trim()) return;
    await wallet.receiveToken(token.trim());
    setToken("");
  }, [wallet, token]);

  return (
    <div>
      <Panel title="Receive a Cashu token">
        <div className="space-y-4">
          <textarea
            className="textarea textarea-bordered w-full h-32 font-mono"
            placeholder="Paste a cashu token (cashuA...)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleReceive} disabled={ops.receive || !token.trim()}>
            {ops.receive ? <span className="loading loading-spinner loading-sm" /> : "Receive"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

// ---- Deposit (mint) ----
// Legacy backups are unscoped; importing them is an explicit operation for the signed-in account.
function LegacyProofRecovery({ wallet }: { wallet: NutWallet }) {
  const commands$ = useMemo(() => new Subject<void>(), []);
  const state = use$(
    () =>
      commands$.pipe(
        exhaustMap(() =>
          defer(async () => {
            const storage = storage$.value;
            if (!storage) throw new Error("Unlock encrypted storage first");
            await importLegacyDeposit(storage, wallet);
            return migrateCouch(new IndexedDBCouch(), wallet.couch);
          }).pipe(
            map((count) => ({
              busy: false,
              message: `Imported ${count} proof backups into encrypted recovery storage. Recover from the couch to restore them.`,
              error: "",
            })),
            startWith({ busy: true, message: "Importing legacy proof backups…", error: "" }),
            catchError((error) => of({ busy: false, message: "", error: String(error.message ?? error) })),
          ),
        ),
      ),
    [commands$, wallet],
  );
  return (
    <div className="space-y-2">
      <button className="btn" onClick={() => commands$.next()} disabled={state?.busy}>
        Import legacy proof backups for this account
      </button>
      {state?.message && <p role="status">{state.message}</p>}
      {state?.error && (
        <p role="alert" className="text-error">
          {state.error}
        </p>
      )}
    </div>
  );
}

function DepositSection({ wallet }: { wallet: NutWallet }) {
  const mints = use$(wallet.mintUrls$) ?? [];
  const ops = use$(wallet.operationsState$) ?? {};
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState("");
  const [quote, setQuote] = useState<MintQuoteBolt11Response | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const depositCommands$ = useMemo(
    () => new Subject<{ command: "create" | "resume"; mint: string; amount: string; id?: string }>(),
    [],
  );
  const deposit = use$(
    () =>
      depositCommands$.pipe(
        exhaustMap(
          ({ command, mint, amount, id }) =>
            new Observable<{ busy: boolean; error: string | null }>((subscriber) => {
              const storage = storage$.value;
              const controller = new AbortController();
              abortRef.current = controller;
              subscriber.next({ busy: true, error: null });
              const onQuote = (quote: MintQuoteBolt11Response) => setQuote(quote);
              const work = async () => {
                if (!storage) throw new Error("Unlock encrypted storage first");
                await importLegacyDeposit(storage, wallet);
                if (command === "resume") {
                  const pending = (await wallet.getPendingDeposits()).find((pending) => !id || pending.id === id);
                  if (!pending) throw new Error("No pending deposit to resume");
                  await wallet.resumeDeposit(pending.id, {
                    onQuote,
                    signal: controller.signal,
                  });
                } else {
                  const target = mint || mints[0];
                  const sats = Number(amount);
                  if (!target || !Number.isSafeInteger(sats) || sats <= 0)
                    throw new Error("Choose a mint and a positive whole amount in sats");
                  await wallet.deposit({
                    mint: target,
                    amount: sats,
                    onQuote,
                    signal: controller.signal,
                  });
                }
                setQuote(null);
                setAmount("");
              };
              void work()
                .then(() => {
                  subscriber.next({ busy: false, error: null });
                  subscriber.complete();
                })
                .catch((error) => {
                  subscriber.next({
                    busy: false,
                    error: controller.signal.aborted
                      ? "Stopped waiting; the invoice and recovery record remain available."
                      : String(error.message ?? error),
                  });
                  subscriber.complete();
                });
              return () => controller.abort();
            }),
        ),
      ),
    [wallet, depositCommands$, mints.join("|")],
  );
  const handleDeposit = () => depositCommands$.next({ command: "create", mint, amount });
  const handleResume = (id?: string) => depositCommands$.next({ command: "resume", mint, amount, id });
  const depositBusy = deposit?.busy ?? false;
  const pendingDeposits = use$(
    () =>
      defer(() => wallet.getPendingDeposits()).pipe(
        map((items) => ({ items, error: null as string | null })),
        catchError((error) => of({ items: [], error: String(error) })),
      ),
    [wallet, depositBusy],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div>
      {deposit?.error && (
        <p role="alert" className="text-error">
          {deposit.error}
        </p>
      )}
      <LegacyProofRecovery wallet={wallet} />
      <button className="btn" onClick={() => handleResume()} disabled={depositBusy}>
        Import / resume legacy deposit
      </button>
      {pendingDeposits?.error && (
        <p role="alert" className="text-error">
          {pendingDeposits.error}
        </p>
      )}
      {pendingDeposits?.items.map((pending) => (
        <div key={pending.id} className="flex items-center gap-2 border-b border-base-300 py-2">
          <span className="flex-1" title={pending.mint}>
            {pending.amount} sats · {pending.stage}
          </span>
          <button className="btn" disabled={depositBusy} onClick={() => handleResume(pending.id)}>
            Resume
          </button>
        </div>
      ))}
      <Panel title="Deposit with Lightning">
        {quote ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <QRCode value={quote.request} size={220} className="rounded" alt="Lightning invoice QR code" />
            </div>
            <textarea
              className="textarea textarea-bordered w-full h-24 font-mono text-sm"
              value={quote.request}
              readOnly
            />
            <div className="flex items-center gap-2 text-sm text-base-content/60">
              <span className="loading loading-spinner loading-sm" />
              {ops.mint ? "Payment received, minting tokens…" : "Waiting for payment…"}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(quote.request)}>
                Copy invoice
              </button>
              <button className="btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="Amount in sats"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {mints.length > 0 && (
              <select className="select select-bordered w-full" value={mint} onChange={(e) => setMint(e.target.value)}>
                {mints.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn btn-primary"
              onClick={handleDeposit}
              disabled={depositBusy || ops.mintQuote || !amount}
            >
              {ops.mintQuote ? <span className="loading loading-spinner loading-sm" /> : "Create invoice"}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---- Withdraw (melt) ----
function WithdrawSection({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const ops = use$(wallet.operationsState$) ?? {};
  const [invoice, setInvoice] = useState("");
  const [mint, setMint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mints = useMemo(() => (balance ? Object.keys(balance).filter((m) => (balance[m] || 0) > 0) : []), [balance]);

  const handlePay = useCallback(async () => {
    const target = mint || mints[0];
    if (!target) return setError("No mint with a balance to pay from");
    if (!invoice.trim()) return;

    setError(null);
    setSuccess(null);
    try {
      const response = await wallet.payInvoice(target, invoice.trim());
      const change = response.change.reduce((sum, proof) => sum + proof.amount.toNumber(), 0);
      setSuccess(change > 0 ? `Invoice paid, ${change} sats change returned` : "Invoice paid");
      setInvoice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pay invoice");
    }
  }, [wallet, invoice, mint, mints]);

  return (
    <div>
      <Panel title="Withdraw with Lightning">
        <div className="space-y-4">
          <textarea
            className="textarea textarea-bordered w-full h-24 font-mono text-sm"
            placeholder="Paste a bolt11 invoice (lnbc...)"
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
          />
          {mints.length > 0 && (
            <select className="select select-bordered w-full" value={mint} onChange={(e) => setMint(e.target.value)}>
              {mints.map((m) => (
                <option key={m} value={m}>
                  {m} ({balance?.[m] || 0} sats)
                </option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={handlePay} disabled={ops.melt || !invoice.trim()}>
            {ops.melt ? <span className="loading loading-spinner loading-sm" /> : "Pay invoice"}
          </button>
          {success && <div className="alert alert-success">{success}</div>}
          {error && <div className="alert alert-error">{error}</div>}
        </div>
      </Panel>
    </div>
  );
}

// ---- Tokens ----
function TokensSection({ wallet }: { wallet: NutWallet }) {
  const coverage = use$(wallet.tokenRelayCoverage$);
  const relays = coverage?.relays ?? [];
  const tokens = coverage?.tokens ?? [];
  const total = coverage?.total ?? 0;

  if (total === 0)
    return (
      <Panel title="Tokens (0)">
        <div className="text-base-content/60">No tokens</div>
      </Panel>
    );

  return (
    <Panel title={`Tokens (${total})`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Amount</th>
              <th>Mint</th>
              {relays.map((url) => (
                <th key={url} className="text-center" title={url}>
                  {new URL(url).hostname}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map(({ token, stored }) => {
              const storedSet = new Set(stored);
              const encoded =
                token.unlocked && token.mint && token.proofs
                  ? getEncodedToken({ mint: token.mint, proofs: normalizeProofAmounts(token.proofs) })
                  : null;
              return (
                <tr key={token.id}>
                  <td className="font-mono text-sm" title={token.id}>
                    {token.id.slice(0, 8)}
                  </td>
                  <td className="font-medium whitespace-nowrap">
                    {token.unlocked ? `${token.amount} sats` : "Locked"}
                  </td>
                  <td className="font-mono">{token.unlocked && token.mint ? new URL(token.mint).hostname : "—"}</td>
                  {relays.map((url) => (
                    <td key={url} className="text-center" title={url}>
                      <span className={storedSet.has(url) ? "text-success" : "text-error"}>
                        {storedSet.has(url) ? "Stored" : "Missing"}
                      </span>
                    </td>
                  ))}
                  <td className="text-right">
                    {encoded && (
                      <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(encoded)}>
                        Copy
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {relays.length > 0 && (
            <tfoot>
              <tr>
                <th>Coverage</th>
                <th />
                <th />
                {relays.map((url) => {
                  const count = coverage?.perRelay[url] ?? 0;
                  const color = count === total ? "text-success" : count === 0 ? "text-error" : "text-warning";
                  return (
                    <th key={url} className={`text-center ${color}`}>
                      {count}/{total}
                    </th>
                  );
                })}
                <th />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  );
}

// ---- History ----
function HistorySection({ wallet }: { wallet: NutWallet }) {
  const history = use$(wallet.history$);

  return (
    <Panel title={`History (${history?.length ?? 0})`}>
      {history?.length ? (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Direction</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  {entry.unlocked ? (
                    <>
                      <td className={entry.direction === "in" ? "text-success" : "text-error"}>
                        {entry.direction === "in" ? "Received" : "Sent"}
                      </td>
                      <td className="text-right font-medium">{entry.amount} sats</td>
                    </>
                  ) : (
                    <td colSpan={2} className="text-base-content/60">
                      Locked
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-base-content/60">No history</div>
      )}
    </Panel>
  );
}

// ---- A small editable list of strings ----
function ListEditor({
  items,
  placeholder,
  busy,
  onChange,
}: {
  items: string[];
  placeholder: string;
  busy?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 border-b border-base-300 py-2">
            <span className="font-mono truncate flex-1">{item}</span>
            <button
              className="btn btn-sm btn-error"
              disabled={busy}
              onClick={() => onChange(items.filter((i) => i !== item))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input input-bordered flex-1"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={busy || !value.trim() || items.includes(value.trim())}
          onClick={() => {
            onChange([...items, value.trim()]);
            setValue("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---- Settings ----
function SettingsSection({ wallet }: { wallet: NutWallet }) {
  const mints = use$(wallet.mintUrls$) ?? [];
  const relays = use$(wallet.walletRelays$) ?? [];
  const ops = use$(wallet.operationsState$) ?? {};

  return (
    <div>
      <div className="grid xl:grid-cols-2">
        <Panel title="Mints">
          <ListEditor
            items={mints}
            placeholder="https://mint.example.com"
            busy={ops.setMints}
            onChange={(next) => wallet.setMints(next)}
          />
        </Panel>
        <Panel title="Relays">
          <ListEditor
            items={relays}
            placeholder="wss://relay.example.com"
            busy={ops.setRelays}
            onChange={(next) => wallet.setRelays(next)}
          />
        </Panel>
      </div>
      <Panel title="Maintenance">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => wallet.consolidateTokens()} disabled={ops.consolidate}>
            {ops.consolidate ? <span className="loading loading-spinner loading-sm" /> : "Consolidate tokens"}
          </button>
          <button
            className="btn"
            title="Swap every token for fresh proofs and record replaced token IDs in each new token's del field"
            onClick={() => wallet.rollover()}
            disabled={ops.rollover}
          >
            {ops.rollover ? <span className="loading loading-spinner loading-sm" /> : "Rollover tokens"}
          </button>
          <button className="btn" onClick={() => wallet.syncTokens()} disabled={ops.sync}>
            {ops.sync ? <span className="loading loading-spinner loading-sm" /> : "Sync tokens"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

// ---- Create view ----
function CreateSection({ wallet }: { wallet: NutWallet }) {
  const ops = use$(wallet.operationsState$) ?? {};
  const [mints, setMints] = useState<string[]>([]);
  const [relays, setRelays] = useState<string[]>(FALLBACK_RELAYS);
  const [receiveNutzaps, setReceiveNutzaps] = useState(false);

  const handleCreate = useCallback(() => {
    if (mints.length === 0) return;
    wallet.createWallet({
      mints,
      relays,
      privateKey: receiveNutzaps ? generateSecretKey() : undefined,
    });
  }, [wallet, mints, relays, receiveNutzaps]);

  return (
    <div>
      <div className="border-b border-base-300 p-4">
        <span className="badge badge-warning">No wallet found</span>
      </div>

      <Panel title="Mints">
        <div className="flex flex-wrap gap-2 mb-3">
          {SUGGESTED_MINTS.map((m) => (
            <button
              key={m}
              className={`btn btn-sm ${mints.includes(m) ? "btn-primary" : ""}`}
              onClick={() => setMints((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
            >
              {new URL(m).hostname}
            </button>
          ))}
        </div>
        <ListEditor items={mints} placeholder="https://mint.example.com" onChange={(next) => setMints(next)} />
      </Panel>

      <Panel title="Relays">
        <ListEditor items={relays} placeholder="wss://relay.example.com" onChange={(next) => setRelays(next)} />
      </Panel>

      <div className="space-y-4 p-4">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox"
            checked={receiveNutzaps}
            onChange={(e) => setReceiveNutzaps(e.target.checked)}
          />
          <span className="label-text">Generate P2PK key (for receiving nutzaps)</span>
        </label>

        <button className="btn btn-primary btn-wide" onClick={handleCreate} disabled={ops.create || mints.length === 0}>
          {ops.create ? <span className="loading loading-spinner loading-sm" /> : "Create wallet"}
        </button>
      </div>
    </div>
  );
}

// ---- Connect (Nostr Wallet Connect) ----
function ConnectSection({ wallet }: { wallet: NutWallet }) {
  const service = use$(service$);
  const walletRelays = use$(wallet.walletRelays$);
  const log = use$(requestLog$) ?? [];
  const [busy, setBusy] = useState(false);
  const [editedRelays, setEditedRelays] = useState<string[] | null>(null);
  const savedConfig = use$(() => defer(() => loadConnectConfig(wallet.pubkey)), [wallet.pubkey]);
  const relays =
    editedRelays ?? savedConfig?.relays ?? (walletRelays?.length ? walletRelays : ["wss://relay.getalby.com/v1"]);

  // Start the service, or restart it on the edited relay set if it is already running
  const apply = useCallback(async () => {
    if (relays.length === 0) return;
    setBusy(true);
    try {
      await setNwcRelays(wallet, relays);
    } finally {
      setBusy(false);
    }
  }, [wallet, relays]);

  const uri = service?.running ? service.getConnectURI() : null;

  return (
    <div>
      <Panel
        title="Nostr Wallet Connect"
        action={
          service ? (
            <button
              className="btn btn-sm btn-error"
              onClick={() => void stopNwcService(wallet.pubkey).catch((error) => logRequest(String(error)))}
            >
              Disconnect
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={apply} disabled={busy || relays.length === 0}>
              {busy ? <span className="loading loading-spinner loading-sm" /> : "Enable"}
            </button>
          )
        }
      >
        {uri ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QRCode value={uri} size={200} className="rounded shrink-0" alt="Wallet connect QR code" />
            <div className="flex-1 space-y-3">
              <textarea className="textarea textarea-bordered w-full h-24 font-mono text-sm" value={uri} readOnly />
              <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(uri)}>
                Copy connection string
              </button>
            </div>
          </div>
        ) : (
          <span
            className="badge badge-ghost"
            title="Enable to connect external apps; saved connections restore on reload"
          >
            Disabled
          </span>
        )}
      </Panel>

      <Panel
        title="Relays"
        action={
          service ? (
            <button className="btn btn-sm" onClick={apply} disabled={busy}>
              {busy ? <span className="loading loading-spinner loading-sm" /> : "Update relays"}
            </button>
          ) : undefined
        }
      >
        <ListEditor
          items={relays}
          placeholder="wss://relay.example.com"
          busy={busy}
          onChange={(next) => setEditedRelays(next)}
        />
      </Panel>

      <Panel
        title="Request log"
        action={
          log.length > 0 ? (
            <button className="btn btn-sm" onClick={() => requestLog$.next([])}>
              Clear
            </button>
          ) : undefined
        }
      >
        {log.length > 0 ? (
          <div className="h-64 overflow-y-auto border border-base-300 bg-base-200 p-2 font-mono text-sm">
            {log.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-base-content/60">No requests yet</div>
        )}
      </Panel>
    </div>
  );
}

function WalletDashboard({ wallet }: { wallet: NutWallet }) {
  const status = use$(wallet.status$) ?? WalletStatus.Idle;
  const error = use$(wallet.errorState$);
  const tokenCount = use$(wallet.tokenCount$);
  const historyCount = use$(wallet.historyCount$);
  const [section, setSection] = useState<Section>("Overview");

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WalletControls wallet={wallet} />
          <nav aria-label="Wallet sections" className="flex flex-col gap-1 p-3">
            {SECTIONS.map((name) => (
              <button
                key={name}
                className={`btn btn-sm justify-start ${section === name ? "btn-active" : "btn-ghost"}`}
                aria-current={section === name ? "page" : undefined}
                disabled={status === WalletStatus.Missing}
                onClick={() => setSection(name)}
              >
                {name}
                {name === "Tokens" && <span className="ms-auto opacity-60">{tokenCount ?? "…"}</span>}
                {name === "History" && <span className="ms-auto opacity-60">{historyCount ?? "…"}</span>}
              </button>
            ))}
          </nav>
        </div>
        <Account wallet={wallet} />
      </aside>

      <main
        aria-label={status === WalletStatus.Missing ? "Create wallet" : section}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        {error && (
          <div role="alert" className="border-b border-base-300 p-4 text-error">
            {error.message}
          </div>
        )}
        {status === WalletStatus.Missing ? (
          <CreateSection wallet={wallet} />
        ) : status === WalletStatus.Idle || status === WalletStatus.Loading ? (
          <div role="status" className="flex items-center justify-center gap-2 p-6">
            <span className="loading loading-spinner loading-sm" />
            Loading wallet…
          </div>
        ) : (
          <>
            {section === "Overview" && <OverviewSection wallet={wallet} />}
            {section === "Send" && <SendSection wallet={wallet} />}
            {section === "Receive" && <ReceiveSection wallet={wallet} />}
            {section === "Deposit" && <DepositSection wallet={wallet} />}
            {section === "Withdraw" && <WithdrawSection wallet={wallet} />}
            {section === "Tokens" && <TokensSection wallet={wallet} />}
            {section === "History" && <HistorySection wallet={wallet} />}
            {section === "Connect" && <ConnectSection wallet={wallet} />}
            {section === "Settings" && <SettingsSection wallet={wallet} />}
          </>
        )}
      </main>
    </div>
  );
}

export default function WalletAdminExample() {
  const storage = use$(storage$);
  const session = use$(session$);
  const wallet = use$(wallet$);

  if (!storage) return <UnlockView onUnlock={(s) => storage$.next(s)} />;
  if (!session)
    return (
      <LoginView
        onLogin={(s, p) => {
          session$.next({ signer: s, pubkey: p });
        }}
      />
    );

  if (!wallet)
    return (
      <div className="flex justify-center py-24">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );

  return <WalletDashboard key={wallet.pubkey} wallet={wallet} />;
}
