---
phase: 24-negentropy-sync-re-layer
plan: 03
subsystem: relay
tags: [scheduler, sync, rxjs, outcomes]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 02
    provides: fresh reconnect and shared auth coordination
provides:
  - Fair two-lane concurrency-four transfer scheduler
  - Exact SyncMessage transfer outcomes
  - Empty-EOSE success and post-store received emission
affects: [24-group-sync, 24-loader-migration, relay-docs]
tech-stack:
  added: []
  patterns: [alternating FIFO lanes, queue-drain completion, settlement-order emission]
key-files:
  created: [packages/relay/src/__tests__/sync.test.ts]
  modified: [packages/relay/src/relay.ts, packages/relay/src/types.ts, packages/relay/src/group.ts, packages/relay/src/pool.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions:
  - "Represent each negotiated ID as one scheduler task so SEND and RECEIVE share the same global bound."
  - "Treat terminal authentication failures as operation errors while ordinary upload failures settle as send-failed values."
patterns-established:
  - "Negotiation enqueues without awaiting transfers; completion waits for negotiation plus queue drain."
requirements-completed: [SYNC-02, SYNC-03, SYNC-04, RESID-03]
coverage:
  - id: D1
    description: "Transfers use alternating FIFO lanes under one concurrency-four bound and drain before completion."
    requirement: SYNC-03
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/sync.test.ts#sync scheduler"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sync emits exact normalized sent/send-failed outcomes and empty RECEIVE succeeds."
    requirement: SYNC-04
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-relay exec vitest run src/__tests__/sync.test.ts"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 03: Fair Sync Scheduler and Outcomes Summary

**Bidirectional sync now advances negotiation independently of a fair concurrency-four scheduler and reports every transfer with explicit normalized outcomes.**

## Performance

- **Duration:** 7 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added alternating SEND/RECEIVE FIFO lanes with one validated global concurrency bound.
- Decoupled protocol rounds from transfer completion while retaining honest queue-drain completion.
- Added normalized `SyncMessage` outcomes, failure identity preservation, and successful zero-event EOSE handling.

## Task Commits

1. **Task 1 RED** - `f1688001`
2. **Task 1 GREEN** - `db75f4b1`
3. **Task 2 RED** - `20d0d798`
4. **Task 2 GREEN** - `c556cd5c`

## Decisions Made

- Lane preference flips after every selected task, including when only one lane was eligible.
- Read transfers collect through EOSE with `toArray`, avoiding `lastValueFrom`'s empty-source rejection.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Propagated the new SyncMessage return through Group and Pool**
- **Found during:** Task 1 build verification
- **Issue:** Existing facades explicitly returned `Observable<NostrEvent>`.
- **Fix:** Derived their return types from the delegated sync methods.
- **Verification:** Relay package build passes.
- **Committed in:** `db75f4b1`

## Issues Encountered

- Existing auth tests expected terminal SEND authentication failure to complete silently; they were aligned with the accepted operation-error contract.
- Concurrent commit `53ce67e3` was preserved unchanged.

## User Setup Required

None.

## Next Phase Readiness

- Group and Pool can now attribute and forward the exact result union.

## Self-Check: PASSED

- Scheduler matrix passes 5/5.
- Prior reconnect/auth/cancel focused coverage passes 10/10.
- Relay TypeScript build passes.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
