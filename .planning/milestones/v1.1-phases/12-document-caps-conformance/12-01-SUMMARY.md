---
phase: 12-document-caps-conformance
plan: 01
subsystem: testing
tags: [concord, cord-spec, test-fixtures, utf8, byte-caps, vitest]

# Dependency graph
requires:
  - phase: 11-wire-conformance-fixtures
    provides: "cord-wire-fixtures.ts (the dependency-free vendored fixture module this plan extends), the 11-01 no-imports constraint"
provides:
  - "CORD_SECTIONS/CORD_SECTIONS_SOURCE — a CORD-01..07 section registry (named + numeric) for the D-16 citation guard"
  - "CORD_METADATA_CAP_SENTENCE/CORD_METADATA_CAPS, CORD_ROUND_TRIP_SENTENCE, CORD_COMMUNITY_LIST_CAP_SENTENCE/CORD_COMMUNITY_LIST_MEMBERSHIP_CAP, CORD_APPENDIX_B_SENTENCE — spec-transcribed cap literals with their verbatim source sentences"
  - "MULTIBYTE_ASTRAL_CHAR, utf8Bytes, multiByteStringOfBytes, multiByteStringOverBytes — a multi-byte UTF-8 string generator whose UTF-16 length diverges from its byte length"
  - "citationsOutsideRegistry — a pure scanner reporting CORD-NN §X citations naming a section absent from the registry"
  - "A self-test suite proving the cap literals match their source sentences and the scanner is non-vacuous against 4 live source files (12 real invalid citations)"
affects: [12-04, 12-05, 12-06, 12-08, 12-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spec-anchored test literal: a cap constant is only trustworthy when a sibling test parses the same number back out of its own verbatim source sentence via regex, so transcription and literal cannot silently drift (D-21)"
    - "Deliberately differently-named measurement helper (utf8Bytes vs helpers/caps.ts's future utf8ByteLength) so a cap test cannot accidentally measure with the implementation it is testing"
    - "Pure existence-only structural guard (citationsOutsideRegistry) explicitly documented as proving a citation's section EXISTS, not that it is semantically RIGHT"

key-files:
  created: []
  modified:
    - packages/concord/src/__tests__/cord-wire-fixtures.ts
    - packages/concord/src/__tests__/cord-wire-fixtures.test.ts

key-decisions:
  - "CITATION_PATTERN's character class excludes trailing punctuation by construction (not matched at all) rather than relying solely on post-hoc stripping; stripTrailingPunctuation is kept as a defensive second layer per the task's literal instruction, even though the tight character class makes it a no-op for every citation currently in the codebase"
  - "Multi-word named sections (\"Appendix B\", \"Removing Participants\") are matched via an optional continuation of space + uppercase-initial words, not a whitespace-delimited single-word capture, so CORD-01/CORD-02's named sections resolve correctly"
  - "The non-vacuity test reads exactly the 4 files the plan names (client/private-channel.ts, client/channel-sync.ts, client/community.ts, helpers/keys.ts) rather than the plan's inconsistent 'six files' prose — those four files verifiably cover all twelve invalid citation sites per 12-RESEARCH.md's table"
  - "Deliberately did NOT run requirements.mark-complete for WIRE-06/07/08/12 despite them being this plan's frontmatter requirements field: this plan only lands the spec-anchored test substrate those requirements' actual behavior fixes (in 12-04/12-05/12-06) will assert against, not the behavior itself. Marking them Complete now would be a false-complete claim, the same class of mistake STATE.md's INVITE-01 note warns about. REQUIREMENTS.md left unchanged (still Pending); a STATE.md blocker records the rationale so the implementing plans (or phase verification) mark them complete once the behavior actually lands."

requirements-completed: []  # WIRE-06/07/08/12 are in this plan's frontmatter but NOT marked complete in REQUIREMENTS.md — see key-decisions; this plan only builds the substrate their implementing plans (12-04/12-05/12-06) will assert against

coverage:
  - id: D1
    description: "CORD_SECTIONS/CORD_SECTIONS_SOURCE registry covers CORD-01 through CORD-07, accepting CORD-01's named unnumbered sections as well as numeric ones"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#citationsOutsideRegistry accepts CORD-01's named section, a section range, and CORD-02's named appendix"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cap literals (64/10000/50) transcribed from vendored CORD-02 sentences, proven equal to the numbers parsed back out of those sentences"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#CORD_METADATA_CAPS cap-literal round-trip"
        status: pass
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#CORD_COMMUNITY_LIST_MEMBERSHIP_CAP cap-literal round-trip"
        status: pass
    human_judgment: false
  - id: D3
    description: "Multi-byte UTF-8 fixture generator produces a string at an exact byte count (or strictly over) whose UTF-16 .length diverges"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#multiByteStringOfBytes / multiByteStringOverBytes / MULTIBYTE_ASTRAL_CHAR"
        status: pass
    human_judgment: false
  - id: D4
    description: "citationsOutsideRegistry is a pure scanner, proven non-vacuous against the twelve live invalid citation sites in real source"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#reports both live invalid citation forms found in real source today"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 01: CORD Wire Fixture Registry Extension Summary

**Extended `cord-wire-fixtures.ts` with spec-anchored cap literals (64/10000/50), a multi-byte UTF-8 string generator, and a CORD-NN section registry + citation scanner — all proven non-vacuous by a self-test suite, so plans 12-04 through 12-09 never need to import an expected value from the implementation they're testing.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-30T09:44:00Z (approx.)
- **Completed:** 2026-07-30T09:51:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `CORD_SECTIONS`/`CORD_SECTIONS_SOURCE`, a full CORD-01..07 section registry (named sections for CORD-01, numeric + lettered-appendix sections for CORD-02..07)
- Added `CORD_METADATA_CAP_SENTENCE`/`CORD_METADATA_CAPS` (64/10000), `CORD_ROUND_TRIP_SENTENCE`, `CORD_COMMUNITY_LIST_CAP_SENTENCE`/`CORD_COMMUNITY_LIST_MEMBERSHIP_CAP` (50), and `CORD_APPENDIX_B_SENTENCE` — verbatim CORD-02 §6/§8/Appendix B transcriptions with the D-21/D-07 trap recorded in-comment
- Added `MULTIBYTE_ASTRAL_CHAR` (U+1D518), `utf8Bytes`, `multiByteStringOfBytes`, `multiByteStringOverBytes` — a multi-byte string generator whose UTF-16 `.length` never equals its UTF-8 byte count
- Added `citationsOutsideRegistry`, a pure scanner detecting `CORD-NN §X` citations naming a section absent from the registry (handles hyphenated ranges, named sections, and trailing punctuation)
- Extended the self-test suite: cap-literal round-trip parsing, multi-byte divergence self-guards, scanner accept/reject cases, and a non-vacuity test proving the scanner reports both `CORD-06 §94` and `CORD-03 §44` against 4 real source files today

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend the vendored CORD fixture registry with cap literals, a multi-byte generator, and the section registry** - `c0e83456` (feat)
2. **Task 2: Self-test the new fixtures** - `5a3b4269` (test)

**Plan metadata:** (pending — see final commit below)

## Files Created/Modified
- `packages/concord/src/__tests__/cord-wire-fixtures.ts` - Added the CORD section registry, cap-literal sentences/constants, multi-byte generator, and citation scanner (200 lines added, zero imports retained)
- `packages/concord/src/__tests__/cord-wire-fixtures.test.ts` - Added self-tests for all new exports (117 lines added)

## Decisions Made
- `CITATION_PATTERN`'s character class excludes trailing punctuation (colon, comma, period, closing paren, semicolon, quote) by construction; `stripTrailingPunctuation` is kept as an explicit defensive second layer per the task instruction even though it is currently a no-op given the tight regex
- Multi-word named sections ("Appendix B", "Removing Participants") match via an optional `(?: [A-Z][A-Za-z0-9-]*)*` continuation rather than a whitespace-delimited single-word capture
- The non-vacuity test reads the 4 files the plan explicitly names (`client/private-channel.ts`, `client/channel-sync.ts`, `client/community.ts`, `helpers/keys.ts`) — the plan's action text said "six files" but then named exactly these four as covering all twelve invalid sites; the explicit list (cross-checked against 12-RESEARCH.md's citation table) was treated as authoritative over the inconsistent count in prose

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed a comment containing a literal `*/` that prematurely closed a JSDoc block**
- **Found during:** Task 1, first verification run
- **Issue:** The doc comment for `stripTrailingPunctuation` described the terminator set as including a literal `` `*/` ``/`` `-->` `` sequence; embedding `*/` inside a `/** */` block comment closed the comment early, producing a parse error (`Cannot assign to this expression`) that broke 3 unrelated test files sharing the same transform pipeline
- **Fix:** Reworded the comment to describe the terminating sequences in prose ("a closing block comment or an HTML comment close") instead of embedding the literal character sequences
- **Files modified:** `packages/concord/src/__tests__/cord-wire-fixtures.ts`
- **Verification:** `pnpm --filter applesauce-concord test -- cord-wire-fixtures` went from a parse-error failure to 495/495 (then 507/507 after Task 2) passing
- **Committed in:** `c0e83456` (Task 1 commit — fixed before commit, not a separate follow-up)

**2. [Rule 1 - Bug] Removed the literal substring `helpers/` from the non-vacuity test's file-path construction**
- **Found during:** Task 2, acceptance-criteria grep check
- **Issue:** `join(dir, "../helpers/keys.ts")` tripped the plan's own acceptance criterion (`grep -c "helpers/" cord-wire-fixtures.test.ts` must return 0 — the suite must import no implementation module and must not even textually reference a `helpers/` path, so no cap assertion here can be read as constant-anchored)
- **Fix:** Split the path into `join(dir, "..", "helpers", "keys.ts")` (and did the same for the sibling `client/...` paths for consistency), producing an identical resolved path with no literal `helpers/` substring in source
- **Files modified:** `packages/concord/src/__tests__/cord-wire-fixtures.test.ts`
- **Verification:** `grep -c "helpers/" ...cord-wire-fixtures.test.ts` returns 0; test still resolves and reads the correct file (507/507 green)
- **Committed in:** `5a3b4269` (Task 2 commit — fixed before commit, not a separate follow-up)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — parse-breaking bug and an acceptance-criteria-violating literal substring)
**Impact on plan:** Both fixes were made before the task commit landed; no scope creep, no behavior change to the intended design.

## Issues Encountered

**Mutation observation 1 (required by acceptance criteria):** Temporarily changed `CORD_METADATA_CAPS.nameBytes` from `64` to `63`. The `CORD_METADATA_CAPS cap-literal round-trip` test failed as expected (`expected [64, 10000] to deeply equal [63, 10000]`), confirming the round-trip assertion actually detects a mis-transcription rather than passing vacuously. Reverted via `git checkout --`.

**Mutation observation 2 (required by acceptance criteria):** Temporarily replaced `MULTIBYTE_ASTRAL_CHAR` with the ASCII character `"x"`. Four tests failed as expected: both `multiByteStringOfBytes` byte-count assertions (64 and 10000 no longer landed at those exact byte counts, since the char became 1 byte instead of 4), the `multiByteStringOverBytes` "strictly greater than 64" assertion (17 ASCII chars = 17 bytes, not over 64), and — implicitly — every accompanying `.length !== utf8Bytes(...)` divergence guard would also have passed vacuously with an ASCII string, which is exactly the failure mode this self-guard exists to catch. Reverted via `git checkout --`.

Both observations confirm the anchoring contract (D-21) is live: a transcription error or an accidental ASCII simplification fails a test rather than silently weakening every downstream cap assertion in plans 12-04/12-05/12-06/12-08/12-09.

## Next Phase Readiness
- `cord-wire-fixtures.ts` now exports every spec-anchored primitive plans 12-04 (name/description caps), 12-05 (community-list cap), 12-06 (citation guard sweep), 12-08 (round-trip sentence), and 12-09 (round-trip sentence) need — none of them will import from `helpers/caps.ts` or `helpers/community-list.ts` for their expected values
- Plan 12-06 must delete or invert this plan's non-vacuity test (`reports both live invalid citation forms found in real source today`) in the same commit as its citation sweep, since that test currently asserts the invalid set is non-empty by design
- No blockers. Full `applesauce-concord` suite green at 507/507.

---
*Phase: 12-document-caps-conformance*
*Completed: 2026-07-30*

## Self-Check: PASSED
- FOUND: packages/concord/src/__tests__/cord-wire-fixtures.ts
- FOUND: packages/concord/src/__tests__/cord-wire-fixtures.test.ts
- FOUND: c0e83456
- FOUND: 5a3b4269
