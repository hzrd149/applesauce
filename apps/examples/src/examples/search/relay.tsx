/**
 * Search for users on a NIP-50 capable relay (default relay.ditto.pub)
 * @tags nip-50, search, relay
 * @related search/primal, search/vertex
 */
import { castUser } from "applesauce-common/casts";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useState } from "react";
import { catchError, map, of, startWith } from "rxjs";
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
import { kinds } from "applesauce-core/helpers";

import RelayPicker from "../../components/relay-picker";
export default function RelaySearch() {
  const [relay, setRelay] = useState("wss://relay.ditto.pub");
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState<{ relay: string; query: string } | null>(null);
  const state = use$(() => {
    if (!command || command.relay !== relay) return of<SearchState<ProfilePointer>>({ status: "idle", results: [] });
    return pool
      .relay(relay)
      .request({ kinds: [kinds.Metadata], search: command.query, limit: 50 }, { timeout: 10_000 })
      .pipe(
        mapEventsToStore(eventStore),
        mapEventsToTimeline(),
        map((events): SearchState<ProfilePointer> => ({
          status: "ready",
          results: events.map((event) => ({ pubkey: event.pubkey, relays: [relay] })),
        })),
        startWith<SearchState<ProfilePointer>>({ status: "loading", results: [] }),
        catchError((error) =>
          of<SearchState<ProfilePointer>>({
            status: "error",
            results: [],
            error: String(error.message ?? error),
          }),
        ),
      );
  }, [relay, command]);
  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <RelayPicker value={relay} onChange={setRelay} supportedNips={["50"]} />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) setCommand({ relay, query: query.trim() });
        }}
      >
        <input
          className="input input-bordered flex-1"
          placeholder="Search profiles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn btn-primary" disabled={!query.trim() || state?.status === "loading"}>
          Search
        </button>
      </form>
      <Results state={state} />
    </div>
  );
}
