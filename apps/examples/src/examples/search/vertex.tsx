/**
 * Search for users and content using Vertex search API
 * @tags nip-50, search, vertex
 * @related search/primal
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { type SortMethod, Vertex } from "applesauce-extra/vertex";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { type ReactNode, useState } from "react";
import { catchError, defer, map, Observable, of, startWith, switchMap, timer } from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const SORT_METHODS: { id: SortMethod; name: string }[] = [
  { id: "globalPagerank", name: "Global PageRank" },
  { id: "personalizedPagerank", name: "Personalized PageRank" },
  { id: "followerCount", name: "Follower count" },
];

type Session = { signer: ISigner; pubkey: string };
type Balance = { status: "loading" } | { status: "ready"; credits: number } | { status: "error"; error: string };
type SearchState =
  { status: "loading" } | { status: "ready"; results: ProfilePointer[] } | { status: "error"; error: string };

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

function ProfileResult({ pointer }: { pointer: ProfilePointer }) {
  const user = castUser(pointer, eventStore);
  const profile = use$(() => user.profile$, [user]);
  const [copied, setCopied] = useState(false);

  return (
    <li className="flex items-center gap-3 border-b border-base-300 px-4 py-3 hover:bg-base-200">
      <Avatar pubkey={pointer.pubkey} />
      <a href={`https://njump.me/${user.npub}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{profile?.displayName ?? user.npub.slice(0, 16) + "…"}</span>
          {profile?.dnsIdentity && <span className="truncate opacity-60">{profile.dnsIdentity}</span>}
        </div>
        {profile?.about && <p className="line-clamp-2 opacity-80">{profile.about}</p>}
      </a>
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
      {state.results.map((pointer) => (
        <ProfileResult key={pointer.pubkey} pointer={pointer} />
      ))}
    </ul>
  );
}

function Search({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMethod>("globalPagerank");
  const [creditRefresh, setCreditRefresh] = useState(0);
  const term = query.trim();

  // Create a Vertex client for the signer and close its relay connection when the signer changes
  const vertex = use$(
    () =>
      new Observable<Vertex>((subscriber) => {
        const client = new Vertex(session.signer);
        subscriber.next(client);
        return () => client.close();
      }),
    [session.signer],
  );

  const balance = use$(
    () =>
      vertex &&
      defer(() => vertex.getCreditBalance()).pipe(
        map((credits): Balance => ({ status: "ready", credits })),
        startWith<Balance>({ status: "loading" }),
        catchError((error) => of<Balance>({ status: "error", error: String(error.message ?? error) })),
      ),
    [vertex, creditRefresh],
  );

  // Search as the user types, debounced by restarting the timer whenever the inputs change
  const state = use$(() => {
    if (!vertex || !term) return undefined;

    return timer(500).pipe(
      switchMap(() => vertex.userSearch(term, sort, 20)),
      map((results): SearchState => ({ status: "ready", results })),
      startWith<SearchState>({ status: "loading" }),
      catchError((error) => of<SearchState>({ status: "error", error: String(error.message ?? error) })),
    );
  }, [vertex, term, sort]);

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex gap-2 border-b border-base-300 p-4">
        <input
          type="search"
          className="input input-bordered flex-1"
          placeholder="Search Vertex profiles"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="select select-bordered w-56"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMethod)}
        >
          {SORT_METHODS.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </select>
        <button className="btn" title="Refresh credits" onClick={() => setCreditRefresh((n) => n + 1)}>
          {balance?.status === "ready"
            ? `${balance.credits.toLocaleString()} credits`
            : balance?.status === "error"
              ? "Credits unavailable"
              : "Loading credits…"}
        </button>
        <button className="btn btn-ghost px-2" title="Sign out" onClick={onSignOut}>
          <Avatar pubkey={session.pubkey} className="h-8 w-8" />
          Sign out
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {balance?.status === "error" && <Message error>{balance.error}</Message>}
        {term ? <Results state={state} /> : <Message>Start typing to search profiles on Vertex.</Message>}
      </div>
    </div>
  );
}

export default function VertexSearch() {
  const [session, setSession] = useState<Session | null>(null);

  return session ? (
    <Search session={session} onSignOut={() => setSession(null)} />
  ) : (
    <LoginView onLogin={(signer, pubkey) => setSession({ signer, pubkey })} />
  );
}
