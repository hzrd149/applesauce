/**
 * Generic SQL Statement type that defines a statement with its expected parameters
 * This allows database implementations to import these and infer the parameter types
 */
export type Statement<TParams extends readonly unknown[] = any[], TResult = any> = {
  /** The SQL query string */
  sql: string;
  /** Type information for parameters (not used at runtime, just for type inference) */
  _params?: TParams;
  /** Type information for result (not used at runtime, just for type inference) */
  _result?: TResult;
};

/**
 * Helper type to extract parameter types from a Statement
 */
export type StatementParams<T> = T extends Statement<infer P, any> ? P : never;

/**
 * Helper type to extract result type from a Statement
 */
export type StatementResult<T> = T extends Statement<any, infer R> ? R : never;

/** Types for the `events` table */
export type EventRow = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string;
  sig: string;
};

// Event-related statements
export const INSERT_EVENT_STATEMENT: Statement<[string, number, string, number, string, string, string, string]> = {
  sql: `INSERT OR REPLACE INTO events (id, kind, pubkey, created_at, content, tags, sig, identifier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
};

export const DELETE_EVENT_TAGS_STATEMENT: Statement<[string]> = {
  sql: `DELETE FROM event_tags WHERE event_id = ?`,
};

export const INSERT_EVENT_TAG_STATEMENT: Statement<[string, string, string]> = {
  sql: `INSERT OR IGNORE INTO event_tags (event_id, tag_name, tag_value) VALUES (?, ?, ?)`,
};

export const DELETE_EVENT_STATEMENT: Statement<[string]> = {
  sql: `DELETE FROM events WHERE id = ?`,
};

export const HAS_EVENT_STATEMENT: Statement<[string], { count: number }> = {
  sql: `SELECT COUNT(*) as count FROM events WHERE id = ?`,
};

export const GET_EVENT_STATEMENT: Statement<[string], EventRow> = {
  sql: `SELECT * FROM events WHERE id = ?`,
};

export const GET_REPLACEABLE_STATEMENT: Statement<[number, string, string], EventRow> = {
  sql: `SELECT * FROM events WHERE kind = ? AND pubkey = ? AND identifier = ? ORDER BY created_at DESC LIMIT 1`,
};

export const GET_REPLACEABLE_HISTORY_STATEMENT: Statement<[number, string, string], EventRow> = {
  sql: `SELECT * FROM events WHERE kind = ? AND pubkey = ? AND identifier = ? ORDER BY created_at DESC`,
};

export const HAS_REPLACEABLE_STATEMENT: Statement<[number, string, string], { count: number }> = {
  sql: `SELECT COUNT(*) as count FROM events WHERE kind = ? AND pubkey = ? AND identifier = ?`,
};

export const GET_ALL_EVENTS_STATEMENT: Statement<[], EventRow> = {
  sql: `SELECT * FROM events`,
};

// SQL schema setup statements
export const CREATE_EVENTS_TABLE_STATEMENT: Statement<[]> = {
  sql: `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    kind INTEGER NOT NULL,
    pubkey TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    content TEXT NOT NULL,
    tags TEXT,
    sig TEXT NOT NULL,
    identifier TEXT NOT NULL DEFAULT ''
  )`,
};

export const CREATE_EVENT_TAGS_TABLE_STATEMENT: Statement<[]> = {
  sql: `CREATE TABLE IF NOT EXISTS event_tags (
    event_id TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, tag_name, tag_value)
  )`,
};

// Index creation statements
export const CREATE_INDEXES_STATEMENTS: Statement<[]>[] = [
  // Events table indexes
  { sql: `CREATE INDEX IF NOT EXISTS kind_idx ON events(kind)` },
  { sql: `CREATE INDEX IF NOT EXISTS pubkey_idx ON events(pubkey)` },
  { sql: `CREATE INDEX IF NOT EXISTS created_at_idx ON events(created_at)` },
  { sql: `CREATE INDEX IF NOT EXISTS identifier_idx ON events(identifier)` },

  // Event tags table indexes for efficient tag filtering
  { sql: `CREATE INDEX IF NOT EXISTS event_tags_event_id_idx ON event_tags(event_id)` },
  { sql: `CREATE INDEX IF NOT EXISTS event_tags_name_value_idx ON event_tags(tag_name, tag_value)` },
];
