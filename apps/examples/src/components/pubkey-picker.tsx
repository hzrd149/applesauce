import { castUser } from "applesauce-common/casts";
import { EventStore, mapEventsToStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  normalizeToPubkey,
  ProfileContent,
  mergeRelaySets as relaySet,
} from "applesauce-core/helpers";
import { parseNIP05Address } from "applesauce-core/helpers/dns-identity";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  DEFAULT_OPEN_RANKING_PROVIDER,
  OpenRanking,
  OpenRankingAlgorithm,
  PrimalCache,
  Vertex,
} from "applesauce-extra";
import { Identity, IdentityStatus } from "applesauce-loaders/helpers";
import { createEventLoaderForStore, DnsIdentityLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  BehaviorSubject,
  Observable,
  Subject,
  catchError,
  defer,
  finalize,
  map,
  of,
  startWith,
  switchMap,
  tap,
  timer,
  toArray,
} from "rxjs";
import RelayPicker from "./relay-picker";
import { lookupRelays$ } from "../settings";

// Common relay URLs that support NIP-50 search
const SEARCH_RELAYS = relaySet(["wss://relay.ditto.pub", "wss://antiprimal.net"]);

// Common Open Ranking providers
const OPEN_RANKING_PROVIDERS = [DEFAULT_OPEN_RANKING_PROVIDER];

// Create an event store for all events
const eventStore = new EventStore();

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  // Fallback to lookup relays if profiles cant be found
  lookupRelays: lookupRelays$,
});

// Create a NIP-05 loader to resolve and cache "name@domain" identities
const dnsIdentityLoader = new DnsIdentityLoader();

type Nip05Lookup = Identity | { status: "resolving" };

/** Resolves a NIP-05 address after the user stops typing */
function resolveNip05(name: string, domain: string): Observable<Nip05Lookup> {
  return timer(500).pipe(
    switchMap(() => dnsIdentityLoader.requestIdentity(name, domain)),
    startWith({ status: "resolving" } as const),
  );
}

type SearchMethod = "primal" | "vertex" | "nip50" | "open-ranking";

interface ProfileSearchResult {
  pubkey: string;
  relays?: string[];
}

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return use$(() => castUser(user, eventStore).profile$, [user.pubkey, user.relays?.join("|")]);
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
  const state$ = useMemo(
    () =>
      new BehaviorSubject({
        query: "",
        method: "primal" as SearchMethod,
        relay: SEARCH_RELAYS[0],
        customRelay: "",
        provider: DEFAULT_OPEN_RANKING_PROVIDER,
        algorithm: "",
      }),
    [],
  );
  const state = use$(state$);
  const update = (patch: Partial<typeof state>) => state$.next({ ...state$.value, ...patch });
  const searchQuery = state.query;
  const searchMethod = state.method;
  const selectedRelay = state.relay;
  const customRelayUrl = state.customRelay;
  const openRankingProvider = state.provider;
  const extensionAvailable = typeof window !== "undefined" && !!window.nostr;

  const discovery = use$(
    () =>
      searchMethod === "open-ranking"
        ? defer(() => new OpenRanking(openRankingProvider).discover()).pipe(
            map((capabilities) => ({ algorithms: capabilities["/search/pubkeys"] ?? [], loading: false, error: "" })),
            catchError((error) =>
              of({ algorithms: [] as OpenRankingAlgorithm[], loading: false, error: String(error) }),
            ),
            startWith({ algorithms: [] as OpenRankingAlgorithm[], loading: true, error: "" }),
          )
        : of({ algorithms: [] as OpenRankingAlgorithm[], loading: false, error: "" }),
    [searchMethod, openRankingProvider],
  );
  const openRankingAlgorithms = discovery?.algorithms ?? [];
  const openRankingAlgorithm = openRankingAlgorithms.some((algorithm) => algorithm.id === state.algorithm)
    ? state.algorithm
    : (openRankingAlgorithms[0]?.id ?? "");
  const search$ = useMemo(() => new Subject<typeof state & { algorithm: string }>(), []);
  const results = use$(
    () =>
      defer(() => {
        const primal = new PrimalCache();
        return search$.pipe(
          switchMap((input) => {
            const query = input.query.trim();
            if (!query) return of({ profiles: [] as ProfileSearchResult[], loading: false, error: "" });
            const pointers$ =
              input.method === "nip50"
                ? defer(() => {
                    if (!input.relay) throw new Error("Please select a search relay");
                    return pool
                      .relay(input.relay)
                      .request({ kinds: [0], search: query, limit: 20 })
                      .pipe(
                        mapEventsToStore(eventStore),
                        toArray(),
                        map((events) => events.map((event) => ({ pubkey: event.pubkey, relays: [input.relay] }))),
                      );
                  })
                : defer(async (): Promise<ProfileSearchResult[]> => {
                    if (input.method === "primal") {
                      const events = await primal.userSearch(query, 20);
                      for (const event of events) eventStore.add(event);
                      return events.map((event) => ({ pubkey: event.pubkey }));
                    }
                    if (input.method === "vertex") {
                      if (!window.nostr) throw new Error("Nostr extension required for Vertex search");
                      return new Vertex(new ExtensionSigner()).userSearch(query, "globalPagerank", 20);
                    }
                    const algorithm = openRankingAlgorithms.find((algorithm) => algorithm.id === input.algorithm);
                    // Authentication is requested only by this intentional Search command, never by discovery/render.
                    const signer = window.nostr ? new ExtensionSigner() : undefined;
                    if (algorithm?.pov && !signer) throw new Error("Nostr extension required for personalized search");
                    const pov = algorithm?.pov ? await signer!.getPublicKey() : undefined;
                    return new OpenRanking(input.provider, { signer }).userSearch(query, 20, {
                      algorithm: input.algorithm || undefined,
                      pov,
                    });
                  });
            return pointers$.pipe(
              map((profiles) => ({
                profiles: [...new Map(profiles.map((profile) => [profile.pubkey, profile])).values()],
                loading: false,
                error: "",
              })),
              catchError((error) =>
                of({ profiles: [] as ProfileSearchResult[], loading: false, error: String(error) }),
              ),
              startWith({ profiles: [] as ProfileSearchResult[], loading: true, error: "" }),
            );
          }),
          finalize(() => primal.close()),
        );
      }),
    [search$, searchMethod, selectedRelay, openRankingProvider, openRankingAlgorithm],
  );
  const searchResults = results?.profiles ?? [];
  const isSearching = results?.loading ?? false;
  const searchError = results?.error;
  const handleSearch = () => search$.next({ ...state$.value, algorithm: openRankingAlgorithm });
  const handleCustomRelaySubmit = () => update({ relay: customRelayUrl, customRelay: "" });
  const handleSelectProfile = (pubkey: string) => {
    onSelect(pubkey);
    onClose();
  };
  const handleClose = () => onClose();

  const modal = (
    <dialog className={`modal ${isOpen ? "modal-open" : ""}`}>
      <div className="modal-box max-w-4xl">
        <h3 className="font-bold text-lg mb-4">Search Profiles</h3>

        {/* Search method selector */}
        <div className="flex flex-col gap-2 mb-4">
          <label className="label">
            <span className="label-text">Search Method</span>
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className={`btn btn-sm ${searchMethod === "primal" ? "btn-primary" : "btn-outline"}`}
              onClick={() => update({ method: "primal" })}
            >
              Primal
            </button>
            <button
              type="button"
              className={`btn btn-sm ${searchMethod === "vertex" ? "btn-primary" : "btn-outline"}`}
              onClick={() => update({ method: "vertex" })}
              disabled={!extensionAvailable}
              title={!extensionAvailable ? "Nostr extension required" : ""}
            >
              Vertex
            </button>
            <button
              type="button"
              className={`btn btn-sm ${searchMethod === "nip50" ? "btn-primary" : "btn-outline"}`}
              onClick={() => update({ method: "nip50" })}
            >
              NIP-50 Relay
            </button>
            <button
              type="button"
              className={`btn btn-sm ${searchMethod === "open-ranking" ? "btn-primary" : "btn-outline"}`}
              onClick={() => update({ method: "open-ranking" })}
            >
              Open Ranking
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
              onChange={(e) => update({ query: e.target.value })}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
            <button
              type="button"
              className="btn btn-primary join-item"
              onClick={handleSearch}
              disabled={!searchQuery.trim() || isSearching || (searchMethod === "vertex" && !extensionAvailable)}
            >
              {isSearching ? <span className="loading loading-spinner loading-sm"></span> : "Search"}
            </button>
          </div>

          {/* Search relay selection - only show for NIP-50 */}
          {searchMethod === "nip50" && (
            <RelayPicker value={selectedRelay} onChange={(relay) => update({ relay })} common={SEARCH_RELAYS} />
          )}

          {/* Provider + algorithm selection - only show for Open Ranking */}
          {searchMethod === "open-ranking" && (
            <div className="join">
              <input
                type="text"
                list="open-ranking-providers"
                placeholder="https://provider.example.com"
                className="input input-bordered join-item"
                value={openRankingProvider}
                onChange={(e) => update({ provider: e.target.value, algorithm: "" })}
              />
              <datalist id="open-ranking-providers">
                {OPEN_RANKING_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider} />
                ))}
              </datalist>
              <select
                className="select select-bordered join-item"
                value={openRankingAlgorithm}
                onChange={(e) => update({ algorithm: e.target.value })}
                disabled={openRankingAlgorithms.length === 0}
              >
                {openRankingAlgorithms.length === 0 && (
                  <option value="">{discovery?.loading ? "Loading…" : "No algorithms available"}</option>
                )}
                {openRankingAlgorithms.map((algorithm) => (
                  <option
                    key={algorithm.id}
                    value={algorithm.id}
                    disabled={algorithm.pov && !extensionAvailable}
                    title={algorithm.description}
                  >
                    {algorithm.name}
                    {algorithm.pov ? " (point-of-view)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {discovery?.error && (
          <p role="alert" className="text-error">
            {discovery.error}
          </p>
        )}
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

          {results && !searchError && !isSearching && searchResults.length === 0 && searchQuery && (
            <div className="text-center py-8 text-base-content/60">No profiles found for "{searchQuery}"</div>
          )}
        </div>

        {/* Custom relay modal */}
        <dialog id="custom-relay-modal" className="modal">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Custom Search Relay</h3>
            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Relay URL (must support NIP-50)</span>
              </label>
              <div className="join w-full mb-4">
                <input
                  type="text"
                  placeholder="wss://your-search-relay.com"
                  className="input input-bordered join-item flex-1"
                  value={customRelayUrl}
                  onChange={(e) => update({ customRelay: e.target.value })}
                />
                <button
                  type="button"
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
                type="button"
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
        <button type="button" onClick={handleClose}>
          close
        </button>
      </form>
    </dialog>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
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

type PubkeyPickerProps = {
  value: string;
  onChange: (pubkey: string) => void;
  className?: string;
  placeholder?: string;
};
export default function PubkeyPicker(props: PubkeyPickerProps) {
  return <PubkeyPickerInput key={props.value} {...props} />;
}
function PubkeyPickerInput({
  value,
  onChange,
  className,
  placeholder = "Enter pubkey, npub, or NIP-05 address...",
}: PubkeyPickerProps) {
  const input$ = useMemo(() => new BehaviorSubject(value), []);
  const inputValue = use$(input$);
  const modal$ = useMemo(() => new BehaviorSubject(false), []);
  const isSearchModalOpen = use$(modal$);
  const input = inputValue.trim();
  const normalized = normalizeToPubkey(input);
  const nip05 = normalized ? null : parseNIP05Address(input);

  // Resolve NIP-05 addresses and pass the pubkey to the parent once found
  const lookup = use$(
    () =>
      nip05
        ? resolveNip05(nip05.name, nip05.domain).pipe(
            tap((l) => l.status === IdentityStatus.Found && onChange(l.pubkey)),
          )
        : undefined,
    [nip05?.name, nip05?.domain, onChange],
  );
  const isResolving = lookup?.status === "resolving";
  const isValidPubkey = !!normalized || lookup?.status === IdentityStatus.Found;
  const isInvalid = !!input && !isValidPubkey && !isResolving;
  const change = useCallback(
    (input: string) => {
      input$.next(input);
      const pubkey = normalizeToPubkey(input.trim());
      if (pubkey) onChange(pubkey);
      else if (!input.trim()) onChange("");
    },
    [input$, onChange],
  );

  // Get pubkey from extension
  const handleGetFromExtension = useCallback(async () => {
    try {
      if (typeof window !== "undefined" && window.nostr) {
        const signer = new ExtensionSigner();
        const extensionPubkey = await signer.getPublicKey();
        change(extensionPubkey);
      } else {
        alert("Nostr extension not found. Please install a browser extension like nos2x or Alby.");
      }
    } catch (error) {
      console.error("Failed to get pubkey from extension:", error);
      alert("Failed to get pubkey from extension. Please check your extension settings.");
    }
  }, [change]);

  const handleSearchSelect = (pubkey: string) => {
    change(pubkey);
    modal$.next(false);
  };

  return (
    <div className={`flex flex-col w-full ${className}`}>
      <div className="join">
        <input
          type="text"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => change(e.target.value)}
          className={`input input-bordered join-item flex-1 ${
            isInvalid ? "input-error" : isValidPubkey ? "input-success" : ""
          }`}
        />
        <button type="button" className="btn join-item" onClick={() => modal$.next(true)} title="Search profiles">
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
          <button type="button" onClick={handleGetFromExtension} className="btn join-item">
            Extension
          </button>
        )}
      </div>
      {isResolving && (
        <label className="label pt-1">
          <span className="label-text-alt">Resolving NIP-05 address...</span>
        </label>
      )}
      {isInvalid && (
        <label className="label pt-1">
          <span className="label-text-alt text-error">
            {lookup?.status === IdentityStatus.Error
              ? `Failed to resolve NIP-05 address: ${lookup.error}`
              : lookup?.status === IdentityStatus.Missing
                ? "NIP-05 address not found"
                : "Invalid pubkey format"}
          </span>
        </label>
      )}

      {isSearchModalOpen && (
        <ProfileSearchModal
          isOpen={isSearchModalOpen}
          onClose={() => modal$.next(false)}
          onSelect={handleSearchSelect}
        />
      )}
    </div>
  );
}
