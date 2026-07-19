---
phase: 08-rotation-robustness-consensus
plan: 02
subsystem: concord
tags: [rekey, rotation, consensus, chunked-events, vitest]

# Dependency graph
requires:
  - phase: 08-rotation-robustness-consensus
    provides: "08-01's isStrictlyLowerKey down-only latch helper (rekey.ts); this plan builds on the same file's groupRotations"
provides:
  - "RekeyRotationSet.consistent flag proving chunkCount/prevEpoch agreement across a correlated bucket's chunks"
  - "groupRotations multiset agreement guard forcing complete=false on any disagreement, closing the first-arrival-wins defect"
affects: [rotation-robustness-consensus, readRekeyScoped, checkRekey]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Per-bucket side-Set agreement check (Set<number>/Set<bigint> tracked alongside the correlation Map) rather than mutating the correlation key itself"]

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/rekey.ts
    - packages/concord/src/helpers/__tests__/rekey.test.ts

key-decisions:
  - "Correlation key left unchanged (rotator:scopeIdHex:newEpoch:prevCommit) per D-02 — chunkCount is NOT added to the key; disagreement is caught by a separate consistency flag instead"
  - "Disagreeing chunks are now retained in set.chunks (not silently dropped) so the disagreement itself is observable, with consistent=false forcing complete=false regardless of chunks.size"

patterns-established:
  - "Track cross-chunk agreement via ephemeral Set<T> per correlation key during the bucketing pass, then fold into a boolean on the final pass — avoids polluting the correlation key or the public RekeyRotationSet fields with intermediate bookkeeping"

requirements-completed: [ROTATE-10, ROTATE-11]

coverage:
  - id: D1
    description: "groupRotations marks a bucket inconsistent (never complete) when its chunks disagree on chunkCount (n), preventing a resumed rotation's stale generation from completing on its own chunk count"
    requirement: "ROTATE-10"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/rekey.test.ts#groupRotations marks a bucket inconsistent when chunks disagree on chunkCount (n)"
        status: pass
    human_judgment: false
  - id: D2
    description: "groupRotations marks a bucket inconsistent (never complete) when its chunks disagree on prevEpoch"
    requirement: "ROTATE-11"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/rekey.test.ts#groupRotations marks a bucket inconsistent when chunks disagree on prevEpoch"
        status: pass
    human_judgment: false
  - id: D3
    description: "Correlation key unchanged (D-02): a fully-agreeing bucket (matching n and prevEpoch across every chunk) still reaches consistent=true, complete=true"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/rekey.test.ts#groupRotations: matching n and prevEpoch across all chunks yields a consistent, complete set (positive control)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 02: groupRotations consistency guard Summary

**Fixed the first-arrival-wins defect in groupRotations (D-02/ROTATE-10/ROTATE-11): chunks are still correlated only by (rotator, scopeIdHex, newEpoch, prevCommit), but a new `consistent` flag now checks multiset agreement on chunkCount and prevEpoch across every chunk in a bucket, forcing `complete = false` on any disagreement instead of silently letting the first-arriving generation win.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-19T13:52:43Z
- **Completed:** 2026-07-19T13:56:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `RekeyRotationSet` gained a `consistent: boolean` field; `groupRotations` tracks the distinct `chunkCount` and `prevEpoch` values seen per correlation bucket via side `Set`s during bucketing, then computes `consistent = (chunkCounts.size === 1 && prevEpochs.size === 1)` on the final pass
- `set.complete` is now `consistent && chunks.size >= chunkCount` — an inconsistent bucket can never be complete, regardless of whether the first-arriving generation's own chunks happen to fully populate its own declared `chunkCount`
- Chunks are no longer silently dropped when their `chunkCount` disagrees with the bucket's first-arriving value; every chunk is retained in `set.chunks` so the disagreement is detectable rather than invisible
- Three new spec-derived tests: n-disagreement, prevEpoch-disagreement, and a positive control, each with expected values hand-derived from CORD-06 §2's "hold all n chunks" removal rule (cited in code comments) rather than captured from implementation output

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cross-chunk consistency guard to groupRotations** - `8a3b536b` (fix)
2. **Task 2: Spec-derived oracles for n-disagreement and prevEpoch-disagreement** - `e9387672` (test)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `packages/concord/src/helpers/rekey.ts` - `RekeyRotationSet.consistent` field; `groupRotations` multiset agreement guard over `chunkCount` and `prevEpoch`
- `packages/concord/src/helpers/__tests__/rekey.test.ts` - n-disagreement, prevEpoch-disagreement, and positive-control tests for `groupRotations`

## Decisions Made
- Correlation key stays exactly `${rotator}:${scopeIdHex}:${newEpoch}:${prevCommit}` — no `chunkCount` added, matching D-02 and upstream, and matching the plan's explicit rejection of the audit's "add chunkCount to the key" alternative fix
- Disagreement bookkeeping (`chunkCounts`/`prevEpochs` Sets) lives as local variables scoped to `groupRotations`, not as new public fields on `RekeyRotationSet` — keeps the public interface minimal (just the one `consistent` boolean) while still being fully computed from a single bucketing pass

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `readRekeyScoped` (packages/concord/src/helpers/keys.ts) already filters on `set.complete` at its per-rotation loop (`if (!set.complete) continue;`), so no caller changes were required — the fix is fully contained to `groupRotations`'s completion gate
- Downstream `checkContinuity` still reads `prevEpoch`/`prevCommit` from the SET's first-arriving values (used only after `consistent` has already gated `complete`), so an inconsistent set's internally-disagreeing `prevEpoch` never reaches continuity checking in practice
- Ready for the next plan in Phase 08's wave sequence

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: packages/concord/src/helpers/rekey.ts
- FOUND: packages/concord/src/helpers/__tests__/rekey.test.ts
- FOUND: .planning/phases/08-rotation-robustness-consensus/08-02-SUMMARY.md
- FOUND commit: 8a3b536b
- FOUND commit: e9387672
