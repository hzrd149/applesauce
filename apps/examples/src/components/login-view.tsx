import { AccountManager } from "applesauce-accounts";
import { ExtensionAccount, NostrConnectAccount, registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { RelayPool } from "applesauce-relay";
import { type ISigner, ExtensionMissingError, NostrConnectSigner } from "applesauce-signers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "./qr-code";

const ACCOUNTS_STORAGE_KEY = "accounts";
const ACTIVE_STORAGE_KEY = "active";
const DEFAULT_QR_RELAY = "wss://bucket.coracle.social";

function createPoolBackedSigner(account: NostrConnectAccount, pool: RelayPool) {
  const signer = account.signer;

  return new NostrConnectSigner({
    pool,
    relays: signer.relays,
    pubkey: account.pubkey,
    remote: signer.remote,
    secret: signer.secret,
    signer: signer.signer,
  });
}

export default function LoginView({ onLogin }: { onLogin: (signer: ISigner, pubkey: string) => void | Promise<void> }) {
  const pool = useMemo(() => new RelayPool(), []);
  const manager = useMemo(() => {
    const instance = new AccountManager();
    registerCommonAccountTypes(instance);
    return instance;
  }, []);

  const restoreAttempted = useRef(false);
  const qrAbortRef = useRef<AbortController | null>(null);
  const qrSignerRef = useRef<NostrConnectSigner | null>(null);
  const qrSessionRef = useRef(0);
  const qrRelayTimeoutRef = useRef<number | null>(null);

  const [bunkerUri, setBunkerUri] = useState("");
  const [qrRelay, setQrRelay] = useState(DEFAULT_QR_RELAY);
  const [loadingMethod, setLoadingMethod] = useState<"extension" | "bunker" | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [qrConnecting, setQrConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accountsSubscription = manager.accounts$.subscribe(() => {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(manager.toJSON(true)));
    });

    const activeSubscription = manager.active$.subscribe((account) => {
      if (account) localStorage.setItem(ACTIVE_STORAGE_KEY, account.id);
      else localStorage.removeItem(ACTIVE_STORAGE_KEY);
    });

    return () => {
      accountsSubscription.unsubscribe();
      activeSubscription.unsubscribe();
    };
  }, [manager]);

  useEffect(() => {
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;

    try {
      const savedAccounts = JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY) || "[]");
      manager.fromJSON(savedAccounts, true);

      for (const account of manager.accounts) {
        if (account instanceof NostrConnectAccount) account.signer = createPoolBackedSigner(account, pool);
      }

      const activeAccountId = localStorage.getItem(ACTIVE_STORAGE_KEY);
      if (!activeAccountId) return;

      const activeAccount = manager.getAccount(activeAccountId);
      if (!activeAccount) return;

      manager.setActive(activeAccount);
      void onLogin(activeAccount.signer, activeAccount.pubkey);
    } catch (err) {
      console.error("Failed to restore saved accounts", err);
      localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_STORAGE_KEY);
    }
  }, [manager, onLogin, pool]);

  const stopQrSession = useCallback((resetRelayTimer = true) => {
    qrSessionRef.current += 1;
    qrAbortRef.current?.abort();
    void qrSignerRef.current?.close();
    qrAbortRef.current = null;
    qrSignerRef.current = null;
    setQrUri(null);
    setQrConnecting(false);

    if (resetRelayTimer && qrRelayTimeoutRef.current) {
      window.clearTimeout(qrRelayTimeoutRef.current);
      qrRelayTimeoutRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      stopQrSession();
    },
    [stopQrSession],
  );

  const activateAccount = useCallback(
    async (account: ExtensionAccount | NostrConnectAccount) => {
      const existing = manager.accounts.find((saved) => {
        if (saved.type !== account.type || saved.pubkey !== account.pubkey) return false;

        if (saved instanceof NostrConnectAccount && account instanceof NostrConnectAccount) {
          return saved.signer.remote === account.signer.remote;
        }

        return true;
      });

      const activeAccount = existing ?? account;

      if (existing) existing.signer = account.signer;
      else manager.addAccount(account);

      manager.setActive(activeAccount);
      setError(null);
      await onLogin(activeAccount.signer, activeAccount.pubkey);
    },
    [manager, onLogin],
  );

  const handleExtensionLogin = useCallback(async () => {
    try {
      setLoadingMethod("extension");
      setError(null);

      const account = await ExtensionAccount.fromExtension();
      await activateAccount(account);
    } catch (err) {
      if (err instanceof ExtensionMissingError) setError("No Nostr extension found");
      else setError(err instanceof Error ? err.message : "Failed to login with extension");
    } finally {
      setLoadingMethod(null);
    }
  }, [activateAccount]);

  const handleBunkerLogin = useCallback(async () => {
    if (!bunkerUri.trim()) return;

    try {
      setLoadingMethod("bunker");
      setError(null);

      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri.trim(), { pool });
      const pubkey = await signer.getPublicKey();
      await activateAccount(new NostrConnectAccount(pubkey, signer));
      setBunkerUri("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to bunker");
    } finally {
      setLoadingMethod(null);
    }
  }, [activateAccount, bunkerUri, pool]);

  const handleQrLogin = useCallback(
    async (relay: string) => {
      const nextRelay = relay.trim();
      if (!nextRelay) {
        setError("Enter a relay URL for QR login");
        return;
      }

      const session = qrSessionRef.current + 1;
      qrSessionRef.current = session;
      qrAbortRef.current?.abort();
      void qrSignerRef.current?.close();

      try {
        setError(null);
        setQrConnecting(true);

        const signer = new NostrConnectSigner({
          pool,
          relays: [nextRelay],
        });

        qrSignerRef.current = signer;
        setQrUri(
          signer.getNostrConnectURI({
            name: "Applesauce Example",
          }),
        );

        const controller = new AbortController();
        qrAbortRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), 60000);

        await signer.waitForSigner(controller.signal);
        if (qrSessionRef.current !== session) return;
        window.clearTimeout(timeoutId);

        const pubkey = await signer.getPublicKey();
        if (qrSessionRef.current !== session) return;

        await activateAccount(new NostrConnectAccount(pubkey, signer));
        stopQrSession();
      } catch (err) {
        if (qrSessionRef.current !== session) return;

        if (err instanceof Error && err.message === "Aborted") setError("Connection timeout. Please try again.");
        else if (err instanceof Error && err.message !== "Closed") setError(err.message);
        else if (!(err instanceof Error)) setError("QR code login failed");

        setQrUri(null);
        setQrConnecting(false);
      }
    },
    [activateAccount, pool, stopQrSession],
  );

  const handleQrRelayChange = useCallback(
    (value: string) => {
      setQrRelay(value);
      if (!qrUri) return;

      if (qrRelayTimeoutRef.current) window.clearTimeout(qrRelayTimeoutRef.current);
      qrRelayTimeoutRef.current = window.setTimeout(() => {
        void handleQrLogin(value);
      }, 300);
    },
    [handleQrLogin, qrUri],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-200 px-4 py-6">
      <div className="w-full max-w-sm bg-base-100 p-4">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">Login Required</h1>
            <p className="mt-1 text-sm text-base-content/70">Use an extension, bunker URI, or QR code to continue.</p>
          </div>

          {qrUri ? (
            <div className="space-y-3">
              <input
                type="text"
                value={qrRelay}
                onChange={(event) => handleQrRelayChange(event.target.value)}
                placeholder="wss://relay.nsec.app"
                className="input input-bordered w-full"
              />
              <div className="flex justify-center bg-white p-2">
                <QRCode
                  value={qrUri}
                  href={qrUri}
                  title="Open Nostr Connect URI"
                  className="h-48 w-48"
                  size={192}
                  alt="Nostr Connect QR code"
                />
              </div>
              <button className="btn btn-outline w-full" onClick={() => stopQrSession()}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleExtensionLogin}
                className="btn btn-primary w-full"
                disabled={loadingMethod !== null || qrConnecting}
              >
                {loadingMethod === "extension" ? <span className="loading loading-spinner" /> : "Login with Extension"}
              </button>
              <button
                className="btn btn-ghost w-full"
                onClick={() => void handleQrLogin(qrRelay)}
                disabled={loadingMethod !== null || qrConnecting}
              >
                {qrConnecting ? "Waiting for signer..." : "Login with QR Code"}
              </button>
              <input
                type="text"
                value={bunkerUri}
                onChange={(event) => setBunkerUri(event.target.value)}
                placeholder="bunker://..."
                className="input input-bordered w-full"
                disabled={loadingMethod !== null || qrConnecting}
              />
              <button
                onClick={handleBunkerLogin}
                className="btn btn-secondary w-full"
                disabled={!bunkerUri.trim() || loadingMethod !== null || qrConnecting}
              >
                {loadingMethod === "bunker" ? "Connecting..." : "Login with Bunker URI"}
              </button>
            </div>
          )}

          {error ? <div className="bg-error/10 px-3 py-2 text-sm text-error">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
