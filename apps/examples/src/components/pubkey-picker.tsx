import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  mergeRelaySets,
  normalizeToPubkey,
  ProfileContent,
} from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { PrimalCache, Vertex } from "applesauce-extra";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lastValueFrom } from "rxjs";
import RelayPicker from "./relay-picker";

// Common relay URLs that support NIP-50 search
const SEARCH_RELAYS = mergeRelaySets(["wss://relay.nostr.band", "wss://search.nos.today"]);

// Create an event store for all events
const eventStore = new EventStore();

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  // Fallback to lookup relays if profiles cant be found
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

type SearchMethod = "primal" | "vertex" | "nip50";

interface ProfileSearchResult {
  pubkey: string;
  relays?: string[];
}

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

function ProfileSearchModal({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pubkey: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMethod, setSearchMethod] = useState<SearchMethod>("primal");
  const [selectedRelay, setSelectedRelay] = useState(SEARCH_RELAYS[0]);
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [customRelayUrl, setCustomRelayUrl] = useState("");
  const [extensionAvailable, setExtensionAvailable] = useState(false);

  // Check if extension is available
  useEffect(() => {
    setExtensionAvailable(typeof window !== "undefined" && !!window.nostr);
  }, []);

  // Create PrimalCache instance
  const primal = useMemo(() => {
    return new PrimalCache();
  }, []);

  // Create Vertex instance when extension is available
  const vertex = useMemo(() => {
    if (extensionAvailable) {
      try {
        const signer = new ExtensionSigner();
        return new Vertex(signer);
      } catch (error) {
        console.error("Failed to create Vertex instance:", error);
        return null;
      }
    }
    return null;
  }, [extensionAvailable]);

  // Cleanup PrimalCache and Vertex connections on unmount
  useEffect(() => {
    return () => {
      primal.close();
      if (vertex) {
        vertex.close();
      }
    };
  }, [primal, vertex]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    // Validate search method requirements
    if (searchMethod === "vertex" && !extensionAvailable) {
      setSearchError(
        "Nostr extension required for Vertex search. Please install a browser extension like nos2x or Alby.",
      );
      return;
    }

    if (searchMethod === "nip50" && !selectedRelay) {
      setSearchError("Please select a relay for NIP-50 search.");
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setSearchError(null);

    try {
      if (searchMethod === "primal") {
        // Primal search
        const events = await primal.userSearch(searchQuery.trim(), 20);
        // Add events to store
        for (const event of events) {
          eventStore.add(event);
        }
        // Convert to search results
        const seenPubkeys = new Set<string>();
        const results: ProfileSearchResult[] = [];
        for (const event of events) {
          if (seenPubkeys.has(event.pubkey)) continue;
          seenPubkeys.add(event.pubkey);
          results.push({ pubkey: event.pubkey });
        }
        setSearchResults(results);
      } else if (searchMethod === "vertex") {
        // Vertex search
        if (!vertex) {
          throw new Error("Vertex instance not available. Extension may be missing.");
        }
        const pointers = await vertex.userSearch(searchQuery.trim(), "globalPagerank", 20);
        // Convert pointers to search results
        const seenPubkeys = new Set<string>();
        const results: ProfileSearchResult[] = [];
        for (const pointer of pointers) {
          if (seenPubkeys.has(pointer.pubkey)) continue;
          seenPubkeys.add(pointer.pubkey);
          results.push({ pubkey: pointer.pubkey, relays: pointer.relays });
        }
        setSearchResults(results);
      } else {
        // NIP-50 relay search
        const relay = pool.relay(selectedRelay);

        const events = await lastValueFrom(
          relay
            .request(
              {
                kinds: [0],
                search: searchQuery.trim(),
                limit: 20,
              },
              { id: `search-${Date.now()}` },
            )
            .pipe(mapEventsToStore(eventStore), mapEventsToTimeline()),
        );

        // Convert to search results
        const seenPubkeys = new Set<string>();
        const results: ProfileSearchResult[] = [];
        for (const event of events) {
          if (seenPubkeys.has(event.pubkey)) continue;
          seenPubkeys.add(event.pubkey);
          results.push({ pubkey: event.pubkey });
        }
        setSearchResults(results);
      }

      setIsSearching(false);
    } catch (error) {
      console.error("Search failed:");
      console.log(error);
      const errorMessage = error instanceof Error ? error.message : "Search failed. Please try again.";
      setSearchError(errorMessage);
      setIsSearching(false);
    }
  }, [searchQuery, searchMethod, selectedRelay, primal, vertex, extensionAvailable]);

  const handleCustomRelaySubmit = () => {
    if (customRelayUrl) {
      setSelectedRelay(customRelayUrl);
      setCustomRelayUrl("");
    }
  };

  const handleSelectProfile = (pubkey: string) => {
    onSelect(pubkey);
    onClose();
  };

  const handleClose = () => {
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
    setSearchError(null);
    onClose();
  };

  return (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box max-w-4xl">
        <h3 className="font-bold text-lg mb-4">Search Profiles</h3>

        {/* Search method selector */}
        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Search Method</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              className={`btn btn-sm ${searchMethod === "primal" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setSearchMethod("primal")}
            >
              Primal
            </button>
            <button
              className={`btn btn-sm ${searchMethod === "vertex" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setSearchMethod("vertex")}
              disabled={!extensionAvailable}
              title={!extensionAvailable ? "Nostr extension required" : ""}
            >
              Vertex
            </button>
            <button
              className={`btn btn-sm ${searchMethod === "nip50" ? "btn-primary" : "btn-outline"}`}
              onClick={() => setSearchMethod("nip50")}
            >
              NIP-50 Relay
            </button>
          </div>
          {searchMethod === "vertex" && !extensionAvailable && (
            <label className="label">
              <span className="label-text-alt text-warning">
                Nostr extension required for Vertex search. Install a browser extension like nos2x or Alby.
              </span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Search input */}
          <div className="join flex-1">
            <input
              type="search"
              placeholder="Search for profiles..."
              className="input input-bordered join-item flex-1"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              className="btn btn-primary join-item"
              onClick={handleSearch}
              disabled={!searchQuery.trim() || isSearching || (searchMethod === "vertex" && !extensionAvailable)}
            >
              {isSearching ? <span className="loading loading-spinner loading-sm"></span> : "Search"}
            </button>
          </div>

          {/* Search relay selection - only show for NIP-50 */}
          {searchMethod === "nip50" && (
            <RelayPicker value={selectedRelay} onChange={setSelectedRelay} common={SEARCH_RELAYS} />
          )}
        </div>

        {/* Search error display */}
        {searchError && (
          <div className="alert alert-error mt-4">
            <span>{searchError}</span>
          </div>
        )}

        {/* Search results */}
        <div className="max-h-96 overflow-y-auto">
          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((result) => (
                <ProfileSearchResultItem
                  key={result.pubkey}
                  pubkey={result.pubkey}
                  relays={result.relays}
                  onSelect={handleSelectProfile}
                />
              ))}
            </div>
          )}

          {isSearching && (
            <div className="text-center py-8">
              <span className="loading loading-spinner loading-lg"></span>
              <div className="mt-2 text-base-content/60">Searching profiles...</div>
            </div>
          )}

          {!isSearching && searchResults.length === 0 && searchQuery && (
            <div className="text-center py-8 text-base-content/60">No profiles found for "{searchQuery}"</div>
          )}
        </div>

        {/* Custom relay modal */}
        <dialog id="custom-relay-modal" className="modal">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Custom Search Relay</h3>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Relay URL (must support NIP-50)</span>
              </label>
              <div className="join w-full mb-4">
                <input
                  type="text"
                  placeholder="wss://your-search-relay.com"
                  className="input input-bordered join-item flex-1"
                  value={customRelayUrl}
                  onChange={(e) => setCustomRelayUrl(e.target.value)}
                />
                <button
                  className="btn btn-primary join-item"
                  onClick={() => {
                    handleCustomRelaySubmit();
                    const modal = document.getElementById("custom-relay-modal") as HTMLDialogElement;
                    modal?.close();
                  }}
                  disabled={!customRelayUrl}
                >
                  Set
                </button>
              </div>
            </div>
            <div className="modal-action">
              <button
                className="btn"
                onClick={() => {
                  const modal = document.getElementById("custom-relay-modal") as HTMLDialogElement;
                  modal?.close();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button onClick={handleClose}>close</button>
      </form>
    </dialog>
  );
}

function ProfileSearchResultItem({
  pubkey,
  relays,
  onSelect,
}: {
  pubkey: string;
  relays?: string[];
  onSelect: (pubkey: string) => void;
}) {
  const profile = useProfile({ pubkey, relays });

  const displayName = getDisplayName(profile, pubkey.slice(0, 8) + "...");
  const picture = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div
      className="flex items-center gap-3 p-3 hover:bg-base-200 rounded-lg cursor-pointer transition-colors"
      onClick={() => onSelect(pubkey)}
    >
      <div className="avatar">
        <div className="w-12 h-12 rounded-full">
          <img src={picture} alt={displayName} />
        </div>
      </div>
      <div className="flex-1">
        <div className="font-medium">{displayName}</div>
        <div className="text-sm text-base-content/60 font-mono">{pubkey.slice(0, 16)}...</div>
      </div>
    </div>
  );
}

export default function PubkeyPicker({
  value,
  onChange,
  className,
  placeholder = "Enter pubkey or nostr identifier...",
}: {
  value: string;
  onChange: (pubkey: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [isValidPubkey, setIsValidPubkey] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // Automatically validate and set pubkey when input changes
  useEffect(() => {
    if (!inputValue.trim()) return setIsValidPubkey(false);

    const normalizedPubkey = normalizeToPubkey(inputValue.trim());

    if (normalizedPubkey) {
      setIsValidPubkey(true);
      changeRef.current(normalizedPubkey);
    } else {
      setIsValidPubkey(false);
    }
  }, [inputValue]);

  // Update input value when external value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

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

  const handleSearchSelect = (pubkey: string) => {
    setInputValue(pubkey);
    setIsSearchModalOpen(false);
  };

  return (
    <div className={`flex flex-col w-full ${className}`}>
      <div className="join">
        <input
          type="text"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className={`input input-bordered join-item flex-1 ${
            inputValue.trim() && !isValidPubkey ? "input-error" : isValidPubkey ? "input-success" : ""
          }`}
        />
        <button className="btn join-item" onClick={() => setIsSearchModalOpen(true)} title="Search profiles">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
        {typeof window !== "undefined" && window.nostr && (
          <button onClick={handleGetFromExtension} className="btn join-item">
            Extension
          </button>
        )}
      </div>
      {inputValue.trim() && !isValidPubkey && (
        <label className="label pt-1">
          <span className="label-text-alt text-error">Invalid pubkey format</span>
        </label>
      )}

      <ProfileSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}
