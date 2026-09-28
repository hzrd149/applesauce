---
phase: 24-negentropy-sync-re-layer
plan: 01
subsystem: relay
tags: [nip-77, negentropy, rxjs, protocol]
requires:
  - phase: 22-req-family-re-layer
    provides: readiness-aware raw relay interaction patterns
provides:
  - Multi-round raw NIP-77 Observable negotiation
  - Positive NegentropyOptions and NegentropyRound public types
  - Deterministic abort, error, and exact-close behavior
affects: [24-sync-scheduler, relay-group-sync, relay-pool-sync]
tech-stack:
  added: []
  patterns: [serial concatMap protocol decoding, wire-before-emission, cold shared interaction]
key-files:
  created: [packages/relay/src/__tests__/negentropy.test.ts]
  modified: [packages/relay/src/negentropy.ts, packages/relay/src/relay.ts, packages/relay/src/types.ts, packages/relay/src/group.ts, packages/relay/src/pool.ts]
key-decisions:
  - "Serialize reconciliation with concatMap and write each follow-up before synchronously notifying subscribers."
  - "Keep group and pool compatibility adapters private while removing legacy raw type exports."
patterns-established:
  - "Raw NIP-77 emits every decoded round and uses Observable completion/error for lifecycle."
requirements-completed: [SYNC-01, SYNC-02]
coverage:
  - id: D1
    description: "A genuine multi-round NIP-77 exchange writes follow-ups before emitting rounds and closes exactly once."
    requirement: SYNC-01
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/negentropy.test.ts#drives a genuine multi-round negotiation"
        status: pass
    human_judgment: false
  - id: D2
    description: "Raw negotiation shares one execution and handles errors and abort without fabricated values."
    requirement: SYNC-02
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/negentropy.test.ts"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build"
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 01: Raw Multi-Round Negentropy Summary

**Cold shared NIP-77 negotiation now serializes real multi-round reconciliation, advances the wire before subscriber work, and terminates with deterministic cancellation and one close frame.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-02T16:09:00Z
- **Completed:** 2026-09-02T16:19:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Replaced the callback/Promise loop with a shared `Observable<NegentropyRound>`.
- Proved genuine multi-round exchange using two real Negentropy state machines and more than 32 items.
- Added positive raw options plus exact unknown-error, abort, terminal-round, and close-cardinality coverage.

## Task Commits

1. **Task 1 RED: Multi-round tracer** - `a2274715`
2. **Task 1 GREEN: Streaming protocol** - `141e59f6`
3. **Task 2: Error and cancellation coverage** - `b6445c2d`
4. **Task 2 cleanup: Remove legacy raw types** - `98504aba`

## Files Created/Modified

- `packages/relay/src/__tests__/negentropy.test.ts` - Real protocol, sharing, error, and cancellation tests.
- `packages/relay/src/negentropy.ts` - Serial Observable protocol engine.
- `packages/relay/src/relay.ts` - Readiness-aware public raw interaction and temporary sync adapter.
- `packages/relay/src/types.ts` - Positive raw public contracts.
- `packages/relay/src/group.ts` - Private compatibility adapter for the later coordinated removal.
- `packages/relay/src/pool.ts` - Derived compatibility signature without legacy raw exports.

## Decisions Made

- `concatMap` is the serialization boundary; the follow-up socket write occurs inside it before the round is emitted.
- Group/Pool compatibility remains private until their planned removal, so the relay package builds between coordinated plans without preserving the removed raw types.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted Group and Pool to the new Relay signature**
- **Found during:** Task 1 build verification
- **Issue:** Existing compatibility methods still compiled against the removed callback signature and legacy types.
- **Fix:** Adapted Group internally to consume rounds and made Pool derive its signature from Group.
- **Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/pool.ts`
- **Verification:** Relay package build passes.
- **Committed in:** `141e59f6`, `98504aba`

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Compatibility only; no new public raw policy was introduced.

## Issues Encountered

- The first test fixture used a frame limit below the library's 4096-byte minimum; it was corrected before recording the behavior-valid RED gate.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- High-level sync can now consume rounds without delaying protocol progress.
- Group and Pool raw compatibility methods remain scheduled for coordinated removal in Plan 24-04.

## Self-Check: PASSED

- All listed files exist.
- All four task commits exist.
- Focused Vitest suite passes 4/4 and the relay TypeScript build passes.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
