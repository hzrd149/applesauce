---
phase: 05-cache-identity-memo-fix
plan: 04
subsystem: testing

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix
    provides: "05-01's non-enumerable cache-memo fix in applesauce-core (BaseKeysSymbol/ChannelPlaneKeysSymbol no longer survive an object spread)"
provides:
  - "keys.test.ts case proving rollForward's control address matches the CORD-02 §4 formula, closing H01(a)"
  - "channel-rekey.test.ts case proving rollForwardChannel's plane address matches the CORD-03 §1 private-channel formula, closing H01(c)"
affects: [05-05, phase-06, phase-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spec-derived expected-value pattern: import controlGroupKey/channelGroupKey directly from crypto.ts, call with the spec's raw (secret, id, epoch) tuple, and assert the implementation-under-test's output equals that — never comparing the implementation to itself (D-18)"
    - "Arm-then-roll non-vacuity pattern: derive keys from the SOURCE object first (writes the identity-cache memo), THEN roll forward — proving the assertion would have caught the pre-05-01 memo-carry bug"

key-files:
  created: []
  modified:

key-decisions:
  - "Placed both new cases as additional it(...) blocks in the existing describe suites rather than new files, per the plan's explicit artifact list"
  - "Used the private branch of the CORD-03 §1 formula for H01(c) (channel's own key/epoch), not the public branch (community_root/root_epoch) — getting this wrong would silently never match rather than fail loudly"

patterns-established:

requirements-completed: [TEST-01]

coverage:
  - id: D1
    description: "H01(a): rollForward's control address matches the CORD-02 §4 formula over the new root, and differs from the pre-roll address"
    requirement: "TEST-01"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "H01(c): rollForwardChannel's plane address matches the CORD-03 §1 private-channel formula over the new key/epoch, and differs from the pre-roll address"
    requirement: "TEST-01"
    verification:
      - kind: unit
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 04: Spec-derived H01(a)/H01(c) regression tests Summary


## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-15
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

## Task Commits

Each task was committed atomically:

1. **Task 1: H01(a) — rollForward's control address matches the CORD-02 §4 formula** - `c44cb38d` (test)
2. **Task 2: H01(c) — rollForwardChannel's plane address matches the CORD-03 §1 formula** - `f9eca302` (test)

## Files Created/Modified

## Decisions Made
- None beyond the plan's explicit instructions — both tests follow the exact sequence (arm → pick fresh root/key+epoch → compute expected via crypto.ts → roll → assert equal and assert rotated) specified in the plan's `<action>` blocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built `applesauce-core`, `applesauce-common`, `applesauce-signers`, `applesauce-loaders`, `applesauce-relay` before tests would run**
- **Fix:** Ran `pnpm --filter applesauce-core build` followed by `pnpm --filter applesauce-common --filter applesauce-loaders --filter applesauce-relay --filter applesauce-signers build` to populate each package's `dist/`.
- **Files modified:** None (build artifacts only, not committed — `dist/` is gitignored per each package's standard build output).
- **Committed in:** N/A (no source files changed by the build; not part of either task commit).

---

**Total deviations:** 1 auto-fixed (1 blocking — pre-existing environment/build-order issue, out of this plan's file scope)
**Impact on plan:** No scope creep — this was a monorepo build-order prerequisite affecting test execution, not a plan or code change. No files owned by sibling plans (05-02, 05-03) were touched.

## Issues Encountered
None beyond the build-order deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 05-05 can proceed to systematically prove both new cases are non-vacuous by temporarily reverting the 05-01 fix and confirming they go red.
- TEST-01 is anchored per this plan's scope (not closed — it stands across Phases 6-12 as more spec-derived tests land).
- Phase 6 inherits these two cases as regression guards when it addresses H01(b) (the epoch walk, explicitly out of scope here per D-17) and the broader memberlist/H02 work.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: .planning/phases/05-cache-identity-memo-fix/05-04-SUMMARY.md
- FOUND commit: c44cb38d (Task 1)
- FOUND commit: f9eca302 (Task 2)
- FOUND commit: 88415809 (SUMMARY.md)
