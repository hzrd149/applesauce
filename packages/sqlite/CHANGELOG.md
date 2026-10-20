# applesauce-sqlite

## 7.0.0

### Major Changes

- 8b951fe: Remove the unsupported `search` option and `rebuildSearchIndex` method from `TursoEventDatabase`
- 8b951fe: Require `@tursodatabase/database` and `@tursodatabase/database-wasm` 0.8 or later for the Turso databases

### Minor Changes

- 751d67a: Add metadata-only `getSyncPairs` queries to every SQLite driver

### Patch Changes

- 51248e2: Send each libsql event insert to the database in a single batch instead of one request per tag
- f39ab99: Reuse fixed prepared statements per connection in the native and better-sqlite3 database drivers
- 4abef3e: Replace the single column SQLite indexes with composite indexes for timeline, author and replaceable event queries
- 4abef3e: Speed up SQLite filter queries by skipping needless DISTINCT sorting and looking up tagged events first
- c16bdb4: Fix `removeByFilters` leaving search index entries behind for removed events
- f961e73: Mark every supported SQLite backend peer as optional for consumer installs.
- 03a4974: Fix the SQLite relay server sending each new event to subscribers twice and re-sending duplicate events
- c6b6376: Fix the SQLite relay server dropping a client's subscription when another client opens one with the same subscription id
- e3b765c: Reuse prepared filter queries in the better-sqlite3 and node:sqlite databases
- 2aea015: Fix SQLite databases truncating tag values that contain colons, which broke `#a` and URL tag filters
- 8b951fe: Fix Turso databases leaving tag index rows behind when events are removed
- 8b951fe: Fix Turso databases not indexing event tags, which made tag filters return every event
- Updated dependencies
  - applesauce-core@7.0.0

## 6.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@6.0.0

## 5.2.0

### Patch Changes

- 11ad823: Fix UNIQUE constraint on event_tags
- Updated dependencies
  - applesauce-core@5.2.0

## 5.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@5.0.0

## 4.4.0

### Minor Changes

- aa75748: Add support for NIP-91 AND tag filters

### Patch Changes

- Updated dependencies
  - applesauce-core@4.4.0

## 4.1.0

### Minor Changes

- 0fdf56a: Add `@tursodatabase/database` implementation
- 2f2d3e3: Add Turso WASM using `@tursodatabase/database-wasm`
- 2f2d3e3: Add `removeByFilters` to all database implementations
- 58cc8a2: Add experimental Turso WASM to `applesauce-sqlite`
- 2f2d3e3: Optimize delete event sql

### Patch Changes

- Updated dependencies
  - applesauce-core@4.1.0

## 4.0.0

### Minor Changes

- 3d9e03b: Add `BetterSqlite3EventDatabase` for `better-sqlite3`
- f8fd5ec: Bump `nostr-tools` to `2.17`
- 3d9e03b: Add `BunSqliteEventDatabase` for bun sqlite
- 3d9e03b: Add `NativeSqliteEventDatabase` for native deno and nodejs sqlite
- 3d9e03b: Add `LibsqlEventDatabase` for `@libsql/client`

### Patch Changes

- Updated dependencies
  - applesauce-core@4.0.0
