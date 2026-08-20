---
phase: 17-correctness-fixes-concord-residuals
plan: 04
subsystem: concord-auth
tags: [concord, nip-42, rxjs, authentication, lifecycle]
requires:
  - phase: 15-relay-auth-rework
    provides: Scoped StreamSigners authentication diagnostics
provides:
  - Fatal-only community and private-channel UI error state
  - Non-vacuous AUTH prevention and lifecycle failure regressions
affects: [concord, auth, ui-status, lifecycle]
tech-stack:
  added: []
  patterns: [operation-scoped auth diagnostics, fatal-only lifecycle state]
key-files:
  created: [.changeset/concord-auth-ui-error-boundary.md]
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/client/__tests__/private-channel.test.ts
key-decisions:
  - "Prevention supersedes RESID-01's earlier clear-on-recovery interpretation: transient AUTH never enters fatal UI state."
  - "StreamSigners keeps caller-visible behavior and redacted :auth diagnostics without engine-level onAuthFailure callbacks."
patterns-established:
  - "Only lifecycle walk catch blocks write non-null community or private-channel error state."
requirements-completed: [RESID-01]
coverage:
  - id: D1
    description: "Rejected, thrown, and unanswered AUTH never latch community or private-channel UI errors."
    requirement: RESID-01
    verification:
      - kind: integration
        ref: "packages/concord/src/client/__tests__/community.test.ts#keeps rejected, thrown, and unanswered AUTH out of fatal UI error state"
        status: pass
      - kind: integration
        ref: "packages/concord/src/client/__tests__/private-channel.test.ts#keeps rejected, thrown, and unanswered AUTH out of fatal UI error state"
        status: pass
    human_judgment: false
  - id: D2
    description: "Genuine lifecycle sync failures still populate fatal error and error phase."
    requirement: RESID-01
    verification:
      - kind: integration
        ref: "community/private-channel fatal sync controls and full applesauce-concord suite"
        status: pass
    human_judgment: false
duration: 11min
completed: 2026-08-20
status: complete
---

# Phase 17 Plan 04: Concord AUTH UI Error Boundary Summary

**Transient relay AUTH failures remain caller/log scoped while genuine community and private-channel lifecycle failures exclusively own fatal UI state.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-20T12:03:44Z
- **Completed:** 2026-08-20T12:14:09Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Removed both UI-facing `StreamSigners.onAuthFailure` sinks without changing shared authentication behavior or diagnostics.
- Added rejected, thrown, and zero-answer AUTH regressions plus genuine lifecycle-failure controls for both engines.
- Proved non-vacuity by restoring both old callbacks and observing the matching prevention tests fail.

## Task Commits

1. **Task 1 RED: Community AUTH boundary regression** - `17eaede6` (test)
2. **Task 1 GREEN: Community fatal-only UI boundary** - `84116225` (fix)
3. **Task 2 RED: Private-channel AUTH boundary regression** - `c1cf3f50` (test)
4. **Task 2 GREEN: Private-channel fatal-only UI boundary** - `46b8962a` (fix)

## Files Created/Modified

- `.changeset/concord-auth-ui-error-boundary.md` - Single-sentence Concord patch notice.
- `packages/concord/src/client/community.ts` - Keeps transient AUTH outside community fatal state.
- `packages/concord/src/client/private-channel.ts` - Mirrors the fatal-only boundary for channels.
- `packages/concord/src/client/__tests__/community.test.ts` - Community AUTH and fatal lifecycle oracles.
- `packages/concord/src/client/__tests__/private-channel.test.ts` - Private-channel AUTH and fatal lifecycle oracles.

## Decisions Made

- Prevention is the accepted stronger interpretation of RESID-01, so no AUTH recovery latch or identity-clearing machinery was added.
- Existing `auth.ts` behavior remains the source of caller-visible failure handling and relay URL/redacted-pubkey diagnostics.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The initial fatal-control fixture used a relay request error that the sync loader intentionally absorbs per relay; the control was corrected to inject a synchronous lifecycle-context failure caught by the engine's public `start()` path.

## Verification

- Community and private-channel focused suites: 80 tests passed.
- Full `applesauce-concord` suite: 596 tests passed across 55 files.
- `pnpm --filter applesauce-concord build`: passed.
- Both old-callback mutation probes: failed the intended AUTH prevention assertions.
- Changeset single-sentence check: passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

RESID-01 is complete; Concord revocation publication honesty can proceed independently in plan 17-05.

## Self-Check: PASSED

- All five planned artifacts exist.
- All four task commits exist in git history.
- Focused, full-suite, build, mutation, and changeset gates passed.

---
*Phase: 17-correctness-fixes-concord-residuals*
*Completed: 2026-08-20*
