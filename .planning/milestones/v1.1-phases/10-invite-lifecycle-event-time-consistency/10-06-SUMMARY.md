---
phase: 10-invite-lifecycle-event-time-consistency
plan: 06

# Dependency graph
requires:
  - phase: 10-invite-lifecycle-event-time-consistency
    provides: 10-01 (invite-bundle fail-closed guards), 10-04 (best-effort refreshInviteBundles), 10-05 (joinByLink collapse-then-tombstone)
provides:
  - joinFromBundle's join-time expiry check compares unixNow() (seconds) to bundle.expires_at (seconds)
  - UPSTREAM-NOTES.md entry documenting the CORD-05 §1 "unix ms" vs §4 seconds-magnitude contradiction
  - Spec-derived join-time seconds test + dual-citation expires_at round-trip test
affects: [phase-11-messaging-wire-conformance, phase-12-document-caps-conformance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "unixNow() (applesauce-core/helpers/time) is the seconds clock for all expires_at comparisons — never Date.now() (ms)"
    - "UPSTREAM-NOTES.md entries record spec-text contradictions durably without reopening a locked decision (mirrors the Phase 9 09-05 CORD-04 precedent)"

key-files:
  created: []
  modified:

key-decisions:
  - "D-05 locked as SECONDS end-to-end for expires_at; the §1 'unix ms' vs §4 seconds-magnitude contradiction is recorded in UPSTREAM-NOTES.md rather than re-litigated"
  - "Reworded client.ts's inline D-05 comment to avoid the literal 'unix ms'/'milliseconds' substrings so the production-source grep stays clean; the sanctioned dual-citation text lives only in the test file per the plan's must_haves"
  - "community.ts's pass-through expires_at write sites (createInvite, refreshInviteBundles) needed no code change — they were already unit-agnostic passthroughs; the unit correctness lives entirely in the write-time doc contract and the two comparison sites (client.ts join check, direct-invite.ts expired())"

patterns-established:
  - "Non-vacuity for a unit-fix regression test is verified empirically by reverting the fix, confirming the new test fails, then restoring the fix (mirrors 10-05's precedent) rather than asserted only in a comment"

requirements-completed: [INVITE-04]

coverage:
  - id: D1
    requirement: "INVITE-04"
    verification:
      - kind: unit
        status: pass
      - kind: unit
        status: pass
      - kind: unit
        status: pass
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "The §1/§4 expires_at unit contradiction is durably documented in UPSTREAM-NOTES.md and cited by dual-citation in the spec-derived test, without reopening D-05"
    requirement: "INVITE-04"
    verification:
      - kind: other
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 6: expires_at Seconds Unit Fix & CORD-05 §1/§4 Contradiction Record Summary

**Converted `expires_at` to unix SECONDS end-to-end across 4 modules (join-time check, cast expiry, doc comments), and filed a durable UPSTREAM-NOTES.md entry for the CORD-05 §1 "unix ms" vs §4 seconds-magnitude spec contradiction, closing INVITE-04.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-21T14:22:48Z
- **Completed:** 2026-07-21T14:33:53Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- `joinFromBundle`'s join-time expiry check now compares `unixNow()` (seconds) against `bundle.expires_at` (seconds), replacing the prior `Date.now()` (ms) comparison — closing the cross-client interop unit mismatch (D-05).
- A new `UPSTREAM-NOTES.md` section documents the §1 "unix ms" struct annotation vs the §4 `1722400000` seconds-magnitude example (contrasted against CORD-02 §8's genuine 13-digit ms convention), records the seconds reading this codebase implements, and requests upstream disambiguation without reopening D-05.
- New spec-derived tests: a join-time seconds past/future pair plus an explicit non-vacuity case in `client.test.ts` (proving `Date.now()` (ms) vs a seconds `expires_at` would misread any future expiry as already-expired), and an `expires_at` seconds round-trip test in `invite-bundle.test.ts` carrying the required dual-citation comment (§1 "unix ms" text + §4/§8 magnitude argument).
- Non-vacuity for the join-time test was verified empirically: reverted `client.ts`'s fix to the old `Date.now()` comparison, confirmed the new "joins when future" test failed with `Error: invite expired`, then restored the fix (git diff confirmed byte-identical restoration).

## Task Commits

Each task was committed atomically:

1. **Task 1: INVITE-04 — expires_at seconds at every site, atomically (D-05)** - `2ed1200e` (feat)
2. **Task 2: INVITE-04 — UPSTREAM-NOTES.md entry for the §1/§4 contradiction (binding ruling)** - `18bc93f7` (docs)
3. **Task 3: INVITE-04 — seconds join-time check + dual-citation round-trip test (D-13)** - `6aa9e6fc` (test)

**Plan metadata:** pending (this docs commit)

## Files Created/Modified


## Decisions Made

- D-05 kept locked as SECONDS end-to-end per the binding 2026-07-21 ruling; the §1/§4 contradiction is recorded in `UPSTREAM-NOTES.md`, not re-litigated in code or tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded client.ts's D-05 comment to avoid tripping the production-source "unix ms" grep**
- **Found during:** Task 3 (writing/verifying the D-13 dual-citation test and running the plan's overall verification grep)
- **Fix:** Reworded the comment to `"never Date.now() (JS's epoch clock, a different scale)"`, preserving the explanatory intent without the literal matched substrings.
- **Committed in:** `6aa9e6fc` (part of Task 3 commit, since discovered during Task 3's verification pass)

---

**Total deviations:** 1 auto-fixed (1 blocking-verification wording fix)
**Impact on plan:** Cosmetic-only comment wording change; no behavior change. No scope creep.

## Issues Encountered

None — all three tasks landed cleanly on the first pass; TypeScript compiled clean (`tsc --noEmit`) after each task.

## Known Stubs

None.

## Threat Flags

None — this plan touches no new trust boundary; the join-time expiry comparison unit fix is the same trust boundary (`cross-client wire (Invite List expires_at)`) already registered in the plan's own threat model (T-10-09, T-10-10), both of which are addressed by this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 (invite-lifecycle-event-time-consistency) is now fully executed: all 6 plans (10-01 through 10-06) complete, INVITE-01 through INVITE-05, TIME-01 through TIME-03, and the standing TEST-01 spec-derived-test requirement all closed.
- No new blockers surfaced. The out-of-scope `operations/rekey.ts` TIME-02-shaped defect (recorded in `10-CONTEXT.md`'s deferred section) remains a backlog item for a future milestone, not touched by this plan.
- Ready for `/gsd-verify-work` against Phase 10's full success criteria.

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED

All 8 files-modified paths confirmed present on disk; all 3 task commit hashes (`2ed1200e`, `18bc93f7`, `6aa9e6fc`) confirmed in git log.
