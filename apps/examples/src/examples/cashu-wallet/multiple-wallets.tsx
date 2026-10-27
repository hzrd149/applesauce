/**
 * Minimal lightning wallet that switches between WebLN, NWC, and a NIP-60 Cashu backend
 * @tags wallet, lightning, nwc, webln, nip-60, cashu
 * @related cashu-wallet/cashu-wallet, cashu-wallet/admin
 */
import { recoverableDeposit, resumeDeposit } from "../../extra/deposit-recovery";
import { createEncryptedCouch, migrateLegacyCouch } from "../../extra/encrypted-couch";
import { default as SecureStorage } from "../../extra/encrypted-storage";
import { default as UnlockView } from "../../components/unlock-view";

import { EncryptedContentCache, parseBolt11, parseLNURLOrAddress } from "applesauce-common/helpers";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { relaySet, generateSecretKey } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { WalletConnect } from "applesauce-wallet-connect";
import { WALLET_KIND } from "applesauce-wallet/helpers";
import { NutWallet } from "applesauce-wallet/wallet";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BehaviorSubject,
  filter,
  firstValueFrom,
  Observable,
  take,
  timeout,
  defer,
  timer,
  exhaustMap,
  takeUntil,
  fromEvent,
  EMPTY,
  merge,
  ignoreElements,
  lastValueFrom,
  defaultIfEmpty,
  Subject,
  map,
  startWith,
  catchError,
  of,
  combineLatest,
  concatMap,
} from "rxjs";

import LoginView from "../../components/login-view";
import QRCode from "../../components/qr-code";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

// ---- Shared app infrastructure (owned by the app, reused by every backend) ----
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
// Encrypted proof recovery is shared by this account's wallet backends.
const account$ = new BehaviorSubject<string | null>(null);
const couch = createEncryptedCouch(
  () => storage$.value,
  () => `wallet-proofs:${account$.value ?? "signed-out"}`,
);

// Decrypted proof-bearing content is persisted only through unlocked encrypted storage.
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const decryptionCache: EncryptedContentCache = {
  getItem: async (key) => storage$.value?.getItem(`wallet-content:${key}`) ?? null,
  setItem: async (key, value) => {
    if (!storage$.value) throw new Error("Storage locked");
    if (!(await storage$.value.setItem(`wallet-content:${key}`, value)))
      throw new Error("Could not persist encrypted wallet content");
  },
};

// In-memory bootstrap loader for the NutWallet's wallet/mailbox events (no local cache)
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
});

// Route the Nostr Wallet Connect transport through the shared relay pool
WalletConnect.pool = pool;

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const SUGGESTED_MINTS = ["https://mint.minibits.cash/Bitcoin", "https://21mint.me"];

// A broad relay set used to hunt for an existing NIP-60 wallet event before offering to create one
const DISCOVERY_RELAYS = relaySet(DEFAULT_RELAYS, ["wss://relay.ditto.pub"], lookupRelays$.value);
// How long to search for an existing wallet before concluding the user has none
const WALLET_DISCOVERY_MS = 12_000;

// ---- The unified backend abstraction every wallet type implements ----
type BackendType = "webln" | "nwc" | "nutwallet";

type StoredBackend =
  | { id: string; type: "webln"; label: string }
  | { id: string; type: "nwc"; label: string; uri: string }
  | { id: string; type: "nutwallet"; label: string; pubkey: string };

/** The result of creating an invoice: the bolt11 string plus a promise that resolves once it is paid */
type ReceiveResult = { invoice: string; paid: Promise<void> };

interface WalletBackend {
  id: string;
  type: BackendType;
  label: string;
  /** Balance in sats, or undefined while unknown/loading */
  balance$: Observable<number | undefined>;
  /** Re-poll the balance */
  refresh(): Promise<void>;
  /**
   * Create a bolt11 invoice to add sats to this wallet. Returns the invoice plus a `paid` promise that
   * resolves when that specific invoice is paid (and rejects if `options.signal` aborts).
   */
  makeInvoice(sats: number, options?: { description?: string; signal?: AbortSignal }): Promise<ReceiveResult>;
  /** Pay a bolt11 invoice from this wallet */
  payInvoice(invoice: string): Promise<void>;
  /** Serialize back to the persisted config */
  serialize(): StoredBackend;
  recoverProofs?(): Promise<void>;
  migrateLegacy?(): Promise<number>;
  resumeDeposit?(onInvoice: (invoice: string) => void, signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

const abortError = () => new DOMException("Aborted", "AbortError");

/**
 * WebLN has no standard "invoice paid" event, so this is the one backend that detects payment by watching
 * its balance rise (polling `refresh` to keep balance$ fresh).
 */
function awaitBalanceIncrease(
  balance$: Observable<number | undefined>,
  refresh: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  return (async () => {
    if (signal?.aborted) throw abortError();
    const baseline = await firstValueFrom(
      balance$.pipe(
        filter((balance): balance is number => balance !== undefined),
        take(1),
        timeout({ first: 10_000 }),
      ),
    );
    await firstValueFrom(
      merge(
        balance$.pipe(filter((balance): balance is number => balance !== undefined && balance > baseline)),
        timer(0, 3000).pipe(
          exhaustMap(() => defer(refresh)),
          ignoreElements(),
        ),
      ).pipe(take(1), takeUntil(signal ? fromEvent(signal, "abort") : EMPTY)),
    ).catch((error) => {
      throw signal?.aborted ? abortError() : error;
    });
  })();
}

// ---- WebLN (window.webln) ----
interface WebLNProvider {
  enable(): Promise<void>;
  getBalance?(): Promise<{ balance: number }>;
  makeInvoice(args: { amount: number | string; defaultMemo?: string }): Promise<{ paymentRequest: string }>;
  sendPayment(invoice: string): Promise<{ preimage: string }>;
}

function getWebln(): WebLNProvider {
  const webln = (window as { webln?: WebLNProvider }).webln;
  if (!webln) throw new Error("No WebLN provider found — install Alby or a compatible extension");
  return webln;
}

async function createWeblnBackend(stored: Extract<StoredBackend, { type: "webln" }>): Promise<WalletBackend> {
  const webln = getWebln();
  await webln.enable();

  const balance$ = new BehaviorSubject<number | undefined>(undefined);
  const refresh = async () => {
    try {
      if (webln.getBalance) balance$.next((await webln.getBalance()).balance);
    } catch (error) {
      console.error("WebLN getBalance failed:", error);
    }
  };
  refresh();

  return {
    id: stored.id,
    type: "webln",
    label: stored.label,
    balance$,
    refresh,
    makeInvoice: async (sats, options) => {
      const { paymentRequest } = await webln.makeInvoice({ amount: sats, defaultMemo: options?.description });
      // No standard WebLN paid event, so fall back to watching the balance rise
      return { invoice: paymentRequest, paid: awaitBalanceIncrease(balance$, refresh, options?.signal) };
    },
    payInvoice: async (invoice) => {
      await webln.sendPayment(invoice);
      await refresh();
    },
    serialize: () => stored,
    dispose: () => {},
  };
}

// ---- Nostr Wallet Connect (NIP-47) ----
function createNwcBackend(stored: Extract<StoredBackend, { type: "nwc" }>): WalletBackend {
  const client = WalletConnect.fromConnectURI(stored.uri);

  const balance$ = new BehaviorSubject<number | undefined>(undefined);
  const refresh = async () => {
    try {
      const { balance } = await client.getBalance();
      balance$.next(Math.floor(balance / 1000)); // msats -> sats
    } catch (error) {
      console.error("NWC getBalance failed:", error);
    }
  };
  refresh();

  return {
    id: stored.id,
    type: "nwc",
    label: stored.label,
    balance$,
    refresh,
    makeInvoice: async (sats, options) => {
      if (!(await client.supportsMethod("make_invoice")) || !(await client.supportsMethod("lookup_invoice")))
        throw new Error("Wallet does not support receiving invoices");
      const tx = await client.makeInvoice(sats * 1000, { description: options?.description }); // amount is msats
      if (!tx.invoice) throw new Error("Wallet did not return an invoice");
      // waitForPaid resolves on a payment_received notification for this invoice (rejects when it expires)
      const paid = firstValueFrom(
        timer(0, 3000).pipe(
          exhaustMap(() => defer(() => client.lookupInvoice(tx.payment_hash, tx.invoice))),
          filter((transaction) => transaction.state === "settled"),
          take(1),
          takeUntil(options?.signal ? fromEvent(options.signal, "abort") : EMPTY),
        ),
      ).then(() => refresh());
      return { invoice: tx.invoice, paid };
    },
    payInvoice: async (invoice) => {
      if (!(await client.supportsMethod("pay_invoice"))) throw new Error("Wallet does not support invoice payments");
      await client.payInvoice(invoice);
      await refresh();
    },
    serialize: () => stored,
    dispose: () => {},
  };
}

// ---- NIP-60 Cashu wallet (applesauce-wallet NutWallet) ----
/**
 * Does its best to find an existing NIP-60 wallet event for a pubkey before we ever offer to create one.
 * Subscribes to a broad relay set for the wallet event (in addition to the NutWallet's own outbox-driven
 * loader) and waits a real discovery window — so a slow load never causes us to create a duplicate wallet.
 */
async function walletExists(pubkey: string): Promise<boolean> {
  const existing = eventStore.getReplaceable(WALLET_KIND, pubkey);
  if (existing) return true;
  const events = await lastValueFrom(
    pool
      .request(DISCOVERY_RELAYS, { kinds: [WALLET_KIND], authors: [pubkey] }, { timeout: WALLET_DISCOVERY_MS })
      .pipe(mapEventsToStore(eventStore), mapEventsToTimeline(), defaultIfEmpty([])),
  );
  return events.length > 0;
}

async function createNutWalletBackend(
  stored: Extract<StoredBackend, { type: "nutwallet" }>,
  signer: ISigner,
  options?: { createIfMissing?: boolean },
): Promise<WalletBackend> {
  const wallet = new NutWallet({
    pubkey: stored.pubkey,
    signer,
    pool,
    eventStore,
    couch,
    autoUnlock: true,
    decryptionCache,
    // Ignore all kind-5 delete events for this example wallet
    useDeleteEvents: false,
  });
  await wallet.start();

  // When adding a new wallet, search hard for an existing one and only create a wallet if none is found.
  // Restored backends skip this — they already loaded once and just resume in the background.
  if (options?.createIfMissing && !(await walletExists(stored.pubkey)))
    await wallet.createWallet({ mints: SUGGESTED_MINTS, relays: DEFAULT_RELAYS });

  return {
    id: stored.id,
    type: "nutwallet",
    label: stored.label,
    balance$: wallet.totalBalance$,
    refresh: () => wallet.refreshCouch(),
    // Adding sats mints ecash: create a mint quote (lightning invoice), then wait for it to be paid and redeem
    makeInvoice: async (sats, options) => {
      const mints = await firstValueFrom(
        wallet.mintUrls$.pipe(
          filter((m): m is string[] => !!m && m.length > 0),
          take(1),
          timeout({ first: 10_000 }),
        ),
      );
      const mint = mints[0];
      const storage = storage$.value;
      if (!storage) throw new Error("Unlock encrypted storage first");
      let reveal!: (invoice: string) => void;
      let fail!: (error: unknown) => void;
      const invoiceReady = new Promise<string>((resolve, reject) => {
        reveal = resolve;
        fail = reject;
      });
      const paid = recoverableDeposit(storage, wallet, {
        mint,
        amount: sats,
        signal: options?.signal,
        namespace: "wallet-deposit",
        onQuote: (quote) => reveal(quote.request),
      });
      void paid.catch(fail);
      return { invoice: await invoiceReady, paid };
    },
    recoverProofs: () => wallet.recoverFromCouch(),
    migrateLegacy: async () => {
      const count = await migrateLegacyCouch(couch);
      await wallet.refreshCouch();
      return count;
    },
    resumeDeposit: async (onInvoice, signal) => {
      const storage = storage$.value;
      if (!storage) throw new Error("Unlock encrypted storage first");
      await resumeDeposit(storage, wallet, {
        onQuote: (quote) => onInvoice(quote.request),
        signal,
        namespace: "wallet-deposit",
      });
    },
    // Sending melts ecash: pick a mint with enough balance and pay the invoice
    payInvoice: async (invoice) => {
      const balance = await firstValueFrom(
        wallet.balance$.pipe(
          filter((b): b is Record<string, number> => !!b),
          take(1),
          timeout({ first: 10_000 }),
        ),
      );
      const sats = parseBolt11(invoice).amount ? Math.ceil(parseBolt11(invoice).amount! / 1000) : 0;
      const mint =
        Object.entries(balance)
          .sort(([, a], [, b]) => b - a)
          .find(([, value]) => value >= sats)?.[0] ?? Object.keys(balance)[0];
      if (!mint) throw new Error("No mint with a balance to pay from");
      await wallet.payInvoice(mint, invoice);
    },
    serialize: () => stored,
    dispose: () => wallet.stop(),
  };
}

// ---- Backend registry (persisted to a single localStorage key) ----
const STORAGE_KEY = "multiple-wallets";

const backends$ = new BehaviorSubject<WalletBackend[]>([]);
const activeId$ = new BehaviorSubject<string | undefined>(undefined);

async function loadStored(): Promise<{ backends: StoredBackend[]; activeId?: string }> {
  const storage = storage$.value;
  if (!storage) throw new Error("Unlock encrypted storage first");
  let raw = await storage.getItem(STORAGE_KEY);
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (!raw && legacy) {
    if (!(await storage.setItem(STORAGE_KEY, legacy))) throw new Error("Could not encrypt saved wallet connections");
    localStorage.removeItem(STORAGE_KEY);
    raw = legacy;
  }
  return raw ? JSON.parse(raw) : { backends: [] };
}

function addBackend(backend: WalletBackend) {
  backends$.next([...backends$.value, backend]);
  if (!activeId$.value) activeId$.next(backend.id);
}

function removeBackend(id: string) {
  backends$.value.find((b) => b.id === id)?.dispose();
  const next = backends$.value.filter((b) => b.id !== id);
  backends$.next(next);
  if (activeId$.value === id) activeId$.next(next[0]?.id);
}

function setActive(id: string) {
  activeId$.next(id);
}

async function reconstruct(stored: StoredBackend, signer: ISigner): Promise<WalletBackend> {
  switch (stored.type) {
    case "webln":
      return createWeblnBackend(stored);
    case "nwc":
      return createNwcBackend(stored);
    case "nutwallet":
      return createNutWalletBackend(stored, signer);
  }
}

let loaded = false;
async function loadBackends(signer: ISigner, pubkey: string) {
  if (loaded) return;
  const stored = await loadStored();
  const instances: WalletBackend[] = [];
  for (const config of stored.backends) {
    // A NutWallet is tied to its pubkey, so only restore ones the current signer can drive
    if (config.type === "nutwallet" && config.pubkey !== pubkey) continue;
    try {
      instances.push(await reconstruct(config, signer));
    } catch (error) {
      console.error("Failed to restore wallet backend:", config, error);
    }
  }

  backends$.next(instances);
  const active =
    stored.activeId && instances.some((b) => b.id === stored.activeId) ? stored.activeId : instances[0]?.id;
  activeId$.next(active);
  loaded = true;
}

// ---- Send helper: resolve a bolt11 invoice or a lightning address into an invoice ----
async function resolveInvoice(input: string, sats?: number): Promise<string> {
  const value = input.trim();
  if (/^ln(bc|tb|bcrt)/i.test(value)) return value; // already a bolt11 invoice

  const url = parseLNURLOrAddress(value);
  if (!url) throw new Error("Not a valid invoice or lightning address");
  if (!sats || sats <= 0) throw new Error("Enter an amount to send to a lightning address");

  const meta = await fetch(url).then((res) => res.json());
  const callback = new URL(meta.callback);
  callback.searchParams.set("amount", String(sats * 1000)); // msats
  const { pr } = await fetch(callback).then((res) => res.json());
  if (!pr) throw new Error("Lightning address did not return an invoice");
  return pr;
}

const TYPE_LABELS: Record<BackendType, string> = {
  webln: "WebLN",
  nwc: "Nostr Wallet Connect",
  nutwallet: "Cashu (NIP-60)",
};

// ---- UI ----
function BackendSwitcher({
  backends,
  activeId,
  onAdd,
}: {
  backends: WalletBackend[];
  activeId?: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex gap-2 mb-4">
      <select
        className="select select-bordered flex-1"
        value={activeId ?? ""}
        onChange={(e) => setActive(e.target.value)}
        disabled={backends.length === 0}
      >
        {backends.length === 0 && <option value="">No wallets</option>}
        {backends.map((backend) => (
          <option key={backend.id} value={backend.id}>
            {backend.label} · {TYPE_LABELS[backend.type]}
          </option>
        ))}
      </select>
      {activeId && (
        <button className="btn btn-outline" title="Remove wallet" onClick={() => removeBackend(activeId)}>
          Remove
        </button>
      )}
      <button className="btn btn-primary" onClick={onAdd}>
        + Add
      </button>
    </div>
  );
}

function BalanceView({ backend }: { backend: WalletBackend }) {
  const balance = use$(backend.balance$);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await backend.refresh().finally(() => setRefreshing(false));
  }, [backend]);

  return (
    <div className="border border-base-300 p-6 text-center mb-4">
      <div className="text-sm text-base-content/70 mb-1">{TYPE_LABELS[backend.type]}</div>
      <div className="text-4xl font-bold">
        {balance === undefined ? "—" : balance.toLocaleString()}{" "}
        <span className="text-lg font-normal text-base-content/70">sats</span>
      </div>
      <button className="btn btn-ghost btn-sm mt-2" onClick={refresh} disabled={refreshing}>
        {refreshing ? <span className="loading loading-spinner loading-sm" /> : "Refresh"}
      </button>
    </div>
  );
}

function ReceivePanel({ backend }: { backend: WalletBackend }) {
  const [amount, setAmount] = useState("");

  const [invoice, setInvoice] = useState<string | null>(null);

  const [paid, setPaid] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const handleCreate = useCallback(async () => {
    const sats = parseInt(amount, 10);
    if (!sats || sats <= 0) return setError("Enter a valid amount");
    setLoading(true);
    setError(null);
    setPaid(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { invoice, paid } = await backend.makeInvoice(sats, {
        description: "Multiple wallets example",
        signal: controller.signal,
      });
      setInvoice(invoice);
      // The backend's promise resolves when this specific invoice is paid; ignore it if superseded/closed
      paid.then(
        () => {
          if (!controller.signal.aborted) setPaid(true);
        },
        (error) => {
          if (!controller.signal.aborted)
            setError(
              `Payment was not completed: ${String(error.message ?? error)}. Resume the pending deposit to retry.`,
            );
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setLoading(false);
    }
  }, [amount, backend]);

  const resume = async () => {
    if (!backend.resumeDeposit || loading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      await backend.resumeDeposit((invoice) => setInvoice(invoice), controller.signal);
      setPaid(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not resume deposit");
    } finally {
      setLoading(false);
    }
  };

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (paid || backend.type !== "nutwallet") setInvoice(null);
    setAmount("");
    setPaid(false);
  }, [paid, backend]);

  // Stop waiting for payment if the panel unmounts
  use$(() => new Observable<void>(() => () => abortRef.current?.abort()), []);

  const copy = useCallback(() => {
    if (!invoice) return;
    navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [invoice]);

  // Once paid, hide the invoice and show a confirmation
  if (invoice && paid)
    return (
      <div className="space-y-4">
        {backend.resumeDeposit && (
          <button className="btn" onClick={resume} disabled={loading}>
            Resume pending deposit
          </button>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className="alert alert-success">Invoice paid!</div>
        <button className="btn btn-primary w-full" onClick={reset}>
          New invoice
        </button>
      </div>
    );

  if (invoice)
    return (
      <div className="space-y-4">
        {backend.resumeDeposit && (
          <button className="btn" onClick={resume} disabled={loading}>
            Resume pending deposit
          </button>
        )}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className="flex justify-center">
          <QRCode value={invoice} size={220} alt="Lightning invoice QR code" />
        </div>
        <textarea className="textarea textarea-bordered w-full h-24 font-mono text-sm" value={invoice} readOnly />
        <div className="flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" /> Waiting for payment…
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" onClick={copy}>
            {copied ? "Copied!" : "Copy invoice"}
          </button>
          <button className="btn" onClick={reset}>
            New
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      {backend.resumeDeposit && (
        <button className="btn" onClick={resume} disabled={loading}>
          Resume pending deposit
        </button>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <input
        type="number"
        className="input input-bordered w-full"
        placeholder="Amount in sats"
        value={amount}
        min="1"
        onChange={(e) => {
          setAmount(e.target.value);
          setError(null);
        }}
      />
      <button className="btn btn-primary w-full" onClick={handleCreate} disabled={loading || !amount.trim()}>
        {loading ? <span className="loading loading-spinner loading-sm" /> : "Create invoice"}
      </button>
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}

function SendPanel({ backend }: { backend: WalletBackend }) {
  const [input, setInput] = useState("");

  const [amount, setAmount] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [success, setSuccess] = useState<string | null>(null);

  const trimmed = input.trim();
  const isAddress = trimmed.length > 0 && !/^ln(bc|tb|bcrt)/i.test(trimmed);

  const handleSend = useCallback(async () => {
    if (!trimmed) return setError("Paste an invoice or lightning address");
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const sats = amount ? parseInt(amount, 10) : undefined;
      const invoice = await resolveInvoice(trimmed, sats);
      await backend.payInvoice(invoice);
      setSuccess("Payment sent");
      setInput("");
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send payment");
    } finally {
      setLoading(false);
    }
  }, [trimmed, amount, backend]);

  return (
    <div className="space-y-4">
      <textarea
        className="textarea textarea-bordered w-full h-24 font-mono text-sm"
        placeholder="Lightning invoice (lnbc...) or address (name@domain.com)"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setError(null);
          setSuccess(null);
        }}
      />
      {isAddress && (
        <input
          type="number"
          className="input input-bordered w-full"
          placeholder="Amount in sats"
          value={amount}
          min="1"
          onChange={(e) => setAmount(e.target.value)}
        />
      )}
      <button className="btn btn-primary w-full" onClick={handleSend} disabled={loading || !trimmed}>
        {loading ? <span className="loading loading-spinner loading-sm" /> : "Send payment"}
      </button>
      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}
    </div>
  );
}

function LegacyProofRecovery({ backend }: { backend: WalletBackend }) {
  const commands$ = useMemo(() => new Subject<"migrate" | "recover">(), []);
  const state = use$(
    () =>
      commands$.pipe(
        exhaustMap((command) =>
          defer(async () => {
            if (command === "recover") {
              await backend.recoverProofs!();
              return -1;
            }
            return backend.migrateLegacy!();
          }).pipe(
            map((count) => ({
              busy: false,
              message:
                count === -1
                  ? "Recovered encrypted proof backups."
                  : `Imported ${count} proof backups into encrypted recovery storage. Recover these backups to restore them.`,
              error: "",
            })),
            startWith({ busy: true, message: "Importing legacy backups…", error: "" }),
            catchError((error) => of({ busy: false, message: "", error: String(error.message ?? error) })),
          ),
        ),
      ),
    [backend, commands$],
  );
  return (
    <div className="space-y-2">
      <button className="btn" onClick={() => commands$.next("migrate")} disabled={state?.busy}>
        Import legacy proof backups for this account
      </button>
      <button className="btn" onClick={() => commands$.next("recover")} disabled={state?.busy}>
        Recover encrypted proof backups
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

function WalletPanels({ backend }: { backend: WalletBackend }) {
  const [tab, setTab] = useState<"receive" | "send">("receive");

  return (
    <div>
      <BalanceView backend={backend} />
      {backend.migrateLegacy && <LegacyProofRecovery backend={backend} />}
      <div className="flex gap-2 mb-4">
        <button
          className={`btn flex-1 ${tab === "receive" ? "btn-primary" : "btn-outline"}`}
          onClick={() => setTab("receive")}
        >
          Receive
        </button>
        <button
          className={`btn flex-1 ${tab === "send" ? "btn-primary" : "btn-outline"}`}
          onClick={() => setTab("send")}
        >
          Send
        </button>
      </div>
      <div className="border border-base-300 p-6">
        {tab === "receive" ? <ReceivePanel backend={backend} /> : <SendPanel backend={backend} />}
      </div>
    </div>
  );
}

/**
 * NWC "wallet auth" connect flow (NIP-47): show a QR the user scans with their wallet. When the wallet
 * connects back over nostr, we hand the parent a full nostr+walletconnect:// string to persist.
 */
function NwcQrConnect({ onConnect }: { onConnect: (uri: string) => void }) {
  const [relay, setRelay] = useState("wss://relay.getalby.com/v1");

  const client = useMemo(() => new WalletConnect({ pool, relays: [relay], secret: generateSecretKey() }), [relay]);

  const connection = use$(
    () =>
      new Observable<{ ready: boolean; error?: string }>((subscriber) => {
        const controller = new AbortController();
        subscriber.next({ ready: false });
        void client
          .waitForService(controller.signal)
          .then(() => {
            if (controller.signal.aborted) return;
            if (client.connectURI) onConnect(client.connectURI);
            subscriber.next({ ready: true });
          })
          .catch((error) => {
            if (!controller.signal.aborted) subscriber.next({ ready: false, error: String(error.message ?? error) });
          });
        return () => controller.abort();
      }),
    [client, onConnect],
  );

  const uri = useMemo(
    () =>
      client.getAuthURI({ methods: ["get_balance", "get_info", "make_invoice", "pay_invoice"], name: "applesauce" }),
    [client],
  );

  return (
    <div className="flex flex-col items-center gap-3">
      {connection?.error && (
        <p role="alert" className="text-error">
          {connection.error}
        </p>
      )}
      <a href={uri} className="bg-white p-4">
        <QRCode value={uri} size={192} className="h-48 w-48" alt="Wallet auth QR code" />
      </a>
      <RelayPicker
        value={relay}
        onChange={(next: typeof relay) => setRelay(next)}
        common={["wss://relay.getalby.com/v1"]}
        className="w-full"
      />
      <a href={uri} className="btn btn-primary btn-block">
        Open in wallet
      </a>
      <p className="text-sm text-base-content/60 text-center">
        Scan with a NWC wallet (e.g. Alby) — it connects back automatically.
      </p>
    </div>
  );
}

function AddWalletModal({ signer, pubkey, onClose }: { signer: ISigner; pubkey: string; onClose: () => void }) {
  const [type, setType] = useState<BackendType>("nwc");

  const [nwcMode, setNwcMode] = useState<"qr" | "paste">("qr");

  const [label, setLabel] = useState("");

  const [uri, setUri] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Run a backend factory, add the result, and close on success
  const finish = useCallback(
    async (create: () => Promise<WalletBackend> | WalletBackend) => {
      setLoading(true);
      setError(null);
      try {
        addBackend(await create());
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add wallet");
      } finally {
        setLoading(false);
      }
    },
    [onClose],
  );

  // Called by the QR flow once the wallet connects back with a connection string
  const connectNwcUri = useCallback(
    (connectUri: string) =>
      finish(() =>
        createNwcBackend({
          id: crypto.randomUUID(),
          type: "nwc",
          label: label.trim() || TYPE_LABELS.nwc,
          uri: connectUri,
        }),
      ),
    [finish, label],
  );

  const handleAdd = useCallback(() => {
    const id = crypto.randomUUID();
    if (type === "webln")
      return finish(() => createWeblnBackend({ id, type, label: label.trim() || TYPE_LABELS.webln }));
    if (type === "nwc") {
      if (!uri.trim()) return setError("Paste a NWC connection string");
      return finish(() => createNwcBackend({ id, type, label: label.trim() || TYPE_LABELS.nwc, uri: uri.trim() }));
    }
    return finish(() =>
      createNutWalletBackend({ id, type, label: label.trim() || TYPE_LABELS.nutwallet, pubkey }, signer, {
        createIfMissing: true,
      }),
    );
  }, [type, uri, label, pubkey, signer, finish]);

  // The QR flow connects on its own, so it doesn't use the bottom "Add" button
  const showAddButton = !(type === "nwc" && nwcMode === "qr");

  return (
    <dialog className="modal modal-open">
      <div className="modal-box border border-base-300 shadow-none">
        <h3 className="text-lg font-bold mb-4">Add a wallet</h3>

        <div className="flex gap-2 mb-4">
          {(Object.keys(TYPE_LABELS) as BackendType[]).map((t) => (
            <button
              key={t}
              className={`btn btn-sm flex-1 ${type === t ? "btn-primary" : "btn-outline"}`}
              onClick={() => setType(t)}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder={`Label (default: ${TYPE_LABELS[type]})`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />

          {type === "nwc" && (
            <>
              <div className="flex gap-2">
                <button
                  className={`btn btn-sm flex-1 ${nwcMode === "qr" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setNwcMode("qr")}
                >
                  Scan QR
                </button>
                <button
                  className={`btn btn-sm flex-1 ${nwcMode === "paste" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setNwcMode("paste")}
                >
                  Paste string
                </button>
              </div>
              {nwcMode === "qr" ? (
                <NwcQrConnect onConnect={connectNwcUri} />
              ) : (
                <textarea
                  className="textarea textarea-bordered w-full h-24 font-mono text-sm"
                  placeholder="nostr+walletconnect://..."
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                />
              )}
            </>
          )}
          {type === "webln" && (
            <p className="text-sm text-base-content/70">Connects to your browser's WebLN provider (e.g. Alby).</p>
          )}
          {type === "nutwallet" && (
            <p className="text-sm text-base-content/70">
              Uses your logged-in account's NIP-60 wallet. We search relays for an existing wallet first and only create
              a new one (with suggested mints) if none is found.
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-base-content/70">
              <span className="loading loading-spinner loading-sm" /> Connecting…
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </div>

        <div className="modal-action">
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          {showAddButton && (
            <button className="btn btn-primary" onClick={handleAdd} disabled={loading}>
              {loading ? <span className="loading loading-spinner loading-sm" /> : "Add"}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function WalletApp({ signer, pubkey }: { signer: ISigner; pubkey: string }) {
  const backends = use$(backends$) ?? [];
  const activeId = use$(activeId$);
  const [adding, setAdding] = useState(false);

  use$(
    () =>
      new Observable<void>(() => () => {
        for (const backend of backends$.value) backend.dispose();
        backends$.next([]);
        activeId$.next(undefined);
        loaded = false;
      }),
    [],
  );
  const persistence = use$(
    () =>
      combineLatest([backends$, activeId$]).pipe(
        concatMap(([backends, activeId]) =>
          defer(async () => {
            if (
              !(await storage$.value?.setItem(
                STORAGE_KEY,
                JSON.stringify({ backends: backends.map((backend) => backend.serialize()), activeId }),
              ))
            )
              throw new Error("Could not save encrypted wallet connections");
            return "";
          }).pipe(catchError((error) => of(String(error.message ?? error)))),
        ),
      ),
    [],
  );
  const active = backends.find((b) => b.id === activeId);

  return (
    <div className="container mx-auto my-8 px-4 max-w-md">
      <h1 className="text-3xl font-bold mb-6">Multiple Wallets</h1>

      {persistence && (
        <p role="alert" className="text-error">
          {persistence}
        </p>
      )}
      <BackendSwitcher backends={backends} activeId={activeId} onAdd={() => setAdding(true)} />

      {active ? (
        <WalletPanels backend={active} />
      ) : (
        <div className="border border-base-300 p-8 text-center text-base-content/70">
          No wallets yet — add one to get started.
        </div>
      )}

      {adding && <AddWalletModal signer={signer} pubkey={pubkey} onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function MultipleWalletsExample() {
  const storage = use$(storage$);
  const [session, setSession] = useState<{ signer: ISigner; pubkey: string } | null>(null);

  const handleLogin = useCallback(async (signer: ISigner, pubkey: string) => {
    account$.next(pubkey);
    await loadBackends(signer, pubkey);
    setSession({ signer, pubkey });
  }, []);

  // Log in first — the NutWallet backend needs a nostr signer (WebLN and NWC don't use it)
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!session) return <LoginView onLogin={handleLogin} />;

  return <WalletApp signer={session.signer} pubkey={session.pubkey} />;
}
