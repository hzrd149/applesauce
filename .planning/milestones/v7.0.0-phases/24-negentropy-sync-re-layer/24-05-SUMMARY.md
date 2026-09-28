---
phase: 24-negentropy-sync-re-layer
plan: 05
subsystem: loaders
tags: [sync-loader, fallback, auth-phase, sync-results]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 04
    provides: structured Relay/Group sync outcomes
provides:
  - Causally re-armed paginated fallback clock
  - Dependency-free structural sync result mirror
  - Receive-only loader result filtering
affects: [24-docs, loader-types, release-notes]
tech-stack:
  added: []
  patterns: [close-before-fallback-subscribe, structural cross-package union]
key-files:
  created: []
  modified: [packages/loaders/src/loaders/sync-loader.ts, packages/loaders/src/loaders/__tests__/sync-loader.test.ts]
key-decisions:
  - "Force-close auth phases synchronously before constructing the non-auth fallback stream."
  - "Mirror relay outcomes structurally without adding an applesauce-relay dependency."
patterns-established:
  - "Receive-only loader consumers narrow on type=received before store processing."
requirements-completed: [RESID-03, SYNC-04]
coverage:
  - id: D1
    description: "A non-auth sync failure closes its open auth phase before the fallback timeout starts."
    requirement: RESID-03
    verification:
      - kind: integration
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts#re-arms fallback timeout"
        status: pass
    human_judgment: false
  - id: D2
    description: "Loader emits only received.event from the structured sync union."
    requirement: SYNC-04
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-loaders test"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-loaders build"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 05: Sync Loader Fallback and Result Migration Summary

**Sync loader fallback now re-arms its stall clock before subscription and consumes only received events from the dependency-free structured result union.**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Closed the open-auth-phase fallback timer leak causally at the transition boundary.
- Preserved auth-family failure bypass and the existing terminal finalize cleanup.
- Added structural received/sent/send-failed/relay-failed representation and receive-only filtering.

## Task Commits

1. **Task 1 RED** - `0e06d040`
2. **Task 1 GREEN** - `6d973985`
3. **Task 2 RED** - `a13c596e`
4. **Task 2 GREEN** - `54ddc476`

## Decisions Made

- Kept a runtime legacy-event compatibility branch for injected test/custom methods while the exported structural method type requires the new union.

## Deviations from Plan

- Test file lives at the repository's established `src/loaders/__tests__` path rather than the plan's shortened `src/__tests__` path.

## Issues Encountered

- The loader factory parameter named `filter` shadows RxJS `filter`; the operator import was explicitly aliased to `rxFilter`.

## User Setup Required

None.

## Next Phase Readiness

- Loader behavior and types are ready for documentation and release migration.

## Self-Check: PASSED

- Focused fallback/auth-phase gate passes 4/4.
- Full loader suite passes 130/130.
- Loader build passes.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
