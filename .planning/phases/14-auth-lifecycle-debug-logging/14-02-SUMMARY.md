---
phase: 14-auth-lifecycle-debug-logging
plan: 02
subsystem: observability
tags: [debug, rxjs, applesauce-loaders, logger-hygiene]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks
    provides: RAUTH-08's per-relay onAuthRequired/authTimeout/authRetries threading in sync-loader.ts, whose per-relay construction boundary (buildRelayStream) already housed the other per-relay values this plan's hoist joins
provides:
  - ALOG-03 restated in REQUIREMENTS.md/ROADMAP.md to a criterion the sweep in this plan is actually required to satisfy (D-17/D-18)
  - packages/loaders/src/loaders/sync-loader.ts's per-url request logger hoisted out of the switchMap projector, derived once per relay in buildRelayStream(url)
  - a derive-once-per-relay regression test pinning the fix structurally (spy Debugger, not log text)
  - SEED-001 marked resolved with an accurate, non-stale audit record
affects: [15-concord-stream-auth-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive-once logger as a per-relay const at the top of the per-relay construction function, never inside a re-enterable switchMap/mergeMap projector (D-18)"

key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/seeds/SEED-001-avoid-inline-debug-extend.md
    - packages/loaders/src/loaders/sync-loader.ts
    - packages/loaders/src/loaders/__tests__/sync-loader.test.ts

key-decisions:
  - "ALOG-03 restated to derive-once-per-lifetime rather than the original zero-hits extend-then-invoke grep, which passed vacuously (D-17/D-18)"
  - "requestLog placed at the very top of buildRelayStream(url), before the other per-relay state, matching 'top of buildRelayStream's body' from the plan text"
  - "Regression test uses a negentropy-succeeds scenario (request path never exercised) to distinguish derive-once-unconditionally (post-fix: 1 derivation) from derive-only-if-request$-is-called (pre-fix: 0 derivations) — the actual observable difference hoisting produces, since a single relay's supported$ never re-emits in this loader's current design"
  - "No enforcement mechanism added (lint rule / grep test / invariant comment), per D-19 and REQUIREMENTS.md's Out of Scope table"

patterns-established:
  - "Pattern: per-relay Debugger derivation lives at the per-relay construction boundary (buildRelayStream), alongside every other per-relay value, never inside the switchMap projector that boundary feeds"

requirements-completed: [ALOG-03]

coverage:
  - id: D1
    description: "ALOG-03 restated in REQUIREMENTS.md and ROADMAP.md to a criterion that requires the packages/loaders/ sweep to actually be performed, citing D-17/D-18"
    requirement: "ALOG-03"
    verification:
      - kind: other
        ref: "grep -c ALOG-03 .planning/REQUIREMENTS.md (returns 3); grep -c D-17\\|D-18 .planning/REQUIREMENTS.md (returns 1); git diff --stat .planning/ROADMAP.md (1 line changed, confined to Phase 14 block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "sync-loader.ts's per-url request logger hoisted out of the switchMap projector into a per-relay const, with a regression test pinning the derive-once property"
    requirement: "ALOG-03"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts#14-02: sync-loader's request logger is derived once per relay (D-18) > derives the per-url request logger exactly once, even when negentropy sync never needs it"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-loaders test (126 tests, 16 files, all passing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SEED-001 marked resolved with an accurate audit record, correcting stale sync-loader.ts breadcrumb coordinates"
    verification:
      - kind: other
        ref: "grep -c '^status: resolved' .planning/seeds/SEED-001-avoid-inline-debug-extend.md (1); grep -c '## Resolution' (1); grep -c '171\\|266\\|351' (0)"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-09
status: complete
---

# Phase 14 Plan 02: ALOG-03 Restatement and packages/loaders/ Derive-Once Sweep Summary

**Restated ALOG-03 from a vacuous zero-hits grep to a derive-once-per-lifetime rule, then hoisted `sync-loader.ts`'s one genuine offender — the per-url request logger buried inside a `switchMap` projector — out to `buildRelayStream`'s per-relay construction boundary, closing SEED-001.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-09
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `REQUIREMENTS.md` ALOG-03 and `ROADMAP.md` Phase 14 success criterion 3 amended to the D-18 tightened wording ("derived once per module load, per class construction, per context construction, or per function/operator invocation — never on a path a reactive pipeline can re-enter"), both citing D-17 (the original criterion's vacuous pass) and D-18 (the tightened rule) for traceability.
- `packages/loaders/src/loaders/sync-loader.ts`'s `buildRelayStream(url)` now derives `requestLog` once, at the top of its body alongside `authPhases`/`authPhaseChange$`/the close-callback set, and the `switchMap((nips) => ...)` projector references that single `requestLog` instead of re-evaluating `log.extend(url).extend("request")` inline.
- A new regression test (`packages/loaders/src/loaders/__tests__/sync-loader.test.ts`) pins the derive-once-per-relay property using an injected spy `Debugger` whose `.extend()` calls are counted — not log text — per the standing Verification Standard.
- `packages/loaders/src/loaders/timeline-loader.ts`'s seven previously-flagged sites, `paginatedRequest`'s `nanoid(8)` correlation logger, and the loader-level `nanoid(4)` call-scoped logger were audited (read-only, per the plan) and confirmed already compliant — no changes.
- SEED-001 marked `resolved` (`resolved: 2026-08-08`, `resolved_in: phase-14`) with a `## Resolution` section and corrected, non-stale breadcrumb coordinates.

## Task Commits

Each task was committed atomically:

1. **Task 1: Restate ALOG-03 in REQUIREMENTS.md and ROADMAP.md** - `e47dd7ad` (docs)
2. **Task 2: Hoist sync-loader's per-url request logger out of the switchMap projector** - `4d02ec5c` (refactor)
3. **Task 3: Mark SEED-001 resolved with its audit record** - `4a250e57` (docs)

_Note: this plan has no TDD-mode tasks; Task 2's RED→GREEN non-vacuity probe was performed manually via temporary Edit-tool reverts (not `git stash`), not as separate commits — see "RED→GREEN Non-Vacuity Probe" below._

## Files Created/Modified

- `.planning/REQUIREMENTS.md` - ALOG-03 checklist bullet tightened to D-18's derive-once-per-lifetime wording, plus a traceability sentence citing D-17/D-18
- `.planning/ROADMAP.md` - Phase 14 success criterion 3 amended to the same tightened wording, `(ALOG-03)` citation preserved
- `.planning/seeds/SEED-001-avoid-inline-debug-extend.md` - status → `resolved`, breadcrumbs corrected, `## Resolution` section added
- `packages/loaders/src/loaders/sync-loader.ts` - `requestLog` hoisted to `buildRelayStream(url)`'s top level; `switchMap` projector's inline `.extend()` chain replaced with a reference to it
- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` - new `describe("14-02: sync-loader's request logger is derived once per relay (D-18)")` block with the derive-once regression test

## RED→GREEN Non-Vacuity Probe

Per the plan's explicit instruction, the new assertion's non-vacuity was verified empirically rather than assumed:

1. **RED:** Temporarily reverted `sync-loader.ts` (via the `Edit` tool, not `git stash`/`git reset`) to restore the pre-fix inline derivation — removing the hoisted `const requestLog` and putting `log.extend(url).extend("request")` back inline inside the `switchMap` projector's `request$` closure. Ran `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts -t "derives the per-url request logger"`. **Observed failure:** `AssertionError: expected [] to have a length of 1 but got +0` — the spy recorded **0** `"request"` extend calls, because in the negentropy-succeeds scenario the request path (and its inline derivation) is never exercised at all.
2. **GREEN:** Restored the hoist (`requestLog` declared once at `buildRelayStream`'s top level, referenced by `request$`). Re-ran the same test: **passed**, with the spy recording exactly **1** `"request"` extend call — the unconditional per-relay derivation, regardless of which loading path is actually used.

This is the genuine observable difference hoisting produces in this loader's current design: a single relay's `supported$` never re-emits (it resolves from a `Promise`, `take(1)`-bounded if an `Observable`), so the `switchMap` projector itself only ever runs once per relay either way — the pre-fix bug was not "derived N>1 times," it was "derived 0 times when the request path is never taken, instead of unconditionally once per relay." The test's negentropy-succeeds fixture is what surfaces that distinction.

## Decisions Made

- **ALOG-03 restated per D-17/D-18** — the original wording tested for an extend-then-immediately-invoke pattern (`x.extend(...)(...)`) that this milestone's research confirmed does not exist anywhere in the monorepo, so it passed without the sweep ever being performed. The tightened wording ("derived once per relay-or-loader lifetime, never on a path a reactive pipeline can re-enter") is what this plan's Task 2 sweep is actually required to satisfy.
- **`requestLog` placed at the very top of `buildRelayStream(url)`'s body**, immediately above the D-16 auth-phase-suspension block, matching the plan's literal "at the top of `buildRelayStream(url)`'s body" instruction while still sitting "alongside" the other per-relay values it precedes.
- **Regression test scenario chosen deliberately** (negentropy succeeds, request path never invoked) to produce a real RED-vs-GREEN contrast, since a naive "run a normal load and count extend('request') calls" test would read 1 in both the pre-fix and post-fix code (the projector only ever runs once per relay in this loader's current design, regardless of hoisting). The chosen scenario isolates the actual difference: unconditional-once-per-relay (post-fix) vs. evaluated-only-if-the-request-path-is-taken (pre-fix).
- **No enforcement mechanism added** (lint rule, grep-based repo test, or invariant comment), per D-19 and `REQUIREMENTS.md`'s Out of Scope table. Regressions are caught by review.
- **`timeline-loader.ts` and `packages/relay/` left untouched**, per the plan's explicit prohibition — both audited and confirmed already compliant under the tightened rule (D-20 for `packages/relay/`).

## Deviations from Plan

**1. [Process correction, not a plan deviation] Used `Edit`-tool reverts instead of `git stash` for the RED→GREEN probe**

During the non-vacuity probe, a `git stash push` was run once to temporarily park the hoist changes — `git stash` is explicitly prohibited during worktree-isolated execution (it can leak state across sibling worktrees via the shared `refs/stash`). This was caught immediately: the stash was popped back in the same turn before any other operation ran, restoring the exact prior state with no data loss and no cross-worktree interaction (verified via `git stash list`/`git stash pop` and a `grep` re-check of the restored file). The RED→GREEN probe itself was then re-done correctly using the `Edit` tool to temporarily revert and restore the specific hunk, per the destructive-git-prohibition's sanctioned alternative. No commit was affected; this is recorded for transparency, not as a code deviation.

No other deviations — the three tasks were executed exactly as the plan specified.

## Issues Encountered

- Initial `pnpm --filter applesauce-loaders build` failed with `TS2307: Cannot find module 'applesauce-core/helpers/...'` errors — a workspace build-order issue (this worktree's `packages/core`/`packages/signers` `dist/` outputs were stale relative to the checked-out source), not caused by this plan's changes. Resolved by running `pnpm turbo build --filter='./packages/*'` once to rebuild the full dependency graph in order; `pnpm --filter applesauce-loaders build` then succeeded standalone for every subsequent check.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ALOG-03 is closed: `REQUIREMENTS.md`/`ROADMAP.md` now state a criterion the sweep actually satisfies, `packages/loaders/` has no `Debugger` derived on a re-enterable path, and SEED-001 is resolved.
- `pnpm --filter applesauce-loaders build` and `pnpm --filter applesauce-loaders test` (126 tests / 16 files) both green.
- No blockers for the remaining Wave 1 plans (14-01, 14-03) or downstream Phase 15 — this plan touched only `packages/loaders/` and planning documents, per its declared file scope.

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-09*
