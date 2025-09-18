import { getDisplayName, getProfilePicture, mergeRelaySets, normalizeToPubkey } from "applesauce-core/helpers";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { NostrEvent } from "nostr-tools";
import { useCallback, useEffect, useMemo, useState } from "react";
import RelayPicker from "./relay-picker";

// Common relay URLs that support NIP-50 search
const SEARCH_RELAYS = mergeRelaySets(["wss://relay.nostr.band", "wss://search.nos.today"]);

interface ProfileSearchResult {
  pubkey: string;
  profile: NostrEvent | null;
  displayName: string;
  picture: string;
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
  const [selectedRelay, setSelectedRelay] = useState(SEARCH_RELAYS[0]);
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [customRelayUrl, setCustomRelayUrl] = useState("");

  const pool = useMemo(() => new RelayPool(), []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !selectedRelay) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      const relay = pool.relay(selectedRelay);

      const subscription = relay.subscription([
        {
          kinds: [0],
          search: searchQuery.trim(),
          limit: 20,
        },
      ]);

      const results: ProfileSearchResult[] = [];
      const seenPubkeys = new Set<string>();

      const sub = subscription.subscribe({
        next: (response) => {
          if (response === "EOSE") {
            setIsSearching(false);
            sub.unsubscribe();
          } else {
            // response is a NostrEvent
            const event = response;
            if (seenPubkeys.has(event.pubkey)) return;
            seenPubkeys.add(event.pubkey);

            try {
              const profile = JSON.parse(event.content);
              const displayName = getDisplayName(profile, event.pubkey.slice(0, 8) + "...");
              const picture = getProfilePicture(profile, `https://robohash.org/${event.pubkey}.png`);

              results.push({
                pubkey: event.pubkey,
                profile: event,
                displayName,
                picture,
              });

              setSearchResults([...results]);
            } catch (error) {
              console.error("Failed to parse profile:", error);
            }
          }
        },
        error: (error) => {
          console.error("Search failed:", error);
          setIsSearching(false);
        },
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        setIsSearching(false);
        sub.unsubscribe();
      }, 10000);
    } catch (error) {
      console.error("Search failed:", error);
      setIsSearching(false);
    }
  }, [searchQuery, selectedRelay, pool]);

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
    onClose();
  };

  return (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box max-w-4xl">
        <h3 className="font-bold text-lg mb-4">Search Profiles</h3>

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
              disabled={!searchQuery.trim() || isSearching}
            >
              {isSearching ? <span className="loading loading-spinner loading-sm"></span> : "Search"}
            </button>
          </div>

          {/* Search relay selection */}
          <RelayPicker value={selectedRelay} onChange={setSelectedRelay} common={SEARCH_RELAYS} />
        </div>

        {/* Search results */}
        <div className="max-h-96 overflow-y-auto">
          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.pubkey}
                  className="flex items-center gap-3 p-3 hover:bg-base-200 rounded-lg cursor-pointer transition-colors"
                  onClick={() => handleSelectProfile(result.pubkey)}
                >
                  <div className="avatar">
                    <div className="w-12 h-12 rounded-full">
                      <img src={result.picture} alt={result.displayName} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{result.displayName}</div>
                    <div className="text-sm text-base-content/60 font-mono">{result.pubkey.slice(0, 16)}...</div>
                  </div>
                </div>
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

  // Automatically validate and set pubkey when input changes
  useEffect(() => {
    if (!inputValue.trim()) {
      setIsValidPubkey(false);
      return;
    }

    try {
      const normalizedPubkey = normalizeToPubkey(inputValue.trim());
      setIsValidPubkey(true);
      onChange(normalizedPubkey);
    } catch (error) {
      setIsValidPubkey(false);
    }
  }, [inputValue, onChange]);

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
