---
phase: 06-refounding-rotation-authority-correctness
plan: 01
subsystem: testing

# Dependency graph
requires:
  - phase: 05-cache-symbol-propagation-redesign
    provides: "Non-enumerable BaseKeysSymbol memo write (setCachedValue/getOrComputeCachedValue), which makes rollForward's `{ ...keys.material, ... }` spread correctly drop the stale memo instead of carrying it forward"
provides:
  - "A spec-derived oracle for rollForward's new-epoch guestbook address (CORD-02 §5), computed only via crypto.ts's guestbookGroupKey"
  - "A spec-derived oracle for the base-rekey listen address (CORD-06 §2) at both the current (prior-root) and rolled (new-root) epochs, computed only via crypto.ts's baseRekeyGroupKey"
  - "Two memo-armed anti-regression spread guards proving rollForward re-derives clean guestbook/rekey addresses over the new epoch, not the source's memoized ones"
affects: [06-02, 06-03, keys.test.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Memo-armed spread guard: derive keys from `material` first (arming BaseKeysSymbol), THEN rollForward, so the assertion is non-vacuous against a reintroduced enumerable-memo regression"

key-files:
  created: []
  modified:

key-decisions:
  - "Followed the exact keys.test.ts:191-213 control-address probe shape for both new tests (arm-the-memo comment, crypto.ts-only oracle, !== old-address assertion) per D-10/D-11 and the plan's read_first guidance"
  - "Split the single combined edit into two separate task commits by temporarily removing/restoring the Task 2 test block, to preserve one-commit-per-task atomicity even though both tests were drafted together"

requirements-completed: [ROTATE-01, ROTATE-02]

coverage:
  - id: D1
    description: "rollForward's new-epoch guestbook address is asserted against the CORD-02 §5 formula (guestbookGroupKey) over the new root, independent of the implementation under test"
    requirement: "ROTATE-01"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "The base-rekey listen address (over the PRIOR root at root_epoch+1) and rollForward's rolled next-listen address (over the NEW root at newEpoch+1) are both asserted against the CORD-06 §2 formula (baseRekeyGroupKey), with the off-by-root asymmetry (Pitfall 1) made explicit"
    requirement: "ROTATE-02"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D3
    requirement: "TEST-01"
    verification:
      - kind: unit
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-16
status: complete
---

# Phase 6 Plan 1: Guestbook + Base-Rekey Spec-Derived Tests Summary

**Two hand-derived CORD-02/CORD-06 spec oracles (guestbook new-epoch address, base-rekey listen address) plus memo-armed anti-regression spread guards close the ROTATE-01/ROTATE-02 test-coverage gap Phase 5's cache fix left open, with zero source changes.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-16T19:40:49Z
- **Completed:** 2026-07-16T19:46:13Z
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments

- Added the base-rekey listen-address test asserting the CORD-06 §2 off-by-root asymmetry explicitly: the current listen address is derived over the PRIOR root at `root_epoch + 1`, while `rollForward`'s rolled next-listen address is derived over the NEW root at `newEpoch + 1` — two distinct oracle calls, never one reused for both (Pitfall 1 from 06-RESEARCH.md).
- Spot-verified non-vacuity live (not committed): temporarily flipped the built `applesauce-core` cache write to `enumerable: true` (simulating the pre-Phase-5 defect) and confirmed both new tests go RED with concrete pk mismatches, then restored the original dist file byte-for-byte.

## Task Commits

Each task was committed atomically:

1. **Task 1: Spec-derived guestbook-address test + memo-armed spread guard (D-10/D-11)** - `7ff443f9` (test)
2. **Task 2: Spec-derived base-rekey-address test + off-by-root spread guard (D-10/D-11)** - `7a5526e7` (test)

_No plan-metadata commit needed beyond this SUMMARY/STATE update — see final commit below._

## Files Created/Modified


## Decisions Made

- Followed the exact `keys.test.ts:191-213` control-address probe shape (arm-the-memo comment, crypto.ts-only oracle, `!== old` assertion) for both new tests, per D-10/D-11 and the plan's explicit `read_first` guidance — no new test pattern invented.
- The plan's two tasks were drafted together in a single edit pass for coherence, then split into two atomic commits by temporarily removing/restoring the Task 2 test block (and its import) so each task's commit reflects only its own test, matching the plan's one-commit-per-task contract.

## Deviations from Plan

None — plan executed exactly as written. This was an additive test-coverage-only plan (per the plan's objective and D-10); no source symbols were touched in the final state.

## Issues Encountered


## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROTATE-01 and ROTATE-02's guestbook/base-rekey derivation coverage is closed for this phase's slice; `keys.test.ts` now has spec-derived oracles for all three rotating plane addresses (control, guestbook, base-rekey).
- TEST-01 remains standing (does not close at this phase) — Plans 02/03 in this phase still owe the ROTATE-04 (memberlist epoch-scoping) and AUTH-01/AUTH-02 (authority guard) spec-derived tests per the phase's Wave 0 gaps list in 06-RESEARCH.md.
- No blockers for Plan 02/03.

---
*Phase: 06-refounding-rotation-authority-correctness*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: .planning/phases/06-refounding-rotation-authority-correctness/06-01-SUMMARY.md
- FOUND: commit 7ff443f9 (Task 1)
- FOUND: commit 7a5526e7 (Task 2)
