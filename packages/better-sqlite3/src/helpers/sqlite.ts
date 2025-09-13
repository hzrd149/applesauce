import { logger } from "applesauce-core";
import { Filter, getIndexableTags, getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers";
import { Database } from "better-sqlite3";

const log = logger.extend("sqlite:tables");

// SQL schema for Nostr events
export const CREATE_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  kind INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  sig TEXT NOT NULL,
  identifier TEXT NOT NULL DEFAULT ''
);
`;

// SQL schema for event tags (for efficient tag filtering)
export const CREATE_EVENT_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS event_tags (
  event_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_value TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, tag_name, tag_value)
);
`;

export const CREATE_INDEXES = [
  // Events table indexes
  `CREATE INDEX IF NOT EXISTS kind_idx ON events(kind);`,
  `CREATE INDEX IF NOT EXISTS pubkey_idx ON events(pubkey);`,
  `CREATE INDEX IF NOT EXISTS created_at_idx ON events(created_at);`,
  `CREATE INDEX IF NOT EXISTS identifier_idx ON events(identifier);`,

  // Event tags table indexes for efficient tag filtering
  `CREATE INDEX IF NOT EXISTS event_tags_event_id_idx ON event_tags(event_id);`,
  `CREATE INDEX IF NOT EXISTS event_tags_name_value_idx ON event_tags(tag_name, tag_value);`,
];

export type EventRow = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string;
  sig: string;
};

/** Create and migrate the `events` and `event_tags` tables */
export function createTables(db: Database): void {
  // Create the events table
  log("Creating events table");
  db.exec(CREATE_EVENTS_TABLE);

  // Create the event_tags table
  log("Creating event_tags table");
  db.exec(CREATE_EVENT_TAGS_TABLE);

  // Create indexes
  log("Creating indexes");
  CREATE_INDEXES.forEach((indexSql) => {
    db.exec(indexSql);
  });
}

/** Inserts an event into the `events` and `event_tags` tables of a database */
export function insertEvent(db: Database, event: NostrEvent): boolean {
  const identifier = getReplaceableIdentifier(event);

  return db.transaction(() => {
    // Insert/update the main event
    const stmt = db.prepare<[string, number, string, number, string, string, string, string]>(`
      INSERT OR REPLACE INTO events (id, kind, pubkey, created_at, content, tags, sig, identifier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

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

    return result.changes > 0;
  })();
}

/** Insert indexable tags for an event into the event_tags table */
export function insertEventTags(db: Database, event: NostrEvent): void {
  // Clear existing tags for this event first
  const deleteStmt = db.prepare<[string]>(`DELETE FROM event_tags WHERE event_id = ?`);
  deleteStmt.run(event.id);

  // Get only the indexable tags using applesauce-core helper
  const indexableTags = getIndexableTags(event);

  if (indexableTags && indexableTags.size > 0) {
    const insertStmt = db.prepare<[string, string, string]>(
      `INSERT OR IGNORE INTO event_tags (event_id, tag_name, tag_value) VALUES (?, ?, ?)`,
    );

    for (const tagString of indexableTags) {
      // Parse the "tagName:tagValue" format
      const [name, value] = tagString.split(":");
      if (name && value) insertStmt.run(event.id, name, value);
    }
  }
}

/** Removes an event by id from the `events` and `event_tags` tables of a database */
export function deleteEvent(db: Database, id: string): boolean {
  return db.transaction(() => {
    // Delete from event_tags first (foreign key constraint)
    const deleteTagsStmt = db.prepare<[string]>(`DELETE FROM event_tags WHERE event_id = ?`);
    deleteTagsStmt.run(id);

    // Delete from events table
    const deleteEventStmt = db.prepare<[string]>(`DELETE FROM events WHERE id = ?`);
    const result = deleteEventStmt.run(id);
    return result.changes > 0;
  })();
}

/** Checks if an event exists */
export function hasEvent(db: Database, id: string): boolean {
  const stmt = db.prepare<[string], { count: number }>(`SELECT COUNT(*) as count FROM events WHERE id = ?`);
  const result = stmt.get(id);
  if (!result) return false;
  return result.count > 0;
}

/** Gets a single event from a database */
export function getEvent(db: Database, id: string): NostrEvent | undefined {
  const stmt = db.prepare<[string], EventRow>(`SELECT * FROM events WHERE id = ?`);
  const row = stmt.get(id);
  return row && rowToEvent(row);
}

/** Gets the latest replaceable event from a database */
export function getReplaceable(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent | undefined {
  const stmt = db.prepare<[number, string, string], EventRow>(
    `SELECT * FROM events WHERE kind = ? AND pubkey = ? AND identifier = ? ORDER BY created_at DESC LIMIT 1`,
  );
  const row = stmt.get(kind, pubkey, identifier);
  return row && rowToEvent(row);
}

/** Gets the history of a replaceable event from a database */
export function getReplaceableHistory(db: Database, kind: number, pubkey: string, identifier: string): NostrEvent[] {
  const stmt = db.prepare<[number, string, string], EventRow>(
    `SELECT * FROM events WHERE kind = ? AND pubkey = ? AND identifier = ? ORDER BY created_at DESC`,
  );
  return stmt.all(kind, pubkey, identifier).map(rowToEvent);
}

/** Checks if a replaceable event exists in a database */
export function hasReplaceable(db: Database, kind: number, pubkey: string, identifier: string = ""): boolean {
  const stmt = db.prepare<[number, string, string], { count: number }>(
    `SELECT COUNT(*) as count FROM events WHERE kind = ? AND pubkey = ? AND identifier = ?`,
  );
  const result = stmt.get(kind, pubkey, identifier);
  if (!result) return false;
  return result.count > 0;
}

/** Convert database row to NostrEvent */
export function rowToEvent(row: EventRow): NostrEvent {
  return {
    id: row.id,
    kind: row.kind,
    pubkey: row.pubkey,
    created_at: row.created_at,
    content: row.content,
    tags: JSON.parse(row.tags || "[]"),
    sig: row.sig,
  };
}

/** Builds conditions for a single filter */
export function buildFilterConditions(filter: Filter): {
  conditions: string[];
  params: any[];
} {
  const conditions: string[] = [];
  const params: any[] = [];

  // Handle IDs filter
  if (filter.ids && filter.ids.length > 0) {
    const placeholders = filter.ids.map(() => `?`).join(", ");
    conditions.push(`id IN (${placeholders})`);
    params.push(...filter.ids);
  }

  // Handle kinds filter
  if (filter.kinds && filter.kinds.length > 0) {
    const placeholders = filter.kinds.map(() => `?`).join(", ");
    conditions.push(`kind IN (${placeholders})`);
    params.push(...filter.kinds);
  }

  // Handle authors filter (pubkeys)
  if (filter.authors && filter.authors.length > 0) {
    const placeholders = filter.authors.map(() => `?`).join(", ");
    conditions.push(`pubkey IN (${placeholders})`);
    params.push(...filter.authors);
  }

  // Handle since filter (timestamp >= since)
  if (filter.since !== undefined) {
    conditions.push(`created_at >= ?`);
    params.push(filter.since);
  }

  // Handle until filter (timestamp <= until)
  if (filter.until !== undefined) {
    conditions.push(`created_at <= ?`);
    params.push(filter.until);
  }

  // Handle tag filters (e.g., #e, #p, #t, #d, etc.)
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && values && Array.isArray(values) && values.length > 0) {
      const tagName = key.slice(1); // Remove the '#' prefix

      // Use the event_tags table for efficient tag filtering
      const placeholders = values.map(() => "?").join(", ");
      conditions.push(`id IN (
        SELECT DISTINCT event_id
        FROM event_tags
        WHERE tag_name = ? AND tag_value IN (${placeholders})
      )`);

      // Add parameters: tagName first, then all the tag values
      params.push(tagName, ...values);
    }
  }

  return { conditions, params };
}

export function buildFiltersQuery(filters: Filter | Filter[]): {
  sql: string;
  params: any[];
} | null {
  const filterArray = Array.isArray(filters) ? filters : [filters];
  if (filterArray.length === 0) return null;

  // Build queries for each filter (OR logic between filters)
  const filterQueries: string[] = [];
  const allParams: any[] = [];
  let globalLimit: number | undefined;

  for (const filter of filterArray) {
    const { conditions, params } = buildFilterConditions(filter);

    if (conditions.length === 0) {
      // If no conditions, this filter matches all events
      filterQueries.push("1=1");
    } else {
      // AND logic within a single filter
      filterQueries.push(`(${conditions.join(" AND ")})`);
    }

    allParams.push(...params);

    // Track the most restrictive limit across all filters
    if (filter.limit !== undefined) {
      globalLimit = globalLimit === undefined ? filter.limit : Math.min(globalLimit, filter.limit);
    }
  }

  // Combine all filter conditions with OR logic
  const whereClause = filterQueries.length > 0 ? `WHERE ${filterQueries.join(" OR ")}` : "";

  // Build the final query with proper ordering and limit
  let query = `
      SELECT DISTINCT * FROM events
      ${whereClause}
      ORDER BY created_at DESC, id ASC
    `;

  // Apply global limit if specified
  if (globalLimit !== undefined && globalLimit > 0) {
    query += ` LIMIT ?`;
    allParams.push(globalLimit);
  }

  return { sql: query, params: allParams };
}

/** Get all events that match the filters */
export function getEventsByFilters(db: Database, filters: Filter | Filter[]): Set<NostrEvent> {
  const query = buildFiltersQuery(filters);
  if (!query) return new Set();

  const eventSet = new Set<NostrEvent>();

  const stmt = db.prepare<any[], EventRow>(query.sql);
  const rows = stmt.all(...query.params);

  // Convert rows to events and add to set
  for (const row of rows) eventSet.add(rowToEvent(row));

  return eventSet;
}
