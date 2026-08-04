---
phase: 09-authority-permission-fold-correctness
verified: 2026-07-19T18:16:53Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 9: Authority & Permission Fold Correctness Verification Report

**Phase Goal:** Grant, Kick, Ban, and Role folds enforce the rank comparisons CORD-04 specifies and reject malformed input locally, instead of defaulting to permit or throwing out of `foldControl` and failing every member's community state.
**Verified:** 2026-07-19T18:16:53Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | AUTH-03: A Grant edition is folded only at its derived coordinate (`grantLocator`), delivery-order independent | ✓ VERIFIED | `control.ts:192-197` — `if (eid !== grantLocator(cidBytes, grant.member)) continue;`. Test `"folds a Grant only at its derived coordinate, delivery-order independent (AUTH-03)"` (`control.test.ts:172`) folds a forged-eid Grant + genuine one in both delivery orders, both converge to `[roleId]`. |
| 2 | AUTH-04: A malformed Grant (`role_ids` not `string[]`) is skipped, never throws out of `foldControl` | ✓ VERIFIED | `control.ts:198-203` — standalone `if (!Array.isArray(...) \|\| !...every(...)) continue;` placed BEFORE `authorized`, so an owner-signed malformed grant is also caught. Confirmed by live non-vacuity re-test (see below): removing the guard reproduces the exact M06 `TypeError: grant.role_ids.join is not a function`. |
| 3 | AUTH-05: `kick()`/`ban()` reject locally, before any publish, when the caller lacks the bit or rank | ✓ VERIFIED | `community.ts:1015-1016` (`kick()`) and `admin.ts:262-263` (`ban()`) — both throw via `this.canDo(PERM, standingOf(target).position)` before any `grantRoles`/`publishEdition` call. Tests at `community.test.ts:1311` and `:1388` hand-derive the expected `canActOn` decision independently and assert it matches the guard's outcome (TEST-01). |
| 4 | AUTH-06: `Role.position` is validated as a positive integer below the roleless sentinel before conferring bits | ✓ VERIFIED | `control.ts:163-168` — `if (!Number.isInteger(role.position) \|\| role.position <= 0 \|\| role.position >= 0xffffffff) continue;` inserted BEFORE the pre-existing `<=` checks. Test at `control.test.ts:512` hand-picks `"NaN"`, `1.5`, `undefined`, `0xffffffff` and asserts zero conferred permission bits for each, plus a valid-position control case that still folds. |
| 5 | AUTH-07: A Grant that revokes or demotes is gated by a rank comparison against its target member (equal cannot act on equal); self-target and roleless-target exempt | ✓ VERIFIED | `control.ts:210-218` — `(grant.member === cand.author \|\| s.position < targetStanding.position)` ANDed into the existing `authorized` chain, on top of (not replacing) the roles-outrank `.every()`. Live non-vacuity re-test performed during this verification (see below) reproduces the junior-strips-senior hole when the clause is removed. |
| 6 | AUTH-08: A Kick's `vac` is validated against the cited Grant and required for non-owner Kicks; a demoted actor's stale-but-structurally-valid `vac` is dropped by the CURRENT roster | ✓ VERIFIED | `guestbook.ts:90-97` — additive `verifyVac` gate inside the retained rank-vs-victim check; `vacVerifier(state, PERM.KICK)` (`permissions.ts:98-111`) reused unchanged. Wired at all 3 production call sites (`models/community.ts:62`, `models/members.ts:30`, `client/sync.ts:183`), confirmed by direct read (not just grep). `guestbook.test.ts:121-251` includes a built-in non-vacuity test (`"non-vacuity: with verifyVac omitted, the same demoted-actor Kick succeeds"`) proving the gate is load-bearing. |
| 7 | AUTH-09/D-14: The read-path banlist honors a banned pk only when the signer strictly outranks that pk's current standing, and the owner is never bannable | ✓ VERIFIED | `control.ts:322-331` — per-pk gate `if (s.isOwner \|\| s.position < standing(pk).position) banlist.add(pk);`, additive to the author-BAN-bit check. `guestbook.ts:132-135` adds a defense-in-depth owner exemption in the banlist-delete loop. Live non-vacuity re-test performed during this verification (see below) reproduces the owner-bannable hole when the gate is removed; `guestbook.test.ts:258-290` includes a built-in non-vacuity test for the owner-exemption half. |
| 8 | D-03: An in-repo upstream clarification note records the CORD-04 §2/§3 ambiguity and the strict reading implemented | ✓ VERIFIED | `packages/concord/UPSTREAM-NOTES.md` exists, documents the §2 vs §3/§5 divergence, states the strict reading shipped, and references the AUTH-07 tests. No changeset created (concord is unreleased, per CLAUDE.md). |
| 9 | REQUIREMENTS.md/concord-audit.md traceability marks AUTH-03..08 resolved and records the D-14 rider as a NEW finding (not silently folded in) | ✓ VERIFIED | `REQUIREMENTS.md:39-45` — AUTH-03..08 all `[x]` Complete, AUTH-07/08 carry their ruling resolutions; AUTH-09 added as a distinct new requirement citing D-14. `concord-audit.md:212` — new finding `D14` recorded in a dedicated post-audit section, cross-referencing AUTH-09. Coverage count updated 53→54. |

**Score:** 9/9 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/helpers/control.ts` | AUTH-03/04/06/07 + D-14 guards in Grant/Role/Banlist folds | ✓ VERIFIED | All four guards present, correctly ordered, additive (not replacing existing checks); confirmed by direct read of full file. |
| `packages/concord/src/helpers/guestbook.ts` | `verifyVac` trailing param, Kick vac gate, banlist owner exemption | ✓ VERIFIED | `foldMembers` signature (`:54-62`) carries the optional `verifyVac` param; Kick branch (`:90-97`) and banlist-delete loop (`:132-135`) both confirmed. |
| `packages/concord/src/client/community.ts` | `kick()` local pre-publish throw | ✓ VERIFIED | `:1015-1016`, precedes `grantRoles`/`vacFor`/`publishToPlane`. |
| `packages/concord/src/client/admin.ts` | `ban()` local pre-publish throw | ✓ VERIFIED | `:262-263`, precedes `publishEdition`/`grantRoles`. |
| `packages/concord/src/models/community.ts`, `models/members.ts`, `client/sync.ts` | `verifyVac: vacVerifier(<state>, PERM.KICK)` wired at each `foldMembers` call | ✓ VERIFIED | All three sites read directly and confirmed passing the 7th positional argument correctly. |
| `packages/concord/UPSTREAM-NOTES.md` | D-03 clarification note | ✓ VERIFIED | Exists, substantive (18 lines), documents the ambiguity and the shipped reading. |
| `.planning/REQUIREMENTS.md`, `.planning/concord-audit.md` | AUTH-03..09 traceability + D-14 new finding | ✓ VERIFIED | Both files updated as claimed. |
| `packages/concord/src/helpers/__tests__/control.test.ts` | spec-derived tests for AUTH-03/04/06/07 + D-14(banlist read) | ✓ VERIFIED | All present, hand-derive expected coordinates/ranks independently of the implementation (via `grantLocator` called directly, hand-tabulated positions). |
| `packages/concord/src/helpers/__tests__/guestbook.test.ts` | spec-derived tests for AUTH-08 + D-14(owner exemption) | ✓ VERIFIED | Present, including in-suite non-vacuity assertions (not just narrated in SUMMARY). |
| `packages/concord/src/client/__tests__/community.test.ts` | AUTH-05 rejection tests | ✓ VERIFIED | Present, hand-derive the `canActOn` decision independently before asserting the throw (TEST-01 topological match). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `control.ts` Grant loop | `crypto.ts` `grantLocator` | coordinate equality gate | ✓ WIRED | Imported at `:22`, used at `:197`. |
| `guestbook.ts` `foldMembers` Kick branch | `permissions.ts` `vacVerifier` | injected `verifyVac` predicate | ✓ WIRED | No bespoke vac logic in `guestbook.ts`; predicate called at `:96`. |
| `models/community.ts` | `guestbook.ts` `foldMembers` | `vacVerifier(control, PERM.KICK)` 7th arg | ✓ WIRED | `:62`. |
| `models/members.ts` | `guestbook.ts` `foldMembers` | `vacVerifier(control, PERM.KICK)` 7th arg | ✓ WIRED | `:30`. |
| `client/sync.ts` | `guestbook.ts` `foldMembers` | `vacVerifier(state0, PERM.KICK)` 7th arg | ✓ WIRED | `:183`, `state0` predates the `members` fold as required (vacVerifier only reads material/roles/grants). |
| `client/community.ts` `kick()` | `client/community.ts` `canDo`/`standingOf` | local pre-publish guard | ✓ WIRED | `:1015`. |
| `client/admin.ts` `ban()` | `client/admin.ts` `canDo`/`standingOf` | local pre-publish guard | ✓ WIRED | `:262`. |

### Behavioral Spot-Checks (Non-Vacuity Re-Verification)

SUMMARY.md non-vacuity claims were independently re-verified during this session by reverting each guard in the live working tree and re-running the affected test — not trusted from the SUMMARY narrative alone. All reverts were restored and the tree confirmed clean (`git diff --stat` empty) afterward.

| Guard | Revert Method | Result | Status |
|-------|---------------|--------|--------|
| AUTH-07 target-rank clause | Replaced the AND-clause with `true` via `sed` | `"rejects a junior member's revoke of a senior member's Grant (AUTH-07)"` FAILED — junior's revoke succeeded (`expected [] to deeply equal [...]`) | ✓ PASS (non-vacuous) |
| AUTH-04 shape guard | Removed the `if (...) continue;` line via `sed` | Both AUTH-04 tests FAILED — one reproduced the exact `TypeError: grant.role_ids.join is not a function` (M06), the other showed the malformed grant folding | ✓ PASS (non-vacuous) |
| D-14/AUTH-09 banlist rank gate | Replaced the conditional `banlist.add(pk)` with an unconditional add via `sed` | `"honors a banlist entry only when the signer strictly outranks the target..."` FAILED — `"owner must never be bannable: expected true to be false"` | ✓ PASS (non-vacuous) |
| AUTH-08 vac gate | Not independently reverted (test suite already contains a dedicated in-code non-vacuity test: `"non-vacuity: with verifyVac omitted, the same demoted-actor Kick succeeds"`) | Confirmed present and asserts the correct (opposite) outcome when `verifyVac` is omitted | ✓ PASS (non-vacuous, self-contained) |

Full suite: `pnpm --filter applesauce-concord test` → **251/251 passed** (45 test files), re-run independently in this session.
Workspace build: `pnpm --filter applesauce-concord build` → **exit 0**.

### Anti-Patterns Found

None. Scanned all 8 phase-modified files (`control.ts`, `guestbook.ts`, `permissions.ts`, `community.ts`, `admin.ts`, `models/community.ts`, `models/members.ts`, `client/sync.ts`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AUTH-03 | 09-01 | Grant folds only at derived coordinate | ✓ SATISFIED | `control.ts:192-197` + test |
| AUTH-04 | 09-01 | Malformed Grant skipped, not thrown | ✓ SATISFIED | `control.ts:198-203` + test |
| AUTH-05 | 09-04 | `kick()`/`ban()` local pre-publish reject | ✓ SATISFIED | `community.ts:1015`, `admin.ts:262` + tests |
| AUTH-06 | 09-02 | `Role.position` integer validation | ✓ SATISFIED | `control.ts:163-168` + test |
| AUTH-07 | 09-01 | Grant target-rank gate (strict reading) | ✓ SATISFIED | `control.ts:210-218` + test, ruling resolved and documented |
| AUTH-08 | 09-03 | Kick `vac` gate | ✓ SATISFIED | `guestbook.ts:90-97` + tests, ruling resolved and documented |
| AUTH-09 (D-14, new) | 09-02/09-03/09-05 | Banlist per-target rank + owner exemption | ✓ SATISFIED | `control.ts:322-331`, `guestbook.ts:132-135` + tests; recorded as new finding in REQUIREMENTS.md/concord-audit.md |
| TEST-01 (standing, this phase's contribution) | all | Spec-derived tests for every fold touched | ✓ SATISFIED | Verified hand-derived (not read from implementation) coordinates/ranks in every new test; non-vacuity independently reproduced for 3 of 4 core guards this session, the 4th self-contained in-suite |

No orphaned requirements found — REQUIREMENTS.md's Phase 9 rows (AUTH-03..09) all trace to a plan in this phase.

### Human Verification Required

None. All must-haves are verifiable via code inspection, test execution, and independent non-vacuity re-verification.

### Gaps Summary

No gaps. All 9 observable truths verified against the actual codebase (not SUMMARY claims), including live re-execution of non-vacuity checks for 3 of the 4 core rank/shape guards (the 4th already carries a self-contained non-vacuity test in the suite). Full test suite (251/251) and workspace build both green, independently re-run during this verification session. Traceability and upstream documentation deliverables confirmed present and substantive.

---

*Verified: 2026-07-19T18:16:53Z*
*Verifier: Claude (gsd-verifier)*
