---
phase: 17-correctness-fixes-concord-residuals
plan: 02
subsystem: sqlite
tags: [packaging, peer-dependencies, npm, sqlite]
requires: [16-method-layering-foundation-typescript-7]
provides: [optional SQLite backend peers, packed one-backend consumer verification]
affects: [applesauce-sqlite consumer installation]
tech-stack: { added: [], patterns: [packed-artifact consumer smoke test] }
key-files:
  created: [packages/sqlite/scripts/verify-optional-peers.mjs, .changeset/sqlite-optional-backends.md]
  modified: [packages/sqlite/package.json]
decisions: ["Keep all four SQLite backends as range-preserving optional peers and verify the published tarball in an isolated npm consumer."]
metrics: { duration: 4m, tasks: 2, files: 3, completed: 2026-08-20 }
status: complete
---
# Phase 17 Plan 02: Optional SQLite Backend Peers Summary

All four SQLite drivers remain declared at their existing peer ranges while packed consumers can install and import one chosen backend without receiving requirements for the other three.

## Verification

- `pnpm --filter applesauce-sqlite build && node packages/sqlite/scripts/verify-optional-peers.mjs`: passed twice, including exact source/tarball metadata comparison and an isolated `better-sqlite3` consumer import.
- The smoke consumer confirmed `@libsql/client`, `@tursodatabase/database`, and `@tursodatabase/database-wasm` were not installed.
- `pnpm --filter applesauce-sqlite test`: 63 tests passed and 2 existing tests skipped across 11 files.
- `pnpm --filter applesauce-sqlite build`: passed after the package suite.
- Changeset shape gate confirmed one patch-scoped Markdown sentence.

## Checkpoints

- The mandatory tracer feedback gate was approved after commit `b6351ce5` demonstrated the packed one-backend consumer flow.

## Decisions Made

- Kept every backend in `peerDependencies` and mirrored the exact four-key set in `peerDependenciesMeta`; no backend export or range changed.
- Used a disposable `mkdtemp` directory and removed only that explicit directory in `finally` after packing and consumer installation.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- All three planned artifacts exist.
- Commits `b6351ce5` and `f961e73b` exist in history.
- All task acceptance criteria and plan-level verification gates pass.
