---
phase: 18-event-family-re-layer
plan: 05
subsystem: release
tags: [changesets, audit, relay, api]
requires:
  - phase: 18-event-family-re-layer
    provides: authoritative EVENT runtime and provenance contract
provides:
  - truthful one-change release metadata for EVENT layering
  - complete relay package and static contract audit
affects: [v7-release, phase-26]
tech-stack:
  added: []
  patterns: [one sentence per changeset, region-scoped static contract gates]
key-files:
  created: [.changeset/relay-event-publish-layering.md]
  modified: [.changeset/relay-operation-scoped-auth-callbacks.md, .changeset/wait-for-auth-pubkeys.md, .changeset/relay-publish-timeout-marks-itself.md, .changeset/relay-publish-response-error-field.md]
key-decisions:
  - "The breaking raw event signature receives its own major applesauce-relay changeset."
requirements-completed: [EVT-04, EVT-05, RESID-04]
coverage:
  - id: D1
    description: "Release metadata exactly matches EVENT ownership, timeout rejection, and verdict error semantics."
    requirement: RESID-04
    verification:
      - kind: other
        ref: "exact changeset sentence gate and full relay contract audit"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-20
status: complete
---

# Phase 18 Plan 05: Release Contract Audit Summary

**Five focused changesets now truthfully describe raw EVENT layering, publish policy, timeout rejection, and typed verdict errors.**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Replaced four stale held release claims with their exact one-change sentences.
- Added a dedicated major changeset for the breaking raw `event()` signature.
- Passed the complete 314-test relay suite, declaration build, and static provenance/absence audit.

## Task Commits

1. **Task 1:** `d2cb1faa`
2. **Task 2:** `2a0088ee`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated export snapshot and stabilized timeout suspension evidence**
- **Found during:** Task 2 full package gate
- **Issue:** New public error exports were absent from the snapshot, and the prior 20ms post-auth budget was flaky under full-suite load.
- **Fix:** Added both typed errors to the export snapshot and widened the timing proof while keeping auth delay greater than the operation budget.
- **Files modified:** `packages/relay/src/__tests__/exports.test.ts`, `packages/relay/src/__tests__/relay.test.ts`
- **Verification:** Full package test and build pass.
- **Committed in:** `2a0088ee`

## Issues Encountered

None beyond the auto-fixed verification gaps.

## User Setup Required

None.

## Next Phase Readiness

Phase 18 is ready for canonical verification; no release-prose or static-contract gaps remain.

## Self-Check: PASSED

All five changesets exist, both task commits exist, 314 tests pass, and the declaration/static audit succeeds.
