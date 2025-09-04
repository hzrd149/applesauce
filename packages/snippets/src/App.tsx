import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { type NostrEvent } from "nostr-tools";
import { useState } from "react";
import { map, Observable } from "rxjs";
import "./App.css";
import { CodeSnippetCard, EmptyState, LoadingSpinner, RelaySelector } from "./components";
import { useSearch } from "./hooks";

// NIP-C0 Code Snippet Kind
const CODE_SNIPPET_KIND = 1337;

// Create an event store for all events
const eventStore = new EventStore();

// Create a relay pool to make relay connections
const pool = new RelayPool();

// Create an address loader to load user profiles
const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Add loaders to event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

function App() {
  // Relay state management
  const [relays, setRelays] = useState([
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://nostr.land",
    "wss://relay.snort.social",
    "wss://relay.nostr.band",
  ]);

  // Relay management functions
  const addRelay = (newRelay: string) => {
    const trimmedRelay = newRelay.trim();
    if (trimmedRelay && !relays.includes(trimmedRelay)) {
      setRelays((prev) => [...prev, trimmedRelay]);
    }
  };

  const removeRelay = (relayToRemove: string) => {
    setRelays((prev) => prev.filter((relay) => relay !== relayToRemove));
  };

  // Create a timeline observable for code snippets from all relays
  const events = useObservableMemo(() => {
    if (relays.length === 0) {
      // Return an observable that emits an empty array when there are no relays
      return new Observable<NostrEvent[]>((subscriber) => {
        subscriber.next([]);
        subscriber.complete();
      });
    }

    return pool
      .subscription(relays, {
        kinds: [CODE_SNIPPET_KIND],
        // Filter for TypeScript snippets
        "#l": ["typescript"],
      })
      .pipe(
        // Only get events from relays (ignore EOSE)
        onlyEvents(),
        // deduplicate events using the event store
        mapEventsToStore(eventStore),
        // collect all events into a timeline
        mapEventsToTimeline(),
        // Duplicate the timeline array to make react happy
        map((timeline) => [...timeline]),
      );
  }, [relays]);

  // Initialize search functionality
  const { searchQuery, updateSearchQuery, filteredEvents, hasActiveSearch } = useSearch(events || null);

  // Use filtered events for display
  const displayEvents = filteredEvents;

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-sm">
        <div className="flex-1">
          <a className="btn btn-ghost text-xl">Applesauce Code Snippets</a>
        </div>
        <div className="flex gap-2">
          <RelaySelector relays={relays} onAddRelay={addRelay} onRemoveRelay={removeRelay} />
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        {/* Description */}
        <div className="text-center mb-8">
          <p className="text-lg opacity-70">Discover and explore Applesauce code snippets shared on Nostr</p>
        </div>

        {/* Beautiful Search Bar */}
        <div className="max-w-2xl mx-auto mb-8">
          <div className="relative">
            <input
              type="text"
              placeholder="Search code snippets..."
              className="input input-bordered input-lg w-full pl-4 pr-12 text-lg shadow-md focus:shadow-xl transition-all duration-200 bg-base-100 border-2 focus:border-primary"
              value={searchQuery}
              onChange={(e) => updateSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => updateSearchQuery("")}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-base-content/40 hover:text-base-content/80 focus:outline-none transition-colors duration-200 p-1 rounded-full hover:bg-base-200"
                title="Clear search"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {hasActiveSearch && displayEvents && (
            <p className="text-sm opacity-60 mt-3 text-center">
              Showing {displayEvents.length} result{displayEvents.length !== 1 ? "s" : ""} for "{searchQuery}"
            </p>
          )}
        </div>

        {/* Loading State */}
        {!events && <LoadingSpinner message="Loading TypeScript snippets..." />}

        {/* Snippets Grid */}
        {displayEvents && displayEvents.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 x2l:grid-cols-3 gap-6">
            {displayEvents.map((event) => (
              <CodeSnippetCard key={event.id} event={event} eventStore={eventStore} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {displayEvents && displayEvents.length === 0 && (
          <EmptyState
            title={hasActiveSearch ? "No snippets found" : "No TypeScript snippets found"}
            description={
              hasActiveSearch
                ? `No snippets match your search for "${searchQuery}". Try different keywords or clear the search.`
                : "Try selecting a different relay or check back later for new snippets."
            }
            icon="📝"
          />
        )}
      </div>
    </div>
  );
}

export default App;
