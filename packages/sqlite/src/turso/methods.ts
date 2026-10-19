import type { SyncPair } from "applesauce-core";
import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { buildDeleteFiltersQuery, buildFiltersQuery, rowToEvent } from "../helpers/sql.js";
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
  INSERT_EVENT_STATEMENT_WITH_IGNORE,
  INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE,
} from "../helpers/statements.js";

/** The query methods shared by Turso `Database` and `Transaction` handles */
export type TursoQueryable = {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: any[]): Promise<{ changes: number }>;
  get(sql: string, ...params: any[]): Promise<any>;
  all(sql: string, ...params: any[]): Promise<any[]>;
};

/** A Turso database from `@tursodatabase/database` or `@tursodatabase/database-wasm` */
export type TursoDatabase = TursoQueryable & {
  transactionAsync<F extends (tx: any) => Promise<any>>(fn: F): () => ReturnType<F>;
};

/** Create and migrate the `events` and `event_tags` tables */
export async function createTables(db: TursoQueryable): Promise<void> {
  // Turso does not enforce foreign keys by default, and event_tags relies on ON DELETE CASCADE
  await db.exec("PRAGMA foreign_keys = ON");

  await db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);
  await db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

  for (const indexStatement of CREATE_INDEXES_STATEMENTS) {
    await db.exec(indexStatement.sql);
  }
}

/** Inserts an event into the `events`, `event_tags` */
export async function insertEvent(db: TursoDatabase, event: NostrEvent): Promise<boolean> {
  const identifier = getReplaceableIdentifier(event);

  return await db.transactionAsync(async (tx: TursoQueryable) => {
    const result = await tx.run(
      INSERT_EVENT_STATEMENT_WITH_IGNORE.sql,
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
    if (result.changes === 0) return false;

    for (const tagString of getIndexableTags(event)) {
      // Split on the first ":" only, values like "a" addresses and "r" URLs contain colons
      const sep = tagString.indexOf(":");
      const name = tagString.slice(0, sep);
      const value = tagString.slice(sep + 1);
      if (name && value) await tx.run(INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE.sql, event.id, name, value);
    }

    return true;
  })();
}

/** Removes an event by id from the `events`, `event_tags` */
export async function deleteEvent(db: TursoQueryable, id: string): Promise<boolean> {
  // event_tags rows are removed by ON DELETE CASCADE
  const result = await db.run(DELETE_EVENT_STATEMENT.sql, id);
  return result.changes > 0;
}

/** Checks if an event exists */
export async function hasEvent(db: TursoQueryable, id: string): Promise<boolean> {
  const result = await db.get(HAS_EVENT_STATEMENT.sql, id);
  return !!result && result.count > 0;
}

/** Gets a single event from a database */
export async function getEvent(db: TursoQueryable, id: string): Promise<NostrEvent | undefined> {
  const row = await db.get(GET_EVENT_STATEMENT.sql, id);
  return row && rowToEvent(row as EventRow);
}

/** Gets the latest replaceable event from a database */
export async function getReplaceable(
  db: TursoQueryable,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | undefined> {
  const row = await db.get(GET_REPLACEABLE_STATEMENT.sql, kind, pubkey, identifier);
  return row && rowToEvent(row as EventRow);
}

/** Gets the history of a replaceable event from a database */
export async function getReplaceableHistory(
  db: TursoQueryable,
  kind: number,
  pubkey: string,
  identifier: string,
): Promise<NostrEvent[]> {
  const rows = await db.all(GET_REPLACEABLE_HISTORY_STATEMENT.sql, kind, pubkey, identifier);
  return rows.map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export async function hasReplaceable(
  db: TursoQueryable,
  kind: number,
  pubkey: string,
  identifier: string = "",
): Promise<boolean> {
  const result = await db.get(HAS_REPLACEABLE_STATEMENT.sql, kind, pubkey, identifier);
  return !!result && result.count > 0;
}

/** Get all events that match the filters */
export async function getEventsByFilters(db: TursoQueryable, filters: Filter | Filter[]): Promise<NostrEvent[]> {
  const query = buildFiltersQuery(filters);
  if (!query) return [];

  const rows = await db.all(query.sql, ...query.params);
  return rows.map(rowToEvent);
}

/** Removes multiple events that match the given filters from the database */
export async function deleteEventsByFilters(db: TursoQueryable, filters: Filter | Filter[]): Promise<number> {
  const whereClause = buildDeleteFiltersQuery(filters);
  if (!whereClause) return 0;

  // event_tags rows are removed by ON DELETE CASCADE
  const result = await db.run(`DELETE FROM events ${whereClause.sql}`, ...whereClause.params);
  return result.changes;
}

/** Gets matching sync pairs without reading full event rows */
export async function getSyncPairs(db: TursoQueryable, filters: Filter | Filter[]): Promise<SyncPair[]> {
  const query = buildFiltersQuery(filters, "sync-pairs");
  if (!query) return [];

  const rows = await db.all(query.sql, ...query.params);
  return rows.map((row) => ({ id: row.id as string, created_at: Number(row.created_at) }));
}
