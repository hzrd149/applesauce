import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents } from "applesauce-relay";
import { type NostrEvent } from "nostr-tools";
import { useEffect, useState } from "react";
import { map, Observable } from "rxjs";
import "./App.css";
import { CodeSnippetDetails, HomeView } from "./components";
import { useSearch } from "./hooks";
import { eventStore, pool, CODE_SNIPPET_KIND, DEFAULT_RELAYS, isValidEventId } from "./helpers/nostr";

function App() {
  // Hash-based routing state
  const [currentView, setCurrentView] = useState<"home" | "details">("home");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Relay state management
  const [relays, setRelays] = useState(DEFAULT_RELAYS);

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

  // Handle hash-based routing
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.substring(1);
      if (hash) {
        // Check if it's a valid event identifier (nevent or hex id)
        if (isValidEventId(hash)) {
          setSelectedEventId(hash);
          setCurrentView("details");
        }
      } else {
        setCurrentView("home");
        setSelectedEventId(null);
      }
    };

    // Handle initial hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Navigation functions
  const navigateToDetails = (nevent: string) => {
    window.location.hash = nevent;
  };

  const navigateToHome = () => {
    window.location.hash = "";
  };

  // Render details view if hash is present
  if (currentView === "details" && selectedEventId) {
    return <CodeSnippetDetails eventId={selectedEventId} relays={relays} onBack={navigateToHome} />;
  }

  return (
    <HomeView
      events={events || null}
      relays={relays}
      onAddRelay={addRelay}
      onRemoveRelay={removeRelay}
      searchQuery={searchQuery}
      updateSearchQuery={updateSearchQuery}
      filteredEvents={filteredEvents}
      hasActiveSearch={hasActiveSearch}
      onViewFull={navigateToDetails}
    />
  );
}

export default App;
