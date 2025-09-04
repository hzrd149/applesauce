import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { type NostrEvent } from "nostr-tools";
import { useMemo, useState } from "react";
import { map } from "rxjs";
import { CodeSnippetCard, StatsDisplay, RelaySelector, LoadingSpinner, EmptyState } from "./components";
import "./App.css";

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

// Helper function to get tag value
function getTagValue(event: NostrEvent, tagName: string): string | null {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag ? tag[1] : null;
}

function App() {
  // Relay options
  const relays = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://nostr.land",
    "wss://relay.snort.social",
    "wss://relay.nostr.band",
  ];

  const [selectedRelay, setSelectedRelay] = useState(relays[0]);

  // Create a timeline observable for code snippets
  const events = useObservableMemo(() => {
    return pool
      .relay(selectedRelay)
      .subscription({
        kinds: [CODE_SNIPPET_KIND],
        // Filter for TypeScript snippets
        "#l": ["typescript"],
      })
      .pipe(
        // Only get events from relay (ignore EOSE)
        onlyEvents(),
        // deduplicate events using the event store
        mapEventsToStore(eventStore),
        // collect all events into a timeline
        mapEventsToTimeline(),
        // Duplicate the timeline array to make react happy
        map((timeline) => [...timeline]),
      );
  }, [selectedRelay]);

  // Helper function to get unique languages
  const uniqueLanguages = useMemo(() => {
    if (!events) return [];
    const languages = events
      .map((event) => getTagValue(event, "l"))
      .filter(Boolean)
      .filter((lang) => lang?.toLowerCase() === "typescript");
    return [...new Set(languages)];
  }, [events]);

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-lg">
        <div className="flex-1">
          <h1 className="text-xl font-bold">Applesauce Code Snippets</h1>
        </div>
        <div className="flex-none">
          <RelaySelector relays={relays} selectedRelay={selectedRelay} onRelayChange={setSelectedRelay} />
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Description */}
        <p className="text-lg opacity-70 mb-6 text-center">
          Discover and explore Applesauce code snippets shared on Nostr
        </p>

        {/* Stats */}
        {events && events.length > 0 && (
          <StatsDisplay
            totalSnippets={events.length}
            uniqueLanguages={uniqueLanguages.length}
            selectedRelay={selectedRelay}
          />
        )}

        {/* Loading State */}
        {!events && <LoadingSpinner message="Loading TypeScript snippets..." />}

        {/* Snippets Grid */}
        {events && events.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => (
              <CodeSnippetCard key={event.id} event={event} eventStore={eventStore} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {events && events.length === 0 && (
          <EmptyState
            title="No TypeScript snippets found"
            description="Try selecting a different relay or check back later for new snippets."
            icon="📝"
          />
        )}
      </div>
    </div>
  );
}

export default App;
