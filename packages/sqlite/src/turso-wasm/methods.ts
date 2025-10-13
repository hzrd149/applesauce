import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { Database } from "@tursodatabase/database-wasm";
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
} from "../helpers/statements.js";

/** Create and migrate the `events`, `event_tags`, and search tables */
export async function createTables(db: Database, search: boolean = true): Promise<void> {
  // Create the events table
  await db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);

  // Create the event_tags table
  await db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  // Create the FTS5 search table
  if (search) {
    await db.exec(CREATE_SEARCH_TABLE_STATEMENT.sql);
  }

  // Create indexes
  for (const indexStatement of CREATE_INDEXES_STATEMENTS) {
    await db.exec(indexStatement.sql);
  }
}

/** Inserts search content for an event */
export async function insertSearchContent(
  db: Database,
  event: NostrEvent,
  contentFormatter: SearchContentFormatter,
): Promise<void> {
  const searchableContent = contentFormatter(event);

  // Insert/update directly into the FTS5 table
  const stmt = db.prepare(INSERT_SEARCH_CONTENT_STATEMENT.sql);
  await stmt.run(event.id, searchableContent, event.kind, event.pubkey, event.created_at);
}

/** Removes search content for an event */
export async function deleteSearchContent(db: Database, eventId: string): Promise<void> {
  const stmt = db.prepare(DELETE_SEARCH_CONTENT_STATEMENT.sql);
  await stmt.run(eventId);
}

/** Inserts an event into the `events`, `event_tags`, and search tables of a database */
export async function insertEvent(
  db: Database,
  event: NostrEvent,
  contentFormatter?: SearchContentFormatter,
): Promise<boolean> {
  const identifier = getReplaceableIdentifier(event);

  return await db.transaction(async () => {
    // Insert/update the main event
    const stmt = db.prepare(INSERT_EVENT_STATEMENT.sql);

    const result = await stmt.run(
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
    await insertEventTags(db, event);

    // Insert searchable content into the search tables
    if (contentFormatter) await insertSearchContent(db, event, contentFormatter);

    return result.changes > 0;
  })();
}

/** Insert indexable tags for an event into the event_tags table */
export async function insertEventTags(db: Database, event: NostrEvent): Promise<void> {
  // Clear existing tags for this event first
  const deleteStmt = db.prepare(DELETE_EVENT_TAGS_STATEMENT.sql);
  await deleteStmt.run(event.id);

  // Get only the indexable tags using applesauce-core helper
  const indexableTags = getIndexableTags(event);

  if (indexableTags && indexableTags.size > 0) {
    const insertStmt = db.prepare(INSERT_EVENT_TAG_STATEMENT.sql);

    for (const tagString of indexableTags) {
      // Parse the "tagName:tagValue" format
      const [name, value] = tagString.split(":");
      if (name && value) await insertStmt.run(event.id, name, value);
    }
  }
}

/** Removes an event by id from the `events`, `event_tags`, and search tables of a database */
export async function deleteEvent(db: Database, id: string): Promise<boolean> {
  return await db.transaction(async () => {
    // Delete from event_tags first (foreign key constraint)
    const deleteTagsStmt = db.prepare(DELETE_EVENT_TAGS_STATEMENT.sql);
    await deleteTagsStmt.run(id);

    // Delete from search tables
    await deleteSearchContent(db, id);

    // Delete from events table
    const deleteEventStmt = db.prepare(DELETE_EVENT_STATEMENT.sql);
    const result = await deleteEventStmt.run(id);
    return result.changes > 0;
  })();
}

/** Checks if an event exists */
export async function hasEvent(db: Database, id: string): Promise<boolean> {
  const stmt = db.prepare(HAS_EVENT_STATEMENT.sql);
  const result = await stmt.get(id);
  if (!result) return false;
  return (result as any).count > 0;
}

/** Gets a single event from a database */
export async function getEvent(db: Database, id: string): Promise<NostrEvent | undefined> {
  const stmt = db.prepare(GET_EVENT_STATEMENT.sql);
  const row = await stmt.get(id);
  return row && rowToEvent(row as EventRow);
}

/** Gets the latest replaceable event from a database */
export async function getReplaceable(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | undefined> {
  const stmt = db.prepare(GET_REPLACEABLE_STATEMENT.sql);
  const row = await stmt.get(kind, pubkey, identifier);
  return row && rowToEvent(row as EventRow);
}

/** Gets the history of a replaceable event from a database */
export async function getReplaceableHistory(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent[]> {
  const stmt = db.prepare(GET_REPLACEABLE_HISTORY_STATEMENT.sql);
  const rows = await stmt.all(kind, pubkey, identifier);
  return rows.map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export async function hasReplaceable(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string = "",
): Promise<boolean> {
  const stmt = db.prepare(HAS_REPLACEABLE_STATEMENT.sql);
  const result = await stmt.get(kind, pubkey, identifier);
  if (!result) return false;
  return (result as any).count > 0;
}

/** Get all events that match the filters (includes NIP-50 search support) */
export async function getEventsByFilters(
  db: Database,
  filters: FilterWithSearch | FilterWithSearch[],
): Promise<NostrEvent[]> {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const stmt = db.prepare(query.sql);
  const rows = await stmt.all(...query.params);

  // Convert rows to events and add to set
  return rows.map(rowToEvent);
}

/** Search events using FTS5 full-text search (convenience wrapper around getEventsByFilters) */
export async function searchEvents(db: Database, search: string, options?: Filter): Promise<NostrEvent[]> {
  if (!search.trim()) return [];

  // Build filter with search and other options
  const filter: FilterWithSearch = {
    search: search.trim(),
    ...options,
  };

  // Use the main filter system which now supports search
  return await getEventsByFilters(db, filter);
}

/** Rebuild the FTS5 search index for all events */
export async function rebuildSearchIndex(db: Database, contentFormatter: SearchContentFormatter): Promise<void> {
  await db.transaction(async () => {
    // Clear existing search data
    await db.exec(`DELETE FROM events_search;`);

    // Rebuild from all events
    const stmt = db.prepare(GET_ALL_EVENTS_STATEMENT.sql);
    const events = (await stmt.all()).map(rowToEvent);

    for (const event of events) {
      await insertSearchContent(db, event, contentFormatter);
    }
  })();
}
