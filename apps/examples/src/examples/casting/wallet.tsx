import { getEncodedToken } from "@cashu/cashu-ts";
import { ProxySigner } from "applesauce-accounts";
import { ActionHub } from "applesauce-actions";
import { castUser, User } from "applesauce-common/casts";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventFactory, EventStore, mapEventsToTimeline, simpleTimeout } from "applesauce-core";
import {
  Filter,
  getDisplayName,
  getProfilePicture,
  getTagValue,
  NostrEvent,
  persistEventsToCache,
  relaySet,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers/signers/extension-signer";
import {
  AddNutzapInfoMint,
  ConsolidateTokens,
  CreateWallet,
  ReceiveNutzaps,
  RemoveNutzapInfoMint,
  SetWalletMints,
  SetWalletRelays,
  UnlockWallet,
} from "applesauce-wallet/actions";
import { Nutzap, Wallet, WalletHistory, WalletToken } from "applesauce-wallet/casts";
import { NUTZAP_KIND, WALLET_HISTORY_KIND, WALLET_KIND } from "applesauce-wallet/helpers";
import { WALLET_TOKEN_KIND } from "applesauce-wallet/helpers/tokens";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BehaviorSubject, firstValueFrom, map } from "rxjs";
import LoginView from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";

// Explicitly import the wallet casts so user.wallet$ is available
import "applesauce-wallet/casts";
import { generateSecretKey } from "nostr-tools";
import RelayPicker from "../../components/relay-picker";

// Setup application state
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ExtensionSigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));
const autoUnlock$ = new BehaviorSubject<boolean>(false);

// Setup event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();
const factory = new EventFactory({ signer: new ProxySigner(signer$.pipe(defined())) });
const actions = new ActionHub(eventStore, factory, async (event) => {
  const outboxes = await firstValueFrom(eventStore.mailboxes(event.pubkey).pipe(defined(), simpleTimeout(5_000)));

  if (!outboxes?.outboxes?.length) throw new Error("No outboxes found");
  await pool.publish(outboxes.outboxes, event);
});

// Persist encrypted content
persistEncryptedContent(eventStore, storage$.pipe(defined()));

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

// Mint announcement kind
const MINT_ANNOUNCEMENT_KIND = 38172;

interface MintInfo {
  url: string;
  pubkey: string;
  network: string;
  event: NostrEvent;
}

// Component to discover mints from Nostr relays
function MintDiscovery({ onMintsSelected }: { onMintsSelected: (mints: string[]) => void }) {
  const [relay, setRelay] = useState<string>("wss://relay.damus.io/");
  const [selectedMints, setSelectedMints] = useState<Set<string>>(new Set());
  const [manualMint, setManualMint] = useState("");
  const [manualMints, setManualMints] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Query for kind:38172 events from common relays
  const mintEvents = use$(
    () =>
      pool.subscription([relay], { kinds: [MINT_ANNOUNCEMENT_KIND] }, { eventStore }).pipe(
        onlyEvents(),
        mapEventsToTimeline(),
        map((events) => [...events]),
      ),
    [relay],
  );

  // Parse mint events into MintInfo objects
  const allMints = useMemo(() => {
    if (!mintEvents) return [];

    const mintMap = new Map<string, MintInfo>();

    for (const event of mintEvents) {
      const url = getTagValue(event, "u");
      const pubkey = getTagValue(event, "d");
      const network = getTagValue(event, "n") || "mainnet";

      if (!url || !pubkey) continue;

      // Use URL as key to deduplicate (keep most recent)
      const existing = mintMap.get(url);
      if (!existing || event.created_at > existing.event.created_at) {
        mintMap.set(url, { url, pubkey, network, event });
      }
    }

    return Array.from(mintMap.values()).sort((a, b) => b.event.created_at - a.event.created_at);
  }, [mintEvents]);

  // Filter mints based on search query
  const mints = useMemo(() => {
    if (!searchQuery.trim()) return allMints;

    const query = searchQuery.toLowerCase().trim();
    return allMints.filter((mint) => {
      return (
        mint.url.toLowerCase().includes(query) ||
        mint.network.toLowerCase().includes(query) ||
        mint.pubkey.toLowerCase().includes(query)
      );
    });
  }, [allMints, searchQuery]);

  useEffect(() => {
    if (mintEvents !== undefined) setLoading(false);
  }, [mintEvents]);

  const handleToggleMint = useCallback((url: string) => {
    setSelectedMints((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const handleAddManualMint = useCallback(() => {
    if (!manualMint.trim()) return;
    const url = manualMint.trim();
    setManualMints((prev) => {
      const next = new Set(prev);
      next.add(url);
      return next;
    });
    setManualMint("");
  }, [manualMint]);

  const handleRemoveManualMint = useCallback((url: string) => {
    setManualMints((prev) => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
  }, []);

  useEffect(() => {
    const allMints = Array.from(new Set([...selectedMints, ...manualMints]));
    onMintsSelected(allMints);
  }, [selectedMints, manualMints, onMintsSelected]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Select Mints</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Choose one or more ecash mints to use with your wallet. These mints are discovered from Nostr relays.
        </p>
        <div className="alert alert-warning">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Unknown mints will steal your sats. Only add mints you trust.</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-md" />
          <span className="ml-2 text-base-content/70">Discovering mints from relays...</span>
        </div>
      ) : allMints.length === 0 ? (
        <div className="alert alert-info">
          <span>No mints found on relays. You can still create a wallet and add mints manually later.</span>
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search mints by URL, network, or pubkey..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <RelayPicker value={relay} onChange={setRelay} />
          </div>
          {mints.length === 0 ? (
            <div className="alert alert-info">
              <span>
                No mints match your search "{searchQuery}". {allMints.length} mint{allMints.length !== 1 ? "s" : ""}{" "}
                available.
              </span>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {mints.map((mint) => {
                const isSelected = selectedMints.has(mint.url);
                return (
                  <div
                    key={mint.url}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      isSelected ? "border-primary bg-primary/10" : "border-base-300 hover:border-base-content/20"
                    }`}
                    onClick={() => handleToggleMint(mint.url)}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary mt-1"
                      checked={isSelected}
                      onChange={() => handleToggleMint(mint.url)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{mint.url}</div>
                      <div className="text-xs text-base-content/70 mt-1 space-y-1">
                        <div>
                          <span className="font-semibold">Network:</span> {mint.network}
                        </div>
                        <div className="font-mono text-xs truncate">
                          <span className="font-semibold">Pubkey:</span> {mint.pubkey}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="divider" />

      <div>
        <h3 className="text-lg font-semibold mb-2">Add Mint Manually</h3>
        <p className="text-sm text-base-content/70 mb-4">
          If you know a mint URL that wasn't found, you can add it manually.
        </p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            className="input input-bordered flex-1"
            placeholder="https://mint.example.com"
            value={manualMint}
            onChange={(e) => setManualMint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddManualMint();
              }
            }}
          />
          <button className="btn btn-primary" onClick={handleAddManualMint} disabled={!manualMint.trim()}>
            Add
          </button>
        </div>

        {manualMints.size > 0 && (
          <div className="space-y-2">
            {Array.from(manualMints).map((url) => (
              <div key={url} className="flex items-center justify-between p-2 bg-base-200 rounded">
                <span className="font-mono text-sm truncate flex-1">{url}</span>
                <button className="btn btn-xs btn-error ml-2" onClick={() => handleRemoveManualMint(url)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {(selectedMints.size > 0 || manualMints.size > 0) && (
        <div className="alert alert-success">
          <span>
            {selectedMints.size + manualMints.size} mint{selectedMints.size + manualMints.size !== 1 ? "s" : ""}{" "}
            selected
          </span>
        </div>
      )}
    </div>
  );
}

// Create Wallet View Component
function CreateWalletView({ onCreate }: { onCreate: (mints: string[], receiveNutzaps: boolean) => Promise<void> }) {
  const [selectedMints, setSelectedMints] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [receiveNutzaps, setReceiveNutzaps] = useState(false);

  const handleCreate = useCallback(async () => {
    if (selectedMints.length === 0) return;
    setCreating(true);
    try {
      await onCreate(selectedMints, receiveNutzaps);
    } finally {
      setCreating(false);
    }
  }, [onCreate, selectedMints, receiveNutzaps]);

  return (
    <div className="container mx-auto my-8 px-4 max-w-2xl">
      <h1 className="text-3xl font-bold mb-6">Create Wallet</h1>
      <div className="bg-base-100 border border-base-300 p-6">
        <h2 className="text-xl font-bold mb-2">No Wallet Found</h2>
        <p className="text-base-content/70 mb-4">
          You don't have a wallet yet. Create one to get started with ecash tokens.
        </p>

        <div className="mb-6">
          <MintDiscovery onMintsSelected={setSelectedMints} />
        </div>

        <div className="mb-6">
          <label className="label cursor-pointer">
            <span className="label-text">Receive Nutzaps</span>
            <input
              type="checkbox"
              className="checkbox checkbox-primary"
              checked={receiveNutzaps}
              onChange={(e) => setReceiveNutzaps(e.target.checked)}
            />
          </label>
          <p className="text-sm text-base-content/70 mt-1">
            Enable this option to receive nutzaps from other users. A private key will be generated and stored in your
            wallet.
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleCreate} disabled={creating || selectedMints.length === 0}>
          {creating ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Creating...
            </>
          ) : (
            `Create Wallet${selectedMints.length > 0 ? ` with ${selectedMints.length} mint${selectedMints.length !== 1 ? "s" : ""}` : ""}`
          )}
        </button>
        {selectedMints.length === 0 && (
          <p className="text-sm text-warning mt-2">
            Please select at least one mint to create a wallet. You can add more mints later in settings.
          </p>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ wallet }: { wallet: Wallet }) {
  const balance = use$(wallet.balance$);
  const autoUnlock = use$(autoUnlock$);

  if (!wallet.unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <div className="text-6xl">🔒</div>
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
        <p className="text-base-content/70 max-w-md">
          Unlock your wallet to view balances and manage your ecash tokens.
        </p>
        <button className="btn btn-primary mt-4" onClick={() => autoUnlock$.next(true)} disabled={autoUnlock}>
          {autoUnlock ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Unlocking...
            </>
          ) : (
            "Unlock Wallet"
          )}
        </button>
      </div>
    );
  }

  const totalBalance = balance ? Object.values(balance).reduce((sum, amount) => sum + amount, 0) : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-base-content/70 mb-1">Total Balance</div>
        <div className="text-3xl font-bold">{totalBalance} sats</div>
      </div>
      <div className="divider" />
      <div>
        <div className="text-sm font-medium text-base-content/70 mb-3">By Mint</div>
        <div className="space-y-2">
          {balance &&
            Object.entries(balance).map(([mint, amount]) => (
              <div key={mint} className="flex justify-between items-center py-2 border-b border-base-300 last:border-0">
                <span className="font-mono text-xs truncate max-w-xs text-base-content/80">{mint}</span>
                <span className="font-medium text-lg">{amount} sats</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function HistoryEntry({ entry }: { entry: WalletHistory }) {
  const unlocked = entry.unlocked;
  const meta = use$(entry.meta$);

  if (!unlocked || !meta) {
    return (
      <div className="py-2 border-b border-base-300">
        <div className="text-base-content/70">🔒 Locked</div>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-base-300">
      <div className="flex items-center gap-2">
        <span className={meta.direction === "in" ? "text-success" : "text-error"}>
          {meta.direction === "in" ? "Received" : "Sent"}
        </span>
        <span className="font-medium">{meta.amount} sats</span>
      </div>
      {meta.mint && <div className="text-sm text-base-content/70 font-mono mt-1">{meta.mint}</div>}
    </div>
  );
}

function HistoryTab({ history }: { history: WalletHistory[] | undefined }) {
  return (
    <>
      {!history || history.length === 0 ? (
        <div className="text-base-content/70">No history entries found</div>
      ) : (
        <div>
          {history.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </>
  );
}

function TokenEntry({ token, wallet }: { token: WalletToken; wallet: Wallet }) {
  const isUnlocked = token.unlocked;
  const meta = use$(token.meta$);
  const amount = use$(token.amount$);
  const relays = use$(wallet.relays$);
  const [copied, setCopied] = useState(false);

  const totalRelays = relays?.length || 0;
  const seenRelays = token.seen ? Array.from(token.seen).filter((r) => relays?.includes(r)).length : 0;

  const encodedToken = useMemo(() => {
    if (!token.mint || !token.proofs) return undefined;
    return getEncodedToken({ mint: token.mint, proofs: token.proofs, unit: "sat" });
  }, [token.mint, token.proofs]);

  const handleCopy = useCallback(() => {
    if (!encodedToken) return;
    navigator.clipboard.writeText(encodedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [token.id]);

  if (!isUnlocked || !meta) {
    return (
      <div className="py-2 border-b border-base-300">
        <div className="text-base-content/70">🔒 Locked</div>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-base-300">
      <div className="flex items-center gap-2">
        <span className="font-medium">{amount} sats</span>
        {meta.mint && <span className="text-sm text-base-content/70 font-mono">{meta.mint}</span>}

        <span className="flex-1"></span>

        {totalRelays > 0 && (
          <span className="text-xs text-base-content/60">
            {seenRelays}/{totalRelays} relay{totalRelays !== 1 ? "s" : ""}
          </span>
        )}

        <div className="join">
          {encodedToken && (
            <button className="btn btn-xs ghost join-item" onClick={handleCopy}>
              {copied ? "✅" : "📋"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TokensTab({ tokens, wallet }: { tokens: WalletToken[] | undefined; wallet: Wallet }) {
  return (
    <>
      {!tokens || tokens.length === 0 ? (
        <div className="text-base-content/70">No tokens found</div>
      ) : (
        <div>
          {tokens.map((token) => (
            <TokenEntry key={token.id} token={token} wallet={wallet} />
          ))}
        </div>
      )}
    </>
  );
}

/** A component for rendering user avatars */
function Avatar({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div className="avatar">
      <div className="w-8 h-8 rounded-full">
        <img
          src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
          alt={user.npub}
          className="w-full h-full object-cover rounded-full"
        />
      </div>
    </div>
  );
}

/** A component for rendering usernames */
function Username({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="font-medium">{getDisplayName(profile, user.pubkey.slice(0, 8) + "...")}</span>;
}

function NutzapEntry({
  nutzap,
  wallet,
  isReceived,
}: {
  nutzap: Nutzap;
  wallet: Wallet | undefined;
  isReceived: boolean;
}) {
  const amount = nutzap.amount;
  const mint = nutzap.mint;
  const comment = nutzap.comment;
  const zappedEvent = use$(nutzap.zapped$);
  const createdDate = new Date(nutzap.created_at * 1000);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReceive = useCallback(async () => {
    if (!wallet || !wallet.unlocked) {
      setError("Wallet must be unlocked to receive nutzaps");
      return;
    }

    setReceiving(true);
    setError(null);

    try {
      await actions.run(ReceiveNutzaps, nutzap.event);
    } catch (err) {
      console.error("Failed to receive nutzap:", err);
      setError(err instanceof Error ? err.message : "Failed to receive nutzap");
    } finally {
      setReceiving(false);
    }
  }, [wallet, nutzap]);

  return (
    <div className="py-3 border-b border-base-300">
      <div className="flex items-start gap-3">
        <Avatar user={nutzap.sender} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Username user={nutzap.sender} />
            <span className="text-success font-semibold">⚡ {amount} sats</span>
            {mint && (
              <span className="text-xs text-base-content/60 font-mono" title={mint}>
                {new URL(mint).hostname}
              </span>
            )}
            <span className="text-xs text-base-content/50 ms-auto">{createdDate.toLocaleString()}</span>
            {!isReceived && (
              <button
                className="btn btn-xs btn-primary"
                onClick={handleReceive}
                disabled={receiving || !wallet?.unlocked}
                title="Receive this nutzap"
              >
                {receiving ? <span className="loading loading-spinner loading-xs" /> : "Receive"}
              </button>
            )}
            {isReceived && <span className="text-xs text-success">✓ Received</span>}
          </div>
          {error && (
            <div className="alert alert-error alert-sm mt-2">
              <span>{error}</span>
            </div>
          )}
          {comment && <div className="mt-2 p-2 bg-base-200 rounded text-sm">{comment}</div>}
          {zappedEvent && (
            <div className="mt-2 p-2 bg-base-200 rounded text-xs">
              <div className="font-semibold mb-1">Zapped Event:</div>
              <div className="font-mono text-xs break-all">
                {zappedEvent.content?.slice(0, 100) || "No content"}
                {zappedEvent.content && zappedEvent.content.length > 100 ? "..." : ""}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NutzapsTab({ user }: { user: User }) {
  const wallet = use$(user.wallet$);
  const received = use$(wallet?.received$);
  const [filter, setFilter] = useState<"all" | "received" | "new">("all");
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const nutzaps = use$(
    () => eventStore.timeline({ kinds: [NUTZAP_KIND], "#p": [user.pubkey] }).pipe(castTimelineStream(Nutzap)),
    [user.pubkey],
  );

  const filteredNutzaps = useMemo(() => {
    if (!nutzaps) return [];
    if (filter === "all") return nutzaps;
    if (!received) return filter === "new" ? nutzaps : [];

    const receivedSet = new Set(received);
    if (filter === "received") {
      return nutzaps.filter((nutzap) => receivedSet.has(nutzap.id));
    } else {
      // filter === "new"
      return nutzaps.filter((nutzap) => !receivedSet.has(nutzap.id));
    }
  }, [nutzaps, received, filter]);

  const newNutzaps = useMemo(() => {
    if (!nutzaps) return [];
    if (!received) return nutzaps;
    const receivedSet = new Set(received);
    return nutzaps.filter((nutzap) => !receivedSet.has(nutzap.id));
  }, [nutzaps, received]);

  const handleReceiveAll = useCallback(async () => {
    if (!wallet || !wallet.unlocked) {
      setError("Wallet must be unlocked to receive nutzaps");
      return;
    }

    if (newNutzaps.length === 0) {
      setError("No new nutzaps to receive");
      return;
    }

    setReceiving(true);
    setError(null);
    setSuccess(false);

    try {
      // Convert Nutzap casts to NostrEvent for the action
      const nutzapEvents = newNutzaps.map((nutzap) => nutzap.event);
      await actions.run(ReceiveNutzaps, nutzapEvents);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to receive nutzaps:", err);
      setError(err instanceof Error ? err.message : "Failed to receive nutzaps");
    } finally {
      setReceiving(false);
    }
  }, [wallet, newNutzaps]);

  return (
    <>
      <div className="mb-4 flex gap-4 items-center">
        <select
          className="select select-bordered w-full max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value as "all" | "received" | "new")}
        >
          <option value="all">All</option>
          <option value="received">Received</option>
          <option value="new">New</option>
        </select>
        {newNutzaps.length > 0 && (
          <button className="btn btn-primary" onClick={handleReceiveAll} disabled={receiving || !wallet?.unlocked}>
            {receiving ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Receiving...
              </>
            ) : (
              `Receive All (${newNutzaps.length})`
            )}
          </button>
        )}
      </div>
      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success mb-4">
          <span>Successfully received all nutzaps!</span>
        </div>
      )}
      {!filteredNutzaps || filteredNutzaps.length === 0 ? (
        <div className="text-base-content/70">No incoming nutzap events found</div>
      ) : (
        <div>
          {filteredNutzaps.map((nutzap) => {
            const receivedSet = received ? new Set(received) : new Set<string>();
            const isReceived = receivedSet.has(nutzap.id);
            return <NutzapEntry key={nutzap.id} nutzap={nutzap} wallet={wallet} isReceived={isReceived} />;
          })}
        </div>
      )}
    </>
  );
}

function SyncTokensTool({ wallet }: { wallet: Wallet }) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [syncedCount, setSyncedCount] = useState(0);

  const tokens = use$(wallet.tokens$);
  const relays = use$(wallet.relays$);

  const handleSync = useCallback(async () => {
    if (!wallet.unlocked) {
      setError("Wallet must be unlocked to sync tokens");
      return;
    }

    if (!relays || relays.length === 0) {
      setError("No wallet relays configured. Please add relays in the relay management section.");
      return;
    }

    if (!tokens || tokens.length === 0) {
      setError("No tokens found to sync");
      return;
    }

    setSyncing(true);
    setError(null);
    setSuccess(false);
    setSyncedCount(0);

    try {
      let successCount = 0;
      for (const token of tokens) {
        try {
          await pool.publish(relays, token.event);
          successCount++;
        } catch (err) {
          console.error(`Failed to sync token ${token.id}:`, err);
        }
      }

      setSyncedCount(successCount);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSyncedCount(0);
      }, 5000);
    } catch (err) {
      console.error("Failed to sync tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to sync tokens");
    } finally {
      setSyncing(false);
    }
  }, [wallet.unlocked, tokens, relays]);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Sync Tokens</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Broadcast all known token events to your wallet relays. This ensures your tokens are available on all configured
        relays.
      </p>
      <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
        {syncing ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Syncing...
          </>
        ) : (
          "Sync Tokens"
        )}
      </button>
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success mt-4">
          <span>
            Successfully synced {syncedCount} of {tokens?.length || 0} tokens to {relays?.length || 0} relay
            {relays?.length !== 1 ? "s" : ""}!
          </span>
        </div>
      )}
    </div>
  );
}

function ConsolidateTool({ wallet }: { wallet: Wallet }) {
  const [consolidating, setConsolidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const tokens = use$(wallet.tokens$);
  const mints = use$(wallet.mints$);

  const handleConsolidate = useCallback(async () => {
    if (!wallet.unlocked) {
      setError("Wallet must be unlocked to consolidate tokens");
      return;
    }

    setConsolidating(true);
    setError(null);
    setSuccess(false);

    try {
      await actions.run(ConsolidateTokens, { ignoreLocked: true });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to consolidate tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to consolidate tokens");
    } finally {
      setConsolidating(false);
    }
  }, [wallet.unlocked]);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Consolidate Tokens</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Combine all unlocked token events into a single event per mint. This helps reduce the number of token events in
        your wallet.
      </p>
      <p className="text-sm text-base-content/70 mb-4">
        {tokens?.length} tokens found accross {mints?.length} mints
      </p>
      <button className="btn btn-primary" onClick={handleConsolidate} disabled={consolidating}>
        {consolidating ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Consolidating...
          </>
        ) : (
          "Consolidate Tokens"
        )}
      </button>
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success mt-4">
          <span>Tokens consolidated successfully!</span>
        </div>
      )}
    </div>
  );
}

function RelayManagementTool({ wallet }: { wallet: Wallet }) {
  const relays = use$(wallet.relays$);
  const tokens = use$(wallet.tokens$);
  const [newRelay, setNewRelay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Count how many tokens were seen on each relay
  const relayTokenCounts = useMemo(() => {
    if (!relays || !tokens) return new Map<string, number>();

    const counts = new Map<string, number>();
    relays.forEach((relay) => counts.set(relay, 0));

    tokens.forEach((token) => {
      const seenRelays = token.seen;
      if (seenRelays) {
        seenRelays.forEach((relay) => {
          if (counts.has(relay)) {
            counts.set(relay, (counts.get(relay) || 0) + 1);
          }
        });
      }
    });

    return counts;
  }, [relays, tokens]);

  const handleAddRelay = useCallback(async () => {
    if (!newRelay.trim()) {
      setError("Please enter a relay URL");
      return;
    }

    if (!wallet.unlocked) {
      setError("Wallet must be unlocked to manage relays");
      return;
    }

    const currentRelays = relays || [];
    const relayUrl = newRelay.trim();

    // Check if relay already exists
    if (currentRelays.includes(relayUrl)) {
      setError("This relay is already in your list");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await actions.run(SetWalletRelays, [...currentRelays, relayUrl]);
      setNewRelay("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to add relay:", err);
      setError(err instanceof Error ? err.message : "Failed to add relay");
    } finally {
      setSaving(false);
    }
  }, [newRelay, relays, wallet.unlocked]);

  const handleRemoveRelay = useCallback(
    async (relayToRemove: string) => {
      if (!wallet.unlocked) {
        setError("Wallet must be unlocked to manage relays");
        return;
      }

      const currentRelays = relays || [];
      const updatedRelays = currentRelays.filter((r) => r !== relayToRemove);

      setSaving(true);
      setError(null);
      setSuccess(false);

      try {
        await actions.run(SetWalletRelays, updatedRelays);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch (err) {
        console.error("Failed to remove relay:", err);
        setError(err instanceof Error ? err.message : "Failed to remove relay");
      } finally {
        setSaving(false);
      }
    },
    [relays, wallet.unlocked],
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Manage Relays</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Add or remove relays from your wallet. These relays will be used for publishing wallet events.
      </p>

      <div className="space-y-2 mb-4">
        {relays && relays.length > 0 ? (
          relays.map((relay, index) => {
            const tokenCount = relayTokenCounts.get(relay) || 0;
            return (
              <div key={index} className="flex items-center justify-between p-2 bg-base-200 rounded">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm truncate block">{relay}</span>
                  <span className="text-xs text-base-content/70 mt-1 block">
                    {tokenCount} token{tokenCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <button
                  className="btn btn-xs btn-error ml-2"
                  onClick={() => handleRemoveRelay(relay)}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            );
          })
        ) : (
          <div className="text-sm text-base-content/70">No relays configured</div>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          className="input input-bordered flex-1"
          placeholder="wss://relay.example.com"
          value={newRelay}
          onChange={(e) => setNewRelay(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddRelay();
            }
          }}
          disabled={saving}
        />
        <button className="btn btn-primary" onClick={handleAddRelay} disabled={saving || !newRelay.trim()}>
          {saving ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Saving...
            </>
          ) : (
            "Add"
          )}
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span>Relays updated successfully!</span>
        </div>
      )}
    </div>
  );
}

function MintManagementTool({ wallet }: { wallet: Wallet }) {
  const mints = use$(wallet.mints$);
  const balance = use$(wallet.balance$);
  const [newMint, setNewMint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleAddMint = useCallback(async () => {
    if (!newMint.trim()) {
      setError("Please enter a mint URL");
      return;
    }

    if (!wallet.unlocked) {
      setError("Wallet must be unlocked to manage mints");
      return;
    }

    const currentMints = mints || [];
    const mintUrl = newMint.trim();

    // Check if mint already exists
    if (currentMints.includes(mintUrl)) {
      setError("This mint is already in your list");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await actions.run(SetWalletMints, [...currentMints, mintUrl]);
      setNewMint("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to add mint:", err);
      setError(err instanceof Error ? err.message : "Failed to add mint");
    } finally {
      setSaving(false);
    }
  }, [newMint, mints, wallet.unlocked]);

  const handleRemoveMint = useCallback(
    async (mintToRemove: string) => {
      if (!wallet.unlocked) {
        setError("Wallet must be unlocked to manage mints");
        return;
      }

      // Check if mint has a balance
      const mintBalance = balance?.[mintToRemove] || 0;
      if (mintBalance > 0) {
        const confirmed = window.confirm(
          `Warning: This mint has a balance of ${mintBalance} sats. Removing it will not delete your tokens, but you may lose access to manage them. Are you sure you want to remove this mint?`,
        );
        if (!confirmed) {
          return;
        }
      }

      const currentMints = mints || [];
      const updatedMints = currentMints.filter((m) => m !== mintToRemove);

      setSaving(true);
      setError(null);
      setSuccess(false);

      try {
        await actions.run(SetWalletMints, updatedMints);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch (err) {
        console.error("Failed to remove mint:", err);
        setError(err instanceof Error ? err.message : "Failed to remove mint");
      } finally {
        setSaving(false);
      }
    },
    [mints, balance, wallet.unlocked],
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Manage Mints</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Add or remove mints from your wallet. These are the ecash mints you trust and use for your tokens.
      </p>

      <div className="space-y-2 mb-4">
        {mints && mints.length > 0 ? (
          mints.map((mint, index) => {
            const mintBalance = balance?.[mint] || 0;
            return (
              <div key={index} className="flex items-center justify-between p-2 bg-base-200 rounded">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-sm truncate block">{mint}</span>
                  {mintBalance > 0 && (
                    <span className="text-xs text-warning mt-1 block">Balance: {mintBalance} sats</span>
                  )}
                </div>
                <button className="btn btn-xs btn-error ml-2" onClick={() => handleRemoveMint(mint)} disabled={saving}>
                  Remove
                </button>
              </div>
            );
          })
        ) : (
          <div className="text-sm text-base-content/70">No mints configured</div>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          className="input input-bordered flex-1"
          placeholder="https://mint.example.com"
          value={newMint}
          onChange={(e) => setNewMint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddMint();
            }
          }}
          disabled={saving}
        />
        <button className="btn btn-primary" onClick={handleAddMint} disabled={saving || !newMint.trim()}>
          {saving ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Saving...
            </>
          ) : (
            "Add"
          )}
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span>Mints updated successfully!</span>
        </div>
      )}
    </div>
  );
}

function NutzapInfoMintManagementTool() {
  const user = use$(user$);
  const nutzapInfo = use$(user?.nutzap$);
  const mints = nutzapInfo?.mints || [];
  const [newMint, setNewMint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleAddMint = useCallback(async () => {
    if (!newMint.trim()) {
      setError("Please enter a mint URL");
      return;
    }

    const mintUrl = newMint.trim();

    // Check if mint already exists
    if (mints.some((m) => m.mint === mintUrl)) {
      setError("This mint is already in your list");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await actions.run(AddNutzapInfoMint, { url: mintUrl, units: ["sat"] });
      setNewMint("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to add mint:", err);
      setError(err instanceof Error ? err.message : "Failed to add mint");
    } finally {
      setSaving(false);
    }
  }, [newMint, mints]);

  const handleRemoveMint = useCallback(async (mintToRemove: string) => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await actions.run(RemoveNutzapInfoMint, mintToRemove);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to remove mint:", err);
      setError(err instanceof Error ? err.message : "Failed to remove mint");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Manage Nutzap Info Mints</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Add or remove mints from your nutzap info. These mints are used to receive nutzaps from other users.
      </p>

      <div className="space-y-2 mb-4">
        {mints && mints.length > 0 ? (
          mints.map((mint, index) => (
            <div key={index} className="flex items-center justify-between p-2 bg-base-200 rounded">
              <div className="flex-1 min-w-0">
                <span className="font-mono text-sm truncate block">{mint.mint}</span>
              </div>
              <button
                className="btn btn-xs btn-error ml-2"
                onClick={() => handleRemoveMint(mint.mint)}
                disabled={saving}
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <div className="text-sm text-base-content/70">No mints configured</div>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          className="input input-bordered flex-1"
          placeholder="https://mint.example.com"
          value={newMint}
          onChange={(e) => setNewMint(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddMint();
            }
          }}
          disabled={saving}
        />
        <button className="btn btn-primary" onClick={handleAddMint} disabled={saving || !newMint.trim()}>
          {saving ? (
            <>
              <span className="loading loading-spinner loading-sm" />
              Saving...
            </>
          ) : (
            "Add"
          )}
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span>Mints updated successfully!</span>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ wallet }: { wallet: Wallet }) {
  if (!wallet.unlocked) {
    return <div className="text-base-content/70">Unlock your wallet to access settings.</div>;
  }

  return (
    <div className="space-y-6">
      <NutzapInfoMintManagementTool />
      <MintManagementTool wallet={wallet} />
      <RelayManagementTool wallet={wallet} />
      <SyncTokensTool wallet={wallet} />
      <ConsolidateTool wallet={wallet} />
    </div>
  );
}

// Wallet Manager Component (shown when wallet exists)
function WalletManager({ user }: { user: User }) {
  const wallet = use$(user.wallet$);
  const history = use$(user.wallet$.history$);
  const tokens = use$(user.wallet$.tokens$);
  const outboxes = use$(user.outboxes$);
  const inboxes = use$(user.inboxes$);
  const nutzapRelays = use$(user.nutzap$.relays);
  const relays = use$(user.wallet$.relays$);
  const autoUnlock = use$(autoUnlock$);
  const unlocking = useRef(false);

  // Subscribe to token and history events
  use$(() => {
    const all = relaySet(relays, outboxes);
    if (all.length === 0) return undefined;

    return pool.subscription(
      all,
      { kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND], authors: [user.pubkey] },
      { eventStore },
    );
  }, [outboxes?.join(","), relays?.join(","), user.pubkey]);

  // Subscribe to incoming nutzap events
  use$(() => {
    const all = relaySet(nutzapRelays, inboxes);
    if (all.length === 0) return undefined;

    return pool.subscription(all, { kinds: [NUTZAP_KIND], "#p": [user.pubkey] }, { eventStore });
  }, [inboxes?.join(","), nutzapRelays?.join(","), user.pubkey]);

  // Automatically unlock wallet if autoUnlock$ is enabled
  useEffect(() => {
    if (unlocking.current || !autoUnlock) return;

    let needsUnlock = false;

    if (wallet && wallet.unlocked === false) needsUnlock = true;
    if (tokens && tokens.some((token) => token.unlocked === false)) needsUnlock = true;
    if (history && history.some((entry) => entry.unlocked === false)) needsUnlock = true;

    // Start unlocking if needed
    if (needsUnlock) {
      console.log("Unlocking wallet...");
      unlocking.current = true;
      actions
        .run(UnlockWallet, { history: true, tokens: true })
        .catch((err) => {
          console.error("Failed to unlock wallet:", err);
        })
        .finally(() => {
          unlocking.current = false;
        });
    }
  }, [wallet?.unlocked, tokens?.length, history?.length, autoUnlock]);

  if (!wallet) return null;

  return (
    <div className="container mx-auto my-8 px-4 max-w-2xl relative">
      <div className="flex gap-2 items-center">
        <h1 className="text-3xl font-bold mb-6">Wallet Example</h1>
        <label className="label ms-auto">
          <input
            type="checkbox"
            className="toggle"
            checked={autoUnlock}
            onChange={() => autoUnlock$.next(!autoUnlock)}
          />
          Auto unlock
        </label>
      </div>

      <div className="tabs tabs-lift">
        <input type="radio" name="wallet_tabs" className="tab" aria-label="Overview" defaultChecked />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <OverviewTab wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="History" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <HistoryTab history={history} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Tokens" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <TokensTab tokens={tokens} wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Nutzaps" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <NutzapsTab user={user} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Settings" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <SettingsTab wallet={wallet} />
        </div>
      </div>
    </div>
  );
}

function WalletView({ user }: { user: User }) {
  const wallet = use$(user.wallet$);

  const handleCreateWallet = useCallback(async (mints: string[], receiveNutzaps: boolean) => {
    // Create wallet with selected mints
    // Only generate privateKey if user wants to receive nutzaps
    const privateKey = receiveNutzaps ? generateSecretKey() : undefined;

    // TODO: allow user to configure relays
    const defaultRelays = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.snort.social",
      "wss://relay.nostr.band",
      "wss://relay.primal.net",
    ];
    await actions.run(CreateWallet, { mints, privateKey, relays: defaultRelays });
  }, []);

  // Show create wallet view first when no wallet is found
  if (!wallet) {
    return <CreateWalletView onCreate={handleCreateWallet} />;
  }

  // Show wallet manager when wallet exists
  return <WalletManager user={user} />;
}

export default function WalletExample() {
  const storage = use$(storage$);
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  const handleUnlock = useCallback(async (storage: SecureStorage) => {
    storage$.next(storage);

    const signer = new ExtensionSigner();
    const pubkey = await signer.getPublicKey();
    pubkey$.next(pubkey);
    signer$.next(signer);
  }, []);

  const handleLogin = useCallback(
    async (newSigner: ExtensionSigner, newPubkey: string) => {
      signer$.next(newSigner);
      pubkey$.next(newPubkey);
      if (storage) await storage.setItem("pubkey", newPubkey);
    },
    [storage],
  );

  // Show unlock view if storage is not initialized
  if (!storage) return <UnlockView onUnlock={handleUnlock} />;

  // Show login view if not logged in
  if (!signer || !pubkey || !user) return <LoginView onLogin={handleLogin} />;

  // Show main wallet view when both storage and login are ready
  return <WalletView user={user} />;
}
