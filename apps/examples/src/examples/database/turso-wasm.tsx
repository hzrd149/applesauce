/**
 * Store and query events using Turso WASM database with SQLite in the browser
 * @tags database, turso, sqlite, wasm
 * @related database/worker-relay
 */
import { use$ } from "applesauce-react/hooks";
import { defer, catchError, of, map, startWith } from "rxjs";

import { AsyncEventStore } from "applesauce-core";
import { NostrEvent, isEvent } from "applesauce-core/helpers";
import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";
import { connect } from "@tursodatabase/database-wasm/vite";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { verifyEvent } from "../../extra/verifier";

// Initialize database and event store
let eventDatabase: TursoWasmEventDatabase | null = null;
let eventStore: AsyncEventStore | null = null;

// This module owns the shared database for the application lifetime.
import.meta.hot?.dispose(() => {
  void eventDatabase?.close();
});

// Check if SharedArrayBuffer is supported
function isSharedArrayBufferSupported(): boolean {
  return typeof SharedArrayBuffer !== "undefined";
}

// Open the database once, OPFS only allows a single connection to each file
let initializing: Promise<boolean> | undefined;
function initializeDatabase() {
  return (initializing ??= openDatabase());
}

async function openDatabase() {
  try {
    const db = await connect("nostr-events.db");
    eventDatabase = await TursoWasmEventDatabase.fromDatabase(db);
    eventStore = new AsyncEventStore({ database: eventDatabase, verifyEvent });
    return true;
  } catch (error) {
    console.error("Failed to initialize database:", error);
    return false;
  }
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
async function importEventsFromJsonl(file: File): Promise<{ total: number; added: number; failed: number }> {
  if (!eventStore) throw new Error("Event store not initialized");

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

// Event row component
function EventRow({ event }: { event: NostrEvent }) {
  const formatDate = (timestamp: number) => new Date(timestamp * 1000).toLocaleString();
  const truncate = (text: string, maxLength: number = 50) =>
    text.length <= maxLength ? text : text.slice(0, maxLength) + "...";

  return (
    <tr>
      <td className="font-mono text-sm">{truncate(event.id, 16)}</td>
      <td>{event.kind}</td>
      <td className="font-mono text-sm">{truncate(event.pubkey, 16)}</td>
      <td>{truncate(event.content, 80)}</td>
      <td className="text-sm">{formatDate(event.created_at)}</td>
      <td>{event.tags.length}</td>
    </tr>
  );
}

// Events table component
function EventsTable({ events }: { events: NostrEvent[] }) {
  if (events.length === 0) {
    return <div className="text-center py-8 text-base-content/60">No events found</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-zebra w-full">
        <thead>
          <tr>
            <th>ID</th>
            <th>Kind</th>
            <th>Author</th>
            <th>Content</th>
            <th>Created At</th>
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Main component
export default function TursoWasmExample() {
  const [isLoading, setIsLoading] = useState(false);

  const [operationError, setOperationError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<number | null>(null);

  const [importStats, setImportStats] = useState<{ total: number; added: number; failed: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const startup = use$(
    () =>
      defer(async () => {
        if (!isSharedArrayBufferSupported())
          throw new Error("Turso WASM requires SharedArrayBuffer and cross-origin isolation headers");
        if (!(await initializeDatabase())) throw new Error("Failed to initialize database");
        return { ready: true, error: undefined as string | undefined };
      }).pipe(catchError((error) => of({ ready: false, error: String(error.message ?? error) }))),
    [],
  );
  const isInitialized = startup?.ready ?? false;
  const [refresh, setRefresh] = useState(0);
  const query = use$(
    () =>
      isInitialized && eventStore
        ? eventStore!.timeline({ limit: 1000, ...(kindFilter === null ? {} : { kinds: [kindFilter] }) }).pipe(
            map((events) => ({ events, loading: false, error: undefined as string | undefined })),
            catchError((error) =>
              of({ events: [] as NostrEvent[], loading: false, error: String(error.message ?? error) }),
            ),
            startWith({ events: [] as NostrEvent[], loading: true, error: undefined as string | undefined }),
          )
        : of(undefined),
    [isInitialized, kindFilter, refresh],
  );
  const events = query?.events ?? [];
  const error = operationError ?? startup?.error ?? query?.error;
  const loadAllEvents = () => {
    setKindFilter(null);
    setRefresh((refresh) => refresh + 1);
  };
  const handleFilter = (e: FormEvent) => {
    e.preventDefault();
    setRefresh((refresh) => refresh + 1);
  };

  // Handle file import
  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".jsonl")) {
      setOperationError("Please select a .jsonl file");
      return;
    }

    setIsLoading(true);
    setOperationError(null);

    try {
      const stats = await importEventsFromJsonl(file);
      setImportStats(stats);
      await loadAllEvents(); // Reload events after import
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setIsLoading(false);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Handle export
  const handleExport = () => {
    if (events.length === 0) {
      setOperationError("No events to export");
      return;
    }

    const jsonlContent = exportEventsToJsonl(events);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadFile(jsonlContent, `nostr-events-${timestamp}.jsonl`, "application/json");
  };

  // Handle clear database
  const handleClearDatabase = async () => {
    if (!confirm("Are you sure you want to clear all events? This action cannot be undone.")) {
      return;
    }

    if (!eventStore) return;

    setIsLoading(true);
    setOperationError(null);

    try {
      // Use removeByFilters with empty filter to clear all events
      await eventStore.removeByFilters({});

      setRefresh((refresh) => refresh + 1);
      setImportStats(null);
    } catch (err) {
      setOperationError(err instanceof Error ? err.message : "Failed to clear database");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isInitialized) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-6">Turso WASM SQLite Example</h1>
          {isLoading || startup === undefined || query?.loading ? (
            <div className="flex items-center justify-center gap-2">
              <span className="loading loading-spinner loading-lg"></span>
              <span>Initializing database...</span>
            </div>
          ) : error ? (
            <div className="alert alert-error max-w-2xl mx-auto">
              <div>
                <h3 className="font-bold">Browser Compatibility Issue</h3>
                <p className="mt-2">{error}</p>
                <div className="mt-4 text-left">
                  <h4 className="font-semibold mb-2">To fix this issue:</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Ensure your browser supports SharedArrayBuffer (Chrome 68+, Firefox 79+, Safari 15.2+)</li>
                    <li>Make sure your server is configured with the required headers:</li>
                    <li className="ml-4 font-mono text-sm">Cross-Origin-Opener-Policy: same-origin</li>
                    <li className="ml-4 font-mono text-sm">Cross-Origin-Embedder-Policy: require-corp</li>
                    <li>If running locally, try accessing via HTTPS or localhost</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-base-content/60">Initializing...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">Turso WASM SQLite Example</h1>
          <div className="badge badge-success ">
            <span className="loading loading-dots loading-xs mr-1"></span>
            SharedArrayBuffer Supported
          </div>
        </div>
        <p className="text-base-content/70">
          Import, export, and filter Nostr events using Turso WASM SQLite with standard Nostr filters.
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="alert alert-error mb-6">
          <span>{error}</span>
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

      {/* Controls */}
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
              {isLoading || startup === undefined || query?.loading ? (
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
          <button onClick={handleExport} disabled={isLoading || events.length === 0} className="btn btn-secondary">
            Export JSONL ({events.length} events)
          </button>

          {/* Clear */}
          <button onClick={handleClearDatabase} disabled={isLoading || events.length === 0} className="btn btn-error">
            Clear Database
          </button>
        </div>
      </div>

      {/* FilterEvents */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">FilterEvents</h2>

        <form onSubmit={handleFilter} className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-2">Event Kind</label>
            <select
              value={kindFilter ?? ""}
              onChange={(e) => setKindFilter(e.target.value === "" ? null : Number(e.target.value))}
              className="select select-bordered w-48"
              disabled={isLoading || query?.loading}
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
            <button type="submit" disabled={isLoading || query?.loading} className="btn btn-primary">
              {isLoading || startup === undefined || query?.loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Filtering...
                </>
              ) : (
                "Filter"
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Results */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Events ({events.length})</h2>
          {events.length > 0 && (
            <button onClick={loadAllEvents} disabled={isLoading || query?.loading} className="btn btn-sm btn-outline">
              Load All Events
            </button>
          )}
        </div>

        <EventsTable events={events} />
      </div>
    </div>
  );
}
