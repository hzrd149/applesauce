---
phase: 24-negentropy-sync-re-layer
plan: 04
subsystem: relay
tags: [group, pool, sync, error-attribution]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 03
    provides: exact SyncMessage outcomes
provides:
  - Attributed GroupSyncMessage relay failures
  - Transparent Pool sync forwarding
  - Relay-only raw negentropy surface
affects: [24-loader-migration, relay-docs, relay-types]
tech-stack:
  added: []
  patterns: [per-relay error materialization, derived facade signatures]
key-files:
  created: []
  modified: [packages/relay/src/group.ts, packages/relay/src/pool.ts, packages/relay/src/types.ts, packages/relay/src/__tests__/group.test.ts, packages/relay/src/__tests__/pool.test.ts]
key-decisions:
  - "Support checks run per relay so one NIP-11 failure becomes one relay-failed value without blocking siblings."
  - "Pool delegates GroupSyncMessage objects unchanged and exposes no raw multi-relay negotiation."
patterns-established:
  - "Multi-relay terminal failures are values carrying normalized relay URL and original cause identity."
requirements-completed: [SYNC-04]
coverage:
  - id: D1
    description: "Group isolates and attributes support/sync failures while passing sibling values unchanged."
    requirement: SYNC-04
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts -t 'sync'"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pool forwards Group sync outcomes and Group/Pool raw negentropy methods are absent."
    requirement: SYNC-04
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts -t 'sync|negentropy'"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 04: Group and Pool Sync Attribution Summary

**Group and Pool now preserve honest sync results while materializing each failed relay as a normalized, cause-preserving value, with raw negotiation restricted to Relay.**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Isolated support-check and terminal sync failures at each relay boundary.
- Preserved successful sibling values and empty-group completion.
- Removed raw Group/Pool negentropy methods and their legacy option surface.

## Task Commits

1. **Task 1 RED** - `8cfd5786`
2. **Task 1 GREEN** - `8df8a1fe`
3. **Task 2 RED** - `6bef49a5`
4. **Task 2 GREEN** - `154d2bd5`

## Decisions Made

- Unsupported NIP-77 relays use the same attributed `relay-failed` path as support lookup and sync failures.
- Empty groups complete naturally through an empty `from(this.relays)` stream.

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered

- Removed the obsolete group auth-options test case for the deleted raw negentropy method.
- Concurrent commit `53ce67e3` remains preserved.

## User Setup Required

None.

## Next Phase Readiness

- Loader and docs consumers can exhaustively handle `received`, `sent`, `send-failed`, and `relay-failed`.

## Self-Check: PASSED

- Group sync gate passes 3/3.
- Combined Group/Pool sync and removal gate passes 7/7.
- Relay build passes.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
