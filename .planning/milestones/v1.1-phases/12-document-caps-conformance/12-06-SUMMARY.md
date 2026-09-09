---
phase: 12-document-caps-conformance
plan: 06
subsystem: testing

requires:
  - phase: 12-document-caps-conformance (plan 12-01)
    provides: "cord-wire-fixtures.ts's CORD_SECTIONS registry and citationsOutsideRegistry scanner"
provides:
  - "A permanent, package-wide structural guard (__tests__/cord-citations.test.ts) failing any CORD-NN §X citation naming a section that doesn't exist"
  - "All 12 invalid CORD-06 §94 / CORD-03 §44 citations corrected to CORD-06 §3 / CORD-03 §3"
  - "A fixed citationsOutsideRegistry citation regex (no longer over-matches trailing prose after a numeric section)"
affects: [12-09]

tech-stack:
  added: []
  patterns:
    - "Package-wide recursive .ts-file text scan as a Vitest structural guard, resolved from import.meta.url"

key-files:
  created:
  modified:

key-decisions:
  - "Fixed a real over-matching bug in cord-wire-fixtures.ts's CITATION_PATTERN (owned by plan 12-01) rather than working around it, since it blocked the guard from ever reporting a clean, exact 12-site RED"
  - "Removed (not inverted) plan 12-01's reciprocal 'invalid set is non-empty' test — inverting it would have merely duplicated a subset of the new package-wide guard"
  - "Excluded cord-wire-fixtures.test.ts from the guard's file walk — its own unit tests embed deliberately-invalid citation strings as literals, which are textually indistinguishable from real citations to a whole-file scan"

requirements-completed: [WIRE-12]

coverage:
  - id: D1
    description: "Structural guard fails any CORD-NN §X citation whose section doesn't exist, consuming plan 12-01's registry, with D-16's limitation recorded in its own comment and two anti-vacuity assertions"
    requirement: "WIRE-12"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "All 12 invalid citations (CORD-06 §94 x10, CORD-03 §44 x2) swept to CORD-06 §3 / CORD-03 §3; the 3 CORD-01 §Deletions and 1 CORD-05 §1-2 valid citations left untouched"
    requirement: "WIRE-12"
    verification:
      - kind: unit
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 06: CORD Citation Structural Guard & Sweep Summary

**Closed WIRE-12 by adding a permanent package-wide citation-existence guard, fixing a real over-matching bug the guard's first run exposed in the shared scanner, then sweeping all 12 invalid `CORD-06 §94`/`CORD-03 §44` citations to `§3`.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Observed the guard RED before any sweep, exactly as required: after fixing the scanner bug below, it reported exactly the twelve offending file+citation pairs matching `12-RESEARCH.md`'s verified inventory (`CORD-06 §94` × 10, `CORD-03 §44` × 2) — no more, no less.
- Swept all twelve citations: `CORD-06 §94` → `CORD-06 §3` (Refounding) at `channel-sync.ts` (1), `private-channel.ts` (1), `community.ts` (3), `keys.ts` (5); `CORD-03 §44` → `CORD-03 §3` (Messages) at `private-channel.ts` (1) and `community.ts` (1). Every changed line differs only in the citation text (`git diff -U0` confirms it).
- Left the 3 valid `CORD-01 §Deletions` citations and the 1 valid `CORD-05 §1-2` range citation byte-for-byte untouched.
- Retired plan 12-01's reciprocal "invalid set is non-empty" test in `cord-wire-fixtures.test.ts` — removed rather than inverted (see Deviations), and dropped its now-unused `node:fs`/`node:path`/`node:url` imports.

## Task Commits

1. **Task 1: Write the structural citation guard and observe it RED** - `1ffaa4cd` (test) — includes the scanner bug fix (Rule 1) as part of getting a clean, exact RED
2. **Task 2: Sweep all twelve invalid citations and retire the reciprocal test** - `893d2048` (fix)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified


## Decisions Made

- Fixed the scanner's over-matching bug in-place in `cord-wire-fixtures.ts` rather than leaving it as an unrelated follow-up, since it directly blocked this plan's own guard from reaching a clean, exact RED (see Deviations, Rule 1).
- Excluded `cord-wire-fixtures.test.ts` from the new guard's file walk, since that file's own `citationsOutsideRegistry` unit tests embed deliberately-invalid citation strings (e.g. `"CORD-06 §7"`) as test literals — a whole-file text scan cannot distinguish a test fixture string from a real citation, and including it would make the guard permanently un-greenable through no fault of any real source comment. Confirmed by direct read that the file carries no genuine citation comments outside its own test literals, so no real coverage is lost.
- Deleted (rather than inverted) plan 12-01's reciprocal "invalid set is non-empty" test per the plan's own explicit fallback instruction: inverting it to "these four files are now clean" would have merely duplicated a subset of the new package-wide guard's assertion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a citation-scanner over-matching bug in `cord-wire-fixtures.ts` (owned by plan 12-01)**
- **Found during:** Task 1, first run of the new guard
- **Issue:** The guard's first run reported 40 offenders, not the expected 12. Investigation traced the extra ~28 to `citationsOutsideRegistry`'s `CITATION_PATTERN`: its multi-word capitalized-continuation clause (added to support CORD-01's named sections like `Removing Participants` and CORD-02's `Appendix B`) also applied after a bare *numeric* section, sweeping ordinary trailing prose into the token. E.g. `CORD-05 §6 Direct Invites` (a valid numeric citation followed by descriptive prose) was captured as token `"6 Direct Invites"`, which isn't in the registry, and reported as invalid — at 6+ real, valid call sites (`CORD-05 §6 Direct Invite(s)`, `CORD-02 §8 Community List`, `CORD-02 §5 Guestbook`, `CORD-05 §4 Invite List`, matched repeatedly across `casts/`, `client/`, `factories/`, `helpers/`, `operations/`).
- **Fix:** Split `CITATION_PATTERN` into two ordered alternatives: `\d+(?:-\d+)?` (bare number or hyphenated range, no continuation) tried first, falling back to the original letter-led `[A-Za-z][A-Za-z0-9-]*(?: [A-Z][A-Za-z0-9-]*)*` (named sections, with continuation) only when the token doesn't start with a digit. Confirmed this doesn't change behavior for any of `cord-wire-fixtures.test.ts`'s existing unit tests of the pattern (all still pass unmodified).
- **Committed in:** `1ffaa4cd` (part of Task 1's commit, alongside the new guard and the observed RED)

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Necessary correctness fix surfaced directly by this plan's own guard; without it the guard could never distinguish the real 12-site defect from ~28 false positives, and would have either falsely blocked or falsely passed depending on how the extra noise was handled. No scope creep — the fix is scoped to the exact bug the guard's own RED output exposed.

## Issues Encountered


## User Setup Required

None.

## Next Phase Readiness


---
*Phase: 12-document-caps-conformance*
*Completed: 2026-07-30*
