---
phase: 05-cache-identity-memo-fix
plan: 05
subsystem: testing
tags: [verification, non-vacuity, cache, pipeline, workspace-gate]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix
    provides: "05-01's non-enumerable cache.ts fix, 05-02's cache.test.ts (6 new cases), 05-03's 35-site sweep classification, 05-04's two concord spec-derived tests (H01(a)/H01(c))"
provides:
  - "Proof (not assumption) that all four of this phase's new tests fail when the specific defect each guards is reintroduced"
  - "Confirmed full-workspace green run (1997 tests passed, exit 0) against the recorded 1989-test pre-phase baseline"
  - "Re-run D-10 sweep grep confirming 34/34 documented sites plus the 35th non-grep-visible site at operations/tags.ts:87"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-probe non-vacuity verification: Probe A (revert the fix under test) proves tests fail for the right reason; Probe B (break an orthogonal mechanism) proves independence claims are also tested, not assumed"

key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Marked CACHE-02 complete in REQUIREMENTS.md (it was completed by 05-03 but never checked off); left TEST-01 untouched per REQUIREMENTS.md's own standing-criterion note that it must not close at Phase 5"

requirements-completed: [CACHE-01, CACHE-02, CACHE-03]

coverage:
  - id: D1
    description: "Probe A: reverting cache.ts's Object.defineProperty writes to plain enumerable writes turns the memo-drop half, concord H01(a), and concord H01(c) all RED, while the carry-forward half stays GREEN"
    requirement: "CACHE-01"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/cache.test.ts#the memo does not survive a spread with a changed field (observed FAIL under probe, PASS after restore)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#rollForward's control address matches the CORD-02 §4 formula over the new root (observed FAIL under probe, PASS after restore)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/channel-rekey.test.ts#rollForwardChannel's plane address matches the CORD-03 §1 private formula over the new key/epoch (observed FAIL under probe, PASS after restore)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Probe B: emptying PRESERVE_EVENT_SYMBOLS turns the carry-forward half RED while the memo-drop half stays GREEN, proving the carry-forward assertion actually exercises symbol preservation"
    requirement: "CACHE-03"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/cache.test.ts#real pipe + real signing preserve plaintext hidden tags on the signed event (observed FAIL under probe, PASS after restore)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full workspace suite (pnpm -r test) exits 0 with 1997 tests passed (>= 1989 baseline), delta of +8 fully attributed to 05-02's 6 new cache.test.ts cases and 05-04's 2 new concord spec-derived cases"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "pnpm -r test (exit 0; 250 test files passed + 1 skipped; 1997 tests passed + 2 skipped)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-10 sweep grep re-run at review time confirms 34/34 documented real write sites plus the 35th non-grep-visible site (operations/tags.ts:87)"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep -rn 'Reflect\\.set' packages/core/src packages/common/src --include='*.ts' | grep -v __tests__ | grep -v cache.ts:36 | wc -l -> 34, each carrying a category comment; tags.ts:87 confirmed separately"
        status: pass
    human_judgment: false

# Metrics
duration: ~25min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 05: Non-vacuity verification gate Summary

**Proved via two deliberate-defect probes that all four of this phase's new tests fail for the right reason, then confirmed the full 1997-test workspace suite is green (exit 0) against the recorded 1989-test baseline with the D-10 sweep re-confirmed at 34/34 — the phase's founding failure mode (tests that only compare the implementation to itself) is closed with evidence.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-15T17:45:00Z (approx)
- **Completed:** 2026-07-15T18:11:15Z
- **Tasks:** 3 completed
- **Files modified:** 1 (`.planning/REQUIREMENTS.md`; production/test source ended with zero net change)

## Accomplishments

- **Probe A** (revert `cache.ts`'s two `Object.defineProperty` writes to plain enumerable `Reflect.set` writes): observed the memo-drop half of `cache.test.ts`, concord's H01(a) (`rollForward`'s control address), and H01(c) (`rollForwardChannel`'s plane address) all turn RED — exactly the three predicted failures, nothing else in either suite affected. The carry-forward half of `cache.test.ts` stayed GREEN as predicted, confirming it doesn't route through `cache.ts`. Restored via `git checkout --`, re-verified all four green, tree confirmed clean.
- **Probe B** (empty `PRESERVE_EVENT_SYMBOLS` in `pipeline.ts`): observed the carry-forward half of `cache.test.ts` turn RED (signed event lost its plaintext hidden tags) while the memo-drop half stayed GREEN — confirming the carry-forward assertion genuinely exercises symbol preservation through the pipe, not something incidental. Restored via `git checkout --`, re-verified green, tree confirmed clean.
- **Full workspace gate**: `pnpm -r test` exits 0 with 250 test files passed + 1 skipped (251), 1997 tests passed + 2 skipped (1999) — the recorded 1989-test pre-phase baseline plus the 8 new cases this phase's sibling plans added (6 in `cache.test.ts` from 05-02, 2 spec-derived cases in `keys.test.ts`/`channel-rekey.test.ts` from 05-04). No regressions; H02 (out of scope) did not turn anything red.
- **D-10 sweep re-run**: `grep -rn "Reflect\.set" packages/core/src packages/common/src --include="*.ts" | grep -v __tests__` returns 35 raw hits; excluding `cache.ts:36` (a doc-comment mentioning the literal string, not a write site — matches 05-03's own documented false positive), all 34 real write sites carry a category comment (`identity memo` / `carry-forward payload` / `accumulated state`) immediately above the write, verified per-site programmatically. `operations/tags.ts:87` (the 35th, non-grep-visible object-literal site) confirmed separately commented as `carry-forward payload`.
- Exactly one changeset exists for this phase: `.changeset/cache-identity-memo-non-enumerable.md` (`applesauce-core` patch).
- Corrected `.planning/REQUIREMENTS.md`: CACHE-02 was completed by 05-03 but never checked off — marked complete (CACHE-01/CACHE-03 were already checked). TEST-01 deliberately left untouched per REQUIREMENTS.md's own standing-criterion note (does not close until Phase 12).

## Task Commits

This plan is a pure verification gate — its `<objective>` and `<files_modified: []>` frontmatter specify no lasting code changes. All probe edits to `packages/core/src/helpers/cache.ts` and `packages/core/src/helpers/pipeline.ts` were made, verified, and reverted via `git checkout --` within each task; `git status --porcelain` was empty after every task and remains empty now. There are no task-level feat/fix/test commits to record.

**Plan metadata:** committed alongside this SUMMARY.md (docs commit) — see final commit below.

## Files Created/Modified

- `.planning/REQUIREMENTS.md` - CACHE-02 checkbox and traceability table row flipped to Complete (was completed by 05-03, previously unchecked)
- `packages/core/src/helpers/cache.ts` - temporarily reverted and restored during Probe A; net change: none
- `packages/core/src/helpers/pipeline.ts` - temporarily reverted and restored during Probe B; net change: none

## Decisions Made

- Marked CACHE-02 complete in REQUIREMENTS.md rather than leaving it pending — 05-03's own SUMMARY declares `requirements-completed: [CACHE-02]` and this plan's Task 3 acceptance criteria depend on the sweep it delivered being verified complete, so the checkbox omission was a bookkeeping gap, not an open item.
- Left TEST-01 unmarked despite it being in this plan's `requirements` frontmatter field — REQUIREMENTS.md explicitly states TEST-01 is a standing cross-phase criterion (Phases 5–12) that "must not be ticked Complete when Phase 5 closes." Marking it here would contradict the project's own documented closing rule.

## Deviations from Plan

None - plan executed exactly as written. Both probes produced the exact predicted pass/fail signature on the first attempt; no test required correction, no missing memo-arming step was found, and the carry-forward half did not go red under Probe A (which would have been a stop-and-report finding).

## Issues Encountered

- Rebuilding `applesauce-core`'s `dist/` after Probe A's `cache.ts` edit was necessary for the concord suite (cross-package import via package `exports`), and after `git checkout --` restore. Probe B's `pipeline.ts` edit briefly broke `tsc` (an empty `Set([])` infers `Set<never>`, and the now-unused `EncryptedContentSymbol` import trips `noUnusedLocals`) — this only matters for the `build` script; `vitest run` on `cache.test.ts` (same-package test) runs directly against TS source without going through `tsc`, so the test observation was unaffected. Confirmed working as intended, not a defect requiring a fix, since the plan only asked for the test-level observation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 05 is fully verified: the shared `applesauce-core` cache fix is proven correct, non-regressive across all four consuming packages, and its regression tests are proven non-vacuous.
- Phase 6 (Refounding-core) is unblocked to begin ROTATE-01/02/03 work; per CONTEXT.md, H02 (ROTATE-04, the memberlist fold) remains masked and out of scope for this phase — nothing turned red for it during the full-suite gate, consistent with the audit's prediction.
- No blockers.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*

## Self-Check: PASSED
