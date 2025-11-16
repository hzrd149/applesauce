import { FilterWithAnd, NostrEvent } from "applesauce-core/helpers";
import type { Statement } from "./statements.js";

// SQL schema for FTS5 search table - stores formatted searchable content directly
export const CREATE_SEARCH_TABLE_STATEMENT: Statement<[]> = {
  sql: `CREATE VIRTUAL TABLE IF NOT EXISTS events_search USING fts5(
    event_id UNINDEXED,
    content,
    kind UNINDEXED,
    pubkey UNINDEXED,
    created_at UNINDEXED
  )`,
};

export const INSERT_SEARCH_CONTENT_STATEMENT: Statement<[string, string, number, string, number]> = {
  sql: `INSERT OR REPLACE INTO events_search (event_id, content, kind, pubkey, created_at)
        VALUES (?, ?, ?, ?, ?)`,
};

export const DELETE_SEARCH_CONTENT_STATEMENT: Statement<[string]> = {
  sql: `DELETE FROM events_search WHERE event_id = ?`,
};

/** Filter with search field and NIP-ND AND operator support */
export type FilterWithSearch = FilterWithAnd & { search?: string; order?: "created_at" | "rank" };

/** Content formatter function type for search indexing */
export type SearchContentFormatter = (event: NostrEvent) => string;

/** Default search content formatter - returns the raw content */
export const defaultSearchContentFormatter: SearchContentFormatter = (event: NostrEvent) => {
  return event.content;
};

/** Enhanced search content formatter that includes tags and special handling for kind 0 events */
export const enhancedSearchContentFormatter: SearchContentFormatter = (event: NostrEvent) => {
  let searchableContent = event.content;

  // Special handling for kind 0 (profile metadata) events
  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content);
      const profileFields = [];

      // Include common profile fields in search
      if (profile.name) profileFields.push(profile.name);
      if (profile.display_name) profileFields.push(profile.display_name);
      if (profile.about) profileFields.push(profile.about);
      if (profile.nip05) profileFields.push(profile.nip05);
      if (profile.lud16) profileFields.push(profile.lud16);

      searchableContent = profileFields.join(" ");
    } catch (e) {
      // If JSON parsing fails, use the raw content
      searchableContent = event.content;
    }
  }

  // Include relevant tags in the searchable content
  const relevantTags = ["t", "subject", "title", "summary", "description", "d"];
  const tagContent: string[] = [];

  for (const tag of event.tags) {
    if (tag.length >= 2 && relevantTags.includes(tag[0])) tagContent.push(tag[1]);
  }

  // Combine content with tag content
  if (tagContent.length > 0) {
    searchableContent += " " + tagContent.join(" ");
  }

  return searchableContent;
};
