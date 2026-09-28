---
phase: 26-release-coordination-v7-0-0
plan: 12
subsystem: release-coordination
tags: [changesets, immutable-source, release-gate, normal-merge, ancestry-preservation]
requires:
  - phase: 26-release-coordination-v7-0-0
    plan: 10
    provides: exact 73-note audit and thirteen-package 7.0.0 oracle
  - phase: 26-release-coordination-v7-0-0
    plan: 11
    provides: non-publishing snapshot and coherent consumer-install proof
provides:
  - immutable fully gated release-source OID and durable terminal evidence
  - prospective ancestry-preserving stable merge with ordered parent and tree proof
  - planning-only descendant and exact protected-state restoration proof
  - completed REL-01, REL-03, and REL-04 replacement validation
affects: [stable-v7-merge, changesets-release, phase-26-closeout]
actuals:
  tokens: 6934
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [resolve mutable release ref once, gate detached immutable source, prove ordinary merge without moving refs, confine closeout descendants to planning]
key-files:
  created:
    - .planning/phases/26-release-coordination-v7-0-0/26-12-SUMMARY.md
  modified:
    - .planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md
    - .planning/phases/26-release-coordination-v7-0-0/26-VALIDATION.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "Use immutable next OID 6e83afa3532bc054b8fe0c755d7e4942462d89d8 as the sole later stable-merge source, regardless of planning-only branch advancement."
  - "Prove the normal stable transition with an unreachable two-parent merge object rather than moving master or rewriting history."
  - "Retain Plans 26-04 through 26-09 only as historical non-gating evidence and authorize readiness solely from Plans 26-10 through 26-12."
patterns-established:
  - "Release gates, package oracles, terminal markers, and merge proofs all bind to one immutable source OID."
  - "Executor commits may advance only their dedicated branch; release refs and inputs remain exact while all descendants are planning-only."
requirements-completed: [REL-01, REL-03, REL-04]
coverage:
  - id: D1
    description: "One immutable next source passed the complete release gate, structured 73-note audit, exact thirteen-package oracle, and both held-note checks."
    requirement: REL-01
    verification:
      - kind: integration
        ref: "pnpm install --frozen-lockfile; pnpm test; pnpm build; docs/examples builds; structured Changesets and status assertions"
        status: pass
    human_judgment: false
  - id: D2
    description: "The exact gated source is the second parent and tree source of a prospective normal ancestry-preserving stable merge."
    requirement: REL-03
    verification:
      - kind: integration
        ref: "git merge --no-ff --no-commit plus commit-tree parent/tree/ancestry assertions"
        status: pass
    human_judgment: false
  - id: D3
    description: "Protected refs and release inputs restore exactly, all closeout descendants are planning-only, and the three release requirements are complete."
    requirement: REL-04
    verification:
      - kind: integration
        ref: "schema-v2 baseline comparison, replacement validation parser, and requirement substitution assertion"
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-09-24
status: complete
---

# Phase 26 Plan 12: Immutable Final Release Source Summary

**Immutable `next` source `6e83afa3` passed the full 2,235-test release gate and exact Changesets oracle, then produced a verified ordinary two-parent stable-merge object without moving `master` or publishing npm packages.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-24T15:44:55Z
- **Completed:** 2026-09-24T15:56:30Z
- **Tasks:** 2
- **Files modified:** 4 tracked planning files

## Accomplishments

- Pinned `6e83afa3532bc054b8fe0c755d7e4942462d89d8` once from `refs/heads/next` and ran frozen install, 232 test files with 2,235 passing tests, 17 workspace builds, and docs/examples builds in a detached disposable worktree.
- Revalidated all 73 structured changeset rows, exactly thirteen `7.0.0` package results, and both held v1.2 note IDs against that same immutable source.
- Created unreachable prospective merge `20b7853c525daa43fdf139648b9aeaf58b7cf7f5` with stable master first, the immutable source second, and the exact gated source tree.
- Removed all temporary evidence and worktree state while retaining durable ignored evidence, preserving local `master == origin/master`, and proving every post-source commit and pending path is under `.planning/**`.
- Replaced obsolete squash-era validation with six green replacement rows and closed exactly the REL-01, REL-03, and REL-04 checkbox/status pairs.

## Task Commits

1. **Task 1: Fully gate one immutable next OID and prove that exact source's normal stable merge** — `d0aa4918` (docs)
2. **Task 2: Prove planning-only descendants, restore state, and close release requirements** — `f92022f2` (docs)

## Files Created/Modified

- `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` — exact-source command ledger, durable identities, normal-merge proof, restoration, and planning-descendant evidence.
- `.planning/phases/26-release-coordination-v7-0-0/26-VALIDATION.md` — six active green replacement rows, historical superseded-plan table, and final approval.
- `.planning/REQUIREMENTS.md` — exactly three release checkboxes and three Phase 26 traceability statuses changed to complete.
- `.planning/phases/26-release-coordination-v7-0-0/26-12-SUMMARY.md` — execution, verification, and deviation record.

## Decisions Made

- The later stable merge must consume immutable source `6e83afa3532bc054b8fe0c755d7e4942462d89d8`; neither mutable `next` nor a later planning tip can replace it.
- Stable readiness is proven by an unreachable ordinary merge object. No real merge, ref update, release-history rewrite, tag, push, versioning, changelog mutation, registry write, or npm publication occurred.
- Plans 26-04 through 26-09 remain historical only; the active authority chain is 26-10 audit, 26-11 snapshot consumer, and 26-12 exact-source gate/merge proof.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reconciled release-source checks with the mandatory dedicated executor worktree**
- **Found during:** Task 1 preflight and Task 2 restoration
- **Issue:** The plan literally required the checkout branch to be `next` and every local ref except `next` to remain fixed, which conflicts with the user-mandated `worktree-agent-p12` branch and mandatory per-task commits.
- **Fix:** Required executor HEAD to equal the once-resolved `next` OID before gating, excluded only `worktree-agent-p12` from ref equality, and required every executor descendant to modify only `.planning/**`; all release inputs and protected refs stayed exact.
- **Files modified:** Evidence logic and `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md`
- **Verification:** `next` remained the immutable source, `master == origin/master`, all other refs/tags matched baseline, and `RELEASE_SOURCE..HEAD` contained planning-only paths.
- **Committed in:** `d0aa4918`, `f92022f2`

**2. [Rule 1 - Bug] Resolved durable evidence through the linked-worktree common Git directory**
- **Found during:** Task 1 and Task 2 automated verification
- **Issue:** The plan's literal `.git/gsd-phase-26-release-evidence/...` path is invalid inside a linked worktree because `.git` is a file.
- **Fix:** Resolved `git rev-parse --git-common-dir` and used its identical durable evidence location without accessing or modifying the primary checkout.
- **Files modified:** Durable ignored evidence only; tracked audit records the canonical `.git/...` location.
- **Verification:** Temporary and durable release-source JSON bytes matched, and the terminal marker named the exact immutable OID.
- **Committed in:** `d0aa4918`

**3. [Rule 3 - Blocking] Corrected baseline byte-order and environment invocation helpers**
- **Found during:** Task 1 baseline capture and Task 2 durable-evidence validation
- **Issue:** Initial inline Node helpers passed strings directly to `Buffer.compare` and attached environment assignments after rather than before the Node process.
- **Fix:** Wrapped strings as buffers for byte sorting and bound environment variables before invocation, then reran from the untouched source baseline.
- **Files modified:** Temporary evidence only.
- **Verification:** Both schema-v2 baseline validation and final protected-state comparison passed.
- **Committed in:** No tracked change; resulting evidence is recorded by `d0aa4918` and `f92022f2`.

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocking issue)
**Impact on plan:** The adaptations enforce worktree isolation and atomic commits without weakening any release identity, restoration, or publication boundary.

## Issues Encountered

- The Changesets CLI wrote its oracle to the requested JSON path and emitted no stdout, so the status command log intentionally hashes as the empty-file SHA-256 while the oracle JSON carries the substantive result.
- No package, test, build, merge, restoration, or requirement-closure failure remained.

## User Setup Required

None — npm credentials and publication were deliberately not used.

## Verification Evidence

- Full immutable-source gate: 13/13 package builds during tests, 17/17 workspace builds, 232 passed test files, 2,235 passed tests, docs build, and examples build.
- Structured release audit: 73 unique IDs, 73 unique tracked paths, valid note shape, and semantic PASS evidence.
- Changesets oracle: exactly thirteen packages at `7.0.0`, seven direct and six dependency cascades, with both held IDs present.
- Prospective merge: ordered parents `ec51f7d4` then `6e83afa3`, tree `ec5046e2`, and both ancestry checks pass.
- Restoration: local `master` remains exactly `origin/master`; all temporary Phase 26-12 paths are absent; durable ignored evidence and `COMPLETE` remain.
- Shared `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Known Stubs

None.

## Next Phase Readiness

Phase 26 replacement execution is complete. The stable v7 transition can later merge immutable source `6e83afa3532bc054b8fe0c755d7e4942462d89d8` normally into reviewed stable master and proceed through standard Changesets automation; this plan performed neither operation.

## Self-Check: PASSED

- The audit, replacement validation, requirements ledger, and this summary exist in the dedicated worktree.
- Task commits `d0aa4918` and `f92022f2` are reachable.
- Immutable source/marker, prospective merge, planning-only descendants, protected master equality, temporary-path absence, and all six requirement substitutions pass.
- `.planning/STATE.md` and `.planning/ROADMAP.md` remain unchanged from the executor base.

---
*Phase: 26-release-coordination-v7-0-0*
*Completed: 2026-09-24*
