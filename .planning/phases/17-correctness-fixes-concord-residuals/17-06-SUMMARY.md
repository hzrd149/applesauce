---
phase: 17-correctness-fixes-concord-residuals
plan: 06
subsystem: concord-client
tags: [typescript, concord, invite-revocation, publication-acknowledgement, tdd]
requires:
  - phase: 17-05
    provides: acknowledged invite-registry unregister publication seam
provides:
  - fail-closed required edition publication when publishRequired is absent
  - exported-admin regression proving strict and optimistic callback routing
affects: [concord-client, invite-revocation, RESID-02]
tech-stack:
  added: []
  patterns: [explicit strict-versus-optimistic publication branches]
key-files:
  created: []
  modified:
    - packages/concord/src/client/admin.ts
    - packages/concord/src/client/__tests__/client.test.ts
key-decisions:
  - "Keep publishRequired optional for ordinary exported-admin consumers, but reject any required publication before invoking publish when it is absent."
patterns-established:
  - "Required publication branches validate their strict callback before any network side effect."
requirements-completed: [RESID-02]
coverage:
  - id: D1
    description: "Required invite-registry unregister rejects without publishRequired and never falls back to optimistic publish."
    requirement: RESID-02
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#unregister invite requires publishRequired and never falls back to optimistic publish"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-concord build"
        status: pass
    human_judgment: false
  - id: D2
    description: "Configured unregister routes exclusively through publishRequired while ordinary admin publication remains valid without it."
    requirement: RESID-02
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#unregister invite requires publishRequired and never falls back to optimistic publish"
        status: pass
      - kind: integration
        ref: "pnpm --filter applesauce-concord test"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-20
status: complete
---

# Phase 17 Plan 06: Required Publication Gap Closure Summary

**Invite-registry unregister now fails closed without a strict publisher while preserving ordinary optimistic admin operations and acknowledged any-relay success.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-20T13:13:50Z
- **Completed:** 2026-08-20T13:17:48Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Replaced the conditional fallback in `publishEdition` with explicit required and ordinary publication branches.
- Added a direct exported-admin regression covering omitted configuration, configured routing, and callback call counts.
- Proved the regression is non-vacuous by temporarily restoring the fallback and observing the focused test fail at the missing rejection.

## Task Commits

1. **Task 1 RED: Required-publication regression** - `d502a232` (test)
2. **Task 1 GREEN: Fail-closed publication boundary** - `4dbbb40a` (fix)

## Files Created/Modified

- `packages/concord/src/client/admin.ts` - Rejects required editions when no strict publisher is configured.
- `packages/concord/src/client/__tests__/client.test.ts` - Exercises the exported admin with and without `publishRequired`.

## Decisions Made

- Kept `publishRequired` optional so ordinary consumers can construct and use the exported admin, while required call sites fail before either publisher is invoked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected stale planning counters after SDK updates**
- **Found during:** Plan close-out
- **Issue:** `state.advance-plan` still read the pre-gap-closure 5/5 total, while the roadmap summary table and RESID-02 traceability row retained stale pre-execution values.
- **Fix:** Corrected STATE to 6/6, the roadmap summary row to 6/6 In Progress, and RESID-02 traceability to Complete without transitioning the phase.
- **Files modified:** `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`
- **Verification:** Detailed roadmap lists 6/6 executed plans, the state records plan 6/6, and both requirement surfaces record RESID-02 complete.

**Total deviations:** 1 auto-fixed (1 blocking planning-state inconsistency). **Impact:** Close-out metadata now agrees with the six on-disk plans and summaries; no product scope changed.

## Issues Encountered

- The first fixture attempted to store an unsigned edition template directly in `RumorStore`; finalizing its rumor id in the fake optimistic publisher made the real store fixture represent the existing registry edition correctly.

## Verification

- Focused required-publication test: 1 passed, 66 skipped.
- Full `applesauce-concord` suite: passed.
- `applesauce-concord` build: passed.
- Mutation/non-vacuity check: restoring the pre-fix required-to-optimistic fallback made the focused regression fail because unregister resolved instead of rejecting; the committed implementation was restored and reverified.

## Known Stubs

None.

## Threat Flags

None - the changed trust boundary and both mitigations are already covered by T-17-12 and T-17-13 in the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 17's remaining RESID-02 verification blocker is closed; the phase is ready for verification without a phase transition.

## Self-Check: PASSED

- Both modified source files exist.
- RED commit `d502a232` and GREEN commit `4dbbb40a` exist in git history.
- Focused tests, full Concord tests, build, and mutation gates passed.

---
*Phase: 17-correctness-fixes-concord-residuals*
*Completed: 2026-08-20*
