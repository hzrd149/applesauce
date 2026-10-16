/**
 * An example of using Web Workers and SQLite WASM with the @snort/worker-relay package for persisting events to a SQLite database
 * @tags database, worker, relay
 * @related cache/worker-relay
 */
import NoteContent from "../../components/note-content";
import { BehaviorSubject, combineLatest, debounceTime, switchMap, map, catchError, of, startWith, from } from "rxjs";

import { WorkerRelayInterface } from "@snort/worker-relay";
import { castUser } from "applesauce-common/casts";
import { AsyncEventStore, IAsyncEventDatabase } from "applesauce-core";
import {
  Filter,
  KnownEvent,
  NostrEvent,
  getDisplayName,
  getProfileContent,
  getProfilePicture,
  isEvent,
  isValidProfile,
  kinds,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$, useObservableEagerState } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { nanoid } from "nanoid";
import { ChangeEvent, FormEvent, useRef, useMemo, useState } from "react";

// when using Vite import the worker script directly (for production)
import WorkerVite from "@snort/worker-relay/src/worker?worker";
import ImportEventsButton from "../../components/import-events-button";
import { lookupRelays$ } from "../../settings";

// The prebuilt development worker is an asset; production bundles the source worker.
const devWorkerUrl = new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url);
const workerScript = import.meta.env.DEV ? new Worker(devWorkerUrl, { type: "module" }) : new WorkerVite();

const workerRelay = new WorkerRelayInterface(workerScript);

// Load sqlite database and run migrations without rejecting module evaluation.
const workerRelayReady = workerRelay.init({
  databasePath: "relay.db",
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

  async removeByFilters(filters: Filter | Filter[]): Promise<number> {
    const filterArray = Array.isArray(filters) ? filters : [filters];
    let totalRemoved = 0;

    for (const filter of filterArray) {
      const deleted = await this.relay.delete(["REQ", "bulk-delete", filter]);
      totalRemoved += deleted.length;
    }

    return totalRemoved;
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
      (await this.relay.count([
        "REQ",
        pubkey,
        { kinds: [kind], authors: [pubkey], ...(kind >= 30000 ? { "#d": [identifier ?? ""] } : {}) },
      ])) > 0
    );
  }
  async getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent | undefined> {
    const res = await this.relay.query([
      "REQ",
      pubkey,
      { kinds: [kind], authors: [pubkey], ...(kind >= 30000 ? { "#d": [identifier ?? ""] } : {}) },
    ]);
    return res.length > 0 ? res[0] : undefined;
  }
  async getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent[]> {
    const res = await this.relay.query([
      "REQ",
      pubkey,
      { kinds: [kind], authors: [pubkey], ...(kind >= 30000 ? { "#d": [identifier ?? ""] } : {}) },
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
const eventStore = new AsyncEventStore({ database: eventDatabase });

const pool = new RelayPool();

// This module owns the shared worker database for the application lifetime.
import.meta.hot?.dispose(() => {
  workerScript.terminate();
  pool.close();
});

// Create unified event loader for the store
// This will be called if the event store doesn't have the requested event
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

const viewEvent$ = new BehaviorSubject<NostrEvent | null>(null);

type OperationError = {
  message: string;
  retry?: "search" | "import" | "clear";
};

// Helper function to truncate text
function truncate(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// Helper function to format timestamp
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

// Export events to JSONL format
function exportEventsToJsonl(events: NostrEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

// Download file helper
function downloadFile(content: string, filename: string, mimeType: string = "application/json") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Import events from JSONL format
async function importEventsFromJsonl(
  file: File,
  eventStore: AsyncEventStore,
): Promise<{ total: number; added: number; failed: number }> {
  const stats = { total: 0, added: 0, failed: 0 };

  try {
    const text = await file.text();
    const lines = text.split("\n").filter((line) => line.trim());
    stats.total = lines.length;

    for (const line of lines) {
      try {
        const event = JSON.parse(line.trim());

        if (!isEvent(event)) {
          console.warn("Invalid event:", event);
          stats.failed++;
          continue;
        }

        await eventStore.add(event);
        stats.added++;
      } catch (parseError) {
        console.error("Failed to parse event:", parseError);
        stats.failed++;
      }
    }
  } catch (error) {
    console.error("Failed to process file:", error);
    throw error;
  }

  return stats;
}

// Profile hook for username lookup
function useProfile(pubkey: string) {
  return use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
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
        <button
          aria-label="Open Event"
          className="btn btn-primary btn-sm btn-soft"
          onClick={() => viewEvent$.next(event)}
        >
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
    <ul className="list bg-base-100 rounded-box ">
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
              <div className="text-sm uppercase font-semibold opacity-60">{profile.nip05}</div>
            </div>
            <p className="list-col-wrap text-sm whitespace-pre truncate max-h-48">{profile.about}</p>

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
    <div className="border border-base-300 bg-base-100 ">
      <div className="p-4 space-y-3">
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
        <NoteContent event={note} />

        {/* Note metadata */}
        <div className="flex justify-between items-center mt-4 pt-3 border-t border-base-300">
          <div className="text-sm text-base-content/50 font-mono">{note.id.slice(0, 16)}...</div>
          <div className="text-sm text-base-content/50">{note.tags.length > 0 && `${note.tags.length} tags`}</div>
        </div>
      </div>
    </div>
  );
}

// Main search component
function WorkerRelaySearch() {
  const kind$ = useMemo(() => new BehaviorSubject<number | null>(null), []);
  const kind = use$(kind$);

  const searchQuery$ = useMemo(() => new BehaviorSubject(""), []);
  const searchQuery = use$(searchQuery$);

  const [isLoading, setIsLoading] = useState(false);

  const [error, setError] = useState<OperationError | null>(null);

  const [importStats, setImportStats] = useState<{ total: number; added: number; failed: number } | null>(null);

  const viewEvent = useObservableEagerState(viewEvent$);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastImportFileRef = useRef<File | null>(null);

  const refresh$ = useMemo(() => new BehaviorSubject(0), []);
  const query = use$(
    () =>
      combineLatest([kind$, searchQuery$.pipe(debounceTime(500)), refresh$]).pipe(
        switchMap(([kind, search]) => {
          const filter: Filter = {
            limit: 1000,
            ...(kind === null ? {} : { kinds: [kind] }),
            ...(search.trim() ? { search: search.trim() } : {}),
          };
          return eventStore.timeline(filter).pipe(
            map((events) => ({ events, loading: false, error: undefined as string | undefined })),
            catchError(() =>
              of({
                events: [] as NostrEvent[],
                loading: false,
                error: "Search failed. Check the filters and try again.",
              }),
            ),
            startWith({ events: [] as NostrEvent[], loading: true, error: undefined as string | undefined }),
          );
        }),
      ),
    [],
  );
  const searchResults = query?.events ?? [];
  const loadEvents = () => refresh$.next(refresh$.value + 1);
  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    loadEvents();
  };

  const importFile = async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      const stats = await importEventsFromJsonl(file, eventStore);
      setImportStats(stats);
      await loadEvents(); // Reload events after import
    } catch {
      setError({ message: "Import failed. Choose a valid .jsonl file and try again.", retry: "import" });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file import
  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".jsonl")) {
      setError({ message: "Please select a .jsonl file" });
      return;
    }

    lastImportFileRef.current = file;
    await importFile(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle export
  const handleExport = () => {
    if (searchResults.length === 0) {
      setError({ message: "No events to export" });
      return;
    }

    const jsonlContent = exportEventsToJsonl(searchResults);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadFile(jsonlContent, `nostr-events-${timestamp}.jsonl`, "application/json");
  };

  const clearDatabase = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use removeByFilters with empty filter to clear all events
      await eventStore.removeByFilters({});

      loadEvents();
      setImportStats(null);
    } catch {
      setError({ message: "Database couldn't be cleared. Try again.", retry: "clear" });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle clear database
  const handleClearDatabase = async () => {
    if (!confirm("Are you sure you want to clear all events? This action cannot be undone.")) return;
    await clearDatabase();
  };

  const retryError = () => {
    if (error?.retry === "search") void loadEvents();
    if (error?.retry === "import" && lastImportFileRef.current) void importFile(lastImportFileRef.current);
    if (error?.retry === "clear") void clearDatabase();
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">Searchable browser SQLite event database with import/export</h1>
          <div className="badge badge-success ">
            <span className="loading loading-dots loading-xs mr-1"></span>
            Worker Relay
          </div>
        </div>
        <p className="text-base-content/70">
          Import, export, search, and filter Nostr events using Worker Relay SQLite with full-text search and standard
          Nostr filters.
        </p>
      </div>

      {/* Error Display */}
      {(error || query?.error) && (
        <div className="alert alert-error mb-6">
          <span>{error?.message ?? query?.error}</span>
          {error?.retry && (
            <button className="btn btn-sm" onClick={retryError} disabled={isLoading || query?.loading}>
              {error?.retry === "search"
                ? "Retry Search"
                : error?.retry === "import"
                  ? "Try Import Again"
                  : "Retry Clear"}
            </button>
          )}
        </div>
      )}

      {/* Import Stats */}
      {importStats && (
        <div className="alert alert-success mb-6">
          <div>
            <h3 className="font-bold">Import Complete!</h3>
            <p>
              Added: {importStats.added} | Failed: {importStats.failed} | Total: {importStats.total}
            </p>
          </div>
        </div>
      )}

      {/* Database Controls */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Database Controls</h2>
        <div className="flex flex-wrap gap-4 items-center">
          {/* Import */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl"
              onChange={handleFileImport}
              className="hidden"
              disabled={isLoading || query?.loading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || query?.loading}
              className="btn btn-primary"
            >
              {isLoading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Importing...
                </>
              ) : (
                "Import JSONL"
              )}
            </button>
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={isLoading || searchResults.length === 0}
            className="btn btn-secondary"
          >
            Export JSONL ({searchResults.length} events)
          </button>

          {/* Clear */}
          <button
            onClick={handleClearDatabase}
            disabled={isLoading || searchResults.length === 0}
            className="btn btn-error"
          >
            Clear Database
          </button>
        </div>
      </div>

      {/* Search Form */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Search Events</h2>
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-2">Event Kind</label>
            <select
              value={kind ?? ""}
              onChange={(e) => (e.target.value === "" ? kind$.next(null) : kind$.next(Number(e.target.value)))}
              className="select select-bordered w-48"
            >
              <option value="">Any</option>
              <option value="0">Profile (0)</option>
              <option value="1">Note (1)</option>
              <option value="2">Recommend Relay (2)</option>
              <option value="3">Contacts (3)</option>
              <option value="4">Encrypted DM (4)</option>
              <option value="5">Event Deletion (5)</option>
              <option value="6">Repost (6)</option>
              <option value="7">Reaction (7)</option>
              <option value="8">Badge Award (8)</option>
              <option value="40">Channel Creation (40)</option>
              <option value="41">Channel Metadata (41)</option>
              <option value="42">Channel Message (42)</option>
              <option value="43">Channel Hide Message (43)</option>
              <option value="44">Channel Mute User (44)</option>
              <option value="10000">Mute List (10000)</option>
              <option value="10001">Pin List (10001)</option>
              <option value="10002">Relay List Metadata (10002)</option>
              <option value="10003">Bookmark List (10003)</option>
              <option value="10004">Communities List (10004)</option>
              <option value="10005">Public Chats List (10005)</option>
              <option value="10006">Public Chats List (10006)</option>
              <option value="10007">App-specific Data (10007)</option>
              <option value="10015">Interests List (10015)</option>
              <option value="10030">User Emoji List (10030)</option>
              <option value="1063">File Metadata (1063)</option>
              <option value="30000">Follow Sets (30000)</option>
              <option value="30001">Communities (30001)</option>
              <option value="30008">Profile Badges (30008)</option>
              <option value="30009">Badge Definition (30009)</option>
              <option value="30015">Interest Sets (30015)</option>
              <option value="30017">Create or update a stall (30017)</option>
              <option value="30018">Create or update a product (30018)</option>
              <option value="30019">Create or update a pickup method (30019)</option>
              <option value="30023">Long-form Content (30023)</option>
              <option value="30024">Draft Long-form Content (30024)</option>
              <option value="30030">Emoji Sets (30030)</option>
              <option value="30078">Application-specific Data (30078)</option>
              <option value="30311">Classified Listing (30311)</option>
              <option value="30315">User Status (30315)</option>
              <option value="30315">Live Event Messages (30315)</option>
              <option value="30402">Community Post Approval (30402)</option>
              <option value="30403">Community Post (30403)</option>
              <option value="31922">Date-based Calendar Event (31922)</option>
              <option value="31923">Time-based Calendar Event (31923)</option>
              <option value="31924">Calendar (31924)</option>
              <option value="31925">Calendar Event RSVP (31925)</option>
              <option value="31990">File Header (31990)</option>
              <option value="31991">File Metadata (31991)</option>
              <option value="31992">Live Event (31992)</option>
              <option value="31993">Live Event Messages (31993)</option>
              <option value="31994">Handler Recommendation (31994)</option>
              <option value="31995">Handler Information (31995)</option>
              <option value="31996">Community Moderation (31996)</option>
              <option value="31997">Community Post (31997)</option>
              <option value="31998">Community (31998)</option>
              <option value="31999">Community Admin (31999)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => searchQuery$.next(e.target.value)}
              placeholder="Search events..."
              className="input input-bordered w-64"
            />
          </div>

          <div>
            <button type="submit" disabled={isLoading || query?.loading} className="btn btn-primary">
              {isLoading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Searching...
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Events ({searchResults.length})</h2>
          {searchResults.length > 0 && <ImportEventsButton eventStore={eventStore} />}
        </div>

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
        {!isLoading && !query?.loading && searchQuery && searchResults.length === 0 && !error && (
          <div className="text-center text-base-content/70 mt-8">No events found for “{searchQuery}”</div>
        )}

        {!isLoading && !query?.loading && !searchQuery && searchResults.length === 0 && !error && (
          <div className="text-center text-base-content/70 mt-8">No events in database, import some</div>
        )}
      </div>

      <dialog className={`modal ${viewEvent ? "modal-open" : ""}`}>
        <div className="modal-box">
          <pre className="text-sm overflow-auto font-mono">{JSON.stringify(viewEvent, null, 2)}</pre>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => viewEvent$.next(null)}>close</button>
        </form>
      </dialog>
    </div>
  );
}

export default function WorkerRelayDatabaseRoute() {
  const startup = use$(
    () =>
      from(workerRelayReady).pipe(
        map(() => ({ ready: true, failed: false })),
        catchError(() => of({ ready: false, failed: true })),
        startWith({ ready: false, failed: false }),
      ),
    [],
  );
  const { ready, failed } = startup ?? { ready: false, failed: false };

  if (failed) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          <span>Worker Relay couldn't start. Reload the example to try again.</span>
          <button className="btn btn-sm" onClick={() => window.location.reload()}>
            Reload Example
          </button>
        </div>
      </div>
    );
  }

  if (!ready) return <div className="p-6">Starting Worker Relay…</div>;
  return <WorkerRelaySearch />;
}
