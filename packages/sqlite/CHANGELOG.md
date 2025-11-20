# applesauce-sqlite

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
