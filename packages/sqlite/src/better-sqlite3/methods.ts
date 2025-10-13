import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { Database } from "better-sqlite3";
import {
  CREATE_SEARCH_TABLE_STATEMENT,
  DELETE_SEARCH_CONTENT_STATEMENT,
  FilterWithSearch,
  INSERT_SEARCH_CONTENT_STATEMENT,
  SearchContentFormatter,
} from "../helpers/search.js";
import { buildFiltersQuery, rowToEvent } from "../helpers/sql.js";
import {
  CREATE_EVENT_TAGS_TABLE_STATEMENT,
  CREATE_EVENTS_TABLE_STATEMENT,
  CREATE_INDEXES_STATEMENTS,
  DELETE_EVENT_STATEMENT,
  DELETE_EVENT_TAGS_STATEMENT,
  EventRow,
  GET_ALL_EVENTS_STATEMENT,
  GET_EVENT_STATEMENT,
  GET_REPLACEABLE_HISTORY_STATEMENT,
  GET_REPLACEABLE_STATEMENT,
  HAS_EVENT_STATEMENT,
  HAS_REPLACEABLE_STATEMENT,
  INSERT_EVENT_STATEMENT,
  INSERT_EVENT_TAG_STATEMENT,
  type StatementParams,
} from "../helpers/statements.js";

/** Create and migrate the `events`, `event_tags`, and search tables */
export function createTables(db: Database, search: boolean = true): void {
  // Create the events table
  db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);

  // Create the event_tags table
  db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  // Create the FTS5 search table
  if (search) {
    db.exec(CREATE_SEARCH_TABLE_STATEMENT.sql);
  }

  // Create indexes
  CREATE_INDEXES_STATEMENTS.forEach((indexStatement) => {
    db.exec(indexStatement.sql);
  });
}

/** Inserts search content for an event */
export function insertSearchContent(db: Database, event: NostrEvent, contentFormatter: SearchContentFormatter): void {
  const searchableContent = contentFormatter(event);

  // Insert/update directly into the FTS5 table
  const stmt = db.prepare<StatementParams<typeof INSERT_SEARCH_CONTENT_STATEMENT>>(INSERT_SEARCH_CONTENT_STATEMENT.sql);

  stmt.run(event.id, searchableContent, event.kind, event.pubkey, event.created_at);
}

/** Removes search content for an event */
export function deleteSearchContent(db: Database, eventId: string): void {
  const stmt = db.prepare<StatementParams<typeof DELETE_SEARCH_CONTENT_STATEMENT>>(DELETE_SEARCH_CONTENT_STATEMENT.sql);
  stmt.run(eventId);
}

/** Inserts an event into the `events`, `event_tags`, and search tables of a database */
export function insertEvent(db: Database, event: NostrEvent, contentFormatter?: SearchContentFormatter): boolean {
  const identifier = getReplaceableIdentifier(event);

  return db.transaction(() => {
    // Insert/update the main event
    const stmt = db.prepare<StatementParams<typeof INSERT_EVENT_STATEMENT>>(INSERT_EVENT_STATEMENT.sql);

    const result = stmt.run(
      event.id,
      event.kind,
      event.pubkey,
      event.created_at,
      event.content,
      JSON.stringify(event.tags),
      event.sig,
      identifier,
    );

    // Insert indexable tags into the event_tags table
    insertEventTags(db, event);

    // Insert searchable content into the search tables
    if (contentFormatter) insertSearchContent(db, event, contentFormatter);

    return result.changes > 0;
  })();
}

/** Insert indexable tags for an event into the event_tags table */
export function insertEventTags(db: Database, event: NostrEvent): void {
  // Clear existing tags for this event first
  const deleteStmt = db.prepare<StatementParams<typeof DELETE_EVENT_TAGS_STATEMENT>>(DELETE_EVENT_TAGS_STATEMENT.sql);
  deleteStmt.run(event.id);

  // Get only the indexable tags using applesauce-core helper
  const indexableTags = getIndexableTags(event);

  if (indexableTags && indexableTags.size > 0) {
    const insertStmt = db.prepare<StatementParams<typeof INSERT_EVENT_TAG_STATEMENT>>(INSERT_EVENT_TAG_STATEMENT.sql);

    for (const tagString of indexableTags) {
      // Parse the "tagName:tagValue" format
      const [name, value] = tagString.split(":");
      if (name && value) insertStmt.run(event.id, name, value);
    }
  }
}

/** Removes an event by id from the `events`, `event_tags`, and search tables of a database */
export function deleteEvent(db: Database, id: string): boolean {
  return db.transaction(() => {
    // Delete from event_tags first (foreign key constraint)
    const deleteTagsStmt = db.prepare<StatementParams<typeof DELETE_EVENT_TAGS_STATEMENT>>(
      DELETE_EVENT_TAGS_STATEMENT.sql,
    );
    deleteTagsStmt.run(id);

    // Delete from search tables if they exist
    try {
      deleteSearchContent(db, id);
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table
    const deleteEventStmt = db.prepare<StatementParams<typeof DELETE_EVENT_STATEMENT>>(DELETE_EVENT_STATEMENT.sql);
    const result = deleteEventStmt.run(id);
    return result.changes > 0;
  })();
}

/** Checks if an event exists */
export function hasEvent(db: Database, id: string): boolean {
  const stmt = db.prepare<StatementParams<typeof HAS_EVENT_STATEMENT>, { count: number }>(HAS_EVENT_STATEMENT.sql);
  const result = stmt.get(id);
  if (!result) return false;
  return result.count > 0;
}

/** Gets a single event from a database */
export function getEvent(db: Database, id: string): NostrEvent | undefined {
  const stmt = db.prepare<StatementParams<typeof GET_EVENT_STATEMENT>, EventRow>(GET_EVENT_STATEMENT.sql);
  const row = stmt.get(id);
  return row && rowToEvent(row);
}

/** Gets the latest replaceable event from a database */
export function getReplaceable(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent | undefined {
  const stmt = db.prepare<StatementParams<typeof GET_REPLACEABLE_STATEMENT>, EventRow>(GET_REPLACEABLE_STATEMENT.sql);
  const row = stmt.get(kind, pubkey, identifier);
  return row && rowToEvent(row);
}

/** Gets the history of a replaceable event from a database */
export function getReplaceableHistory(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent[] {
  const stmt = db.prepare<StatementParams<typeof GET_REPLACEABLE_HISTORY_STATEMENT>, EventRow>(
    GET_REPLACEABLE_HISTORY_STATEMENT.sql,
  );
  return stmt.all(kind, pubkey, identifier).map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export function hasReplaceable(db: Database, kind: number, pubkey: string, identifier: string = ""): boolean {
  const stmt = db.prepare<StatementParams<typeof HAS_REPLACEABLE_STATEMENT>, { count: number }>(
    HAS_REPLACEABLE_STATEMENT.sql,
  );
  const result = stmt.get(kind, pubkey, identifier);
  if (!result) return false;
  return result.count > 0;
}

/** Get all events that match the filters (includes NIP-50 search support) */
export function getEventsByFilters(db: Database, filters: FilterWithSearch | FilterWithSearch[]): NostrEvent[] {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const stmt = db.prepare<any[], EventRow>(query.sql);
  const rows = stmt.all(...query.params);

  // Convert rows to events and add to set
  return rows.map(rowToEvent);
}

/** Search events using FTS5 full-text search (convenience wrapper around getEventsByFilters) */
export function searchEvents(db: Database, search: string, options?: Filter): NostrEvent[] {
  if (!search.trim()) return [];

  // Build filter with search and other options
  const filter: FilterWithSearch = {
    search: search.trim(),
    ...options,
  };

  // Use the main filter system which now supports search
  return getEventsByFilters(db, filter);
}

/** Rebuild the FTS5 search index for all events */
export function rebuildSearchIndex(db: Database, contentFormatter: SearchContentFormatter): void {
  db.transaction(() => {
    // Clear existing search data
    db.exec(`DELETE FROM events_search;`);

    // Rebuild from all events
    const stmt = db.prepare<StatementParams<typeof GET_ALL_EVENTS_STATEMENT>, EventRow>(GET_ALL_EVENTS_STATEMENT.sql);
    const events = stmt.all().map(rowToEvent);

    for (const event of events) {
      insertSearchContent(db, event, contentFormatter);
    }
  })();
}
