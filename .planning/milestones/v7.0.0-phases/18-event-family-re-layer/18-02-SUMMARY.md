---
phase: 18-event-family-re-layer
plan: 02
subsystem: relay
tags: [rxjs, authentication, retry, timeout]
requires:
  - phase: 18-event-family-re-layer
    provides: one-attempt raw EVENT primitive
provides:
  - publish-owned authentication and retry policy
  - additive call-scoped auth and transient budgets
affects: [18-03, 18-04, sync]
tech-stack:
  added: []
  patterns: [shared call-scoped auth counter, typed refusal consumption]
key-files:
  created: []
  modified: [packages/relay/src/relay.ts, packages/relay/src/operators/auth-retry.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions:
  - "A publish-owned auth counter persists across outer transient retry resubscriptions to enforce the additive wire bound."
requirements-completed: [EVT-02, EVT-03, EVT-04]
coverage:
  - id: D1
    description: "Publish owns typed auth refusal handling, synchronous resend, transient retry, and whole-operation timeout policy."
    requirement: EVT-02
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/relay.test.ts#publish"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-08-20
status: complete
---

# Phase 18 Plan 02: Publish Policy Summary

**Publish now consumes typed raw refusals while retaining independent, additive auth and transient retry budgets.**

## Performance

- **Duration:** 7 min
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Moved EVENT auth consumption and resend above raw `event()` with a call-scoped `AuthPhaseGate`.
- Preserved synchronous handler resends through fresh raw listeners and existing ordered lifecycle logging.
- Made auth retry state survive outer transient retry subscriptions, proving the `1 + authRetries + retries` bound.

## Task Commits

1. **Task 1 implementation:** `3fbe0dc7` (landed as the blocking consumer migration in 18-01)
2. **Task 2 RED:** `6dc6907d`
3. **Task 2 GREEN:** `c2684cfc`

## Deviations from Plan

None - the Task 1 runtime move landed early as 18-01's required compilation fix and was verified again under this plan's focused gates.

## Issues Encountered

The first additive-budget probe exposed that RxJS outer retry recreated the auth operator's local counter; an explicit call-scoped counter fixed the reset without changing other request families.

## User Setup Required

None.

## Next Phase Readiness

Group, Pool, AUTH, and sync consumers can now be verified against the raw/high-level split.

## Self-Check: PASSED

The two relay suites pass 188 tests, the declaration build passes, and all listed commits exist.
