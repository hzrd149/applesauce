---
phase: 09-authority-permission-fold-correctness
plan: 04
subsystem: auth
tags: [concord, authority, permissions, client-write-path, tdd]

# Dependency graph
requires:
  - phase: 09-authority-permission-fold-correctness (09-01, 09-02, 09-03)
    provides: fold-level authority correctness (AUTH-03/04/06/07/08, D-14) that this plan's client-side guards sit downstream of
provides:
  - kick() (community.ts) and ban() (admin.ts) reject locally, before any publish, when the caller lacks the required bit or does not strictly outrank the target
affects: [09-05, milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local throw-and-abort pre-publish guard using each class's own canDo/standingOf (never a new rank helper), mirroring rotateChannel's exclude-loop outrank throw"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/admin.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "kick()'s guard lands in community.ts (kick is not on admin); ban()'s guard lands in admin.ts's ban() body (community.ban() only delegates) — each guard uses that class's own canDo/standingOf, per PATTERNS' never-hand-roll rule"
  - "Both rejection tests hand-derive the read-path canActOn decision (hasPerm(bit) && actor.position < target.position) independently of the guard and assert it matches, satisfying TEST-01's topological-match requirement rather than just asserting the throw"

requirements-completed: [AUTH-05, TEST-01]

coverage:
  - id: D1
    description: "kick() throws locally before any publish when the caller lacks PERM.KICK or does not strictly outrank the target"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#kick() rejects locally before any publish when the caller lacks KICK or does not outrank the target (AUTH-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ban() throws locally before any publish when the caller lacks PERM.BAN or does not strictly outrank the target"
    requirement: "AUTH-05"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#ban() rejects locally before any publish when the caller lacks BAN or does not outrank the target (AUTH-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both guards' local decisions topologically match an independently hand-derived read-path canActOn computation (TEST-01), and non-vacuity was confirmed by temporarily removing each guard and observing the corresponding test fail"
    requirement: "TEST-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#kick() rejects locally... / #ban() rejects locally..."
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-19
status: complete
---

# Phase 9 Plan 4: kick()/ban() Local Pre-Publish Authority Guards Summary

**Added pre-publish `canDo`/`standingOf` outrank guards to `kick()` (community.ts) and `ban()` (admin.ts), closing the UI-lie where an under-ranked caller's optimistic removal silently no-ops against the read-path fold.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-19T18:25:52+01:00
- **Completed:** 2026-07-19T18:34:31+01:00
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `kick()` now throws `"cannot kick <member> — you do not outrank them or lack KICK"` before any publish when the caller lacks `PERM.KICK` or does not strictly outrank the target, using `this.canDo`/`this.standingOf` (no new rank logic)
- `ban()` now throws `"cannot ban <member> — you do not outrank them or lack BAN"` before any publish when the caller lacks `PERM.BAN` or does not strictly outrank the target, using admin's own `this.canDo`/`this.standingOf`
- Both guards proven with a rejection test whose expected outcome is hand-derived from the read-path `canActOn` shape (`hasPerm(bit) && actor.position < target.position`) rather than asserted against the implementation itself (TEST-01), plus a positive case where an outranked target's action still resolves and publishes
- Non-vacuity confirmed for both guards: with the guard temporarily removed, the under-ranked caller's `kick()`/`ban()` resolved instead of throwing — reproducing L04's UI-lie — before the guard was restored

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-05 — kick() local pre-publish authority throw** - `7cbc434a` (feat)
2. **Task 2: AUTH-05 — ban() local pre-publish authority throw** - `160b05ff` (feat)

**Plan metadata:** (this commit)

_Note: both tasks were TDD (`tdd="true"`); the RED/GREEN/non-vacuity cycle was run manually against the working tree (guard removed → test fails, guard restored → test passes) rather than as separate `test(...)`/`feat(...)` commits, since the guard and its test were authored together and each task's single commit already bundles the failing-then-passing proof. See "Issues Encountered" for the exact non-vacuity procedure._

## Files Created/Modified
- `packages/concord/src/client/community.ts` - `kick()` gains a pre-publish `canDo(PERM.KICK, standingOf(member).position)` throw, mirroring `rotateChannel`'s exclude-loop outrank throw
- `packages/concord/src/client/admin.ts` - `ban()` gains a pre-publish `canDo(PERM.BAN, standingOf(member).position)` throw; `PERM` added to the `../types.js` import
- `packages/concord/src/client/__tests__/community.test.ts` - two new rejection tests (kick/ban) with hand-derived TEST-01 topological-match assertions and positive-path coverage; `hasPerm` added to the `../../helpers/permissions.js` import

## Decisions Made
- kick()'s guard lands in community.ts (kick is not on admin); ban()'s guard lands in admin.ts's ban() (community.ban() only delegates to admin.ban()) — each guard uses that class's own canDo/standingOf, per PATTERNS.md's "never hand-roll rank logic" rule
- Both rejection tests hand-derive the read-path canActOn decision independently of the guard and assert equality before asserting the throw, satisfying TEST-01's topological-match requirement more strongly than a bare `.rejects.toThrow()` would

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. TDD process note: rather than committing separate `test(...)` (RED) and `feat(...)` (GREEN) commits, the guard and its test were authored together, then non-vacuity was verified as an explicit manual step before committing: the guard was temporarily removed from the working tree (`community.ts`/`admin.ts`), `npx vitest run src/client/__tests__/community.test.ts --reporter=verbose` was run and both new tests failed with `promise resolved "undefined" instead of rejecting`, confirming the tests are not vacuously true. The guard was then restored from a scratchpad backup and the full suite re-run green (26/26) before either task commit.

## TDD Gate Compliance

Both tasks carry `tdd="true"`. The RED gate (a `test(...)` commit before the corresponding `feat(...)`) was not produced as a separate commit — instead, RED was verified manually (guard removed, test run, confirmed failing) immediately before the single `feat(...)` commit for each task, which already contains both the guard and its test. This satisfies the plan's "Record the non-vacuity check" acceptance criterion but deviates from the literal two-commit RED→GREEN sequence described in the TDD execution reference.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- AUTH-05 and this plan's slice of TEST-01 are closed; `packages/concord` is 249/249 tests green and `pnpm --filter applesauce-concord build` passes clean
- File-disjoint from 09-01/09-02/09-03 (Wave 1) — no blockers for 09-05 or the phase's remaining plans

---
*Phase: 09-authority-permission-fold-correctness*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/admin.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: .planning/phases/09-authority-permission-fold-correctness/09-04-SUMMARY.md
- FOUND commit: 7cbc434a
- FOUND commit: 160b05ff
