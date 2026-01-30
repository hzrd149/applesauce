import { useCallback, useEffect, useMemo, useState } from "react";
import { Index } from "flexsearch";
import type { NostrEvent } from "nostr-tools";
import { CodeSnippet, castEvent } from "applesauce-common/casts";
import { eventStore } from "../services/event-store";

// Helper function to extract searchable text from event
function getSearchableText(event: NostrEvent): string {
  try {
    const snippet = castEvent(event, CodeSnippet, eventStore);
    const name = snippet.name || "";
    const description = snippet.description || "";
    const content = snippet.event.content || "";
    const language = snippet.language || "";

    return `${name} ${description} ${content} ${language}`.toLowerCase();
  } catch (err) {
    // Fallback if casting fails
    return event.content?.toLowerCase() || "";
  }
}

export function useSearch(events: NostrEvent[] | null) {
  const [searchQuery, setSearchQuery] = useState("");

  // Initialize FlexSearch index
  const searchIndex = useMemo(() => {
    return new Index({
      tokenize: "full",
      context: true,
    });
  }, []);

  // Update search index when events change
  useEffect(() => {
    if (!events) return;

    // Clear existing index
    searchIndex.clear();

    // Add all events to the search index
    events.forEach((event, index) => {
      const searchableText = getSearchableText(event);
      searchIndex.add(index, searchableText);
    });
  }, [events, searchIndex]);

  // Get search query from URL on mount and handle browser navigation
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const queryParam = urlParams.get("q");
    if (queryParam) {
      setSearchQuery(queryParam);
    }

    // Handle browser back/forward navigation
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const queryParam = urlParams.get("q") || "";
      setSearchQuery(queryParam);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Update URL when search query changes
  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);

    const url = new URL(window.location.href);
    if (query.trim()) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }

    // Use history API to update URL without page refresh
    window.history.pushState({}, "", url.toString());
  }, []);

  // Filter events based on search query
  const filteredEvents = useMemo(() => {
    if (!events || !searchQuery.trim()) {
      return events;
    }

    try {
      // Perform search using FlexSearch
      const searchResults = searchIndex.search(searchQuery, {
        limit: 100,
        suggest: true,
      });

      // Map search results back to events
      const resultIndices = Array.isArray(searchResults) ? searchResults : [];
      return resultIndices.map((index) => events[index as number]).filter(Boolean);
    } catch (error) {
      console.error("Search error:", error);
      return events;
    }
  }, [events, searchQuery, searchIndex]);

  return {
    searchQuery,
    updateSearchQuery,
    filteredEvents,
    hasActiveSearch: searchQuery.trim().length > 0,
  };
}
