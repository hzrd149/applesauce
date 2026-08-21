---
phase: 19-count-becomes-the-high-level-member
plan: 01
subsystem: relay
tags: [nip45, hll, validation]
requires: [{ phase: 18, provides: event-family layering patterns }]
provides: [strict COUNT response parsing, HLL merge and cardinality estimation]
affects: [19-02, 19-03, phase-23]
tech-stack: { added: [], patterns: [prototype-safe forward-compatible protocol parsing] }
key-files:
  created: [packages/relay/src/nip45.ts, packages/relay/src/__tests__/nip45.test.ts]
  modified: [packages/relay/src/types.ts, packages/relay/src/relay.ts]
key-decisions: [Use one shared HLL decoder for parsing merge and estimation]
requirements-completed: [COUNT-02, COUNT-03]
duration: 12min
completed: 2026-08-21
status: complete
---
# Phase 19 Plan 01: Strict NIP-45 COUNT Data Path Summary

**Prototype-safe COUNT validation with fixed 256-register HLL merge and independently checked estimation**

## Accomplishments
- Validated strict known fields while preserving unknown own enumerable fields.
- Added non-mutating lowercase HLL max-merge and cardinality estimation.
- Replaced unchecked wire casts and made non-auth CLOSED failures typed.

## Task Commits
1. **Validated response and HLL utilities** — `7fb16e47`

## Verification
- `pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts src/__tests__/relay.test.ts -t 'NIP-45|count|COUNT'` — passed.
- `pnpm --filter applesauce-relay build` — passed.

## Deviations from Plan
Task commits were consolidated with Plan 19-02's tightly coupled COUNT policy edits because both plans modify the same method and test region; behavior remains independently verified.

## Known Stubs
None.

## Self-Check: PASSED
