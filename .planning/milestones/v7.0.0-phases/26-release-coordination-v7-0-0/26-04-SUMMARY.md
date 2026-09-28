---
phase: 26-release-coordination-v7-0-0
plan: 04
subsystem: release-coordination
tags: [git-history, commit-tree, compare-and-swap, release-validation]
requires:
  - phase: 26-release-coordination-v7-0-0
    plan: 03
    provides: frozen full release gate bound to immutable source evidence
provides:
  - release-ready local master with the reviewed source tree and sole pre-Concord parent
  - immutable source, tree, base, candidate, and preserved-ref proof ledger
  - complete Phase 26 validation and release requirement traceability
affects: [v7.0.0, local-master, release-readiness]
actuals:
  tokens: 7089
  tasks: 2
  commits: 4
tech-stack:
  added: []
  patterns: [unreachable commit-tree candidate before ref mutation, expected-old compare-and-swap, detached planning-only closeout]
key-files:
  created: [.planning/phases/26-release-coordination-v7-0-0/26-04-SUMMARY.md, .git/gsd-phase-26-release-evidence/final.env]
  modified: [.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md, .planning/phases/26-release-coordination-v7-0-0/26-VALIDATION.md, .planning/REQUIREMENTS.md, .planning/STATE.md, .planning/ROADMAP.md]
key-decisions:
  - "Keep SOURCE as the immutable release tree and perform every later GSD commit on a detached planning-only lineage, leaving next unchanged."
  - "Install the verified candidate with expected-old update-ref only after tree, parent, count, history, and preserved-ref proofs pass."
patterns-established:
  - "Release branch reconstruction verifies an unreachable candidate before the sole compare-and-swap ref mutation."
  - "Post-pin bookkeeping is accepted only when every changed path is under .planning and release/product path diffs are empty."
requirements-completed: [REL-01, REL-03, REL-04]
coverage:
  - id: D1
    description: "Local master contains exactly one post-base commit whose tree equals the pinned reviewed source tree."
    requirement: REL-01
    verification:
      - kind: integration
        ref: "final.env candidate tree/parent/count assertions and git update-ref expected-old proof"
        status: pass
    human_judgment: false
  - id: D2
    description: "Resulting master has no case-insensitive Concord path or content match in any reachable product or release surface."
    requirement: REL-03
    verification:
      - kind: integration
        ref: ".git/gsd-phase-26-release-evidence/master-path.matches and master-content.matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "All Phase 26 release requirements and validation rows are complete while next and remote refs remain unchanged."
    requirement: REL-04
    verification:
      - kind: other
        ref: "26-04 task verification over REQUIREMENTS.md, 26-VALIDATION.md, ref snapshots, and SOURCE path boundary"
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-09-15
status: complete
---

# Phase 26 Plan 04: Immutable Release Master Construction Summary

**Local `master` now points to one verified post-base commit with the exact reviewed v7 source tree, while `next`, remotes, and all release inputs remain immutable.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-15T00:45:23Z
- **Completed:** 2026-09-15T01:10:19Z
- **Tasks:** 2
- **Files modified:** 6 tracked planning files plus retained raw evidence under `.git`

## Accomplishments

- Pinned source `4786d952e04eb4535e9c776d86adf4058c69801f`, tree `0099380fb3df8c9e97b4ac19b0066e32e445d617`, and verified pre-Concord base `5d0260e296a15b85bc4e58abc34cde3fb055179c` only after the clean/gated source boundary passed.
- Constructed candidate `399eea787eb86e4eeab3a7c8138092255fce180f` from that exact tree with the base as sole parent, proved one post-base commit and no reachable scoped Concord path/content, then installed it through expected-old compare-and-swap of local `master` only.
- Preserved local `next` at `4786d952e04eb4535e9c776d86adf4058c69801f`, preserved every remote and other local ref, detached closeout at SOURCE, and confined all later tracked changes to `.planning/**`.
- Re-ran the Plan 01/02 note, package, held-change, relay, and loaders assertions before completing REL-01, REL-03, REL-04 and all eight Phase 26 validation rows.

## Task Commits

1. **Task 1: Pin identities, verify the candidate, and compare-and-swap local master** — `9aabc544` (chore)
2. **Task 2: Record immutable history proof and bound post-pin bookkeeping** — `dbd3a207` (docs)

## Files Created/Modified

- `.git/gsd-phase-26-release-evidence/final.env` — Literal immutable identities and PASS results for candidate, ref, and detached-closeout proofs.
- `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` — D-16 identity ledger, structural proof table, and post-pin boundary.
- `.planning/phases/26-release-coordination-v7-0-0/26-VALIDATION.md` — All task rows, Wave 0 dependencies, and sign-off marked green.
- `.planning/REQUIREMENTS.md` — REL-01, REL-03, and REL-04 checklist and traceability statuses completed.
- `.planning/phases/26-release-coordination-v7-0-0/26-04-SUMMARY.md` — Plan outcome and verification coverage.
- `.planning/STATE.md` — Execution position, metrics, decisions, and session continuity.
- `.planning/ROADMAP.md` — Plan 26-04 and Phase 26 plan count advanced to 4/4.

## Decisions Made

- SOURCE remains the immutable reviewed release source and candidate tree; no bookkeeping descendant can redefine it.
- Candidate verification precedes the only allowed ref mutation, `git update-ref refs/heads/master "$CANDIDATE" "$OLD_MASTER"`.
- Every post-pin commit stays detached from `next` and must pass both an all-path `.planning/**` allowlist and an empty product/release path diff.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted the history scan for Git 2.34 pathspec support**
- **Found during:** Task 1 candidate verification
- **Issue:** The planned `git ls-tree` command rejects `:(glob)` pathspec magic on the installed Git 2.34.1, preventing the fail-closed reachable-history scan.
- **Fix:** Enumerated each tree with `git ls-tree -r --name-only`, filtered the exact product/release scope with dependency-free Node, and retained explicit no-match/error handling for path and blob-content scans.
- **Files modified:** Raw evidence under `.git/gsd-phase-26-release-evidence/` only.
- **Verification:** Candidate and resulting-master match files are empty; master remains the recorded candidate.
- **Committed in:** `9aabc544`

**2. [Rule 3 - Blocking] Completed the post-CAS history proof with a bounded bulk scan**
- **Found during:** Task 1 resulting-master verification
- **Issue:** Repeating 1,140 per-commit process launches exceeded the command timeout after the compare-and-swap, although the candidate scan had already passed over the identical commit.
- **Fix:** Re-ran resulting-master path coverage from `git rev-list --objects` and blob-content coverage with one scoped multi-tree `git grep`, preserving fail-closed exit handling and empty match evidence.
- **Files modified:** Raw evidence under `.git/gsd-phase-26-release-evidence/` only.
- **Verification:** Resulting master equals candidate; both master match files are empty; next, HEAD-at-mutation, remotes, and other local refs match snapshots.
- **Committed in:** `9aabc544`

**3. [Rule 1 - Bug] Corrected stale Phase 26 roadmap progress**
- **Found during:** Sequential tracking closeout
- **Issue:** `roadmap.update-plan-progress` checked Plan 26-04 and updated the detailed plan count to 4/4, but left the progress-table row at 3/4.
- **Fix:** Corrected the progress-table count to 4/4 while retaining the SDK-selected In Progress status pending phase verification.
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** The Phase 26 detail and progress-table representations both report 4/4 plans executed.
- **Committed in:** Plan tracking closeout commit.

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking issues)
**Impact on plan:** Both adaptations preserve the exact scan scope and fail-closed semantics; no release input, pinned identity, or additional ref was changed.

## Issues Encountered

- Three pre-existing untracked GSD runtime paths prevented a literal clean checkout. They were moved individually to `/tmp/opencode` for the pinning gate and restored afterward; no broad cleanup or deletion command was used.
- Two pre-mutation scan attempts stopped before `final.env` or any ref update while the base-history and Git pathspec details were corrected. The successful run performed the sole master compare-and-swap.

## User Setup Required

None - no credentials, publication service, or external configuration was used.

## Verification Evidence

- Candidate/source tree equality, sole parent, and one-post-base count: PASS.
- Expected-old master compare-and-swap and immediate preservation snapshots: PASS.
- Resulting-master case-insensitive Concord path/content scan: PASS, empty match files.
- Plan 01 73-row/74-note parser and held-note provenance assertions: PASS.
- Plan 02 thirteen-package `7.0.0` assertion: PASS.
- `pnpm --filter applesauce-relay test`: PASS — 16 files, 418 tests.
- `pnpm --filter applesauce-loaders test`: PASS — 16 files, 130 tests.
- Post-pin path allowlist and empty release/product diff: PASS.
- REL-01, REL-03, and REL-04 checklist and traceability parser: PASS.

## Next Phase Readiness

Phase 26 execution is complete and ready for verification. Local `master` is release-ready, but no versioning, changelog mutation, publication, push, tag, or hosted release was performed.

## Self-Check: PASSED

The audit, validation, requirements, summary, and transient final evidence exist; task commits `9aabc544` and `dbd3a207` exist; local master equals the recorded candidate; local next equals the pinned source; and every tracked post-pin difference remains planning-only.

---
*Phase: 26-release-coordination-v7-0-0*
*Completed: 2026-09-15*
