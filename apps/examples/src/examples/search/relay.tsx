/**
 * Search for users on a NIP-50 capable relay (default relay.ditto.pub)
 * @tags nip-50, search, relay
 * @related search/primal, search/vertex
 */
import { castUser } from "applesauce-common/casts";
import { EventStore, mapEventsToStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { type ReactNode, useState } from "react";
import { catchError, distinct, map, of, startWith, switchMap, timer, toArray } from "rxjs";
import RelayPicker from "../../components/relay-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

type SearchState =
  { status: "loading" } | { status: "ready"; results: ProfilePointer[] } | { status: "error"; error: string };

function ProfileResult({ pointer }: { pointer: ProfilePointer }) {
  const user = castUser(pointer, eventStore);
  const profile = use$(() => user.profile$, [user]);
  const [copied, setCopied] = useState(false);

  return (
    <li className="flex items-center gap-3 border-b border-base-300 px-4 py-3 hover:bg-base-200">
      <img
        className="h-12 w-12 shrink-0 rounded-full border border-base-300 object-cover"
        src={profile?.picture ?? `https://robohash.org/${pointer.pubkey}.png`}
        alt=""
      />
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

export default function RelaySearch() {
  const [relay, setRelay] = useState("wss://relay.ditto.pub");
  const [query, setQuery] = useState("");
  const term = query.trim();

  // Search as the user types, debounced by restarting the timer whenever the relay or query changes
  const state = use$(() => {
    if (!term) return undefined;

    return timer(300).pipe(
      switchMap(() =>
        pool.relay(relay).request({ kinds: [kinds.Metadata], search: term, limit: 50 }, { timeout: 10_000 }),
      ),
      mapEventsToStore(eventStore),
      // NIP-50 relays return results by relevance, so keep arrival order instead of sorting by date
      distinct((event) => event.pubkey),
      toArray(),
      // Keep the relay as a hint so the result rows load profiles from the same relay
      map((events): SearchState => ({
        status: "ready",
        results: events.map((event) => ({ pubkey: event.pubkey, relays: [relay] })),
      })),
      startWith<SearchState>({ status: "loading" }),
      catchError((error) => of<SearchState>({ status: "error", error: String(error.message ?? error) })),
    );
  }, [relay, term]);

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap gap-2 border-b border-base-300 p-4">
        <input
          type="search"
          className="input input-bordered min-w-64 flex-1"
          placeholder="Search profiles"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <RelayPicker className="w-96" value={relay} onChange={setRelay} supportedNips={["50"]} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {term ? <Results state={state} /> : <Message>Start typing to search profiles on {relay}.</Message>}
      </div>
    </div>
  );
}
