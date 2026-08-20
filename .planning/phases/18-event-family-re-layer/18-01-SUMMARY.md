---
phase: 18-event-family-re-layer
plan: 01
subsystem: relay
tags: [rxjs, websocket, event, errors]
requires:
  - phase: 16-method-layering-foundation-typescript-7
    provides: high/low relay method layering
provides:
  - readiness-aware one-attempt raw EVENT/AUTH interaction
  - typed relay-verdict and fixed reply-timeout errors
affects: [18-02, 18-03, sync, relay-group]
tech-stack:
  added: []
  patterns: [fresh defer per wire attempt, protocol verdict values vs client errors]
key-files:
  created: []
  modified: [packages/relay/src/relay.ts, packages/relay/src/types.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions:
  - "Raw event() owns readiness and exactly one write/reply interaction; publish() consumes its typed failures."
requirements-completed: [EVT-01, EVT-03]
coverage:
  - id: D1
    description: "Raw EVENT/AUTH performs one readiness-aware attempt with typed verdict and timeout boundaries."
    requirement: EVT-01
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/relay.test.ts#event"
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-08-20
status: complete
---

# Phase 18 Plan 01: Raw EVENT Tracer Summary

**Readiness-aware single EVENT/AUTH writes now distinguish genuine relay verdicts from typed client timeout failures.**

## Performance

- **Duration:** 12 min
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Narrowed `event()` to a fresh, one-attempt raw interaction with no policy options.
- Added `RelayEventVerdictError` and `RelayEventTimeoutError` at the protocol/client boundary.
- Preserved clean completion, matching-OK filtering, AUTH verdict values, and readiness behavior.

## Task Commits

1. **Task 1 RED:** `60c5b51d`
2. **Task 1 GREEN:** `97e4aee3`
3. **Task 2:** `3fbe0dc7`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Kept direct consumers compiling after raw signature narrowing**
- **Found during:** Task 2 declaration build
- **Issue:** Group, Pool, publish, and sync still forwarded the removed policy argument.
- **Fix:** Narrowed Group/Pool forwarding, moved publish auth consumption above `event()`, and routed sync SEND through publish as already required by later Phase 18 plans.
- **Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/pool.ts`, `packages/relay/src/relay.ts`
- **Verification:** Relay test suite and TypeScript build pass.
- **Committed in:** `3fbe0dc7`

## Issues Encountered

Legacy tests asserted manufactured timeout responses and auth policy on raw `event()`; they were updated to the accepted Phase 18 contract.

## User Setup Required

None.

## Next Phase Readiness

The raw primitive is ready for Plan 02's bounded high-level publish policy tests and classifier refinement.

## Self-Check: PASSED

All modified files exist, all three task commits exist, and the focused relay suite plus declaration build pass.
