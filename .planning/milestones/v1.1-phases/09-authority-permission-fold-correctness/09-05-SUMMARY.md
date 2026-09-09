---
phase: 09-authority-permission-fold-correctness
plan: 05
subsystem: auth

# Dependency graph
requires:
  - phase: 09-authority-permission-fold-correctness
    plan: "01"
    provides: "AUTH-03/04/07 Grant-fold correctness"
  - phase: 09-authority-permission-fold-correctness
    plan: "02"
    provides: "AUTH-06 Role.position guard + D-14 read-path banlist rank gate"
  - phase: 09-authority-permission-fold-correctness
    plan: "03"
    provides: "AUTH-08 Kick vac gate + D-14 owner-exemption defense-in-depth"
  - phase: 09-authority-permission-fold-correctness
    plan: "04"
    provides: "AUTH-05 client-side kick()/ban() pre-publish guards"
provides:
  - "AUTH-03..08 marked Complete in REQUIREMENTS.md traceability"
affects: [phase-10-planning, milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Coverage count updated 53 -> 54 total requirements to account for AUTH-09; 'Blocked on a spec ruling' count reduced from 3 to 1 (only CHAN-07 remains, Phase 7's scope) now that AUTH-07/08 rulings landed"

requirements-completed: [AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, D-14, TEST-01]

coverage:
  - id: D1
    requirement: D-03
    verification:
      - kind: manual
        status: pass
    human_judgment: false
  - id: D2
    requirement: TEST-01
    verification:
      - kind: manual
        status: pass
    human_judgment: false
  - id: D3
    requirement: TEST-01
    verification:
      - kind: unit
        status: pass
      - kind: build
        ref: "pnpm run build"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-19
status: complete
---

# Phase 9 Plan 5: Phase Gate — D-03 Upstream Note, AUTH-03..08 Traceability, D-14 New Finding Summary


## Performance

- **Duration:** ~20 min (read context + 3 tasks)
- **Completed:** 2026-07-19
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `.planning/REQUIREMENTS.md`: AUTH-07 and AUTH-08's "BLOCKED on ruling" annotations replaced with their resolutions (strict reading / required+validated respectively); their Traceability rows flipped from "Pending — blocked on spec ruling" to "Complete". AUTH-03..06 were already Complete from prior plans, confirmed unchanged.
- A new requirement **AUTH-09** added for the D-14 banlist rider ("the read-path banlist honors a banned pk only when the list author strictly outranks it, and the owner is never bannable"), with its own Traceability row (Phase 9, Complete, flagged NEW). Coverage count updated 53 → 54; "blocked on a spec ruling" count reduced from 3 to 1 (only CHAN-07 remains).
- Cross-checked all seven phase fixes against 09-01..09-04's SUMMARYs: AUTH-03/04/07 (09-01), AUTH-06 + D-14 read-path (09-02), AUTH-08 + D-14 owner-exemption (09-03), AUTH-05 (09-04) — each carries a `requirements-completed` entry and a recorded non-vacuity check in its SUMMARY.

## Task Commits

1. **Task 1: D-03 upstream note** — `c10fae59` docs(09-05): file D-03 upstream note on CORD-04 §2/§3 Grant-target ambiguity
2. **Task 2: AUTH-03..08 traceability + D-14 new finding** — `1335496b` docs(09-05): resolve AUTH-07/08 traceability, record D-14 as new AUTH-09 finding
3. **Task 3: phase gate** — no code changes; verification-only (results recorded above and in this SUMMARY)

## Files Created/Modified

- `.planning/REQUIREMENTS.md` — AUTH-07/AUTH-08 annotations resolved, AUTH-09 added, Traceability table updated (AUTH-07/08/09 rows), coverage count 53→54, "blocked on ruling" count 3→1.

## Decisions Made

- D-14 tracked under a new requirement ID (AUTH-09) and a new audit finding ID (D14), kept visually and structurally distinct from the AUTH-03..08 set it was pulled in alongside, per D-13→D-14's explicit instruction not to silently absorb it.
- Coverage recount (53→54) is additive only — no existing requirement's content changed, matching the precedent set by the original 52→53 correction recorded in REQUIREMENTS.md.

## Deviations from Plan

None — plan executed exactly as written. All three tasks (upstream note, traceability update, phase gate) completed without needing any Rule 1/2/3 auto-fixes.

## Issues Encountered

None.

## Non-Vacuity Checks (recorded per TEST-01/D-12)

This plan produces no runtime code, so no new guard requires a non-vacuity check of its own (per the plan's threat model: "This plan produces no runtime code; it files a note, updates traceability, and gates the phase"). The phase-gate task instead verifies that the seven runtime guards landed in 09-01..09-04 each already carry their own recorded non-vacuity check — confirmed present in all four SUMMARYs (09-01 §"Non-Vacuity Checks", 09-02 §"Non-Vacuity Checks", 09-03 coverage `human_judgment: false` unit refs, 09-04 §"Issues Encountered" TDD non-vacuity procedure).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 9 (authority & permission fold correctness) is complete: AUTH-01..09 all Complete in REQUIREMENTS.md traceability (AUTH-01/02 from Phase 6; AUTH-03..09 from Phase 9), TEST-01 remains the standing cross-phase criterion (does not close until Phase 12).
- Ready to advance to Phase 10 (Invites & Time Encoding) per ROADMAP.md.

---
*Phase: 09-authority-permission-fold-correctness*
*Completed: 2026-07-19*

## Self-Check: PASSED

- FOUND: .planning/REQUIREMENTS.md (modified)
- FOUND commit: c10fae59
- FOUND commit: 1335496b
- CONFIRMED: `pnpm run build` → exit 0
