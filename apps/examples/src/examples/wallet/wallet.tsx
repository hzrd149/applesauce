/**
 * Full-featured Cashu wallet with token management, nutzaps, and Lightning integration
 * @tags nip-60, nip-61, wallet, cashu, tokens, nutzaps
 * @related wallet/mint-discovery, nwc/simple-wallet
 */
import {
  getEncodedToken,
  MintQuoteBolt11Response,
  normalizeProofAmounts,
} from "@cashu/cashu-ts";
import { castUser, User } from "applesauce-common/casts";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, mapEventsToTimeline } from "applesauce-core";
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
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { ExtensionSigner } from "applesauce-signers/signers/extension-signer";
import { Nutzap, WalletHistory, WalletToken } from "applesauce-wallet/casts";
import { IndexedDBCouch, NUTZAP_KIND } from "applesauce-wallet/helpers";
import { NutWallet, WalletStatus } from "applesauce-wallet/wallet";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BehaviorSubject, map } from "rxjs";
import LoginView from "../../components/login-view";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";

// Explicitly import the wallet casts so user.wallet$ is available
import "applesauce-wallet/casts";
import { generateSecretKey } from "nostr-tools";
import QRCode from "../../components/qr-code";
import RelayPicker from "../../components/relay-picker";

// Setup application state
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

// Setup IndexedDB couch for storing tokens during nutzap operations
const couch = new IndexedDBCouch();

// Setup event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

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
  const [selectedMints, setSelectedMints] = useState<string[]>([]);

  // Query for kind:38172 events from common relays
  const mintEvents = use$(
    () =>
      pool.subscription([relay], { kinds: [MINT_ANNOUNCEMENT_KIND] }, { eventStore }).pipe(
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

  const handleToggleMint = (url: string) => {
    const next = selectedMints.includes(url) ? selectedMints.filter((m) => m !== url) : [...selectedMints, url];
    setSelectedMints(next);
    onMintsSelected(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Select Mints</h3>
        <div className="alert alert-warning">
          <span>Only select 2 or 3 mints you trust to avoid losing funds.</span>
        </div>
      </div>

      <div className="mb-4">
        <RelayPicker value={relay} onChange={setRelay} />
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {allMints.map((mint) => {
          const isSelected = selectedMints.includes(mint.url);
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

      {selectedMints.length > 0 && (
        <div className="alert alert-success">
          <span>
            {selectedMints.length} mint{selectedMints.length !== 1 ? "s" : ""} selected
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
    await onCreate(selectedMints, receiveNutzaps).finally(() => setCreating(false));
  }, [onCreate, selectedMints, receiveNutzaps]);

  return (
    <div className="container mx-auto my-8 px-4 max-w-2xl">
      <h1 className="text-3xl font-bold mb-6">Create Wallet</h1>
      <div className="bg-base-100 border border-base-300 p-6">
        <h2 className="text-xl font-bold mb-2">No Wallet Found</h2>

        <div className="mb-6">
          <MintDiscovery onMintsSelected={setSelectedMints} />
        </div>

        <div className="mb-6 flex gap-2 items-center justify-between">
          <label className="label cursor-pointer">
            <span className="label-text">Receive Nutzaps</span>
            <input
              type="checkbox"
              className="checkbox checkbox-primary"
              checked={receiveNutzaps}
              onChange={(e) => setReceiveNutzaps(e.target.checked)}
            />
          </label>
          <button className="btn btn-primary " onClick={handleCreate} disabled={creating || selectedMints.length === 0}>
            {creating ? "Creating..." : "Create Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const unlocked = use$(wallet.unlocked$);
  const ops = use$(wallet.operationsState$) ?? {};
  const [autoUnlock, setAutoUnlock] = useState(wallet.autoUnlock);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
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
        <button className="btn btn-primary" onClick={() => wallet.unlock()} disabled={ops.unlock}>
          {ops.unlock ? "Unlocking..." : "Unlock Wallet"}
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

  if (!unlocked || !meta)
    return (
      <div className="py-2 border-b border-base-300">
        <div className="text-base-content/70">Locked</div>
      </div>
    );

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

function TokenEntry({ token }: { token: WalletToken }) {
  const isUnlocked = token.unlocked;
  const meta = use$(token.meta$);
  const amount = use$(token.amount$);
  const [copied, setCopied] = useState(false);

  const encodedToken = useMemo(() => {
    if (!token.mint || !token.proofs) return undefined;
    return getEncodedToken({ mint: token.mint, proofs: normalizeProofAmounts(token.proofs), unit: "sat" });
  }, [token.mint, token.proofs]);

  const handleCopy = useCallback(() => {
    if (!encodedToken) return;
    navigator.clipboard.writeText(encodedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [encodedToken]);

  if (!isUnlocked || !meta) {
    return (
      <div className="py-2 border-b border-base-300">
        <div className="text-base-content/70">Locked</div>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-base-300">
      <div className="flex items-center gap-2">
        <span className="font-medium">{amount} sats</span>
        {meta.mint && <span className="text-sm text-base-content/70 font-mono">{meta.mint}</span>}
        <span className="flex-1"></span>
        {encodedToken && (
          <button className="btn btn-xs" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function NutzapEntry({ nutzap, wallet, isReceived }: { nutzap: Nutzap; wallet: NutWallet; isReceived: boolean }) {
  const unlocked = use$(wallet.unlocked$);
  const amount = nutzap.amount;
  const mint = nutzap.mint;
  const comment = nutzap.comment;
  const zappedEvent = use$(nutzap.zapped$);
  const senderProfile = use$(nutzap.sender.profile$);
  const createdDate = nutzap.createdAt;
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReceive = useCallback(async () => {
    if (!unlocked) {
      setError("Wallet must be unlocked to receive nutzaps");
      return;
    }

    setReceiving(true);
    setError(null);

    try {
      await wallet.receiveNutzaps(nutzap.event);
    } catch (err) {
      console.error("Failed to receive nutzap:", err);
      setError(err instanceof Error ? err.message : "Failed to receive nutzap");
    } finally {
      setReceiving(false);
    }
  }, [wallet, nutzap, unlocked]);

  return (
    <div className="py-3 border-b border-base-300">
      <div className="flex items-start gap-3">
        <div className="avatar">
          <div className="w-8 h-8 rounded-full">
            <img
              src={getProfilePicture(senderProfile, `https://robohash.org/${nutzap.sender.pubkey}.png`)}
              alt={nutzap.sender.npub}
              className="w-full h-full object-cover rounded-full"
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium">
              {getDisplayName(senderProfile, nutzap.sender.pubkey.slice(0, 8) + "...")}
            </span>
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
                disabled={receiving || !unlocked}
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

function NutzapsTab({ user, wallet }: { user: User; wallet: NutWallet }) {
  const walletEvent = use$(wallet.wallet$);
  const unlocked = use$(wallet.unlocked$);
  const received = use$(walletEvent?.received$);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nutzaps = use$(
    () =>
      eventStore.timeline({ kinds: [NUTZAP_KIND], "#p": [user.pubkey] }).pipe(castTimelineStream(Nutzap, eventStore)),
    [user.pubkey],
  );

  const unclaimed = useMemo(() => {
    if (!nutzaps) return [];
    if (!received) return nutzaps;
    return nutzaps.filter((nutzap) => !received.includes(nutzap.id));
  }, [nutzaps, received]);

  const handleReceiveAll = useCallback(async () => {
    if (!unlocked) return setError("Wallet must be unlocked to receive nutzaps");
    if (unclaimed.length === 0) return setError("No new nutzaps to receive");

    setReceiving(true);
    setError(null);

    try {
      const nutzapEvents = unclaimed.map((nutzap) => nutzap.event);
      await wallet.receiveNutzaps(nutzapEvents);
    } catch (err) {
      console.error("Failed to receive nutzaps:", err);
      setError(err instanceof Error ? err.message : "Failed to receive nutzaps");
    } finally {
      setReceiving(false);
    }
  }, [wallet, unlocked, unclaimed]);

  return (
    <>
      {unclaimed.length > 0 && (
        <div className="mb-4">
          <button className="btn btn-primary" onClick={handleReceiveAll} disabled={receiving || !unlocked}>
            {receiving ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Receiving...
              </>
            ) : (
              `Receive All (${unclaimed.length})`
            )}
          </button>
        </div>
      )}
      {error && (
        <div className="alert alert-error mb-4">
          <span>{error}</span>
        </div>
      )}
      {!unclaimed || unclaimed.length === 0 ? (
        <div className="text-base-content/70">No incoming nutzap events found</div>
      ) : (
        <div>
          {unclaimed.map((nutzap) => {
            const receivedSet = received ? new Set(received) : new Set<string>();
            const isReceived = receivedSet.has(nutzap.id);
            return <NutzapEntry key={nutzap.id} nutzap={nutzap} wallet={wallet} isReceived={isReceived} />;
          })}
        </div>
      )}
    </>
  );
}

function SyncTokensTool({ wallet }: { wallet: NutWallet }) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlocked = use$(wallet.unlocked$);
  const ops = use$(wallet.operationsState$) ?? {};

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);

    try {
      if (!unlocked) throw new Error("Wallet must be unlocked to sync tokens");
      await wallet.syncTokens();
    } catch (err) {
      console.error("Failed to sync tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to sync tokens");
    } finally {
      setSyncing(false);
    }
  }, [wallet, unlocked]);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Sync Tokens</h3>
      <button className="btn btn-primary" onClick={handleSync} disabled={syncing || ops.sync}>
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
    </div>
  );
}

function ConsolidateTool({ wallet }: { wallet: NutWallet }) {
  const [consolidating, setConsolidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConsolidate = useCallback(async () => {
    setConsolidating(true);
    setError(null);

    try {
      await wallet.consolidateTokens();
    } catch (err) {
      console.error("Failed to consolidate tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to consolidate tokens");
    } finally {
      setConsolidating(false);
    }
  }, [wallet]);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Consolidate Tokens</h3>
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
    </div>
  );
}

function RecoverFromCouchTool({ wallet }: { wallet: NutWallet }) {
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRecover = useCallback(async () => {
    setRecovering(true);
    setError(null);

    try {
      await wallet.recoverFromCouch();
    } catch (err) {
      console.error("Failed to recover tokens from couch:", err);
      setError(err instanceof Error ? err.message : "Failed to recover tokens from couch");
    } finally {
      setRecovering(false);
    }
  }, [wallet]);

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Recover Tokens from Couch</h3>
      <p className="text-sm text-base-content/70 mb-4">
        Recover tokens that were stored in the couch during operations. This will check for any tokens in the couch,
        verify they are unspent, and add them to your wallet if they are not already present.
      </p>
      <button className="btn btn-primary" onClick={handleRecover} disabled={recovering}>
        {recovering ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Recovering...
          </>
        ) : (
          "Recover Tokens"
        )}
      </button>
      {error && (
        <div className="alert alert-error mt-4">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function RelayManagementTool({ wallet }: { wallet: NutWallet }) {
  const relays = use$(wallet.walletRelays$);
  const tokens = use$(wallet.tokens$);
  const [newRelay, setNewRelay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!newRelay.trim()) return setError("Please enter a relay URL");

    const currentRelays = relays || [];
    const relayUrl = newRelay.trim();

    // Check if relay already exists
    if (currentRelays.includes(relayUrl)) return setError("This relay is already in your list");

    setSaving(true);
    setError(null);

    try {
      await wallet.setRelays([...currentRelays, relayUrl]);
      setNewRelay("");
    } catch (err) {
      console.error("Failed to add relay:", err);
      setError(err instanceof Error ? err.message : "Failed to add relay");
    } finally {
      setSaving(false);
    }
  }, [newRelay, relays, wallet]);

  const handleRemoveRelay = useCallback(
    async (relayToRemove: string) => {
      const currentRelays = relays || [];
      const updatedRelays = currentRelays.filter((r) => r !== relayToRemove);

      setSaving(true);
      setError(null);

      try {
        await wallet.setRelays(updatedRelays);
      } catch (err) {
        console.error("Failed to remove relay:", err);
        setError(err instanceof Error ? err.message : "Failed to remove relay");
      } finally {
        setSaving(false);
      }
    },
    [relays, wallet],
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Wallet Relays</h3>

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
    </div>
  );
}

function MintManagementTool({ wallet }: { wallet: NutWallet }) {
  const mints = use$(wallet.mintUrls$);
  const balance = use$(wallet.balance$);
  const [newMint, setNewMint] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddMint = useCallback(async () => {
    if (!newMint.trim()) return setError("Please enter a mint URL");

    const currentMints = mints || [];
    const mintUrl = newMint.trim();

    // Check if mint already exists
    if (currentMints.includes(mintUrl)) return setError("This mint is already in your list");

    setSaving(true);
    setError(null);

    try {
      await wallet.setMints([...currentMints, mintUrl]);
      setNewMint("");
    } catch (err) {
      console.error("Failed to add mint:", err);
      setError(err instanceof Error ? err.message : "Failed to add mint");
    } finally {
      setSaving(false);
    }
  }, [newMint, mints, wallet]);

  const handleRemoveMint = useCallback(
    async (mintToRemove: string) => {
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

      try {
        await wallet.setMints(updatedMints);
      } catch (err) {
        console.error("Failed to remove mint:", err);
        setError(err instanceof Error ? err.message : "Failed to remove mint");
      } finally {
        setSaving(false);
      }
    },
    [mints, balance, wallet],
  );

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Wallet Mints</h3>

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
    </div>
  );
}

function SettingsTab({ wallet }: { wallet: NutWallet }) {
  const unlocked = use$(wallet.unlocked$);
  if (!unlocked) return <div className="text-base-content/70">Unlock your wallet to access settings.</div>;

  return (
    <div className="space-y-6">
      <MintManagementTool wallet={wallet} />
      <RelayManagementTool wallet={wallet} />
      <SyncTokensTool wallet={wallet} />
      <ConsolidateTool wallet={wallet} />
      <RecoverFromCouchTool wallet={wallet} />
    </div>
  );
}

function SendTab({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const unlocked = use$(wallet.unlocked$);
  const [amount, setAmount] = useState("");
  const [selectedMint, setSelectedMint] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Get available mints from balance (mints that have tokens)
  const availableMints = useMemo(() => {
    if (!balance) return [];
    return Object.keys(balance).filter((mint) => (balance[mint] || 0) > 0);
  }, [balance]);

  const handleSend = useCallback(async () => {
    if (!unlocked) return setError("Wallet must be unlocked to send tokens");
    if (!amount.trim()) return setError("Please enter an amount");

    const sendAmount = parseInt(amount.trim(), 10);
    if (isNaN(sendAmount) || sendAmount <= 0) return setError("Please enter a valid amount");

    // Check if selected mint has sufficient balance
    if (selectedMint && balance) {
      const mintBalance = balance[selectedMint] || 0;
      if (mintBalance < sendAmount) {
        return setError(`Insufficient balance. Available: ${mintBalance} sats`);
      }
    }

    setSending(true);
    setError(null);
    setCreatedToken(null);

    try {
      setCreatedToken(await wallet.sendToken(sendAmount, { mint: selectedMint }));

      // Clear amount after successful send
      setAmount("");
    } catch (err) {
      console.error("Failed to send tokens:", err);
      setError(err instanceof Error ? err.message : "Failed to send tokens");
      setCreatedToken(null);
    } finally {
      setSending(false);
    }
  }, [wallet, unlocked, amount, selectedMint, balance]);

  const handleCopy = useCallback(() => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [createdToken]);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
        <p className="text-base-content/70">Unlock your wallet to send tokens</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Send Cashu Token</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Enter an amount to send and optionally select a mint. A cashu token will be created that you can share with
          the recipient.
        </p>
      </div>

      {createdToken ? (
        <div className="space-y-4">
          <div className="alert alert-success">
            <span>Token created successfully!</span>
          </div>

          <div>
            <label className="label">
              <span className="label-text">Created Token</span>
            </label>
            <textarea
              className="textarea textarea-bordered h-32 font-mono text-sm w-full"
              value={createdToken}
              readOnly
            />
          </div>

          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy Token"}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setCreatedToken(null);
                setAmount("");
              }}
            >
              Create Another
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-col">
            <label className="label">
              <span className="label-text">Amount (sats)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="Enter amount in sats"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              disabled={sending}
              min="1"
            />
            {selectedMint && balance && (
              <div className="text-sm text-base-content/70">Available: {balance[selectedMint] || 0} sats</div>
            )}
          </div>

          {availableMints.length > 0 && (
            <div className="flex gap-2 flex-col">
              <label className="label">
                <span className="label-text">Mint (optional)</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={selectedMint || ""}
                onChange={(e) => {
                  setSelectedMint(e.target.value || undefined);
                  setError(null);
                }}
                disabled={sending}
              >
                <option value="">Auto-select (any mint with sufficient balance)</option>
                {availableMints.map((mint) => (
                  <option key={mint} value={mint}>
                    {mint} ({balance?.[mint] || 0} sats)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="btn btn-primary w-full"
            onClick={handleSend}
            disabled={sending || !amount.trim() || !unlocked}
          >
            {sending ? (
              <>
                <span className="loading loading-spinner loading-sm" />
                Creating Token...
              </>
            ) : (
              "Create Token"
            )}
          </button>

          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReceiveTab({ wallet }: { wallet: NutWallet }) {
  const unlocked = use$(wallet.unlocked$);
  const [tokenString, setTokenString] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReceive = useCallback(async () => {
    if (!unlocked) return setError("Wallet must be unlocked to receive tokens");
    if (!tokenString.trim()) return setError("Please paste a cashu token");

    setReceiving(true);
    setError(null);

    try {
      await wallet.receiveToken(tokenString.trim());

      setTokenString("");
    } catch (err) {
      console.error("Failed to receive token:", err);
      setError(err instanceof Error ? err.message : "Failed to receive token");
    } finally {
      setReceiving(false);
    }
  }, [wallet, unlocked, tokenString]);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
        <p className="text-base-content/70">Unlock your wallet to receive tokens</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Receive Cashu Token</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Paste a cashu token below to receive it into your wallet. The token will be swapped at the mint before being
          added to your wallet.
        </p>
      </div>

      <div className="flex gap-2 flex-col">
        <label className="label">
          <span className="label-text">Cashu Token</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-32 font-mono text-sm w-full"
          placeholder="Paste cashu token here (e.g., cashuAeyJ...)"
          value={tokenString}
          onChange={(e) => {
            setTokenString(e.target.value);
            setError(null);
          }}
          disabled={receiving}
        />
      </div>

      <button
        className="btn btn-primary w-full"
        onClick={handleReceive}
        disabled={receiving || !tokenString.trim() || !unlocked}
      >
        {receiving ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Receiving...
          </>
        ) : (
          "Receive Token"
        )}
      </button>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function DepositTab({ wallet }: { wallet: NutWallet }) {
  const mints = use$(wallet.mintUrls$) ?? [];
  const unlocked = use$(wallet.unlocked$);
  const [amount, setAmount] = useState("");
  const [selectedMint, setSelectedMint] = useState<string>("");
  const [quote, setQuote] = useState<MintQuoteBolt11Response | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "redeeming">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Default to the first configured mint
  useEffect(() => {
    if (!selectedMint && mints.length > 0) setSelectedMint(mints[0]);
  }, [mints, selectedMint]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setQuote(null);
    setStatus("idle");
    setError(null);
  }, []);

  const handleDeposit = useCallback(async () => {
    if (!unlocked) return setError("Wallet must be unlocked to deposit");
    const mint = selectedMint || mints[0];
    if (!mint) return setError("Add a mint to your wallet first");

    const sats = parseInt(amount.trim(), 10);
    if (isNaN(sats) || sats <= 0) return setError("Please enter a valid amount");

    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await wallet.deposit({
        method: "bolt11",
        mint,
        amount: sats,
        onQuote: (quote) => {
          setQuote(quote);
          setStatus("waiting");
        },
        signal: ac.signal,
      });
      setQuote(null);
      setStatus("idle");
      setAmount("");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      console.error("Failed to deposit:", err);
      setError(err instanceof Error ? err.message : "Failed to deposit");
      setStatus("idle");
    }
  }, [wallet, unlocked, amount, selectedMint, mints]);

  const handleCopy = useCallback(() => {
    if (!quote) return;
    navigator.clipboard.writeText(quote.request);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [quote]);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
        <p className="text-base-content/70">Unlock your wallet to deposit</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Deposit with Lightning</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Mint new ecash by paying a lightning invoice. Enter an amount, pay the generated invoice, and the proofs are
          added to your wallet automatically.
        </p>
      </div>

      {quote ? (
        <div className="space-y-4">
          <div className="flex justify-center">
            <QRCode value={quote.request} size={220} className="rounded" alt="Lightning invoice QR code" />
          </div>

          <textarea
            className="textarea textarea-bordered h-24 font-mono text-xs w-full"
            value={quote.request}
            readOnly
          />

          <div className="flex items-center gap-2 text-sm text-base-content/70">
            <span className="loading loading-spinner loading-sm" />
            {status === "redeeming" ? "Payment received, minting tokens..." : "Waiting for payment..."}
          </div>

          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy Invoice"}
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-col">
            <label className="label">
              <span className="label-text">Amount (sats)</span>
            </label>
            <input
              type="number"
              className="input input-bordered w-full"
              placeholder="Enter amount in sats"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              min="1"
            />
          </div>

          {mints.length > 0 && (
            <div className="flex gap-2 flex-col">
              <label className="label">
                <span className="label-text">Mint</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={selectedMint}
                onChange={(e) => setSelectedMint(e.target.value)}
              >
                {mints.map((mint) => (
                  <option key={mint} value={mint}>
                    {mint}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            className="btn btn-primary w-full"
            onClick={handleDeposit}
            disabled={!amount.trim() || !unlocked}
          >
            Create Invoice
          </button>

          {error && (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WithdrawTab({ wallet }: { wallet: NutWallet }) {
  const balance = use$(wallet.balance$);
  const unlocked = use$(wallet.unlocked$);
  const [invoice, setInvoice] = useState("");
  const [selectedMint, setSelectedMint] = useState<string>("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Mints that currently hold a balance to pay from
  const availableMints = useMemo(() => {
    if (!balance) return [];
    return Object.keys(balance).filter((mint) => (balance[mint] || 0) > 0);
  }, [balance]);

  useEffect(() => {
    if (!selectedMint && availableMints.length > 0) setSelectedMint(availableMints[0]);
  }, [availableMints, selectedMint]);

  const handlePay = useCallback(async () => {
    if (!unlocked) return setError("Wallet must be unlocked to withdraw");
    const mint = selectedMint || availableMints[0];
    if (!mint) return setError("No mint with a balance to pay from");
    if (!invoice.trim()) return setError("Please paste a lightning invoice");

    setPaying(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await wallet.payInvoice(mint, invoice.trim());
      const change = response.change.reduce((sum, proof) => sum + proof.amount.toNumber(), 0);
      setSuccess(change > 0 ? `Invoice paid, ${change} sats change returned` : "Invoice paid");
      setInvoice("");
    } catch (err) {
      console.error("Failed to pay invoice:", err);
      setError(err instanceof Error ? err.message : "Failed to pay invoice");
    } finally {
      setPaying(false);
    }
  }, [wallet, unlocked, invoice, selectedMint, availableMints]);

  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        <h2 className="text-2xl font-bold">Wallet Locked</h2>
        <p className="text-base-content/70">Unlock your wallet to withdraw</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">Withdraw with Lightning</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Pay a lightning invoice from a mint's balance (melts ecash to lightning). The mint pays the invoice and any
          change is returned to your wallet.
        </p>
      </div>

      <div className="flex gap-2 flex-col">
        <label className="label">
          <span className="label-text">Lightning Invoice</span>
        </label>
        <textarea
          className="textarea textarea-bordered h-24 font-mono text-xs w-full"
          placeholder="Paste a bolt11 invoice here (e.g., lnbc...)"
          value={invoice}
          onChange={(e) => {
            setInvoice(e.target.value);
            setError(null);
          }}
          disabled={paying}
        />
      </div>

      {availableMints.length > 0 && (
        <div className="flex gap-2 flex-col">
          <label className="label">
            <span className="label-text">Pay from mint</span>
          </label>
          <select
            className="select select-bordered w-full"
            value={selectedMint}
            onChange={(e) => setSelectedMint(e.target.value)}
            disabled={paying}
          >
            {availableMints.map((mint) => (
              <option key={mint} value={mint}>
                {mint} ({balance?.[mint] || 0} sats)
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        className="btn btn-primary w-full"
        onClick={handlePay}
        disabled={paying || !invoice.trim() || !unlocked}
      >
        {paying ? (
          <>
            <span className="loading loading-spinner loading-sm" />
            Paying...
          </>
        ) : (
          "Pay Invoice"
        )}
      </button>

      {success && (
        <div className="alert alert-success">
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// Wallet Manager Component (shown when wallet exists)
function WalletManager({ user, wallet }: { user: User; wallet: NutWallet }) {
  const walletEvent = use$(wallet.wallet$);
  const history = use$(wallet.history$);
  const tokens = use$(wallet.tokens$);
  const inboxes = use$(user.inboxes$);
  const nutzapInfo = use$(user.nutzap$);
  const nutzapRelays = nutzapInfo?.relays;
  const nutzapMints = nutzapInfo?.mints.map(({ mint }) => mint);
  const [autoUnlock, setAutoUnlock] = useState(wallet.autoUnlock);

  // Subscribe to incoming nutzap events
  use$(() => {
    const all = relaySet(nutzapRelays, inboxes);
    if (all.length === 0) return undefined;

    if (!nutzapMints || nutzapMints.length === 0) return undefined;

    return pool.subscription(all, { kinds: [NUTZAP_KIND], "#p": [user.pubkey], "#u": nutzapMints }, { eventStore });
  }, [inboxes?.join(","), nutzapMints?.join(","), nutzapRelays?.join(","), user.pubkey]);

  if (!walletEvent) return null;

  return (
    <div className="container mx-auto my-8 px-4 max-w-2xl relative">
      <div className="flex gap-2 items-center">
        <h1 className="text-3xl font-bold mb-6">Wallet Example</h1>
        <label className="label ms-auto">
          <input
            type="checkbox"
            className="toggle"
            checked={autoUnlock}
            onChange={(e) => {
              wallet.setAutoUnlock(e.target.checked);
              setAutoUnlock(e.target.checked);
            }}
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
          {history?.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} />
          ))}
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Tokens" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          {tokens?.map((token) => (
            <TokenEntry key={token.id} token={token} />
          ))}
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Nutzaps" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <NutzapsTab user={user} wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Send" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <SendTab wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Receive" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <ReceiveTab wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Deposit" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <DepositTab wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Withdraw" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <WithdrawTab wallet={wallet} />
        </div>

        <input type="radio" name="wallet_tabs" className="tab" aria-label="Settings" />
        <div className="tab-content bg-base-100 border-base-300 p-6">
          <SettingsTab wallet={wallet} />
        </div>
      </div>
    </div>
  );
}

function WalletView({ user, wallet }: { user: User; wallet: NutWallet }) {
  const status = use$(wallet.status$) ?? WalletStatus.Idle;

  const handleCreateWallet = useCallback(async (mints: string[], receiveNutzaps: boolean) => {
    // Create wallet with selected mints
    // Only generate privateKey if user wants to receive nutzaps
    const privateKey = receiveNutzaps ? generateSecretKey() : undefined;

    // TODO: allow user to configure relays
    const defaultRelays = [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.snort.social",
      "wss://relay.primal.net",
    ];
    await wallet.createWallet({ mints, privateKey, relays: defaultRelays });
  }, [wallet]);

  // Show create wallet view first when no wallet is found
  if (status === WalletStatus.Missing) {
    return <CreateWalletView onCreate={handleCreateWallet} />;
  }

  // Show wallet manager when wallet exists
  return <WalletManager user={user} wallet={wallet} />;
}

export default function WalletExample() {
  const storage = use$(storage$);
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);
  const user = use$(user$);
  const [wallet, setWallet] = useState<NutWallet | null>(null);

  useEffect(() => {
    if (!signer || !pubkey) {
      setWallet(null);
      return;
    }

    const instance = new NutWallet({ pubkey, signer, pool, eventStore, couch, autoUnlock: false });
    instance.start();
    setWallet(instance);
    return () => instance.stop();
  }, [signer, pubkey]);

  const handleUnlock = useCallback(async (storage: SecureStorage) => {
    storage$.next(storage);

    const signer = new ExtensionSigner();
    const pubkey = await signer.getPublicKey();
    pubkey$.next(pubkey);
    signer$.next(signer);
  }, []);

  const handleLogin = useCallback(
    async (newSigner: ISigner, newPubkey: string) => {
      signer$.next(newSigner);
      pubkey$.next(newPubkey);
      if (storage) await storage.setItem("pubkey", newPubkey);
    },
    [storage],
  );

  // Show unlock view if storage is not initialized
  if (!storage) return <UnlockView onUnlock={handleUnlock} />;

  // Show login view if not logged in
  if (!signer || !pubkey || !user || !wallet) return <LoginView onLogin={handleLogin} />;

  // Show main wallet view when both storage and login are ready
  return <WalletView user={user} wallet={wallet} />;
}
