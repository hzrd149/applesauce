---
phase: 09-authority-permission-fold-correctness
plan: 02
subsystem: auth
tags: [concord, fold, control-plane, roles, banlist, permissions, tdd]

# Dependency graph
requires:
  - phase: 09-authority-permission-fold-correctness
    plan: 01
    provides: cidBytes hoisted above the fixpoint loop; grantLocator imported into control.ts (shared file this plan also edits)
provides:
  - "AUTH-06: Role fold rejects a Role.position that is not a positive integer strictly below the roleless sentinel (0xffffffff), before either existing `<=` check runs"
  - "D-14: read-path banlist fold honors a banned pk only when the list author strictly outranks that pk's CURRENT standing; the owner is never bannable regardless of signer rank"
affects: [09-03, 09-04, 09-05, retroactive-secure-phase-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skip-candidate-on-malformed-shape guard placed as its own standalone `if (...) continue;` BEFORE the pre-existing `<=` checks — a `<=` comparison against NaN/undefined is always false and a float passes an integer-shaped bound, so those checks alone cannot reject a malformed value"
    - "Per-entry rank gate inside a set-fold loop: `s.isOwner || s.position < standing(TARGET).position`, reusing the already-injected `standing()` closure — identical shape to AUTH-07's Grant target-rank clause, applied to the banlist's per-pk entries instead of a single Grant target"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/control.ts
    - packages/concord/src/helpers/__tests__/control.test.ts

key-decisions:
  - "AUTH-06's guard tests four hand-picked CORD-04 §3 u32-boundary values, none of which requires an actual JS NaN to travel over JSON (which is impossible — JSON.stringify(NaN) always serializes to null): a wire-arrived non-numeric string \"NaN\" (Number.isInteger rejects non-number types; the OLD `<=` checks coerce it to NaN and never trigger, reproducing the described `NaN <= x` hole), a real float (1.5), an omitted position field (undefined — the project's known \"hand-rolled literal drops an optional field\" bug class), and the roleless sentinel 0xffffffff itself"
  - "AUTH-06's test asserts on resolved PERMISSION BITS (via resolveStanding), not on `state.grants.has(member)` — an owner-signed Grant still records a dead role_id in `state.grants` (owner authority to grant is separate from a role's own validity, s.isOwner short-circuits the Grant fold's role-lookup checks); what the guard must prevent is the member gaining any bits from the skipped role, which resolveStanding already guarantees by skipping a missing role_id (permissions.ts:56)"
  - "D-14's fix wraps the JSON.parse's inner for-loop with a per-pk conditional, replacing the flat `banlist.add(pk)` — kept inside the existing outer author-BAN-bit check and try/catch, so the fix is a minimal targeted diff inside the existing control-flow shape rather than a restructuring"

requirements-completed: [AUTH-06, D-14, TEST-01]

coverage:
  - id: D1
    description: "AUTH-06 — a Role.position that is NaN(-text)/1.5/undefined/0xffffffff is skipped in the Role fold and confers no permission bits to any member granted it; a valid positive-integer position still folds"
    requirement: AUTH-06
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#rejects a Role.position that is not a positive integer below the roleless sentinel (AUTH-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-14 — the banlist fold honors a pk only when the signer strictly outranks that pk's current standing; a junior BAN-holder cannot ban a senior or the owner, but can still ban someone they strictly outrank"
    requirement: D-14
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#honors a banlist entry only when the signer strictly outranks the target, and the owner is never bannable (D-14)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-07-19
status: complete
---

# Phase 9 Plan 2: Role.position Guard + Banlist Rank Gate Summary

**Closed two live `foldControl` authority holes in `control.ts` — a Role fold defense-in-depth gap letting a malformed `position` confer permission bits (AUTH-06), and a read-path banlist fold with no per-entry rank check that let a junior BAN-holder list the owner or a senior (D-14) — each proven by a spec-derived test with a recorded non-vacuity result.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-19T18:42:27+01:00 (first task commit)
- **Completed:** 2026-07-19T18:48:52+01:00 (last task commit)
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- The Role fold now rejects any `position` that is not a positive integer strictly below the roleless sentinel (`0xffffffff`) BEFORE either pre-existing `<=` check runs — closing the defense-in-depth hole where `NaN <= x` (always false) or a float passing an integer-shaped bound let a malformed role fold and confer its permission bits (L05).
- The read-path banlist fold now honors a banned pk only when the list author strictly outranks that pk's CURRENT standing (`s.isOwner || s.position < standing(pk).position`), additive to the pre-existing author-BAN-bit check — closing the hole where any BAN-holder, regardless of rank, could drop an arbitrary pk (including the owner or a senior member) from the roster.
- The owner is now unbannable for free — no signer's position can ever be strictly below `0`.

## Task Commits

Each task followed RED → GREEN TDD:

1. **Task 1: AUTH-06 Role.position guard**
   - `71095b0a` test(09-02): add failing test for AUTH-06 Role.position integer guard
   - `62ed7aff` feat(09-02): AUTH-06 validate Role.position as a positive integer below the roleless sentinel
2. **Task 2: D-14 banlist per-entry rank gate + owner exemption**
   - `e3832778` test(09-02): add failing test for D-14 banlist per-entry rank gate + owner exemption
   - `53006160` feat(09-02): D-14 banlist per-entry rank gate honors only strictly-outranked targets

## Files Created/Modified
- `packages/concord/src/helpers/control.ts` — Role fold gained the AUTH-06 integer/range guard (`:163-168`); Banlist fold's flat `banlist.add(pk)` replaced with the D-14 per-pk rank gate (`:319-330`).
- `packages/concord/src/helpers/__tests__/control.test.ts` — added 2 new spec-derived tests (AUTH-06's four-case Role.position rejection + valid-position control case; D-14's senior/junior/owner/bystander banlist rank test).

## Decisions Made
- AUTH-06 test values chosen to be achievable over the real JSON wire (a JS `NaN` cannot survive `JSON.stringify`/`JSON.parse` round-trip — it always serializes to `null`): a wire string `"NaN"`, a real float `1.5`, an omitted `position` key (`undefined`), and the sentinel `0xffffffff` — see key-decisions above for full rationale.
- AUTH-06 assertions check resolved permission bits (`resolveStanding(...).permissions === 0n`) rather than `state.grants.has(member)`, since an owner-signed Grant can still record a dead role_id independent of whether that role validly folded.
- D-14's fix is a minimal per-pk conditional inside the existing loop/try/catch shape, not a restructuring — mirrors AUTH-07's Grant target-rank clause applied to a different entity in the same file.

## Deviations from Plan

None — plan executed exactly as written. Both guards landed exactly where and how the plan/PATTERNS.md specified (Role fold: standalone `continue` before the existing `<=` checks; Banlist fold: per-pk rank gate additive to the author-bit check, `standing(pk)` resolving the banned target, never `s.position < s.position`).

## Issues Encountered

- During the AUTH-06 non-vacuity revert-and-restore step, a `git checkout -- control.ts` (intended to discard only the temporary `if (false) continue;` revert-marker edit) also discarded the not-yet-committed AUTH-06 guard implementation itself, since only the test had been committed at that point (correct TDD RED state). Caught immediately by re-running the test suite (250/251 green with the guard missing) and by re-reading the file; the guard was re-applied via `Edit` and the GREEN state re-verified (250/250, then 251/251 after Task 2's RED test was added) before committing. For the D-14 non-vacuity check (after Task 2's GREEN commit), the revert/restore was done entirely via targeted `Edit` calls rather than `git checkout`, to avoid repeating the same failure mode — confirmed via `git diff --stat` showing zero diff against the committed state afterward.

## Non-Vacuity Checks (recorded per TEST-01/D-12)

Each new guard was proven load-bearing by reverting it and observing the associated test fail:

- **AUTH-06 (Role.position integer guard):** with the guard replaced by `if (false) continue;`, the "NaN" wire-string case failed first (`AssertionError: role.position=NaN must be skipped: expected true to be false`) — the malformed role folded into `state.roles` exactly as L05 describes. Restored via `Edit`, full suite green (251/251).
- **D-14 (banlist per-entry rank gate):** with the per-pk check replaced by `if (true) banlist.add(pk);` (the original flat behavior), the test failed first on `AssertionError: owner must never be bannable: expected true to be false` — the junior BAN-holder's list successfully banned the owner (and, by the same unconditional add, would have banned the senior too). Restored via `Edit`, full suite green (251/251); `git diff --stat` confirmed no residual diff against the committed fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both AUTH-06 and D-14 holes closed with spec-derived, non-vacuous tests; `applesauce-concord` 251/251 tests green, package builds clean (`tsc`).
- `control.ts`'s Grant fold (AUTH-03/04/07, from 09-01), Role fold (AUTH-06), and Banlist fold (D-14) are now all hardened. Remaining phase-9 scope per 09-PATTERNS.md: AUTH-08 guestbook vac gate, AUTH-05 client-side kick/ban pre-publish guards (already landed per STATE.md's 09-03/09-04 summaries, executed out of wave order relative to this plan).

---
*Phase: 09-authority-permission-fold-correctness*
*Completed: 2026-07-19*

## Self-Check: PASSED

All referenced files exist (`control.ts`, `control.test.ts`) and all 4 task commit hashes (`71095b0a`, `62ed7aff`, `e3832778`, `53006160`) are present in git history.
