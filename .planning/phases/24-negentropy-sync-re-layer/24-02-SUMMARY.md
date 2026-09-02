---
phase: 24-negentropy-sync-re-layer
plan: 02
subsystem: relay
tags: [sync, reconnect, nip-42, cancellation]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 01
    provides: raw multi-round negentropy Observable
provides:
  - Fresh positively classified sync reconnect attempts
  - One call-scoped auth budget across NEG, EVENT, and REQ
  - Caller-owned sync cancellation without a built-in timeout
affects: [24-sync-scheduler, relay-group-sync]
tech-stack:
  added: []
  patterns: [fresh defer per reconnect, shared auth gate and counter, AbortSignal takeUntil]
key-files:
  created: []
  modified: [packages/relay/src/relay.ts, packages/relay/src/types.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions:
  - "Reconnect wraps the complete authenticated negotiation attempt and mints a new ID on each allowed retry."
  - "Sync passes a false progress predicate to the shared auth operator so unrelated progress never replenishes the global budget."
patterns-established:
  - "All sync wire verbs consume one call-scoped AuthPhaseGate and counter."
requirements-completed: [SYNC-02, SYNC-03]
coverage:
  - id: D1
    description: "Unclean transport reconnect creates a fresh negotiation ID while verdict failures do not retry."
    requirement: SYNC-03
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t 'sync.*reconnect|reconnect.*sync'"
        status: pass
    human_judgment: false
  - id: D2
    description: "NEG, EVENT, and REQ share one auth budget and caller cancellation tears down active work."
    requirement: SYNC-02
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t 'sync.*auth|auth.*sync|sync.*cancel'"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 02: Sync Policy Coordinator Summary

**High-level sync now retries only unclean transport failures with fresh negotiation state and shares one non-resetting authentication budget across every wire verb.**

## Performance

- **Duration:** 7 min
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added fresh negotiation IDs and state construction for each positively classified reconnect.
- Centralized NEG, EVENT, and REQ authentication under one call-scoped gate and retry counter.
- Added positive reconnect/concurrency/signal options with no sync timeout and deterministic caller cancellation.

## Task Commits

1. **Task 1 RED** - `8d9d48b4`
2. **Task 1 GREEN** - `8f63192c`
3. **Task 2 RED** - `8e44a61c`
4. **Task 2 GREEN** - `086633ba`

## Decisions Made

- Auth progress never resets the sync-wide counter; the configured budget is total across branches.
- Raw EVENT and REQ attempts are composed directly so nested high-level policy owners cannot multiply the budget.

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered

- Legacy raw-negentropy auth test names matched the new sync-focused gate; their suite label was corrected and sync transfer tests were updated to tolerate the required NEG-CLOSE ordering.

## User Setup Required

None.

## Next Phase Readiness

- The shared coordinator and fresh attempt boundary are ready for the bounded fair transfer scheduler.

## Self-Check: PASSED

- Focused reconnect tests pass 2/2.
- Focused auth/cancel tests pass 8/8.
- Relay TypeScript build passes.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
