import { AccountManager } from "applesauce-accounts";
import { ExtensionAccount, NostrConnectAccount, registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { RelayPool } from "applesauce-relay";
import { type ISigner, ExtensionMissingError, NostrConnectSigner } from "applesauce-signers";
import { useCallback, useMemo, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { BehaviorSubject, NEVER, catchError, defer, finalize, from, merge, of, tap } from "rxjs";
import QRCode from "./qr-code";

const ACCOUNTS_STORAGE_KEY = "accounts";
const ACTIVE_STORAGE_KEY = "active";
const DEFAULT_QR_RELAY = "wss://bucket.coracle.social";

/** Forgets the active account so the next login view does not sign back in automatically */
export function forgetActiveAccount() {
  localStorage.removeItem(ACTIVE_STORAGE_KEY);
}

function createPoolBackedSigner(account: NostrConnectAccount, pool: RelayPool) {
  const signer = account.signer;

  return new NostrConnectSigner({
    pool,
    relays: signer.relays,
    pubkey: account.pubkey,
    remote: signer.remote,
    bunkerSecret: signer.bunkerSecret,
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
  const restoredLogin = useRef(false);
  const qrAbortRef = useRef<AbortController | null>(null);
  const qrSignerRef = useRef<NostrConnectSigner | null>(null);
  const qrSessionRef = useRef(0);
  const qrRelayTimeoutRef = useRef<number | null>(null);

  const state$ = useMemo(
    () =>
      new BehaviorSubject({
        bunkerUri: "",
        qrRelay: DEFAULT_QR_RELAY,
        loadingMethod: null as "extension" | "bunker" | null,
        qrUri: null as string | null,
        qrConnecting: false,
        error: null as string | null,
      }),
    [],
  );
  const { bunkerUri, qrRelay, loadingMethod, qrUri, qrConnecting, error } = use$(state$);
  const update = useCallback(
    (changes: Partial<typeof state$.value>) => state$.next({ ...state$.value, ...changes }),
    [state$],
  );

  // Restore before subscribing to persistence so initial empty values cannot overwrite saved accounts.
  use$(
    () =>
      defer(() => {
        if (!restoreAttempted.current) {
          restoreAttempted.current = true;
          try {
            manager.fromJSON(JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY) || "[]"), true);
            for (const account of manager.accounts) {
              if (account instanceof NostrConnectAccount) account.signer = createPoolBackedSigner(account, pool);
            }
            const activeId = localStorage.getItem(ACTIVE_STORAGE_KEY);
            const active = activeId ? manager.getAccount(activeId) : undefined;
            if (active) manager.setActive(active);
          } catch (error) {
            update({ error: error instanceof Error ? error.message : "Failed to restore saved accounts" });
          }
        }
        return merge(
          manager.accounts$.pipe(
            tap(() => localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(manager.toJSON(true)))),
          ),
          manager.active$.pipe(
            tap((account) => {
              if (account) localStorage.setItem(ACTIVE_STORAGE_KEY, account.id);
              else localStorage.removeItem(ACTIVE_STORAGE_KEY);
            }),
          ),
        );
      }),
    [manager, pool, update],
  );

  use$(
    () =>
      defer(() => {
        if (restoredLogin.current) return of(undefined);
        restoredLogin.current = true;
        const active = manager.active;
        return active ? from(Promise.resolve(onLogin(manager.signer, active.pubkey))) : of(undefined);
      }).pipe(
        catchError((error) => {
          update({ error: error instanceof Error ? error.message : "Failed to restore login" });
          return of(undefined);
        }),
      ),
    [manager, onLogin, update],
  );

  const stopQrSession = useCallback(
    (resetRelayTimer = true, closeSigner = true) => {
      qrSessionRef.current += 1;
      // Keep the signer open after a successful login since the app is now using it
      if (closeSigner) {
        qrAbortRef.current?.abort();
        void qrSignerRef.current?.close();
      }
      qrAbortRef.current = null;
      qrSignerRef.current = null;
      update({ qrUri: null, qrConnecting: false });

      if (resetRelayTimer && qrRelayTimeoutRef.current) {
        window.clearTimeout(qrRelayTimeoutRef.current);
        qrRelayTimeoutRef.current = null;
      }
    },
    [update],
  );

  // The QR signer transfers ownership on login; pending sessions must close on unmount.
  use$(() => NEVER.pipe(finalize(() => stopQrSession())), [stopQrSession]);

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
      update({ error: null });
      await onLogin(manager.signer, activeAccount.pubkey);
    },
    [manager, onLogin, update],
  );

  const handleExtensionLogin = useCallback(async () => {
    try {
      update({ loadingMethod: "extension" });
      update({ error: null });

      const account = await ExtensionAccount.fromExtension();
      await activateAccount(account);
    } catch (err) {
      if (err instanceof ExtensionMissingError) update({ error: "No Nostr extension found" });
      else update({ error: err instanceof Error ? err.message : "Failed to login with extension" });
    } finally {
      update({ loadingMethod: null });
    }
  }, [activateAccount, update]);

  const handleBunkerLogin = useCallback(async () => {
    if (!bunkerUri.trim()) return;

    try {
      update({ loadingMethod: "bunker" });
      update({ error: null });

      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUri.trim(), { pool });
      const pubkey = await signer.getPublicKey();
      await activateAccount(new NostrConnectAccount(pubkey, signer));
      update({ bunkerUri: "" });
    } catch (err) {
      update({ error: err instanceof Error ? err.message : "Failed to connect to bunker" });
    } finally {
      update({ loadingMethod: null });
    }
  }, [activateAccount, bunkerUri, pool]);

  const handleQrLogin = useCallback(
    async (relay: string) => {
      const nextRelay = relay.trim();
      if (!nextRelay) {
        update({ error: "Enter a relay URL for QR login" });
        return;
      }

      const session = qrSessionRef.current + 1;
      qrSessionRef.current = session;
      qrAbortRef.current?.abort();
      void qrSignerRef.current?.close();

      let timeoutId: number | undefined;
      try {
        update({ error: null, qrConnecting: true });

        const signer = new NostrConnectSigner({
          pool,
          relays: [nextRelay],
        });

        qrSignerRef.current = signer;
        update({
          qrUri: signer.getNostrConnectURI({
            name: "Applesauce Example",
          }),
        });

        const controller = new AbortController();
        qrAbortRef.current = controller;
        timeoutId = window.setTimeout(() => controller.abort(), 60000);

        await signer.waitForSigner(controller.signal);
        if (qrSessionRef.current !== session) return;
        window.clearTimeout(timeoutId);

        const pubkey = await signer.getPublicKey();
        if (qrSessionRef.current !== session) return;

        await activateAccount(new NostrConnectAccount(pubkey, signer));
        stopQrSession(true, false);
      } catch (err) {
        if (qrSessionRef.current !== session) return;

        if (err instanceof Error && err.message === "Aborted")
          update({ error: "Connection timeout. Please try again." });
        else if (err instanceof Error && err.message !== "Closed") update({ error: err.message });
        else if (!(err instanceof Error)) update({ error: "QR code login failed" });

        stopQrSession();
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    },
    [activateAccount, pool, stopQrSession, update],
  );

  const handleQrRelayChange = useCallback(
    (value: string) => {
      update({ qrRelay: value });
      if (!qrUri) return;

      if (qrRelayTimeoutRef.current) window.clearTimeout(qrRelayTimeoutRef.current);
      qrRelayTimeoutRef.current = window.setTimeout(() => {
        void handleQrLogin(value);
      }, 300);
    },
    [handleQrLogin, qrUri, update],
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
                placeholder="wss://bucket.coracle.social"
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
                onChange={(event) => update({ bunkerUri: event.target.value })}
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
