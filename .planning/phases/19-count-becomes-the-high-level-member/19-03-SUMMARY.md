---
phase: 19-count-becomes-the-high-level-member
plan: 03
subsystem: documentation
tags: [exports, vitepress, changeset, nip45]
requires: [{ phase: 19-02, provides: completed COUNT runtime contract }]
provides: [public COUNT exports, Relay and Pool guidance, release metadata]
affects: [phase-23]
tech-stack: { added: [], patterns: [guarded HLL union without summing counts] }
key-files:
  created: [.changeset/relay-count-nip45.md]
  modified: [packages/relay/src/index.ts, packages/relay/src/__tests__/exports.test.ts, apps/docs/loading/relays/relays.md, apps/docs/loading/relays/pool.md]
key-decisions: [Keep progressive failure-isolated aggregation deferred to Phase 23]
requirements-completed: [COUNT-01, COUNT-02, COUNT-03]
duration: 5min
completed: 2026-08-21
status: complete
---
# Phase 19 Plan 03: Public COUNT Contract Summary

**Root-exported COUNT errors and HLL utilities with accurate Observable, timeout, and cross-relay guidance**

## Accomplishments
- Exported both COUNT errors plus HLL merge and estimate helpers while keeping the parser internal.
- Documented strict response validation, policy options, and guarded HLL unions.
- Added one exact single-sentence minor changeset.

## Task Commits
1. **Exports, documentation, and changeset** — `f5eeb5ed`

## Verification
- Root export snapshot passed.
- Full relay suite/build and VitePress docs build passed.

## Deviations from Plan
None - plan executed as written.

## Known Stubs
None.

## Self-Check: PASSED
