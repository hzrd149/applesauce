import { WorkerRelayInterface } from "@snort/worker-relay";
import { AsyncEventStore, BehaviorSubject, IAsyncEventDatabase } from "applesauce-core";
import {
  Filter,
  KnownEvent,
  NostrEvent,
  getDisplayName,
  getProfileContent,
  getProfilePicture,
  isValidProfile,
  kinds,
} from "applesauce-core/helpers";
import { nanoid } from "nanoid";
import { FormEvent, useCallback, useEffect, useState } from "react";

// when using Vite import the worker script directly (for production)
import WorkerVite from "@snort/worker-relay/src/worker?worker";
import { createAddressLoader, createEventLoader } from "applesauce-loaders/loaders";
import { useObservableEagerState, useObservableMemo } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useDebounce } from "react-use";
import ImportEventsButton from "../../components/import-events-button";

// in dev mode import esm module, i have no idea why it has to work like this
const workerScript = import.meta.env.DEV
  ? new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url)
  : new WorkerVite();

const workerRelay = new WorkerRelayInterface(workerScript);

// load sqlite database and run migrations
await workerRelay.init({
  databasePath: "relay.db",
  insertBatchSize: 500,
});

class WorkerRelayEventDatabase implements IAsyncEventDatabase {
  constructor(private readonly relay: WorkerRelayInterface) {}

  async add(event: NostrEvent): Promise<NostrEvent> {
    const res = await this.relay.event(event);
    if (!res.ok) throw new Error("Failed to add event");
    return res.event;
  }
  async remove(event: string | NostrEvent): Promise<boolean> {
    const id = typeof event === "string" ? event : event.id;
    const deleted = await this.relay.delete(["REQ", id, { ids: [id] }]);
    return deleted.length > 0;
  }

  async hasEvent(event: string | NostrEvent): Promise<boolean> {
    const id = typeof event === "string" ? event : event.id;
    return (await this.relay.count(["REQ", id, { ids: [id] }])) > 0;
  }
  async getEvent(event: string | NostrEvent): Promise<NostrEvent | undefined> {
    const id = typeof event === "string" ? event : event.id;
    const res = await this.relay.query(["REQ", id, { ids: [id] }]);
    return res.length > 0 ? res[0] : undefined;
  }
  async hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean> {
    return (
      (await this.relay.count(["REQ", pubkey, { kinds: [kind], authors: [pubkey], identifiers: [identifier ?? ""] }])) >
      0
    );
  }
  async getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent | undefined> {
    const res = await this.relay.query([
      "REQ",
      pubkey,
      { kinds: [kind], authors: [pubkey], identifiers: [identifier ?? ""] },
    ]);
    return res.length > 0 ? res[0] : undefined;
  }
  async getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent[]> {
    const res = await this.relay.query([
      "REQ",
      pubkey,
      { kinds: [kind], authors: [pubkey], identifiers: [identifier ?? ""] },
    ]);
    return res;
  }
  getByFilters(filters: Filter[]): Promise<NostrEvent[]> {
    if (!Array.isArray(filters)) filters = [filters];
    return this.relay.query(["REQ", nanoid(), ...filters]);
  }
  getTimeline(filters: Filter | Filter[]): Promise<NostrEvent[]> {
    if (!Array.isArray(filters)) filters = [filters];
    return this.relay.query(["REQ", nanoid(), ...filters]);
  }
}

const eventDatabase = new WorkerRelayEventDatabase(workerRelay);
const eventStore = new AsyncEventStore(eventDatabase);

const pool = new RelayPool();

const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});
const eventLoader = createEventLoader(pool, { eventStore });

// Add loaders to event store for profile lookups
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;
eventStore.eventLoader = eventLoader;

const viewEvent$ = new BehaviorSubject<NostrEvent | null>(null);

// Helper function to truncate text
function truncate(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// Helper function to format timestamp
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Profile hook for username lookup
function useProfile(pubkey: string) {
  return useObservableMemo(() => eventStore.profile({ pubkey }), [pubkey]);
}

// Event row component
function EventRow({ event }: { event: NostrEvent }) {
  const profile = useProfile(event.pubkey);

  return (
    <tr>
      <td className="font-mono text-sm">{truncate(event.id, 16)}</td>
      <td>{event.kind}</td>
      <td>{getDisplayName(profile) || truncate(event.pubkey, 16)}</td>
      <td>{truncate(event.content, 80)}</td>
      <td className="text-sm">{formatDate(event.created_at)}</td>
      <td>
        <button className="btn btn-primary btn-sm btn-soft" onClick={() => viewEvent$.next(event)}>
          Open
        </button>
      </td>
    </tr>
  );
}

function AnyEventTable({ events }: { events: NostrEvent[] }) {
  return (
    <table className="table table-zebra">
      <thead>
        <tr>
          <th>ID</th>
          <th>Kind</th>
          <th>Author</th>
          <th>Content</th>
          <th>Created At</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </tbody>
    </table>
  );
}

function ProfileList({ events }: { events: KnownEvent<kinds.Metadata>[] }) {
  return (
    <ul className="list bg-base-100 rounded-box shadow-md">
      {events.map((event) => {
        const profile = getProfileContent(event);

        return (
          <li key={event.id} className="list-row relative">
            <div>
              <img
                className="size-10 rounded-box"
                src={getProfilePicture(profile, `https://robohash.org/${event.pubkey}.png`)}
              />
            </div>
            <div>
              <div className="font-bold text-md">{getDisplayName(profile, event.pubkey.slice(0, 8) + "...")}</div>
              <div className="text-xs uppercase font-semibold opacity-60">{profile.nip05}</div>
            </div>
            <p className="list-col-wrap text-xs whitespace-pre truncate max-h-48">{profile.about}</p>

            <button className="btn btn-soft btn-primary absolute top-2 right-2" onClick={() => viewEvent$.next(event)}>
              View
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function NotesList({ events }: { events: NostrEvent[] }) {
  // Filter for only kind 1 notes and sort by created_at descending (newest first)
  const notes = events.filter((event) => event.kind === 1).sort((a, b) => b.created_at - a.created_at);

  if (notes.length === 0) {
    return <div className="text-center text-base-content/70 mt-8">No notes found</div>;
  }

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: NostrEvent }) {
  const profile = useProfile(note.pubkey);

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        {/* Author info */}
        <div className="flex items-center gap-3 mb-3">
          <img
            className="size-10 rounded-full"
            src={getProfilePicture(profile, `https://robohash.org/${note.pubkey}.png`)}
            alt="Profile"
          />
          <div className="flex-1">
            <div className="font-semibold">{getDisplayName(profile) || `${note.pubkey.slice(0, 8)}...`}</div>
            <div className="text-sm text-base-content/70">{formatDate(note.created_at)}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => viewEvent$.next(note)}>
            View
          </button>
        </div>

        {/* Note content */}
        <div className="whitespace-pre-wrap break-words">{note.content}</div>

        {/* Note metadata */}
        <div className="flex justify-between items-center mt-4 pt-3 border-t border-base-300">
          <div className="text-xs text-base-content/50 font-mono">{note.id.slice(0, 16)}...</div>
          <div className="text-xs text-base-content/50">{note.tags.length > 0 && `${note.tags.length} tags`}</div>
        </div>
      </div>
    </div>
  );
}

// Main search component
export default function WorkerRelaySearch() {
  const [kind, setKind] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NostrEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewEvent = useObservableEagerState(viewEvent$);

  const loadEvents = useCallback(async () => {
    const filter: Filter = {
      limit: 100,
    };

    // Build filter
    if (kind !== null) filter.kinds = [kind];
    if (searchQuery.trim()) filter.search = searchQuery.trim();

    console.log(filter);

    setIsLoading(true);
    setError(null);

    try {
      const events = await eventStore.getTimeline(filter);
      setSearchResults(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [kind, searchQuery, eventStore]);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadEvents();
  };

  // Load events when kind changes
  useEffect(() => {
    loadEvents();
  }, [kind]);

  // Load events 500 ms after finish typing
  useDebounce(loadEvents, 500, [searchQuery]);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Searchable browser SQLite event database</h1>

      {/* Search Form */}
      <div className="flex gap-2 w-full">
        <form onSubmit={handleSearch} className="mb-6 flex-1">
          <div className="flex gap-2">
            <select
              value={kind ?? ""}
              onChange={(e) => (e.target.value === "" ? setKind(null) : setKind(Number(e.target.value)))}
              className="select select-bordered w-32"
            >
              <option value="">Any</option>
              <option value={1}>Note</option>
              <option value={0}>Profile</option>
            </select>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events..."
              className="input input-bordered flex-1"
            />
            <button type="submit" disabled={isLoading} className="btn btn-primary">
              {isLoading ? "Searching..." : "Search"}
            </button>
          </div>
        </form>
        <ImportEventsButton eventStore={eventStore} />
      </div>

      {/* Error Display */}
      {error && <div className="alert alert-error mb-4">Error: {error}</div>}

      {/* Results Table */}
      {searchResults.length > 0 &&
        (kind === 0 ? (
          <ProfileList events={searchResults.filter(isValidProfile)} />
        ) : kind === 1 ? (
          <NotesList events={searchResults.filter((e) => e.kind === 1)} />
        ) : (
          <AnyEventTable events={searchResults} />
        ))}

      {/* No Results Message */}
      {!isLoading && searchQuery && searchResults.length === 0 && !error && (
        <div className="text-center text-base-content/70 mt-8">No events found for "{searchQuery}"</div>
      )}

      {!isLoading && !searchQuery && searchResults.length === 0 && !error && (
        <div className="text-center text-base-content/70 mt-8">No events in database, import some</div>
      )}

      <dialog className={`modal ${viewEvent ? "modal-open" : ""}`}>
        <div className="modal-box">
          <pre className="text-xs overflow-auto font-mono">{JSON.stringify(viewEvent, null, 2)}</pre>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => viewEvent$.next(null)}>close</button>
        </form>
      </dialog>
    </div>
  );
}
