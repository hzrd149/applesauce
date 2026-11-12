/**
 * Store and query events using Turso WASM database with SQLite in the browser
 * @tags database, turso, sqlite, wasm
 * @related database/worker-relay
 */
import { use$ } from "applesauce-react/hooks";
import { defer, catchError, of, map, startWith } from "rxjs";

import { AsyncEventStore } from "applesauce-core";
import { castUser } from "applesauce-common/casts";
import { NostrEvent, getDisplayName, isEvent } from "applesauce-core/helpers";
import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";
import { connect } from "@tursodatabase/database-wasm/vite";
import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
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

// Readable names for common event kinds
const KIND_NAMES: Record<number, string> = {
  0: "Profile",
  1: "Note",
  3: "Follows",
  5: "Deletion",
  6: "Repost",
  7: "Reaction",
  1063: "File",
  9735: "Zap",
  10002: "Relays",
  30023: "Article",
};

function getKindName(kind: number) {
  return KIND_NAMES[kind] ?? `Kind ${kind}`;
}

// Summarize an event for display without showing raw JSON or tags
function describeEvent(event: NostrEvent) {
  switch (event.kind) {
    case 0:
      return "Updated their profile";
    case 3: {
      const followCount = event.tags.filter((tag) => tag[0] === "p").length;
      return followCount === 1 ? "Follows 1 person" : `Follows ${followCount} people`;
    }
    case 6:
      return "Reposted a note";
    case 10002:
      return "Updated their relays";
    default:
      return event.content;
  }
}

// Event row component
function EventRow({ event }: { event: NostrEvent }) {
  const user = useMemo(() => castUser(event.pubkey, eventStore!), [event.pubkey]);
  const profile = use$(() => user.profile$, [user]);

  const fallbackName = user.npub.slice(0, 12) + "…";
  const authorName = getDisplayName(profile, fallbackName);

  return (
    <div className="py-3 border-b border-base-300">
      <div className="flex items-center gap-2">
        <span className="font-semibold truncate">{authorName}</span>
        <span className="badge badge-ghost">{getKindName(event.kind)}</span>
        <span className="ms-auto text-sm text-base-content/60 shrink-0">
          {new Date(event.created_at * 1000).toLocaleString()}
        </span>
      </div>
      <p className="line-clamp-2 break-words">{describeEvent(event)}</p>
    </div>
  );
}

// Events list component
function EventsList({ events }: { events: NostrEvent[] }) {
  if (events.length === 0) {
    return <div className="text-center py-8 text-base-content/60">No events found</div>;
  }

  return (
    <div>
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
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

      {/* Filter */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Filter</h2>

        <form onSubmit={handleFilter} className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-2">Event Kind</label>
            <select
              value={kindFilter ?? ""}
              onChange={(e) => setKindFilter(e.target.value === "" ? null : Number(e.target.value))}
              className="select select-bordered w-48"
              disabled={isLoading || query?.loading}
            >
              <option value="">All kinds</option>
              {Object.entries(KIND_NAMES).map(([kind, name]) => (
                <option key={kind} value={kind}>
                  {name}
                </option>
              ))}
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

        <EventsList events={events} />
      </div>
    </div>
  );
}
