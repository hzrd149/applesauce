---
phase: 09-authority-permission-fold-correctness
plan: 01
subsystem: auth
tags: [concord, fold, grant, coordinate-binding, permissions, tdd]

# Dependency graph
requires:
  - phase: 06-refounding-rotation-authority-correctness
    provides: resolveStanding/hasPerm rank primitives (owner=0, roleless=0xffffffff sentinel) reused unchanged
provides:
  - "AUTH-03: Grant fold is coordinate-bound (eid === grantLocator(cid, grant.member)) and delivery-order independent"
  - "AUTH-04: Grant fold is total — malformed role_ids degrades to a skip, never a fold-wide throw"
  - "AUTH-07: non-self Grant folds only when signer strictly outranks the target's current standing; self-target and roleless-target grants unaffected"
affects: [09-02, 09-03, retroactive-secure-phase-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Grant fold coordinate/shape/rank guards as standalone unconditional `if (...) continue;` statements, never folded into the `authorized &&` chain — mirrors the existing banlist coordinate-gate shape in the same file"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/control.ts
    - packages/concord/src/helpers/__tests__/control.test.ts

key-decisions:
  - "cidBytes hoisted to a single declaration above the roles/grants fixpoint loop (was duplicated later at the banlist section); the later declaration deleted, not left as a second copy"
  - "AUTH-04's shape guard placed as its own unconditional continue BEFORE the authorized computation — an owner-signed malformed grant must also be rejected, and s.isOwner short-circuiting authorized would otherwise let it reach .every()/.join() unguarded"
  - "AUTH-07's target-rank clause ANDs into the existing roles-outrank .every() rather than replacing it — both constraints must hold independently (outrank every role handed out AND outrank the target)"
  - "Fixed a pre-existing test ('keeps a deleted role visible...') that published its Grant at eid=roleId instead of the derived grantLocator(cid, member) coordinate — it only passed before AUTH-03 existed to enforce coordinate binding"

patterns-established:
  - "Spec-derived test pattern for Grant fold: construct candidate editions directly via EditionFactory.create() at hand-computed coordinates (grantLocator(cidBytes, member), not read from foldControl's own output), fold, assert on the resulting state.grants map"

requirements-completed: [AUTH-03, AUTH-04, AUTH-07, TEST-01]

coverage:
  - id: D1
    description: "AUTH-03 — a Grant candidate whose eid != grantLocator(cid, grant.member) is dropped, even if signed by an authorized author; two Grants for the same member converge to the same result regardless of delivery order"
    requirement: AUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#folds a Grant only at its derived coordinate, delivery-order independent (AUTH-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUTH-04 — a Grant with role_ids as a non-array, or containing a non-string entry, is skipped without throwing (even owner-signed); an empty role_ids still folds as a valid revoke (D-08)"
    requirement: AUTH-04
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#skips a Grant whose role_ids is not an array, without throwing, even when owner-signed (AUTH-04)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#skips a Grant whose role_ids contains a non-string entry, without throwing (AUTH-04)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#treats an empty role_ids as a valid revoke, not malformed (AUTH-04/D-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AUTH-07 — a junior MANAGE_ROLES holder cannot revoke/demote a senior member's Grant; self-targeting Grants and grants to a roleless (never-granted) target are unaffected"
    requirement: AUTH-07
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#rejects a junior member's revoke of a senior member's Grant (AUTH-07)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#still allows a self-targeting Grant despite failing the (non-exempt) target-rank check (AUTH-07)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/control.test.ts#still allows granting a role to a roleless (never-granted) target (AUTH-07)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-19
status: complete
---

# Phase 9 Plan 1: Grant Fold Authority Correctness Summary

**Closed three live Grant-fold holes in `foldControl` — coordinate binding (AUTH-03), total malformed-input handling (AUTH-04), and strict target-outrank gating (AUTH-07) — each proven by a spec-derived test with a recorded non-vacuity result.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-19T16:51:00Z (approx, per plan read)
- **Completed:** 2026-07-19T17:08:10Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- A forged-coordinate Grant (any eid other than `grantLocator(cid, grant.member)`) is now dropped, even when signed by an authorized author — the Grant fold is delivery-order independent for a given member.
- `foldControl` is now total over a malformed `role_ids`: a non-array or an array with a non-string entry is skipped via a standalone, unconditional guard (never reached through the `authorized` chain, so an owner-signed malformed Grant is caught too). Empty `role_ids` still folds as a valid revoke (D-08).
- A non-self Grant now folds only when the signer strictly outranks the target member's CURRENT standing, closing the vacuous `[].every()` hole that let any MANAGE_ROLES holder revoke/demote a senior member. Self-targeting Grants (leave/self-revoke) and grants to a roleless (never-granted) target are unaffected.

## Task Commits

Each task followed RED → GREEN TDD:

1. **Task 1: AUTH-03 coordinate gate**
   - `152d261d` test(09-01): add failing test for AUTH-03 Grant coordinate gate
   - `1103e268` feat(09-01): AUTH-03 gate the Grant fold on its derived coordinate
2. **Task 2: AUTH-04 malformed role_ids guard**
   - `e559f4aa` test(09-01): add failing tests for AUTH-04 malformed role_ids guard
   - `59b63c9b` feat(09-01): AUTH-04 skip a malformed Grant instead of throwing
3. **Task 3: AUTH-07 target-rank clause**
   - `dfdb01db` test(09-01): add failing test for AUTH-07 junior-strips-senior revoke
   - `9b9b4acc` feat(09-01): AUTH-07 gate non-self Grants on strictly outranking the target

## Files Created/Modified
- `packages/concord/src/helpers/control.ts` — imported `grantLocator`; hoisted the single `cidBytes` declaration above the Grant fold loop; added the AUTH-03 coordinate gate, AUTH-04 unconditional shape guard, and AUTH-07 target-rank AND-clause to the Grant loop (`:174-212`).
- `packages/concord/src/helpers/__tests__/control.test.ts` — added 6 new spec-derived tests (1 AUTH-03, 3 AUTH-04, 3 AUTH-07 including self-target and roleless-target regression guards); fixed one pre-existing test that relied on the old ignored-coordinate behavior.

## Decisions Made
- `cidBytes` hoisted to one declaration above the fixpoint loop rather than computed twice (RESEARCH Pitfall 1) — the later `:293` declaration was deleted, not duplicated.
- AUTH-04's shape guard is a standalone `if (...) continue;` placed before `authorized`, not folded into the `authorized &&` chain, so it cannot be bypassed by `s.isOwner` short-circuiting.
- AUTH-07's target-rank clause is ANDed into the existing roles-outrank `.every()`, not a replacement — both "outrank every role handed out" and "outrank the target" must hold.
- Fixed the pre-existing test `"keeps a deleted role visible in state but strips its authority"`, which published its Grant at `eid: roleId` instead of the derived `grantLocator(cid, member)` coordinate. This only ever passed because AUTH-03 didn't exist yet to enforce the coordinate; per Rule 1 (auto-fix bugs caused by the current task's change), the test fixture was corrected to use the spec-correct coordinate rather than weakening the new guard.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a pre-existing test that published a Grant at the wrong coordinate**
- **Found during:** Task 1 (AUTH-03 coordinate gate)
- **Issue:** `"keeps a deleted role visible in state but strips its authority"` (control.test.ts) constructed its Grant edition at `eid: roleId` rather than `grantLocator(community_id, member)`. Once AUTH-03 enforces coordinate binding, this Grant is correctly dropped as forged, breaking the test's unrelated assertion about deleted-role authority stripping.
- **Fix:** Changed the test's Grant `eid` to `grantLocator(hexToBytes(genesis.material.community_id), grant.member)`.
- **Files modified:** `packages/concord/src/helpers/__tests__/control.test.ts`
- **Verification:** Full `control.test.ts` suite green (240/240) after the fix.
- **Committed in:** `1103e268` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug fix, test-fixture only — no production behavior change beyond the intended AUTH-03 fix)
**Impact on plan:** No scope creep; the fix was a direct, necessary consequence of correctly implementing AUTH-03 as specified.

## Non-Vacuity Checks (recorded per TEST-01/D-12)

Each new guard was proven load-bearing by reverting it and observing the associated test fail:

- **AUTH-03 (coordinate gate):** the "folds a Grant only at its derived coordinate" test was written and run BEFORE the fix existed (true RED state, not a simulated revert) — it failed with the forged-coordinate Grant clobbering the genuine one (`expected [] to deeply equal ["0101..."]`). After the fix, both forward and reversed delivery order converge to `[roleId]`.
- **AUTH-04 (shape guard):** both malformed-role_ids tests were written and run BEFORE the fix existed — the non-array case threw `TypeError: grant.role_ids.join is not a function` out of `foldControl` (reproducing M06); the non-string-entry case folded successfully instead of being rejected (`expected true to be false`). After the fix, both are skipped without throwing.
- **AUTH-07 (target-rank clause):** the junior-strips-senior test was written and run BEFORE the fix existed — the junior's revoke succeeded (`expected [] to deeply equal ["0101..."]`, i.e. the senior's grant was wiped). After the fix, it's rejected. Additionally, the self-target exemption specifically was verified by re-removing just the `grant.member === cand.author ||` clause post-fix and re-running: the self-revoke test then failed, sticking at the original `[juniorRoleId]` (never revoked) instead of the exempted `[]` — confirming the exemption clause, not just the rank check as a whole, is load-bearing.

## Issues Encountered

- The self-revoke test (`role_ids: []` against one's own Grant, chained after an owner-authored initial grant) exercises `foldControl`'s fixed 4-pass fixpoint loop in a non-obvious way: because the self-edit removes the actor's own `MANAGE_ROLES` bit, the fold toggles between "revoked" (self-edit wins, using standing carried over from the prior pass) and "reinstated" (falls back to the still-valid owner-authored edition once the self-edit's own perm is lost) across passes, converging deterministically to "revoked" only because the pass count is fixed at 4. This was verified empirically with a scratch probe before committing the test, and confirmed to hold identically both pre- and post-AUTH-07 (since the self-exemption preserves exactly this pre-existing self-edit behavior — AUTH-07 only changes non-self targeting). No production code change was needed for this; it's documented here as context for a future reader of that test.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three Grant-fold authority holes (AUTH-03/04/07) closed with spec-derived, non-vacuous tests; `applesauce-concord` 240/240 tests green, package builds clean (`tsc`).
- Ready for the next plan in phase 09 (AUTH-06 Role fold `position` guard, D-14 banlist rank+owner-exemption, AUTH-08 guestbook vac gate, AUTH-05 client-side kick/ban pre-publish guards, per 09-PATTERNS.md).

---
*Phase: 09-authority-permission-fold-correctness*
*Completed: 2026-07-19*

## Self-Check: PASSED

All referenced files exist (`control.ts`, `control.test.ts`) and all 6 task commit hashes (`152d261d`, `1103e268`, `e559f4aa`, `59b63c9b`, `dfdb01db`, `9b9b4acc`) are present in git history.
