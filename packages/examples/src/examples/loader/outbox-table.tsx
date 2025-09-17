import { defined, EventStore } from "applesauce-core";
import {
  Filter,
  getDisplayName,
  getProfilePicture,
  normalizeToPubkey,
  persistEventsToCache,
} from "applesauce-core/helpers";
import { createAddressLoader } from "applesauce-loaders/loaders";
import {
  groupPubkeysByRelay,
  includeLegacyWriteRelays,
  includeOutboxes,
  selectOutboxes,
} from "applesauce-loaders/operators";
import { useObservableMemo } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useCallback, useEffect, useState } from "react";
import { BehaviorSubject, shareReplay, switchMap } from "rxjs";

// Extend Window interface to include nostr property
declare global {
  interface Window {
    nostr?: any;
  }
}

const pubkey$ = new BehaviorSubject<string | null>(null);

const pool = new RelayPool();
const eventStore = new EventStore();

// Setup a local event cache
const cache = await openDB();
function cacheRequest(filters: Filter[]) {
  return getEventsForFilters(cache, filters).then((events) => {
    console.log("loaded events from cache", events.length);
    return events;
  });
}

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Create some loaders using the cache method and the event store
const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

const contacts$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.contacts(pubkey)),
);

const outboxes$ = contacts$.pipe(
  defined(),
  // Load the NIP-65 outboxes for all contacts
  includeOutboxes(addressLoader),
  // Load the legacy write relays for contacts missing the NIP-65 outboxes
  includeLegacyWriteRelays(addressLoader),
  // Only calculate it once
  shareReplay(1),
);

// User Avatar Component
function UserAvatar({ pubkey }: { pubkey: string }) {
  const profile = useObservableMemo(() => eventStore.profile(pubkey), [pubkey]);

  const displayName = getDisplayName(profile, pubkey.slice(0, 8) + "...");
  const avatarUrl = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div className="flex flex-col items-center gap-1 p-2 hover:bg-base-200 rounded-lg transition-colors">
      <div className="avatar">
        <div className="w-10 h-10 rounded-full">
          <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
        </div>
      </div>
      <div className="text-xs text-center max-w-16 truncate">{displayName}</div>
    </div>
  );
}

// Relay Row Component
function RelayRow({ relay, pubkeys }: { relay: string; pubkeys: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const info = useObservableMemo(() => pool.relay(relay).information$, [relay]);

  const relayDisplayName = info?.name || relay.replace("wss://", "").replace("ws://", "");
  const icon =
    info?.icon || new URL("/favicon.ico", relay.replace("wss://", "https://").replace("ws://", "https://")).toString();

  return (
    <tr>
      <td colSpan={3} className="p-0">
        <div className="w-full">
          {/* Relay header row */}
          <div
            className="flex items-center justify-between p-4 hover:bg-base-100 cursor-pointer transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-3">
              <div className="text-lg">{expanded ? "▼" : "▶"}</div>
              <div className="avatar">
                <div className="w-10 h-10 rounded-full">
                  <img src={icon} className="w-full h-full object-cover" />
                </div>
              </div>
              <div>
                <div className="font-medium">{relayDisplayName}</div>
                <div className="text-sm text-base-content/60">{relay}</div>
              </div>
            </div>
            <div className="badge badge-primary">{pubkeys.length} users</div>
          </div>

          {/* Expanded user avatars */}
          {expanded && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
                {pubkeys.map((pubkey) => (
                  <UserAvatar key={pubkey} pubkey={pubkey} />
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// Settings Panel Component
function SettingsPanel({
  pubkey,
  setPubkey,
  maxPerPubkey,
  setMaxPerPubkey,
  minPerRelay,
  setMinPerRelay,
}: {
  pubkey: string;
  setPubkey: (value: string) => void;
  maxPerPubkey: number;
  setMaxPerPubkey: (value: number) => void;
  minPerRelay: number;
  setMinPerRelay: (value: number) => void;
}) {
  const [inputValue, setInputValue] = useState(pubkey);
  const [isValidPubkey, setIsValidPubkey] = useState(false);

  // Automatically validate and set pubkey when input changes
  useEffect(() => {
    if (!inputValue.trim()) {
      setIsValidPubkey(false);
      return;
    }

    try {
      const normalizedPubkey = normalizeToPubkey(inputValue.trim());
      setIsValidPubkey(true);
      setPubkey(normalizedPubkey);
      pubkey$.next(normalizedPubkey);
    } catch (error) {
      setIsValidPubkey(false);
      pubkey$.next(null);
    }
  }, [inputValue, setPubkey]);

  // Get pubkey from extension
  const handleGetFromExtension = useCallback(async () => {
    try {
      if (typeof window !== "undefined" && window.nostr) {
        const signer = new ExtensionSigner();
        const extensionPubkey = await signer.getPublicKey();
        setInputValue(extensionPubkey);
      } else {
        alert("Nostr extension not found. Please install a browser extension like nos2x or Alby.");
      }
    } catch (error) {
      console.error("Failed to get pubkey from extension:", error);
      alert("Failed to get pubkey from extension. Please check your extension settings.");
    }
  }, []);

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-col max-w-lg w-full">
        <label className="label pb-1">
          <span className="label-text">Pubkey (hex, npub, or nprofile)</span>
        </label>
        <div className="join">
          <input
            type="text"
            placeholder="Enter pubkey or nostr identifier..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className={`input input-bordered join-item flex-1 ${
              inputValue.trim() && !isValidPubkey ? "input-error" : isValidPubkey ? "input-success" : ""
            }`}
          />
          {typeof window !== "undefined" && window.nostr && (
            <button onClick={handleGetFromExtension} className="btn btn-outline join-item">
              Extension
            </button>
          )}
        </div>
        {inputValue.trim() && !isValidPubkey && (
          <label className="label pt-1">
            <span className="label-text-alt text-error">Invalid pubkey format</span>
          </label>
        )}
      </div>

      <div className="flex flex-col max-w-lg w-full">
        <label className="label pb-1">
          <span className="label-text">Max relays per user: {maxPerPubkey}</span>
        </label>
        <input
          type="range"
          min="1"
          max="10"
          value={maxPerPubkey}
          onChange={(e) => setMaxPerPubkey(Number(e.target.value))}
          className="range range-primary range-sm w-full"
        />
      </div>

      <div className="flex flex-col max-w-lg w-full">
        <label className="label pb-1">
          <span className="label-text">Min relays per user: {minPerRelay}</span>
        </label>
        <input
          type="range"
          min="0"
          max="10"
          value={minPerRelay}
          onChange={(e) => setMinPerRelay(Number(e.target.value))}
          className="range range-primary range-sm w-full"
        />
      </div>
    </div>
  );
}

// Main Component
export default function OutboxTable() {
  const [pubkey, setPubkey] = useState<string>("");
  const [maxPerPubkey, setMaxPerPubkey] = useState(5);
  const [minPerRelay, setMinPerRelay] = useState(0);

  // Get processed contacts data
  const contacts = useObservableMemo(() => outboxes$, []);

  // Get grouped outbox data
  const outboxMap = useObservableMemo(
    () => outboxes$.pipe(selectOutboxes({ maxPerPubkey, minPerRelay }), groupPubkeysByRelay()),
    [maxPerPubkey, minPerRelay],
  );

  // Find users without relays
  const usersWithoutRelays = contacts
    ? contacts.filter((contact) => !contact.relays || contact.relays.length === 0)
    : [];

  // Sort relays by popularity (number of users) in descending order
  const sortedRelays = outboxMap
    ? Object.entries(outboxMap).sort(([, pubkeysA], [, pubkeysB]) => pubkeysB.length - pubkeysA.length)
    : [];

  return (
    <div className="min-h-screen bg-base-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Outbox Relay Table</h1>
        <p className="text-base-content/60 text-lg">Relays sorted by popularity with expandable user lists</p>
      </div>

      {/* Settings */}
      <SettingsPanel
        pubkey={pubkey}
        setPubkey={setPubkey}
        maxPerPubkey={maxPerPubkey}
        setMaxPerPubkey={setMaxPerPubkey}
        minPerRelay={minPerRelay}
        setMinPerRelay={setMinPerRelay}
      />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th colSpan={3} className="text-left text-lg">
                Relays ({sortedRelays.length})
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRelays.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center py-12 text-base-content/60">
                  {pubkey ? "Loading..." : "Enter a pubkey to view relay data"}
                </td>
              </tr>
            ) : (
              sortedRelays.map(([relay, pubkeys]) => <RelayRow key={relay} relay={relay} pubkeys={pubkeys} />)
            )}
          </tbody>
        </table>

        {/* Users without relays section */}
        {usersWithoutRelays.length > 0 && (
          <>
            <h3 className="text-left text-lg pt-8">Users without relays ({usersWithoutRelays.length})</h3>
            <p className="text-left text-sm text-gray-500">
              These users have not published their list of outboxes relays they write to.
            </p>
            <div className="flex flex-wrap gap-2 max-h-96 overflow-y-auto">
              {usersWithoutRelays.map((contact) => (
                <UserAvatar key={contact.pubkey} pubkey={contact.pubkey} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
