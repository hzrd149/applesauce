import { ProxySigner } from "applesauce-accounts";
import { ActionHub } from "applesauce-actions";
import { castUser, User } from "applesauce-common/casts";
import { defined, EventFactory, EventStore, simpleTimeout } from "applesauce-core";
import { Filter, persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { CreateWallet, UnlockWallet } from "applesauce-wallet/actions";
import { Wallet, WalletHistory, WalletToken } from "applesauce-wallet/casts";
import { WALLET_HISTORY_KIND, WALLET_KIND } from "applesauce-wallet/helpers";
import { WALLET_TOKEN_KIND } from "applesauce-wallet/helpers/tokens";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useCallback, useState } from "react";
import { BehaviorSubject, firstValueFrom, map } from "rxjs";
import LoginView from "../../components/login-view";

// Explicitly import the wallet casts so user.wallet$ is available
import "applesauce-wallet/casts";

// Setup application state
const signer$ = new BehaviorSubject<ExtensionSigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

// Setup event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();
const factory = new EventFactory({ signer: new ProxySigner(signer$.pipe(defined())) });
const actions = new ActionHub(eventStore, factory, async (event) => {
  const outboxes = await firstValueFrom(eventStore.mailboxes(event.pubkey).pipe(defined(), simpleTimeout(5_000)));

  if (!outboxes?.outboxes?.length) throw new Error("No outboxes found");
  await pool.publish(outboxes.outboxes, event);
});

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters);
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create unified event loader for the store
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
  cacheRequest,
});

type Tab = "overview" | "history" | "tokens";

// Helper function
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Components
function CreateWalletCard({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">No Wallet Found</h2>
        <p className="text-base-content/70 mb-4">
          You don't have a wallet yet. Create one to get started with ecash tokens.
        </p>
        <button className="btn btn-primary" onClick={onCreate} disabled={creating}>
          {creating ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Creating...
            </>
          ) : (
            "Create Wallet"
          )}
        </button>
      </div>
    </div>
  );
}

function WalletStatusCard({ wallet }: { wallet: Wallet }) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">Wallet Status</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">Status:</span>
            <span className={`badge ${!wallet.unlocked ? "badge-warning" : "badge-success"}`}>
              {!wallet.unlocked ? "Locked" : "Unlocked"}
            </span>
          </div>
          {wallet.unlocked && wallet.mints && (
            <div className="flex items-center gap-2">
              <span className="font-medium">Mints:</span>
              <span className="text-sm text-base-content/70">
                {wallet.mints.length > 0 ? wallet.mints.length : "None configured"}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BalanceCard({
  wallet,
  balance,
  totalBalance,
}: {
  wallet: Wallet;
  balance: Record<string, number> | undefined;
  totalBalance: number | undefined;
}) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">Balance</h2>
        {!wallet.unlocked ? (
          <div className="text-lg text-base-content/70">🔒 Locked</div>
        ) : totalBalance !== undefined ? (
          <div className="space-y-2">
            <div className="text-3xl font-bold">{totalBalance} sats</div>
            {balance && Object.keys(balance).length > 0 && (
              <div className="mt-4 space-y-1">
                <div className="text-sm font-medium text-base-content/70">By Mint:</div>
                {Object.entries(balance).map(([mint, amount]) => (
                  <div key={mint} className="flex justify-between text-sm">
                    <span className="font-mono text-xs truncate max-w-xs">{mint}</span>
                    <span className="font-medium">{amount} sats</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-lg text-base-content/70">No balance</div>
        )}
      </div>
    </div>
  );
}

function WalletActionsCard({
  wallet,
  onUnlock,
  unlocking,
}: {
  wallet: Wallet;
  onUnlock: () => void;
  unlocking: boolean;
}) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">Actions</h2>
        <div className="flex gap-2">
          {!wallet.unlocked && (
            <button className="btn btn-primary" onClick={onUnlock} disabled={unlocking}>
              {unlocking ? (
                <>
                  <span className="loading loading-spinner loading-sm" />
                  Unlocking...
                </>
              ) : (
                "Unlock Wallet"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function WalletTabs({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  return (
    <div className="tabs tabs-boxed">
      <button className={`tab ${activeTab === "overview" ? "tab-active" : ""}`} onClick={() => onTabChange("overview")}>
        Overview
      </button>
      <button className={`tab ${activeTab === "history" ? "tab-active" : ""}`} onClick={() => onTabChange("history")}>
        History
      </button>
      <button className={`tab ${activeTab === "tokens" ? "tab-active" : ""}`} onClick={() => onTabChange("tokens")}>
        Tokens
      </button>
    </div>
  );
}

function OverviewTab({
  wallet,
  balance,
  totalBalance,
  onUnlock,
  unlocking,
}: {
  wallet: Wallet;
  balance: Record<string, number> | undefined;
  totalBalance: number | undefined;
  onUnlock: () => void;
  unlocking: boolean;
}) {
  return (
    <>
      <WalletStatusCard wallet={wallet} />
      <BalanceCard wallet={wallet} balance={balance} totalBalance={totalBalance} />
      <WalletActionsCard wallet={wallet} onUnlock={onUnlock} unlocking={unlocking} />
    </>
  );
}

function HistoryEntry({ entry }: { entry: WalletHistory }) {
  const unlocked = entry.unlocked;
  const meta = use$(entry.meta$);

  return (
    <div className="border border-base-300 rounded-lg p-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-base-content/70">{formatDate(entry.created_at)}</span>
          {!unlocked && <span className="badge badge-warning badge-sm">Locked</span>}
          {unlocked && meta && (
            <span className={`badge badge-sm ${meta.direction === "in" ? "badge-success" : "badge-error"}`}>
              {meta.direction === "in" ? "Received" : "Sent"}
            </span>
          )}
        </div>
        {unlocked && meta ? (
          <div className="space-y-1">
            <div className="font-medium text-lg">{meta.amount} sats</div>
            {meta.mint && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Mint:</span> <span className="font-mono text-xs">{meta.mint}</span>
              </div>
            )}
            {meta.fee !== undefined && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Fee:</span> {meta.fee} sats
              </div>
            )}
            {meta.created.length > 0 && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Created tokens:</span> {meta.created.length}
              </div>
            )}
            {entry.redeemed.length > 0 && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Redeemed tokens:</span> {entry.redeemed.length}
              </div>
            )}
          </div>
        ) : (
          <div className="text-base-content/70">🔒 Content is locked</div>
        )}
      </div>
    </div>
  );
}

function HistoryTab({ history }: { history: WalletHistory[] | undefined }) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">Transaction History</h2>
        {!history || history.length === 0 ? (
          <div className="text-base-content/70">No history entries found</div>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TokenEntry({ token }: { token: WalletToken }) {
  const isUnlocked = token.unlocked;
  const meta = use$(token.meta$);
  const amount = use$(token.amount$);

  return (
    <div className="border border-base-300 rounded-lg p-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-base-content/70">{formatDate(token.created_at)}</span>
          {!isUnlocked && <span className="badge badge-warning badge-sm">Locked</span>}
          {meta && <span className="badge badge-info badge-sm">{meta.proofs?.length} proofs</span>}
        </div>
        {meta ? (
          <div className="space-y-1">
            <div className="font-medium text-lg">{amount} sats</div>
            <div className="text-sm text-base-content/70">
              <span className="font-medium">Mint:</span> <span className="font-mono text-xs">{meta.mint}</span>
            </div>
            {meta.unit && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Unit:</span> {meta.unit}
              </div>
            )}
            {meta.del && meta.del.length > 0 && (
              <div className="text-sm text-base-content/70">
                <span className="font-medium">Deleted tokens:</span> {meta.del.length}
              </div>
            )}
          </div>
        ) : (
          <div className="text-base-content/70">🔒 Content is locked</div>
        )}
      </div>
    </div>
  );
}

function TokensTab({ tokens }: { tokens: WalletToken[] | undefined }) {
  return (
    <div className="card bg-base-100 shadow-lg">
      <div className="card-body">
        <h2 className="card-title">Stored Tokens</h2>
        {!tokens || tokens.length === 0 ? (
          <div className="text-base-content/70">No tokens found</div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <TokenEntry key={token.id} token={token} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WalletView({ user }: { user: User }) {
  const wallet = use$(user.wallet$);
  const balance = use$(user.wallet$.balance$);
  const history = use$(user.wallet$.history$);
  const tokens = use$(user.wallet$.tokens$);

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [creating, setCreating] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outboxes = use$(user.outboxes$);

  // Subscribe to token and history events
  use$(
    () =>
      outboxes &&
      pool.subscription(
        outboxes,
        { kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND], authors: [user.pubkey] },
        { eventStore },
      ),
    [outboxes, user.pubkey],
  );

  const handleCreateWallet = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      // Create wallet with default mints (empty array for now)
      await actions.run(CreateWallet, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wallet");
      console.error("Failed to create wallet:", err);
    } finally {
      setCreating(false);
    }
  }, []);

  const handleUnlockWallet = useCallback(async () => {
    setUnlocking(true);
    setError(null);
    try {
      await actions.run(UnlockWallet, { history: true, tokens: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlock wallet");
      console.error("Failed to unlock wallet:", err);
    } finally {
      setUnlocking(false);
    }
  }, []);

  // Calculate total balance
  const totalBalance = balance ? Object.values(balance).reduce((sum, amount) => sum + amount, 0) : undefined;

  return (
    <div className="container mx-auto my-8 px-4 max-w-2xl">
      <h1 className="text-3xl font-bold mb-6">Wallet Example</h1>

      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}

      {!wallet ? (
        <CreateWalletCard onCreate={handleCreateWallet} creating={creating} />
      ) : (
        <div className="space-y-4">
          <WalletTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "overview" && (
            <OverviewTab
              wallet={wallet}
              balance={balance}
              totalBalance={totalBalance}
              onUnlock={handleUnlockWallet}
              unlocking={unlocking}
            />
          )}

          {activeTab === "history" && <HistoryTab history={history} />}

          {activeTab === "tokens" && <TokensTab tokens={tokens} />}
        </div>
      )}
    </div>
  );
}

export default function WalletExample() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  const handleLogin = useCallback((newSigner: ExtensionSigner, newPubkey: string) => {
    signer$.next(newSigner);
    pubkey$.next(newPubkey);
  }, []);

  if (!signer || !pubkey || !user) return <LoginView onLogin={handleLogin} />;
  else return <WalletView user={user} />;
}
