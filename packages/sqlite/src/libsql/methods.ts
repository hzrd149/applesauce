import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { Client, Transaction } from "@libsql/client";
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
export async function createTables(db: Client, search: boolean = true): Promise<void> {
  // Create the events table
  await db.execute(CREATE_EVENTS_TABLE_STATEMENT.sql);

  // Create the event_tags table
  await db.execute(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  // Create the FTS5 search table
  if (search) {
    await db.execute(CREATE_SEARCH_TABLE_STATEMENT.sql);
  }

  // Create indexes
  for (const indexStatement of CREATE_INDEXES_STATEMENTS) {
    await db.execute(indexStatement.sql);
  }
}

/** Inserts search content for an event */
export async function insertSearchContent(
  db: Client | Transaction,
  event: NostrEvent,
  contentFormatter: SearchContentFormatter,
): Promise<void> {
  const searchableContent = contentFormatter(event);

  // Insert/update directly into the FTS5 table
  await db.execute({
    sql: INSERT_SEARCH_CONTENT_STATEMENT.sql,
    args: [event.id, searchableContent, event.kind, event.pubkey, event.created_at],
  });
}

/** Removes search content for an event */
export async function deleteSearchContent(db: Client | Transaction, eventId: string): Promise<void> {
  await db.execute({
    sql: DELETE_SEARCH_CONTENT_STATEMENT.sql,
    args: [eventId],
  });
}

/** Inserts an event into the `events`, `event_tags`, and search tables of a database */
export async function insertEvent(
  db: Client,
  event: NostrEvent,
  contentFormatter?: SearchContentFormatter,
): Promise<boolean> {
  const identifier = getReplaceableIdentifier(event);

  const transaction = await db.transaction();
  try {
    // Check if event already exists
    const existsResult = await transaction.execute({
      sql: HAS_EVENT_STATEMENT.sql,
      args: [event.id],
    });

    if (existsResult.rows[0] && (existsResult.rows[0][0] as number) > 0) {
      await transaction.rollback();
      return false; // Event already exists, skip insertion
    }

    // Insert the event
    const result = await transaction.execute({
      sql: INSERT_EVENT_STATEMENT.sql,
      args: [
        event.id,
        event.kind,
        event.pubkey,
        event.created_at,
        event.content,
        JSON.stringify(event.tags),
        event.sig,
        identifier,
      ],
    });

    // Insert indexable tags into the event_tags table
    const indexableTags = getIndexableTags(event);
    if (indexableTags && indexableTags.size > 0) {
      for (const tagString of indexableTags) {
        // Parse the "tagName:tagValue" format
        const [name, value] = tagString.split(":");
        if (name && value) {
          await db.execute({
            sql: INSERT_EVENT_TAG_STATEMENT.sql,
            args: [event.id, name, value],
          });
        }
      }
    }

    // Insert searchable content into the search tables
    if (contentFormatter) {
      try {
        await insertSearchContent(transaction, event, contentFormatter);
      } catch (error) {
        // Search table might not exist if search is disabled, ignore the error
      }
    }

    await transaction.commit();
    return result.rowsAffected > 0;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/** Removes an event by id from the `events`, `event_tags`, and search tables of a database */
export async function deleteEvent(db: Client, id: string): Promise<boolean> {
  const transaction = await db.transaction();
  try {
    // Delete from search tables if they exist
    try {
      await deleteSearchContent(transaction, id);
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const result = await transaction.execute({
      sql: DELETE_EVENT_STATEMENT.sql,
      args: [id],
    });
    await transaction.commit();
    return result.rowsAffected > 0;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/** Checks if an event exists */
export async function hasEvent(db: Client, id: string): Promise<boolean> {
  const result = await db.execute({
    sql: HAS_EVENT_STATEMENT.sql,
    args: [id],
  });
  if (!result.rows[0]) return false;
  return (result.rows[0][0] as number) > 0;
}

/** Gets a single event from a database */
export async function getEvent(db: Client, id: string): Promise<NostrEvent | undefined> {
  const result = await db.execute({
    sql: GET_EVENT_STATEMENT.sql,
    args: [id],
  });
  const row = result.rows[0];
  return (
    row &&
    rowToEvent({
      id: row[0] as string,
      kind: row[1] as number,
      pubkey: row[2] as string,
      created_at: row[3] as number,
      content: row[4] as string,
      tags: row[5] as string,
      sig: row[6] as string,
    })
  );
}

/** Gets the latest replaceable event from a database */
export async function getReplaceable(
  db: Client,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | undefined> {
  const result = await db.execute({
    sql: GET_REPLACEABLE_STATEMENT.sql,
    args: [kind, pubkey, identifier],
  });
  const row = result.rows[0];
  return (
    row &&
    rowToEvent({
      id: row[0] as string,
      kind: row[1] as number,
      pubkey: row[2] as string,
      created_at: row[3] as number,
      content: row[4] as string,
      tags: row[5] as string,
      sig: row[6] as string,
    })
  );
}

/** Gets the history of a replaceable event from a database */
export async function getReplaceableHistory(
  db: Client,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent[]> {
  const result = await db.execute({
    sql: GET_REPLACEABLE_HISTORY_STATEMENT.sql,
    args: [kind, pubkey, identifier],
  });
  return result.rows.map((row) =>
    rowToEvent({
      id: row[0] as string,
      kind: row[1] as number,
      pubkey: row[2] as string,
      created_at: row[3] as number,
      content: row[4] as string,
      tags: row[5] as string,
      sig: row[6] as string,
    }),
  );
}

/** Checks if a replaceable event exists in a database */
export async function hasReplaceable(
  db: Client,
  kind: number,
  pubkey: string,
  identifier: string = "",
): Promise<boolean> {
  const result = await db.execute({
    sql: HAS_REPLACEABLE_STATEMENT.sql,
    args: [kind, pubkey, identifier],
  });
  if (!result.rows[0]) return false;
  return (result.rows[0][0] as number) > 0;
}

/** Get all events that match the filters (includes NIP-50 search support) */
export async function getEventsByFilters(
  db: Client,
  filters: FilterWithSearch | FilterWithSearch[],
): Promise<NostrEvent[]> {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const events: NostrEvent[] = [];

  const result = await db.execute({
    sql: query.sql,
    args: query.params,
  });

  // Convert rows to events and add to set
  for (const row of result.rows) {
    events.push(
      rowToEvent({
        id: row[0] as string,
        kind: row[1] as number,
        pubkey: row[2] as string,
        created_at: row[3] as number,
        content: row[4] as string,
        tags: row[5] as string,
        sig: row[6] as string,
      }),
    );
  }

  return events;
}

/** Search events using FTS5 full-text search (convenience wrapper around getEventsByFilters) */
export async function searchEvents(db: Client, search: string, options?: Filter): Promise<NostrEvent[]> {
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
export async function rebuildSearchIndex(db: Client, contentFormatter: SearchContentFormatter): Promise<void> {
  const transaction = await db.transaction();
  try {
    // Clear existing search data
    await transaction.execute(`DELETE FROM events_search;`);

    // Rebuild from all events
    const result = await transaction.execute(GET_ALL_EVENTS_STATEMENT.sql);
    const events = result.rows.map((row) =>
      rowToEvent({
        id: row[0] as string,
        kind: row[1] as number,
        pubkey: row[2] as string,
        created_at: row[3] as number,
        content: row[4] as string,
        tags: row[5] as string,
        sig: row[6] as string,
      }),
    );

    for (const event of events) {
      await insertSearchContent(transaction, event, contentFormatter);
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/** Removes multiple events that match the given filters from the database */
export async function deleteEventsByFilters(
  db: Client,
  filters: FilterWithSearch | FilterWithSearch[],
): Promise<number> {
  const whereClause = buildDeleteFiltersQuery(filters);
  if (!whereClause) return 0;

  const transaction = await db.transaction();
  try {
    // Delete from search tables if they exist
    try {
      const searchDeleteQuery = `DELETE FROM search_content WHERE event_id IN (SELECT id FROM events ${whereClause.sql})`;
      await transaction.execute({
        sql: searchDeleteQuery,
        args: whereClause.params,
      });
    } catch (error) {
      // Search table might not exist if search is disabled, ignore the error
    }

    // Delete from events table - this will CASCADE to event_tags automatically!
    // The foreign key constraint: FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    // ensures that all related event_tags records are deleted automatically
    const deleteEventsQuery = `DELETE FROM events ${whereClause.sql}`;
    const result = await transaction.execute({
      sql: deleteEventsQuery,
      args: whereClause.params,
    });

    await transaction.commit();
    return result.rowsAffected;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
