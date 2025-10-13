import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { Database } from "better-sqlite3";
import {
  CREATE_SEARCH_TABLE_STATEMENT,
  DELETE_SEARCH_CONTENT_STATEMENT,
  FilterWithSearch,
  INSERT_SEARCH_CONTENT_STATEMENT,
  SearchContentFormatter,
} from "../helpers/search.js";
import { buildFiltersQuery, buildDeleteFiltersQuery, rowToEvent } from "../helpers/sql.js";
import {
  CREATE_EVENT_TAGS_TABLE_STATEMENT,
  CREATE_EVENTS_TABLE_STATEMENT,
  CREATE_INDEXES_STATEMENTS,
  DELETE_EVENT_STATEMENT,
  EventRow,
  GET_ALL_EVENTS_STATEMENT,
  GET_EVENT_STATEMENT,
  GET_REPLACEABLE_HISTORY_STATEMENT,
  GET_REPLACEABLE_STATEMENT,
  HAS_EVENT_STATEMENT,
  HAS_REPLACEABLE_STATEMENT,
  INSERT_EVENT_STATEMENT_WITH_IGNORE,
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
    // Try to insert the main event with OR IGNORE
    const result = db
      .prepare<StatementParams<typeof INSERT_EVENT_STATEMENT_WITH_IGNORE>>(INSERT_EVENT_STATEMENT_WITH_IGNORE.sql)
      .run(
        event.id,
        event.kind,
        event.pubkey,
        event.created_at,
        event.content,
        JSON.stringify(event.tags),
        event.sig,
        identifier,
      );

    // If no rows were changed, the event already existed
    if (result.changes === 0) return false; // Event already exists, skip tags/search processing

    // Event was inserted, continue with tags and search content
    const indexableTags = getIndexableTags(event);
    if (indexableTags && indexableTags.size > 0) {
      const insertStmt = db.prepare<StatementParams<typeof INSERT_EVENT_TAG_STATEMENT>>(INSERT_EVENT_TAG_STATEMENT.sql);

      for (const tagString of indexableTags) {
        // Parse the "tagName:tagValue" format
        const [name, value] = tagString.split(":");
        if (name && value) insertStmt.run(event.id, name, value);
      }
    }

    if (contentFormatter) {
      try {
        insertSearchContent(db, event, contentFormatter);
      } catch (error) {
        // Search table might not exist if search is disabled, ignore the error
      }
    }

    return true;
  })();
}

/** Removes an event by id from the `events`, `event_tags`, and search tables of a database */
export function deleteEvent(db: Database, id: string): boolean {
  return db.transaction(() => {
    // Delete from search tables if they exist
    try {
      deleteSearchContent(db, id);
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const result = db.prepare<StatementParams<typeof DELETE_EVENT_STATEMENT>>(DELETE_EVENT_STATEMENT.sql).run(id);
    return result.changes > 0;
  })();
}

/** Checks if an event exists */
export function hasEvent(db: Database, id: string): boolean {
  const result = db
    .prepare<StatementParams<typeof HAS_EVENT_STATEMENT>, { count: number }>(HAS_EVENT_STATEMENT.sql)
    .get(id);
  if (!result) return false;
  return result.count > 0;
}

/** Gets a single event from a database */
export function getEvent(db: Database, id: string): NostrEvent | undefined {
  const row = db.prepare<StatementParams<typeof GET_EVENT_STATEMENT>, EventRow>(GET_EVENT_STATEMENT.sql).get(id);
  return row && rowToEvent(row);
}

/** Gets the latest replaceable event from a database */
export function getReplaceable(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent | undefined {
  const row = db
    .prepare<StatementParams<typeof GET_REPLACEABLE_STATEMENT>, EventRow>(GET_REPLACEABLE_STATEMENT.sql)
    .get(kind, pubkey, identifier);
  return row && rowToEvent(row);
}

/** Gets the history of a replaceable event from a database */
export function getReplaceableHistory(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent[] {
  return db
    .prepare<StatementParams<typeof GET_REPLACEABLE_HISTORY_STATEMENT>, EventRow>(GET_REPLACEABLE_HISTORY_STATEMENT.sql)
    .all(kind, pubkey, identifier)
    .map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export function hasReplaceable(db: Database, kind: number, pubkey: string, identifier: string = ""): boolean {
  const result = db
    .prepare<StatementParams<typeof HAS_REPLACEABLE_STATEMENT>, { count: number }>(HAS_REPLACEABLE_STATEMENT.sql)
    .get(kind, pubkey, identifier);
  if (!result) return false;
  return result.count > 0;
}

/** Get all events that match the filters (includes NIP-50 search support) */
export function getEventsByFilters(db: Database, filters: FilterWithSearch | FilterWithSearch[]): NostrEvent[] {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const rows = db.prepare<any[], EventRow>(query.sql).all(...query.params);

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
    const events = db
      .prepare<StatementParams<typeof GET_ALL_EVENTS_STATEMENT>, EventRow>(GET_ALL_EVENTS_STATEMENT.sql)
      .all()
      .map(rowToEvent);

    for (const event of events) {
      insertSearchContent(db, event, contentFormatter);
    }
  })();
}

/** Removes multiple events that match the given filters from the database */
export function deleteEventsByFilters(db: Database, filters: FilterWithSearch | FilterWithSearch[]): number {
  const whereClause = buildDeleteFiltersQuery(filters);
  if (!whereClause) return 0;

  return db.transaction(() => {
    // Delete from search tables if they exist
    try {
      const searchDeleteQuery = `DELETE FROM search_content WHERE event_id IN (SELECT id FROM events ${whereClause.sql})`;
      db.prepare(searchDeleteQuery).run(...whereClause.params);
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const deleteEventsQuery = `DELETE FROM events ${whereClause.sql}`;
    const result = db.prepare(deleteEventsQuery).run(...whereClause.params);

    return result.changes;
  })();
}
