---
phase: 06-refounding-rotation-authority-correctness
plan: 01
subsystem: testing
tags: [vitest, concord, key-derivation, spec-derived-tests, hkdf]

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
    - "Spec-derived test oracle: expected pk values computed by hand-calling the frozen crypto.ts primitive (guestbookGroupKey/baseRekeyGroupKey), never by calling the implementation under test (deriveConcordKeys/rollForward/baseKeysFor)"
    - "Memo-armed spread guard: derive keys from `material` first (arming BaseKeysSymbol), THEN rollForward, so the assertion is non-vacuous against a reintroduced enumerable-memo regression"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/__tests__/keys.test.ts

key-decisions:
  - "Followed the exact keys.test.ts:191-213 control-address probe shape for both new tests (arm-the-memo comment, crypto.ts-only oracle, !== old-address assertion) per D-10/D-11 and the plan's read_first guidance"
  - "Split the single combined edit into two separate task commits by temporarily removing/restoring the Task 2 test block, to preserve one-commit-per-task atomicity even though both tests were drafted together"
  - "Ran an optional non-vacuity spot-check (temporarily flipping getOrComputeCachedValue's write to enumerable:true in the built packages/core/dist/helpers/cache.js, since concord resolves applesauce-core via its dist exports, not src) to confirm both new spread guards go RED against the pre-Phase-5 cache defect, then restored the dist file from a backup before continuing — nothing committed"

requirements-completed: [ROTATE-01, ROTATE-02]

coverage:
  - id: D1
    description: "rollForward's new-epoch guestbook address is asserted against the CORD-02 §5 formula (guestbookGroupKey) over the new root, independent of the implementation under test"
    requirement: "ROTATE-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#ConcordKeys > rollForward's guestbook address matches the CORD-02 §5 formula over the new root"
        status: pass
    human_judgment: false
  - id: D2
    description: "The base-rekey listen address (over the PRIOR root at root_epoch+1) and rollForward's rolled next-listen address (over the NEW root at newEpoch+1) are both asserted against the CORD-06 §2 formula (baseRekeyGroupKey), with the off-by-root asymmetry (Pitfall 1) made explicit"
    requirement: "ROTATE-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#ConcordKeys > the base-rekey listen address matches the CORD-06 §2 formula over the prior root, and rollForward re-derives it over the new root"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both new derivations carry a memo-armed anti-regression spread guard (deriveConcordKeys before rollForward), and the full applesauce-concord suite (195 tests) is green"
    requirement: "TEST-01"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test"
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

- Extended the existing `keys.test.ts:191` control-address probe pattern (H01(a)) to the guestbook plane: asserts both the current-epoch address (over the current root) and the rolled new-epoch address (over the new root) against `guestbookGroupKey` from `crypto.ts`, never against `deriveConcordKeys`/`rollForward`/`baseKeysFor`.
- Added the base-rekey listen-address test asserting the CORD-06 §2 off-by-root asymmetry explicitly: the current listen address is derived over the PRIOR root at `root_epoch + 1`, while `rollForward`'s rolled next-listen address is derived over the NEW root at `newEpoch + 1` — two distinct oracle calls, never one reused for both (Pitfall 1 from 06-RESEARCH.md).
- Both new tests include the same "ARM THE MEMO" discipline as the existing control probe: `deriveConcordKeys(material, [])` is called before `rollForward` so the spread guard is non-vacuous against a reintroduced `CONCORD-H01`-class regression.
- Spot-verified non-vacuity live (not committed): temporarily flipped the built `applesauce-core` cache write to `enumerable: true` (simulating the pre-Phase-5 defect) and confirmed both new tests go RED with concrete pk mismatches, then restored the original dist file byte-for-byte.
- Full `applesauce-concord` suite: 195 tests green (was 193; +2 new tests), 43 test files, no regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Spec-derived guestbook-address test + memo-armed spread guard (D-10/D-11)** - `7ff443f9` (test)
2. **Task 2: Spec-derived base-rekey-address test + off-by-root spread guard (D-10/D-11)** - `7a5526e7` (test)

_No plan-metadata commit needed beyond this SUMMARY/STATE update — see final commit below._

## Files Created/Modified

- `packages/concord/src/helpers/__tests__/keys.test.ts` - Added two spec-derived tests (guestbook new-epoch address; base-rekey listen + rolled addresses) plus their memo-armed anti-regression spread guards; added `baseRekeyGroupKey`/`guestbookGroupKey` to the existing `crypto.js` import alongside `controlGroupKey`.

## Decisions Made

- Followed the exact `keys.test.ts:191-213` control-address probe shape (arm-the-memo comment, crypto.ts-only oracle, `!== old` assertion) for both new tests, per D-10/D-11 and the plan's explicit `read_first` guidance — no new test pattern invented.
- The plan's two tasks were drafted together in a single edit pass for coherence, then split into two atomic commits by temporarily removing/restoring the Task 2 test block (and its import) so each task's commit reflects only its own test, matching the plan's one-commit-per-task contract.
- Ran the plan's optional non-vacuity spot-check (`06-01-PLAN.md`'s `<verification>` section: "temporarily reverting Phase-5.1's non-enumerable cache write should turn each spread guard RED"). Since `applesauce-concord` resolves `applesauce-core` via its published `dist/` exports (not `src/`, confirmed via `packages/core/package.json`'s `exports` map), the spot-check patched `packages/core/dist/helpers/cache.js`'s `getOrComputeCachedValue` write to `enumerable: true` (backed up first), confirmed both new guards fail with real pk mismatches, then restored the original file from the backup. Nothing from this spot-check was committed; `git status` and `git diff packages/core/src/helpers/cache.ts` were both empty afterward.

## Deviations from Plan

None — plan executed exactly as written. This was an additive test-coverage-only plan (per the plan's objective and D-10); no source symbols were touched in the final state.

## Issues Encountered

None. The `pnpm --filter applesauce-concord test -- ... -t "..."` scoped-run command in the plan's `<verify>` blocks passed through pnpm's argument forwarding as expected only when run via `npx vitest run <file> --reporter=verbose` directly inside the package directory (the `pnpm --filter ... -- -t "..."` form ran the full 195-test suite instead of the `-t`-scoped subset, likely due to pnpm's own `--` handling colliding with the package's `vitest run --passWithNoTests` script). Both the scoped file run and the full-suite run were used to verify each task, so this had no effect on verification confidence — flagging only for anyone reusing the plan's literal command.

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

- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: .planning/phases/06-refounding-rotation-authority-correctness/06-01-SUMMARY.md
- FOUND: commit 7ff443f9 (Task 1)
- FOUND: commit 7a5526e7 (Task 2)
