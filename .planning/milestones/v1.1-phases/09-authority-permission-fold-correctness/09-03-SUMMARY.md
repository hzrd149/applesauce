---
phase: 09-authority-permission-fold-correctness
plan: 03
subsystem: auth
tags: [concord, foldMembers, vacVerifier, guestbook, kick, membership-fold]

# Dependency graph
requires:
  - phase: 08-channel-rekey-authority
    provides: "vacVerifier(state, requiredPerm) centralized in helpers/permissions.ts, shared by root/channel rekey scopes"
provides:
  - "foldMembers gates a non-owner Kick through vacVerifier(PERM.KICK) at all three production call sites"
  - "D-14 owner-exemption defense-in-depth in the banlist-delete loop"
affects: [09-04, phase-09-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AUTH-08 Kick vac gate: additive inner `if (verifyVac)` check nested inside the retained rank-vs-victim check, never replacing it"
    - "Vac tag extraction mirrors parseRekey (rekey.ts) — find the `vac` tag, build a 3-tuple only when all fields present"
    - "Test isolation pattern: feed foldMembers' `resolveStanding` param an OLD roster (rank check passes) while vacVerifier's `state` reflects the CURRENT/demoted roster, isolating the vac-gate assertion from the pre-existing rank check"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/guestbook.ts
    - packages/concord/src/helpers/__tests__/guestbook.test.ts
    - packages/concord/src/models/community.ts
    - packages/concord/src/models/members.ts
    - packages/concord/src/client/sync.ts

key-decisions:
  - "verifyVac is an optional trailing positional parameter on foldMembers (not an options object) — matches the function's existing positional-parameter shape"
  - "client/sync.ts passes vacVerifier(state0, PERM.KICK) inline as the 7th foldMembers argument (not a named local) to avoid colliding with the existing `const verifyVac = vacVerifier(state, PERM.BAN)` declared later in the same function for the root rekey scope"

patterns-established:
  - "A fold-level authority gate (vac) is threaded as an optional trailing predicate parameter, mirroring the channel-sync.ts/private-channel.ts ConcordPrivateChannel shape, so callers that don't need the gate compile unchanged"

requirements-completed: [AUTH-08, D-14, TEST-01]

coverage:
  - id: D1
    description: "foldMembers gates a non-owner Kick through vacVerifier(PERM.KICK): missing vac, wrong-coordinate vac, and demoted-actor Kicks (structurally valid stale vac, but current roster no longer grants KICK) are dropped; owner Kick (vac omitted) is honored; the pre-existing rank-vs-victim check is retained unchanged"
    requirement: "AUTH-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/guestbook.test.ts#AUTH-08 Kick vac gate"
        status: pass
    human_judgment: false
  - id: D2
    description: "All three production foldMembers call sites (models/community.ts, models/members.ts, client/sync.ts) wire verifyVac: vacVerifier(<state>, PERM.KICK) — confirmed by grep, no silent no-op site"
    requirement: "AUTH-08"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (models/, client/__tests__/sync.test.ts green with the new positional argument wired)"
        status: pass
    human_judgment: false
  - id: D3
    description: "foldMembers never removes the owner via the banlist-delete loop, even if a banlist Set carries the owner's pk, as defense-in-depth behind 09-02's read-path banlist rank gate"
    requirement: "D-14"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/guestbook.test.ts#D-14 owner exemption in the banlist-delete loop"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-19
status: complete
---

# Phase 9 Plan 3: AUTH-08 Kick vac gate + D-14 owner-exemption defense-in-depth Summary

**foldMembers now requires a non-owner Kick to cite its Grant against the CURRENT folded roster via a shared vacVerifier(PERM.KICK) predicate, and never removes the owner through the banlist-delete loop even under a forged banlist.**

## Performance

- **Duration:** 15 min
- **Completed:** 2026-07-19T18:21Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `foldMembers` gained an optional trailing `verifyVac` predicate, additive to (not replacing) the existing rank-vs-victim check — a demoted actor's Kick, or one with a missing/wrong-coordinate vac, is now dropped
- All three production call sites (`models/community.ts`, `models/members.ts`, `client/sync.ts`) wired `vacVerifier(<state>, PERM.KICK)`, confirmed by grep so no site silently no-ops
- The banlist-delete loop gained a D-14 owner-exemption guard (`resolveStanding(banned).isOwner` skip), defense-in-depth behind 09-02's read-path banlist rank gate
- Six new spec-derived tests: four for the Kick vac gate (missing vac, wrong-coordinate vac, demoted actor with a structurally-valid stale vac, owner Kick honored) plus a non-vacuity check, and two for the owner exemption (positive case + non-vacuity revert)

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-08 — thread a verifyVac predicate into foldMembers and gate the Kick branch** - `b0defc63` (feat)
2. **Task 2: AUTH-08 spec-derived test — vac gate drops missing/forged/demoted Kicks** - `bbf1d1a1` (test)
3. **Task 3: D-14 — owner exemption in the foldMembers banlist-delete loop** - `bd76c0f8` (fix)

_Note: Task 3 is a `fix` (not `feat`) since it closes a defense-in-depth gap in existing behavior._

## Files Created/Modified
- `packages/concord/src/helpers/guestbook.ts` - `foldMembers` gained the `verifyVac` trailing param, the Kick branch's additive vac gate, and the D-14 owner-exemption guard in the banlist-delete loop
- `packages/concord/src/helpers/__tests__/guestbook.test.ts` - `AUTH-08 Kick vac gate` describe block (5 tests) and `D-14 owner exemption in the banlist-delete loop` describe block (2 tests)
- `packages/concord/src/models/community.ts` - wired `vacVerifier(control, PERM.KICK)` into its `foldMembers` call, added `vacVerifier`/`PERM` imports
- `packages/concord/src/models/members.ts` - wired `vacVerifier(control, PERM.KICK)` into its `foldMembers` call, added `vacVerifier`/`PERM` imports
- `packages/concord/src/client/sync.ts` - wired `vacVerifier(state0, PERM.KICK)` inline into its `foldMembers` call (state0 predates the `members` fold, per RESEARCH Open Question 2 — vacVerifier only reads material/roles/grants)

## Decisions Made
- `verifyVac` is threaded as an optional trailing positional parameter on `foldMembers` (matching the function's existing positional shape), not an options object
- `client/sync.ts` passes `vacVerifier(state0, PERM.KICK)` inline as the literal 7th argument rather than a named local, since the function already declares `const verifyVac = vacVerifier(state, PERM.BAN)` later for the root rekey scope — an inline call avoids a naming collision and needless reordering
- Task 2's tests construct two roster views (an "old" roster fed to `foldMembers`' own `resolveStanding` param so the retained rank check passes, and a "current" roster fed to `vacVerifier`) to isolate the new vac-gate assertion from the pre-existing rank-vs-victim check, mirroring Phase 08-05's isAuthorized/vac independence pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Prettier auto-reformatted `guestbook.test.ts` after the D-14 test block was added (a pre-existing repo-wide format rule, not a logic change) — re-verified tests and typecheck green after the reformat, no behavior affected.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- AUTH-08 and D-14 are closed for `foldMembers`; the shared `vacVerifier` predicate now gates both the root/channel rekey (Phase 8) and Kick (this plan) authority paths, keeping one source of truth for the vac-citation rule
- `applesauce-concord` at 247/247 tests green, package builds clean (`tsc`), formatting clean
- Plan 09-04 (file-disjoint, Wave 1) is unblocked by this plan's completion

---
*Phase: 09-authority-permission-fold-correctness*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 5 modified files found on disk; all 3 task commit hashes (b0defc63, bbf1d1a1, bd76c0f8) found in git history.
