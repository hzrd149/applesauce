/**
 * Search web-of-trust-ranked profiles through an authenticated Open Ranking provider.
 * @tags search, open-ranking, web-of-trust, nostr-web-token
 * @related search/vertex, search/primal
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import {
  DEFAULT_OPEN_RANKING_PROVIDER,
  OpenRanking,
  OpenRankingAlgorithm,
  OpenRankingSearchResult,
} from "applesauce-extra/open-ranking";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { type ReactNode, useMemo, useState } from "react";
import { catchError, defer, map, of, startWith, switchMap, timer } from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Known public Open Ranking providers, the first is used by default
const PROVIDERS = [
  { name: "Vertex", url: "https://ranking.vertexlab.io" },
  { name: "Brainstorm", url: DEFAULT_OPEN_RANKING_PROVIDER },
];

type Session = { signer: ISigner; pubkey: string };
type Capabilities = { status: "loading" | "ready" | "error"; algorithms: OpenRankingAlgorithm[]; error?: string };
type SearchState =
  { status: "loading" } | { status: "ready"; results: OpenRankingSearchResult[] } | { status: "error"; error: string };

function Avatar({ pubkey, className = "h-12 w-12" }: { pubkey: string; className?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      className={`${className} shrink-0 rounded-full border border-base-300 object-cover`}
      src={profile?.picture ?? `https://robohash.org/${pubkey}.png`}
      alt=""
    />
  );
}

function ProfileResult({ result }: { result: OpenRankingSearchResult }) {
  const user = castUser(result, eventStore);
  const profile = use$(() => user.profile$, [user]);
  const [copied, setCopied] = useState(false);

  return (
    <li className="flex items-center gap-3 border-b border-base-300 px-4 py-3 hover:bg-base-200">
      <Avatar pubkey={result.pubkey} />
      <a href={`https://njump.me/${user.npub}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{profile?.displayName ?? user.npub.slice(0, 16) + "…"}</span>
          {profile?.dnsIdentity && <span className="truncate opacity-60">{profile.dnsIdentity}</span>}
        </div>
        {profile?.about && <p className="line-clamp-2 opacity-80">{profile.about}</p>}
      </a>
      <span className="badge badge-outline shrink-0" title="Web-of-trust rank">
        {result.rank.toLocaleString(undefined, { maximumFractionDigits: 3 })}
      </span>
      <button
        className="btn btn-ghost shrink-0"
        onClick={() => navigator.clipboard.writeText(user.npub).then(() => setCopied(true))}
      >
        {copied ? "Copied" : "Copy npub"}
      </button>
    </li>
  );
}

function Message({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <div role={error ? "alert" : "status"} className={`p-8 text-center ${error ? "text-error" : "opacity-60"}`}>
      {children}
    </div>
  );
}

function Results({ state }: { state?: SearchState }) {
  if (!state || state.status === "loading")
    return (
      <Message>
        <span className="loading loading-spinner" /> Searching…
      </Message>
    );
  if (state.status === "error") return <Message error>{state.error}</Message>;
  if (state.results.length === 0) return <Message>No profiles found.</Message>;

  return (
    <ul>
      {state.results.map((result) => (
        <ProfileResult key={result.pubkey} result={result} />
      ))}
    </ul>
  );
}

function SettingsModal({
  provider,
  onClose,
  onSave,
}: {
  provider: string;
  onClose: () => void;
  onSave: (provider: string) => void;
}) {
  const [url, setUrl] = useState(provider);

  return (
    <dialog className="modal modal-open">
      <form
        className="modal-box space-y-4 border border-base-300"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onSave(url.trim());
        }}
      >
        <h3 className="text-lg font-bold">Settings</h3>
        <div className="flex flex-col gap-2">
          Open Ranking provider
          <div className="join">
            {PROVIDERS.map((p) => (
              <button
                key={p.url}
                type="button"
                className={`btn join-item ${url === p.url ? "btn-primary" : ""}`}
                onClick={() => setUrl(p.url)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <input className="input input-bordered w-full" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">Save</button>
        </div>
      </form>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

export default function OpenRankingSearch() {
  const [provider, setProvider] = useState(PROVIDERS[0].url);
  const [session, setSession] = useState<Session | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [algorithmId, setAlgorithmId] = useState("");

  // The client signs Nostr Web Tokens with the session signer for point-of-view requests
  const client = useMemo(() => new OpenRanking(provider, { signer: session?.signer }), [provider, session?.signer]);

  // Discover the search algorithms the provider supports
  const capabilities = use$(
    () =>
      defer(() => client.discover()).pipe(
        map((caps): Capabilities => ({ status: "ready", algorithms: caps["/search/pubkeys"] ?? [] })),
        startWith<Capabilities>({ status: "loading", algorithms: [] }),
        catchError((error) =>
          of<Capabilities>({ status: "error", algorithms: [], error: String(error.message ?? error) }),
        ),
      ),
    [client],
  );

  const algorithms = capabilities?.algorithms ?? [];
  const algorithm =
    algorithms.find((a) => a.id === algorithmId) ?? algorithms.find((a) => !a.pov || session) ?? algorithms[0];
  const needsLogin = !!algorithm?.pov && !session;
  const term = query.trim();

  // Search as the user types, debounced by restarting the timer whenever the inputs change
  const state = use$(() => {
    if (!term || !algorithm || needsLogin) return undefined;

    return timer(300).pipe(
      switchMap(() =>
        client.userSearch(term, 20, { algorithm: algorithm.id, pov: algorithm.pov ? session?.pubkey : undefined }),
      ),
      map((results): SearchState => ({ status: "ready", results })),
      startWith<SearchState>({ status: "loading" }),
      catchError((error) => of<SearchState>({ status: "error", error: String(error.message ?? error) })),
    );
  }, [client, term, algorithm?.id, needsLogin, session?.pubkey]);

  if (showLogin)
    return (
      <div className="flex min-h-0 grow flex-col">
        <div className="border-b border-base-300 p-2">
          <button className="btn btn-ghost" onClick={() => setShowLogin(false)}>
            ← Back to search
          </button>
        </div>
        <LoginView
          onLogin={(signer, pubkey) => {
            setSession({ signer, pubkey });
            setShowLogin(false);
          }}
        />
      </div>
    );

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="space-y-2 border-b border-base-300 p-4">
        <div className="flex gap-2">
          <input
            type="search"
            className="input input-bordered flex-1"
            placeholder="Search people by name or NIP-05"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select select-bordered w-48"
            value={algorithm?.id ?? ""}
            disabled={algorithms.length === 0}
            onChange={(e) => setAlgorithmId(e.target.value)}
          >
            {capabilities?.status === "loading" && <option>Loading…</option>}
            {algorithms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.pov && !session ? " (sign in)" : ""}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setShowSettings(true)}>
            Settings
          </button>
          {session ? (
            <button className="btn btn-ghost px-2" title="Sign out" onClick={() => setSession(null)}>
              <Avatar pubkey={session.pubkey} className="h-8 w-8" />
              Sign out
            </button>
          ) : (
            <button className="btn" onClick={() => setShowLogin(true)}>
              Sign in
            </button>
          )}
        </div>
        {algorithm?.description && <p className="opacity-70">{algorithm.description}</p>}
      </div>

      {showSettings && (
        <SettingsModal
          provider={provider}
          onClose={() => setShowSettings(false)}
          onSave={(provider) => {
            setProvider(provider);
            setShowSettings(false);
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {capabilities?.status === "error" ? (
          <Message error>{capabilities.error}</Message>
        ) : needsLogin ? (
          <Message>
            <p className="mb-2">{algorithm.name} ranks results from your point of view.</p>
            <button className="btn btn-primary" onClick={() => setShowLogin(true)}>
              Sign in to search
            </button>
          </Message>
        ) : !term ? (
          <Message>Start typing to search profiles ranked by the web of trust.</Message>
        ) : (
          <Results state={state} />
        )}
      </div>
    </div>
  );
}
