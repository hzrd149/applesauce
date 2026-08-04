---
phase: 11-messaging-wire-conformance
plan: 01
subsystem: testing
tags: [concord, cord-protocol, wire-conformance, vitest, fixtures]

# Dependency graph
requires: []
provides:
  - "packages/concord/src/__tests__/cord-wire-fixtures.ts — the single vendored import source for every WIRE-02/03/04/05 assertion in plans 11-05 and 11-06"
  - "substituteFixtureTags/missingFixtureTags/tagValues pure helpers for binding fixture placeholders and comparing tag sets order-independently"
affects: [11-05-plan, 11-06-plan]

# Tech tracking
tech-stack:
  added: []
  patterns: ["vendored external-spec fixture module (plain exported-const-per-shape .ts, no class/loader) — first instance in this workspace"]

key-files:
  created:
    - packages/concord/src/__tests__/cord-wire-fixtures.ts
    - packages/concord/src/__tests__/cord-wire-fixtures.test.ts
  modified: []

key-decisions:
  - "Cited branch main (not master) per RESEARCH.md's GitHub-API-verified default branch, correcting CONTEXT.md's canonical-refs section"
  - "Fixture module is dependency-free (no vitest import, no concord source import) so it stays importable from any test file without cycles"
  - "missingFixtureTags compares tag arrays by length + per-index value equality, not reference identity, and is deliberately order- and extras-tolerant since bindToChannel appends binding tags after the factory's own tags"

patterns-established:
  - "Vendored spec fixture: plain exported-const-per-shape .ts module with a leading section citation, no JSON loader or class"

requirements-completed: [WIRE-02, WIRE-03, WIRE-04, WIRE-05]

coverage:
  - id: D1
    description: "Vendored fixture module transcribes the four examples.md tag sets (reaction, threaded reply, delete, voice presence joined/left) plus two prose rules, each with a resolvable examples.md section citation and branch main"
    requirement: "WIRE-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#vendored fixture shape > $section carries a resolvable citation and non-empty tags"
        status: pass
    human_judgment: false
  - id: D2
    description: "substituteFixtureTags throws naming the unresolved placeholder token when a binding is missing, preventing a mis-typed binding from silently comparing against literal placeholder text"
    requirement: "WIRE-04"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#substituteFixtureTags > throws naming the unresolved token when a placeholder has no binding"
        status: pass
    human_judgment: false
  - id: D3
    description: "missingFixtureTags reports tag-set differences independent of order and tolerant of extra unrelated tags"
    requirement: "WIRE-03"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#missingFixtureTags > returns empty when actual contains every expected tag in a different order with extras interleaved"
        status: pass
    human_judgment: false
  - id: D4
    description: "tagValues extracts repeated-tag values in encounter order for downstream target-kind assertions"
    requirement: "WIRE-05"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/cord-wire-fixtures.test.ts#tagValues > returns every value for a repeated tag name in encounter order"
        status: pass
    human_judgment: false

duration: 4min
completed: 2026-07-29
status: complete
---

# Phase 11 Plan 01: Vendored CORD Wire Fixtures Summary

**Checked-in transcription of CORD's `examples.md` tag sets (reaction, threaded reply, delete, voice presence) plus three order-independent pure helpers (`substituteFixtureTags`, `missingFixtureTags`, `tagValues`) that plans 11-05/11-06 bind their WIRE-02/03/04/05 assertions to.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-29T10:05:39Z
- **Completed:** 2026-07-29T10:09:47Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- Vendored the four `examples.md` tag sets (kind 7 reaction, kind 1111 threaded reply, kind 5 delete, kind 23313 voice presence joined/left) plus two verbatim prose rules (root inheritance, target-kind), each carrying a resolvable `examples.md §` citation and citing branch `main`
- Implemented three dependency-free pure helpers: `substituteFixtureTags` (throws on unbound placeholder), `missingFixtureTags` (order- and extras-independent tag-set diff), `tagValues` (repeated-tag extraction)
- Proved all three helpers non-vacuous with 13 tests: the throw case asserts on the actual unresolved-token message text, the order-independence case feeds a shuffled+extras-interleaved actual set, and a data-driven case iterates all five exported examples so a future added fixture is covered automatically

## Task Commits

Each task was committed atomically:

1. **Task 1: Transcribe the CORD wire fixtures into a checked-in module** - `328f0bda` (feat)
2. **Task 2: Prove the fixture helpers are non-vacuous** - `94f2f2f8` (test)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `packages/concord/src/__tests__/cord-wire-fixtures.ts` - vendored `examples.md` transcription (5 examples, 2 prose rules) + 3 pure helpers
- `packages/concord/src/__tests__/cord-wire-fixtures.test.ts` - 13 tests proving the helpers non-vacuous

## Decisions Made
- Cited branch `main` (RESEARCH.md's GitHub-API-verified default branch), not `master` as CONTEXT.md's canonical-refs section states
- No `CORD-06` citation style copied (the L11 phantom-citation this phase's D-10 explicitly warns against)
- `missingFixtureTags`/`tagValues` compare/extract via plain array iteration (no external deep-equal dependency) to keep the module free of any runtime import

## Deviations from Plan

None - plan executed exactly as written. One self-correction during Task 2 authoring: the test file's initial import path (`../cord-wire-fixtures.js`) was wrong for a same-directory module and was corrected to `./cord-wire-fixtures.js` before the task was verified or committed (caught by the first `pnpm --filter applesauce-concord test cord-wire-fixtures` run, which failed on "Cannot find module"; not a deviation from plan content, a same-task typo fix).

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The vendored fixture module and its three helpers are ready for plans 11-05 and 11-06 to import directly. No downstream test may hardcode its own copy of a tag set — `cord-wire-fixtures.ts` is now the single source. `pnpm --filter applesauce-concord test` is green at 484/484 (471 pre-existing + 13 new).

---
*Phase: 11-messaging-wire-conformance*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: packages/concord/src/__tests__/cord-wire-fixtures.ts
- FOUND: packages/concord/src/__tests__/cord-wire-fixtures.test.ts
- FOUND: 328f0bda
- FOUND: 94f2f2f8
