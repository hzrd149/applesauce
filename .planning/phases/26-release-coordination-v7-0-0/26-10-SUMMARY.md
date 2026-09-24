---
phase: 26-release-coordination-v7-0-0
plan: 10
subsystem: release-coordination
tags: [changesets, release-audit, preserved-history, relay-auth, sync-loader]
requires:
  - phase: 25.5-repository-extraction-cleanup
    provides: cleaned current changeset inventory and repository-extraction verification
  - phase: 26-release-coordination-v7-0-0
    plan: 02
    provides: earlier release projection and held-note behavior proof to re-establish on preserved history
provides:
  - exact 73-note semantic and mechanical audit for the current tracked inventory
  - exact thirteen-package 7.0.0 direct/cascade Changesets projection
  - current relay and loader behavior proof for both held v1.2 notes
  - checkout restoration proof preserving all protected refs and release inputs
affects: [26-11, 26-12, release-snapshot, stable-merge, v7.0.0]
actuals:
  tokens: 13013
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [current-inventory audit before graph computation, source-and-suite held-note proof, protected-ref restoration with isolated executor commits]
key-files:
  created:
    - .planning/phases/26-release-coordination-v7-0-0/26-10-SUMMARY.md
  modified:
    - .planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md
key-decisions:
  - "Treat the live next-versus-master Changesets result as the release oracle and remove obsolete squash/CAS evidence from the current audit."
  - "Classify seven releases as direct and six as dependency cascades from nonempty versus empty Changesets arrays, while excluding the type-none examples workspace."
  - "Permit only this plan's commits on the isolated executor branch during restoration checks while requiring every protected ref and release input to remain unchanged."
patterns-established:
  - "Release-note semantic review precedes package-graph computation and remains distinct from line and sentence validation."
  - "Held changesets cite current source ownership, focused tests, and complete package-suite totals."
requirements-completed: [REL-01, REL-03, REL-04]
coverage:
  - id: D1
    description: "Every one of the 73 current changesets has a unique stable audit row, semantic provenance, and an exact thirteen-package 7.0.0 projection."
    requirement: REL-01
    verification:
      - kind: integration
        ref: "pnpm exec changeset status --verbose --since=master plus Plan 26-10 inventory/package assertions"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both held v1.2 changesets remain in the computed result and match current relay and sync-loader behavior."
    requirement: REL-03
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-relay test (16 files/418 tests) and pnpm --filter applesauce-loaders test (16 files/130 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Mechanical sentence validation remains separate from provenance-backed one-change semantic judgments for every current note."
    requirement: REL-04
    verification:
      - kind: integration
        ref: "Plan 26-10 ten-column matrix and current-note structural assertions"
        status: pass
    human_judgment: false
duration: 20min
completed: 2026-09-24
status: complete
---

# Phase 26 Plan 10: Current Changeset and Release Graph Audit Summary

**A 73-note provenance-backed audit now computes the preserved-history release graph as exactly thirteen 7.0.0 packages and re-proves both held auth changes against 548 passing tests.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-24T15:02:00Z
- **Completed:** 2026-09-24T15:22:00Z
- **Tasks:** 2
- **Files modified:** 1 audit file plus this summary

## Accomplishments

- Replaced squash-era evidence with a fixed ten-column matrix covering all 73 tracked changesets exactly once, including the new timer-fix note and current consumer-facing revisions.
- Derived seven direct and six cascade releases from live Changesets output, proving the exact thirteen-package set resolves to `7.0.0` while the examples workspace remains `type: none`.
- Re-proved relay operation-scoped authentication and sync-loader option preservation from current source, focused tests, and complete suites totaling 548 tests.
- Preserved `next`, `master`, `origin/master`, all protected refs, lock/config bytes, and every changeset hash; temporary baseline/status evidence was removed after validation.

## Task Commits

1. **Task 1: Trace the cleaned note set through semantic audit and Changesets computation** — `f56019a0` (docs)
2. **Task 2: Re-prove the two held v1.2 notes and preserve the dirty baseline** — `da0fc6ef` (docs)
3. **Task 2 evidence correction: Clarify captured release base versus executor commits** — `d69525fd` (fix)

## Files Created/Modified

- `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` — Current 73-note matrix, exact package projection, held-note behavior evidence, command evidence, and restoration result.
- `.planning/phases/26-release-coordination-v7-0-0/26-10-SUMMARY.md` — Plan outcomes, verification coverage, and deviation record.

## Decisions Made

- Used `next` versus `master` as the current preserved-history boundary and removed obsolete squash, commit-tree, and compare-and-swap claims.
- Classified direct versus cascade releases from whether each active Changesets release has a nonempty `changesets` array, not from linked-package membership.
- Kept required task commits isolated on `worktree-agent-p10`; restoration equality remained strict for protected refs and release inputs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built workspace outputs before package verification**
- **Found during:** Task 2 (held-note behavior verification)
- **Issue:** The fresh dependency tree lacked built workspace entry points, so Vitest could not resolve `applesauce-core` and `applesauce-signers` exports.
- **Fix:** Ran the repository build to populate all 17 workspace outputs, then reran both required suites unchanged.
- **Files modified:** Generated ignored build outputs only; no release input was changed.
- **Verification:** The relay suite passed 16 files/418 tests and the loaders suite passed 16 files/130 tests.
- **Committed in:** `da0fc6ef` records the successful command evidence.

**2. [Rule 1 - Bug] Reconciled restoration wording with mandatory atomic commits**
- **Found during:** Task 2 checkout restoration
- **Issue:** Literal branch/HEAD/ref equality with the pre-task baseline conflicts with the mandatory per-task commits, which necessarily advance the isolated executor branch.
- **Fix:** Required every protected ref and release input to remain exact while permitting only the plan's known commit chain on `worktree-agent-p10`; corrected the audit to distinguish captured `next` base identity from executor HEAD.
- **Files modified:** `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md`
- **Verification:** `next`, `master`, `origin/master`, all 261 protected refs, lock/config files, and all 73 changeset hashes remained unchanged; `next..HEAD` contained only plan commits at the check boundary.
- **Committed in:** `d69525fd`

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking issue)
**Impact on plan:** Both fixes were required to execute verification correctly; neither altered release inputs, protected refs, package behavior, or release scope.

## Issues Encountered

The initial package-suite run could not resolve unbuilt workspace packages. Building the monorepo resolved the environment issue, after which both suites passed completely.

## User Setup Required

None - no credentials, publication, versioning, push, tag, or hosted release action was used.

## Verification Evidence

- All 73 tracked changeset paths form a bijection with the audit matrix and retain unique stable IDs.
- Every note has valid frontmatter, one nonempty Markdown body line, one sentence, and a separate provenance-backed semantic result.
- Live Changesets output contains exactly thirteen active `7.0.0` releases: seven direct and six cascades; both held IDs remain present.
- `pnpm build` passed all 17 workspace targets.
- `pnpm --filter applesauce-relay test` passed 16 files and 418 tests.
- `pnpm --filter applesauce-loaders test` passed 16 files and 130 tests.
- Temporary Plan 26-10 baseline and status artifacts were absent after successful restoration checks.

## Known Stubs

None.

## Next Phase Readiness

Plan 26-11 can validate the snapshot/tag path against the current preserved-history audit and exact package graph. Publication remains explicitly out of scope, and no release input or protected branch moved.

## Self-Check: PASSED

The audit and summary exist; task commits `f56019a0`, `da0fc6ef`, and `d69525fd` are reachable; inventory, package-result, held-note, suite, restoration, and temporary-artifact checks pass; shared STATE and ROADMAP files remain untouched.

---
*Phase: 26-release-coordination-v7-0-0*
*Completed: 2026-09-24*
