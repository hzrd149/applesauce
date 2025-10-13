import { logger } from "applesauce-core";
import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { DatabaseSync } from "node:sqlite";
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
} from "../helpers/statements.js";

const log = logger.extend("sqlite:tables");

/** Create and migrate the `events`, `event_tags`, and search tables */
export function createTables(db: DatabaseSync, search: boolean = true): void {
  // Create the events table
  log("Creating events table");
  db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);

  // Create the event_tags table
  log("Creating event_tags table");
  db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  // Create the FTS5 search table
  if (search) {
    log("Creating events_search FTS5 table");
    db.exec(CREATE_SEARCH_TABLE_STATEMENT.sql);
  }

  // Create indexes
  log("Creating indexes");
  CREATE_INDEXES_STATEMENTS.forEach((indexStatement) => {
    db.exec(indexStatement.sql);
  });
}

/** Inserts search content for an event */
export function insertSearchContent(
  db: DatabaseSync,
  event: NostrEvent,
  contentFormatter: SearchContentFormatter,
): void {
  const searchableContent = contentFormatter(event);

  // Insert/update directly into the FTS5 table
  db.prepare(INSERT_SEARCH_CONTENT_STATEMENT.sql).run(
    event.id,
    searchableContent,
    event.kind,
    event.pubkey,
    event.created_at,
  );
}

/** Removes search content for an event */
export function deleteSearchContent(db: DatabaseSync, eventId: string): void {
  db.prepare(DELETE_SEARCH_CONTENT_STATEMENT.sql).run(eventId);
}

/** Inserts an event into the `events`, `event_tags`, and search tables of a database */
export function insertEvent(db: DatabaseSync, event: NostrEvent, contentFormatter?: SearchContentFormatter): boolean {
  const identifier = getReplaceableIdentifier(event);

  // Node.js sqlite doesn't have a transaction method like better-sqlite3, so we use BEGIN/COMMIT
  db.exec("BEGIN");
  try {
    // Try to insert the main event with OR IGNORE
    const result = db
      .prepare(INSERT_EVENT_STATEMENT_WITH_IGNORE.sql)
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
    if (result.changes === 0) {
      db.exec("COMMIT");
      return false; // Event already exists, skip tags/search processing
    }

    // Event was inserted, continue with tags and search content
    // Get only the indexable tags using applesauce-core helper
    const indexableTags = getIndexableTags(event);
    if (indexableTags && indexableTags.size > 0) {
      const insertStmt = db.prepare(INSERT_EVENT_TAG_STATEMENT.sql);

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

    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Removes an event by id from the `events`, `event_tags`, and search tables of a database */
export function deleteEvent(db: DatabaseSync, id: string): boolean {
  // Delete from search tables first (outside transaction to avoid rollback issues)
  try {
    deleteSearchContent(db, id);
  } catch (error) {
    // Search table might not exist if search is disabled, ignore the error
  }

  db.exec("BEGIN");
  try {
    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const deleteEventStmt = db.prepare(DELETE_EVENT_STATEMENT.sql);
    const result = deleteEventStmt.run(id);

    db.exec("COMMIT");
    return result.changes > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Checks if an event exists */
export function hasEvent(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(HAS_EVENT_STATEMENT.sql).get(id) as { count: number } | undefined;
  if (!result) return false;
  return result.count > 0;
}

/** Gets a single event from a database */
export function getEvent(db: DatabaseSync, id: string): NostrEvent | undefined {
  const row = db.prepare(GET_EVENT_STATEMENT.sql).get(id) as EventRow | undefined;
  return row && rowToEvent(row);
}

/** Gets the latest replaceable event from a database */
export function getReplaceable(
  db: DatabaseSync,
  kind: number,
  pubkey: string,
  identifier: string,
): NostrEvent | undefined {
  const row = db.prepare(GET_REPLACEABLE_STATEMENT.sql).get(kind, pubkey, identifier) as EventRow | undefined;
  return row && rowToEvent(row);
}

/** Gets the history of a replaceable event from a database */
export function getReplaceableHistory(
  db: DatabaseSync,
  kind: number,
  pubkey: string,
  identifier: string,
): NostrEvent[] {
  return (db.prepare(GET_REPLACEABLE_HISTORY_STATEMENT.sql).all(kind, pubkey, identifier) as EventRow[]).map(
    rowToEvent,
  );
}

/** Checks if a replaceable event exists in a database */
export function hasReplaceable(db: DatabaseSync, kind: number, pubkey: string, identifier: string = ""): boolean {
  const result = db.prepare(HAS_REPLACEABLE_STATEMENT.sql).get(kind, pubkey, identifier) as
    | { count: number }
    | undefined;
  if (!result) return false;
  return result.count > 0;
}

/** Get all events that match the filters (includes NIP-50 search support) */
export function getEventsByFilters(db: DatabaseSync, filters: FilterWithSearch | FilterWithSearch[]): NostrEvent[] {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const rows = db.prepare(query.sql).all(...query.params) as EventRow[];

  // Convert rows to events and add to set
  return rows.map(rowToEvent);
}

/** Search events using FTS5 full-text search (convenience wrapper around getEventsByFilters) */
export function searchEvents(db: DatabaseSync, search: string, options?: Filter): NostrEvent[] {
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
export function rebuildSearchIndex(db: DatabaseSync, contentFormatter: SearchContentFormatter): void {
  db.exec("BEGIN");
  try {
    // Clear existing search data
    db.exec(`DELETE FROM events_search;`);

    // Rebuild from all events
    const events = (db.prepare(GET_ALL_EVENTS_STATEMENT.sql).all() as EventRow[]).map(rowToEvent);

    for (const event of events) {
      insertSearchContent(db, event, contentFormatter);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Removes multiple events that match the given filters from the database */
export function deleteEventsByFilters(db: DatabaseSync, filters: FilterWithSearch | FilterWithSearch[]): number {
  const whereClause = buildDeleteFiltersQuery(filters);
  if (!whereClause) return 0;

  db.exec("BEGIN");
  try {
    // Delete from search tables first (no foreign key, so do manually)
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

    db.exec("COMMIT");
    return Number(result.changes);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
