/**
 * Search for profiles using an Open Ranking (ORE) provider, ranked by its web of trust.
 * Signing in issues a Nostr Web Token (kind 27519) to authenticate point-of-view requests.
 * @tags search, open-ranking, web-of-trust, nostr-web-token
 * @related search/vertex, search/primal
 */
import { EventStore } from "applesauce-core";
import { getDisplayName, getProfilePicture, ProfileContent } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  DEFAULT_OPEN_RANKING_PROVIDER,
  OpenRanking,
  OpenRankingAlgorithm,
  OpenRankingSearchResult,
} from "applesauce-extra";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { nprofileEncode } from "nostr-tools/nip19";
import { useEffect, useMemo, useState } from "react";
import { BehaviorSubject } from "rxjs";

import LoginView from "../../components/login-view";

// Common Open Ranking providers to choose from
const COMMON_PROVIDERS = [DEFAULT_OPEN_RANKING_PROVIDER];

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

// Optional signer used to issue Nostr Web Tokens for authenticated requests
const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

function ProfileListItem({ user }: { user: OpenRankingSearchResult }) {
  const profile = useProfile(user);
  const nprofile = nprofileEncode(user);

  const displayName = getDisplayName(profile, user.pubkey.slice(0, 8));
  const about = profile?.about || `User profile for ${displayName}`;
  const pubkeyShort = user.pubkey.slice(0, 8).toUpperCase();

  return (
    <li className="list-row">
      <div>
        <img
          className="size-10 rounded-box"
          src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
          alt={displayName}
        />
      </div>
      <div>
        <div>{displayName}</div>
        <div className="text-xs uppercase font-semibold opacity-60">{pubkeyShort}</div>
      </div>
      <p className="list-col-wrap text-xs">{about}</p>
      <div className="badge badge-primary" title="Web-of-trust rank">
        {user.rank}
      </div>
      <a
        href={`https://njump.me/${nprofile}`}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-square btn-ghost"
        title="View profile"
      >
        <svg
          className="size-[1.2em]"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" x2="21" y1="14" y2="3" />
        </svg>
      </a>
    </li>
  );
}

export default function OpenRankingSearch() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);

  const [provider, setProvider] = useState(DEFAULT_OPEN_RANKING_PROVIDER);
  const [query, setQuery] = useState("");
  const [algorithm, setAlgorithm] = useState<string>("");
  const [algorithms, setAlgorithms] = useState<OpenRankingAlgorithm[]>([]);
  const [searchResults, setSearchResults] = useState<OpenRankingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // Create the Open Ranking client for the selected provider, passing the signer so point-of-view requests are authenticated with a Nostr Web Token
  const openRanking = useMemo(() => new OpenRanking(provider, { signer: signer ?? undefined }), [provider, signer]);

  // Discover which search algorithms the selected provider offers (ORE-01)
  useEffect(() => {
    let active = true;
    openRanking
      .discover()
      .then((capabilities) => {
        if (!active) return;
        const supported = capabilities["/search/pubkeys"] ?? [];
        setAlgorithms(supported);
        // Default to the first (default) algorithm when the current selection is unavailable
        setAlgorithm((current) => (supported.some((a) => a.id === current) ? current : (supported[0]?.id ?? "")));
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to discover Open Ranking capabilities:", err);
        setAlgorithms([]);
      });

    return () => {
      active = false;
    };
  }, [openRanking]);

  const handleSearch = async () => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setSearchError(null);

    try {
      // Personalized algorithms require a point-of-view pubkey
      const selected = algorithms.find((a) => a.id === algorithm);
      const results = await openRanking.userSearch(query.trim(), 20, {
        algorithm: algorithm || undefined,
        pov: selected?.pov ? (pubkey ?? undefined) : undefined,
      });
      setSearchResults(results);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to search";
      setSearchError(errorMessage);
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleLogin = async (newSigner: ISigner, newPubkey: string) => {
    signer$.next(newSigner);
    pubkey$.next(newPubkey);
    setShowLogin(false);
  };

  // Show the login view when the user wants to enable Nostr Web Token auth
  if (showLogin) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="container mx-auto max-w-4xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="card-title text-2xl">Open Ranking Search</h1>
        {signer ? (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              signer$.next(null);
              pubkey$.next(null);
            }}
          >
            Sign out
          </button>
        ) : (
          <button className="btn btn-sm btn-outline" onClick={() => setShowLogin(true)}>
            Sign in for Nostr Web Token auth
          </button>
        )}
      </div>

      {/* Provider selection — algorithms are discovered from the chosen provider (ORE-01) */}
      <div className="mb-2">
        <div className="text-sm mb-1">Provider</div>
        <input
          type="text"
          list="open-ranking-providers"
          placeholder="https://provider.example.com"
          className="input input-bordered w-full"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <datalist id="open-ranking-providers">
          {COMMON_PROVIDERS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search for profiles..."
          className="input input-bordered flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        {algorithms.length > 0 && (
          <select className="select select-bordered" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
            {algorithms.map((a) => (
              <option key={a.id} value={a.id} disabled={a.pov && !signer}>
                {a.name}
                {a.pov ? " (point-of-view)" : ""}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={handleSearch} disabled={searching}>
          {searching ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              Searching...
            </>
          ) : (
            "Search"
          )}
        </button>
      </div>

      {/* Show search error */}
      {searchError && (
        <div className="alert alert-error">
          <span>{searchError}</span>
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <>
          <div className="text-sm mb-2">
            <span>Search Results ({searchResults.length})</span>
          </div>
          <ul className="list bg-base-100 rounded-box">
            {searchResults.map((user) => (
              <ProfileListItem key={user.pubkey} user={user} />
            ))}
          </ul>
        </>
      )}

      {/* Show message when no results */}
      {query && !searching && searchResults.length === 0 && !searchError && (
        <div className="alert alert-info">
          <span>No results found. Try a different search query.</span>
        </div>
      )}
    </div>
  );
}
