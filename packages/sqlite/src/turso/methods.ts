import { Database } from "@tursodatabase/database";
import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { buildDeleteFiltersQuery, buildFiltersQuery, rowToEvent } from "../helpers/sql.js";
import {
  SearchContentFormatter,
  CREATE_SEARCH_TABLE_STATEMENT,
  DELETE_SEARCH_CONTENT_STATEMENT,
  INSERT_SEARCH_CONTENT_STATEMENT,
} from "../helpers/search.js";
import {
  CREATE_EVENT_TAGS_TABLE_STATEMENT,
  CREATE_EVENTS_TABLE_STATEMENT,
  CREATE_INDEXES_STATEMENTS,
  DELETE_EVENT_STATEMENT,
  EventRow,
  GET_EVENT_STATEMENT,
  GET_REPLACEABLE_HISTORY_STATEMENT,
  GET_REPLACEABLE_STATEMENT,
  HAS_EVENT_STATEMENT,
  HAS_REPLACEABLE_STATEMENT,
  INSERT_EVENT_STATEMENT,
  INSERT_EVENT_TAG_STATEMENT,
} from "../helpers/statements.js";

/** Create and migrate the `events`, `event_tags`, and search tables */
export async function createTables(db: Database, search: boolean = false): Promise<void> {
  // Create the events table
  await db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);

  // Create the event_tags table
  await db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  // Create search table if search is enabled
  if (search) {
    await db.exec(CREATE_SEARCH_TABLE_STATEMENT.sql);
  }

  // Create indexes
  for (const indexStatement of CREATE_INDEXES_STATEMENTS) {
    await db.exec(indexStatement.sql);
  }
}

/** Inserts an event into the `events`, `event_tags` */
export async function insertEvent(
  db: Database,
  event: NostrEvent,
  searchContentFormatter?: SearchContentFormatter,
): Promise<boolean> {
  const identifier = getReplaceableIdentifier(event);

  return await db.transaction(async () => {
    // Try to insert the main event with OR IGNORE
    const result = await db
      .prepare(INSERT_EVENT_STATEMENT.sql)
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
    if (result.changes === 0) return false; // Event already exists, skip tags processing

    // Event was inserted, continue with tags
    const indexableTags = getIndexableTags(event);
    if (indexableTags && indexableTags.size > 0) {
      const insertStmt = db.prepare(INSERT_EVENT_TAG_STATEMENT.sql);

      for (const tagString of indexableTags) {
        // Parse the "tagName:tagValue" format
        const [name, value] = tagString.split(":");
        if (name && value) await insertStmt.run(event.id, name, value);
      }
    }

    // Insert search content if search is enabled
    if (searchContentFormatter) {
      try {
        const searchContent = searchContentFormatter(event);
        await db
          .prepare(INSERT_SEARCH_CONTENT_STATEMENT.sql)
          .run(event.id, searchContent, event.kind, event.pubkey, event.created_at);
      } catch (error) {
        // Search table might not exist if search is disabled, ignore the error
      }
    }

    return result.changes > 0;
  })();
}

/** Removes an event by id from the `events`, `event_tags` */
export async function deleteEvent(db: Database, id: string): Promise<boolean> {
  return await db.transaction(async () => {
    // Delete from search table first if it exists
    try {
      await db.prepare(DELETE_SEARCH_CONTENT_STATEMENT.sql).run(id);
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const result = await db.prepare(DELETE_EVENT_STATEMENT.sql).run(id);

    return result.changes > 0;
  })();
}

/** Checks if an event exists */
export async function hasEvent(db: Database, id: string): Promise<boolean> {
  const result = await db.prepare(HAS_EVENT_STATEMENT.sql).get(id);
  if (!result) return false;
  return (result as any).count > 0;
}

/** Gets a single event from a database */
export async function getEvent(db: Database, id: string): Promise<NostrEvent | undefined> {
  const row = await db.prepare(GET_EVENT_STATEMENT.sql).get(id);
  return row && rowToEvent(row as EventRow);
}

/** Gets the latest replaceable event from a database */
export async function getReplaceable(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | undefined> {
  const row = await db.prepare(GET_REPLACEABLE_STATEMENT.sql).get(kind, pubkey, identifier);
  return row && rowToEvent(row as EventRow);
}

/** Gets the history of a replaceable event from a database */
export async function getReplaceableHistory(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent[]> {
  const rows = await db.prepare(GET_REPLACEABLE_HISTORY_STATEMENT.sql).all(kind, pubkey, identifier);
  return rows.map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export async function hasReplaceable(
  db: Database,
  kind: number,
  pubkey: string,
  identifier: string = "",
): Promise<boolean> {
  const result = await db.prepare(HAS_REPLACEABLE_STATEMENT.sql).get(kind, pubkey, identifier);
  if (!result) return false;
  return (result as any).count > 0;
}

/** Get all events that match the filters */
export async function getEventsByFilters(db: Database, filters: Filter | Filter[]): Promise<NostrEvent[]> {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const rows = await db.prepare(query.sql).all(...query.params);

  // Convert rows to events and add to set
  return rows.map(rowToEvent);
}

/** Removes multiple events that match the given filters from the database */
export async function deleteEventsByFilters(db: Database, filters: Filter | Filter[]): Promise<number> {
  const whereClause = buildDeleteFiltersQuery(filters);
  if (!whereClause) return 0;

  return await db.transaction(async () => {
    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const deleteEventsQuery = `DELETE FROM events ${whereClause.sql}`;
    const result = await db.prepare(deleteEventsQuery).run(...whereClause.params);

    return result.changes;
  })();
}

/** Rebuild the search index for all events */
export async function rebuildSearchIndex(db: Database, searchContentFormatter: SearchContentFormatter): Promise<void> {
  try {
    // Clear the search table
    await db.exec("DELETE FROM events_search");

    // Get all events and rebuild the search index
    const events = await db.prepare("SELECT * FROM events").all();

    for (const eventRow of events) {
      const event = rowToEvent(eventRow as EventRow);
      const searchContent = searchContentFormatter(event);

      await db
        .prepare(INSERT_SEARCH_CONTENT_STATEMENT.sql)
        .run(event.id, searchContent, event.kind, event.pubkey, event.created_at);
    }
  } catch (error) {
    // Search table might not exist if search is disabled, throw a more descriptive error
    throw new Error("Search table does not exist. Make sure search is enabled when creating the database.");
  }
}
