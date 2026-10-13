/**
 * Search for users and content using Vertex search API
 * @tags nip-50, search, vertex
 * @related search/primal
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useMemo } from "react";
import { BehaviorSubject, catchError, defer, map, Observable, of, startWith, switchMap } from "rxjs";
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
import { Vertex } from "applesauce-extra";
import { type ISigner } from "applesauce-signers";
import LoginView from "../../components/login-view";
function Search({ signer }: { signer: ISigner }) {
  const query$ = useMemo(() => new BehaviorSubject(""), []);
  const commands$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const creditRefresh$ = useMemo(() => new BehaviorSubject(0), []);
  const query = use$(query$);
  const vertex = use$(
    () =>
      new Observable<Vertex>((subscriber) => {
        const client = new Vertex(signer);
        subscriber.next(client);
        return () => client.close();
      }),
    [signer],
  );
  const balance = use$(
    () =>
      vertex
        ? creditRefresh$.pipe(
            switchMap(() =>
              defer(() => vertex.getCreditBalance()).pipe(
                map((credits) => ({ status: "ready" as const, credits, error: "" })),
                startWith({ status: "loading" as const, credits: 0, error: "" }),
                catchError((error) =>
                  of({ status: "error" as const, credits: 0, error: String(error.message ?? error) }),
                ),
              ),
            ),
          )
        : undefined,
    [vertex, creditRefresh$],
  );
  const state = use$(
    () =>
      vertex
        ? commands$.pipe(
            switchMap((query) =>
              query
                ? defer(() => vertex.userSearch(query)).pipe(
                    map((results): SearchState<ProfilePointer> => ({ status: "ready", results })),
                    startWith<SearchState<ProfilePointer>>({ status: "loading", results: [] }),
                    catchError((error) =>
                      of<SearchState<ProfilePointer>>({
                        status: "error",
                        results: [],
                        error: String(error.message ?? error),
                      }),
                    ),
                  )
                : of<SearchState<ProfilePointer>>({ status: "idle", results: [] }),
            ),
          )
        : undefined,
    [vertex, commands$],
  );
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <div className="flex gap-2 items-center">
        <p>
          {balance?.status === "ready"
            ? `Credits: ${balance.credits}`
            : balance?.status === "error"
              ? balance.error
              : "Loading credits…"}
        </p>
        <button className="btn btn-sm" onClick={() => creditRefresh$.next(creditRefresh$.value + 1)}>
          Refresh credits
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) commands$.next(query.trim());
        }}
      >
        <input
          className="input input-bordered flex-1"
          placeholder="Search Vertex profiles"
          value={query}
          onChange={(event) => query$.next(event.target.value)}
        />
        <button className="btn btn-primary" disabled={!query.trim() || state?.status === "loading"}>
          Search
        </button>
      </form>
      <Results state={state} />
    </div>
  );
}
export default function VertexSearch() {
  const session$ = useMemo(() => new BehaviorSubject<{ signer: ISigner; pubkey: string } | null>(null), []);
  const session = use$(session$);
  return session ? (
    <Search signer={session.signer} />
  ) : (
    <LoginView onLogin={(signer, pubkey) => session$.next({ signer, pubkey })} />
  );
}
