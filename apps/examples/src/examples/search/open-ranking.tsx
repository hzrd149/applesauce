/**
 * Search web-of-trust-ranked profiles through an authenticated Open Ranking provider.
 * @tags search, open-ranking, web-of-trust, nostr-web-token
 * @related search/vertex, search/primal
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import { catchError, defer, map, of, startWith } from "rxjs";
import { lookupRelays$ } from "../../settings";
const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });
type SearchState<T> = { status: "idle" | "loading" | "ready" | "error"; results: T[]; error?: string };
function ProfileResult({ user }: { user: ProfilePointer }) {
  const profile = use$(() => castUser(user, eventStore).profile$, [user.pubkey, user.relays?.join("|")]);
  return (
    <li className="flex gap-3 border-b border-base-300 py-3">
      <img
        className="h-12 w-12 rounded-full"
        src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`}
        alt=""
      />
      <div className="min-w-0 flex-1">
        <a
          href={`https://njump.me/${castUser(user, eventStore).npub}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold"
        >
          {profile?.displayName ?? user.pubkey.slice(0, 12)}
        </a>
        <p className="text-sm break-words">{profile?.about}</p>
      </div>
      <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(castUser(user, eventStore).npub)}>
        Copy npub
      </button>
    </li>
  );
}
function Results({ state }: { state: SearchState<ProfilePointer> | undefined }) {
  if (!state || state.status === "idle") return <p>Submit a query to search.</p>;
  if (state.status === "loading") return <p role="status">Searching…</p>;
  if (state.status === "error")
    return (
      <p role="alert" className="text-error">
        {state.error}
      </p>
    );
  return state.results.length ? (
    <ul>
      {state.results.map((user) => (
        <ProfileResult key={user.pubkey} user={user} />
      ))}
    </ul>
  ) : (
    <p>No results found.</p>
  );
}
import {
  DEFAULT_OPEN_RANKING_PROVIDER,
  OpenRanking,
  OpenRankingAlgorithm,
  OpenRankingSearchResult,
} from "applesauce-extra";
import { type ISigner } from "applesauce-signers";
import LoginView from "../../components/login-view";
export default function OpenRankingSearch() {
  const [provider, setProvider] = useState(DEFAULT_OPEN_RANKING_PROVIDER);
  const [query, setQuery] = useState("");
  const [algorithmId, setAlgorithmId] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [session, setSession] = useState<{ signer: ISigner; pubkey: string } | null>(null);
  const [command, setCommand] = useState<{
    query: string;
    provider: string;
    algorithm: string;
    pubkey?: string;
  } | null>(null);
  const client = useMemo(() => new OpenRanking(provider, { signer: session?.signer }), [provider, session?.signer]);
  const capabilities = use$(
    () =>
      defer(() => client.discover()).pipe(
        map((capabilities) => ({
          algorithms: capabilities["/search/pubkeys"] ?? ([] as OpenRankingAlgorithm[]),
          error: "",
          loading: false,
        })),
        startWith({ algorithms: [] as OpenRankingAlgorithm[], error: "", loading: true }),
        catchError((error) =>
          of({ algorithms: [] as OpenRankingAlgorithm[], error: String(error.message ?? error), loading: false }),
        ),
      ),
    [client],
  );
  const algorithms = capabilities?.algorithms ?? [];
  const algorithm = algorithms.find((algorithm) => algorithm.id === algorithmId) ?? algorithms[0];
  const state = use$(() => {
    if (!command || command.provider !== provider || command.pubkey !== session?.pubkey)
      return of<SearchState<OpenRankingSearchResult>>({ status: "idle", results: [] });
    return defer(() =>
      client.userSearch(command.query, 20, {
        algorithm: command.algorithm || undefined,
        pov: algorithm?.pov ? session?.pubkey : undefined,
      }),
    ).pipe(
      map((results): SearchState<OpenRankingSearchResult> => ({ status: "ready", results })),
      startWith<SearchState<OpenRankingSearchResult>>({ status: "loading", results: [] }),
      catchError((error) =>
        of<SearchState<OpenRankingSearchResult>>({
          status: "error",
          results: [],
          error: String(error.message ?? error),
        }),
      ),
    );
  }, [client, provider, session?.pubkey, algorithm, command]);
  if (showLogin)
    return (
      <LoginView
        onLogin={(signer, pubkey) => {
          setSession({ signer, pubkey });
          setShowLogin(false);
        }}
      />
    );
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <button className="btn btn-sm" onClick={() => (session ? setSession(null) : setShowLogin(true))}>
        {session ? "Sign out" : "Sign in for personalized ranking"}
      </button>
      <label className="flex flex-col gap-2">
        Provider
        <input
          className="input input-bordered"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        />
      </label>
      {capabilities?.error && (
        <p role="alert" className="text-error">
          {capabilities.error}
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim())
            setCommand({
              query: query.trim(),
              provider,
              algorithm: algorithm?.id ?? "",
              pubkey: session?.pubkey,
            });
        }}
      >
        <input
          className="input input-bordered flex-1"
          value={query}
          placeholder="Search ranked profiles"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="select select-bordered"
          value={algorithm?.id ?? ""}
          onChange={(event) => setAlgorithmId(event.target.value)}
        >
          {algorithms.map((algorithm) => (
            <option key={algorithm.id} value={algorithm.id} disabled={algorithm.pov && !session}>
              {algorithm.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={
            !query.trim() || state?.status === "loading" || capabilities?.loading || !!(algorithm?.pov && !session)
          }
        >
          Search
        </button>
      </form>
      <Results state={state} />
      {state?.results.map((user) => (
        <p key={user.pubkey}>
          {user.pubkey.slice(0, 12)}: rank {user.rank}
        </p>
      ))}
    </div>
  );
}
