---
phase: 10-invite-lifecycle-event-time-consistency
plan: 03
subsystem: concord
tags: [concord, time-encoding, guestbook, snapshot, event-factory]

# Dependency graph
requires:
  - phase: 10-invite-lifecycle-event-time-consistency (plan 02)
    provides: splitTime single-clock-read pattern for a single event (includeMs/bindToChannel)
provides:
  - includeSnapshotChunk takes a pre-computed { created_at, ms } pair instead of a bare ms number and never reads Date.now() itself
  - buildSnapshotFactories reads splitTime(nowMs) exactly once per snapshot and threads the identical pair into every chunk's SnapshotFactory.create call
  - Spec-derived regression test proving all chunks of one snapshot share one created_at and one ms tag
affects: [10-04, 10-05, 10-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Caller-threads-the-pair: the outermost scope that owns a logical unit of work (one event = includeMs; one multi-chunk snapshot = buildSnapshotFactories) reads splitTime() exactly once and threads the resulting { created_at, ms } pair down through every inner operation/factory call, which never re-reads the clock itself"

key-files:
  created: []
  modified:
    - packages/concord/src/operations/guestbook.ts
    - packages/concord/src/factories/guestbook.ts
    - packages/concord/src/factories/__tests__/snapshot.test.ts
    - packages/concord/src/operations/__tests__/planes.test.ts

key-decisions:
  - "SnapshotFactory.create and chunk() both default their trailing time param to splitTime() (a fresh single read) rather than requiring every caller to pass it explicitly, preserving the existing no-args call in snapshot.test.ts (SnapshotFactory.create(['x'], 'id', 1, 1)) and the existing helpers/keys.ts call site (buildSnapshotFactories(recipients, snapshotId)) with zero signature-breaking impact on either"

patterns-established:
  - "TIME-02/D-08: multi-chunk event families thread one splitTime pair from the outermost builder (buildSnapshotFactories) down through every per-chunk factory/operation call, mirroring TIME-01's single-event includeMs fix one call-depth up"

requirements-completed: [TIME-02]

coverage:
  - id: D1
    description: "includeSnapshotChunk stamps draft.created_at and the ms tag from a caller-supplied { created_at, ms } pair, never reading Date.now() internally"
    requirement: "TIME-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/operations/__tests__/planes.test.ts#includeSnapshotChunk sets members + snap tag"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildSnapshotFactories reads splitTime(nowMs) exactly once and every chunk of a multi-chunk snapshot shares an identical created_at and ms tag"
    requirement: "TIME-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/factories/__tests__/snapshot.test.ts#shares one created_at and one ms tag across all chunks (TIME-02/D-08)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 03: Snapshot chunk single-clock-read Summary

**All N chunks of a Guestbook refounder snapshot now share one `created_at` and one `ms` tag, threaded from a single `splitTime` read in `buildSnapshotFactories` down through `SnapshotFactory.create`/`chunk()` into `includeSnapshotChunk`, closing the per-chunk `Date.now()` defect (TIME-02/D-08).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-21T14:58:25Z
- **Completed:** 2026-07-21T15:02:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `includeSnapshotChunk` (`operations/guestbook.ts`) now takes a `{ created_at, ms }` pair as its trailing parameter, stamps both `draft.created_at` and the `ms` singleton tag from that pair, and never calls `Date.now()` itself
- `buildSnapshotFactories` (`factories/guestbook.ts`) computes `const time = splitTime(nowMs)` exactly once per snapshot and passes the identical `time` pair into every `SnapshotFactory.create(...)` call across all chunks; `SnapshotFactory.create`/`chunk()` thread the pair straight through with no independent clock reads
- Added a hand-derived spec regression test (`splitTime(1700000000700)` -> `{ created_at: 1700000000, ms: 700 }`) that builds a 401-member/2-chunk snapshot and asserts every chunk shares the identical `created_at` and `ms` tag, with a non-vacuity comment explaining the old per-chunk-read behavior would fail this assertion

## Task Commits

Each task was committed atomically:

1. **Task 1: TIME-02 — thread one splitTime pair through the snapshot factory (D-08)** - `f8079daa` (feat)
2. **Task 2: TIME-02 — spec test: all chunks share one timestamp** - `b319d2f0` (test)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `packages/concord/src/operations/guestbook.ts` - `includeSnapshotChunk` takes a pre-computed `{ created_at, ms }` pair instead of a bare `ms: number`
- `packages/concord/src/factories/guestbook.ts` - `buildSnapshotFactories` reads `splitTime(nowMs)` once and threads the pair through `SnapshotFactory.create`/`chunk()`
- `packages/concord/src/operations/__tests__/planes.test.ts` - updated `includeSnapshotChunk` call site to the new `{ created_at, ms }` signature
- `packages/concord/src/factories/__tests__/snapshot.test.ts` - added the shared-timestamp-across-chunks spec-derived assertion

## Decisions Made
- `SnapshotFactory.create` and `chunk()` default their trailing `time` param to `splitTime()` (a fresh single read at that call), rather than making it a required argument — this keeps the pre-existing no-args call (`SnapshotFactory.create(["x"], "id", 1, 1)` in `snapshot.test.ts`) and `helpers/keys.ts`'s `buildSnapshotFactories(opts.recipients, snapshotId)` call compiling unchanged. `buildSnapshotFactories` remains the only place that reads a raw `nowMs: number = Date.now()` at the caller boundary, per the plan's explicit instruction.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- TIME-02 is fully satisfied: the snapshot factory reads the clock once per snapshot and no per-chunk `Date.now()` remains in the guestbook snapshot path.
- `operations/rekey.ts`/`helpers/rekey.ts` deliberately left untouched (identical defect shape on Rekey chunks, explicitly deferred per the plan's prohibitions) — confirmed via `git diff --stat` showing zero changes to either file.
- Full `applesauce-concord` suite green (278/278 tests across 47 files); `pnpm --filter applesauce-concord build` clean.
- Ready for 10-04.

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files exist on disk and both task commit hashes (f8079daa, b319d2f0) are present in git log.
