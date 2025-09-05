import { type NostrEvent } from "nostr-tools";
import { CodeSnippetCard, EmptyState, LoadingSpinner, RelaySelector } from "../components";

interface HomeViewProps {
  events: NostrEvent[] | null;
  relays: string[];
  onAddRelay: (relay: string) => void;
  onRemoveRelay: (relay: string) => void;
  searchQuery: string;
  updateSearchQuery: (query: string) => void;
  filteredEvents: NostrEvent[] | null;
  hasActiveSearch: boolean;
  onViewFull: (eventId: string) => void;
}

export default function HomeView({
  events,
  relays,
  onAddRelay,
  onRemoveRelay,
  searchQuery,
  updateSearchQuery,
  filteredEvents,
  hasActiveSearch,
  onViewFull,
}: HomeViewProps) {
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
          <a className="btn btn-ghost" href="https://github.com/hzrd149/nostr-code-snippets" target="_blank">
            MCP code snippets
          </a>
          <RelaySelector relays={relays} onAddRelay={onAddRelay} onRemoveRelay={onRemoveRelay} />
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
              <CodeSnippetCard key={event.id} event={event} onViewFull={(nevent) => onViewFull(nevent)} />
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
