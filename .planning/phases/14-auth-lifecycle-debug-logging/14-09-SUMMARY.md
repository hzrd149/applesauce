---
phase: 14-auth-lifecycle-debug-logging
plan: 09
subsystem: observability
tags: [debug, rxjs, applesauce-loaders, logger-hygiene, gap-closure]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-02's requestLog hoist and the D-18 derive-once regression-test pattern this plan mirrors and widens"
provides:
  - "packages/loaders/src/loaders/sync-loader.ts's paginatedRequest logger (backwardLog) hoisted out of the switchMap-reachable request$() call site to buildRelayStream's per-relay top level, matching requestLog's 14-02 pattern"
  - "the D-18 regression guard widened from a single-namespace filter (\"request\" only) to a total extend()-count assertion, so it observes derivations anywhere in the per-relay scope, not just the one namespace 14-02 happened to touch"
  - "WR-07 closed; ALOG-03 as restated by 14-02 now actually holds across packages/loaders/, not just the one call site 14-02 fixed"
affects: [15-concord-stream-auth-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regression guards on a derive-once property must assert the total derivation count for the scope under test, not a single filtered namespace — a filtered guard is structurally blind to any derivation outside the namespace it happened to be written against (WR-07)"

key-files:
  created: []
  modified:
    - packages/loaders/src/loaders/sync-loader.ts
    - packages/loaders/src/loaders/__tests__/sync-loader.test.ts

key-decisions:
  - "backwardLog hoisted to buildRelayStream's top level immediately after requestLog, threaded into paginatedRequest as an already-derived logger (renamed param logger -> log) instead of deriving inside the function, mirroring 14-02's exact shape rather than inventing a second convention"
  - "Guard widened to assert extendCalls.length (total, unfiltered) for the existing negentropy-succeeds scenario, plus fixed-position value checks on the non-random indices, rather than adding a second single-namespace filter (which would just relocate the same blind spot) — per the plan's explicit prohibition on narrowing the guard to today's known call sites"
  - "The per-relay nanoid(8) correlation suffix stayed a per-relay derivation (not per-paginatedRequest-call), since paginatedRequest is only ever invoked once per relay per run in this loader's current design (mutually exclusive negentropy-direct vs negentropy-fallback branches) — hoisting to buildRelayStream preserves that 'once per pagination run' semantics while eliminating the re-enterable-scope defect"

patterns-established:
  - "Pattern: when a regression guard is discovered to have a namespace-filtering blind spot, widen it to a total-count assertion for the scope under test rather than adding another namespace-specific filter"

requirements-completed: [ALOG-03]

coverage:
  - id: D1
    description: "paginatedRequest's backwardLog derivation hoisted out of the switchMap-reachable request$() call site to buildRelayStream's per-relay top level, matching requestLog's 14-02 pattern"
    requirement: "ALOG-03"
    verification:
      - kind: unit
        ref: "pnpm exec vitest run packages/loaders (16 files, 126 tests, all passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-18 regression guard widened from a single \"request\"-namespace filter to a total extend()-count assertion, proven non-vacuous via Edit-tool revert/restore of Task 1's hoist"
    requirement: "ALOG-03"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts#14-02: sync-loader's request logger is derived once per relay (D-18) > derives the per-url request logger exactly once, even when negentropy sync never needs it"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 09: Finish the ALOG-03 derive-once sweep and widen the guard that missed it Summary

**Hoisted `paginatedRequest`'s `backward`/`nanoid(8)` logger derivation out of `buildRelayStream`'s switchMap-reachable `request$()` call site (mirroring 14-02's `requestLog` hoist exactly), then widened the D-18 regression guard from a single `"request"`-namespace filter to a total `extend()`-count assertion — proven non-vacuous by an Edit-tool revert/restore that reproduced the exact pre-fix failure.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-11
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `packages/loaders/src/loaders/sync-loader.ts`'s `buildRelayStream(url)` now derives `backwardLog = requestLog.extend("backward").extend(nanoid(8))` once, unconditionally, at its own top level — immediately after `requestLog` — instead of `paginatedRequest` deriving `logger?.extend("backward").extend(nanoid(8))` on every call from `request$()`, which lives inside the `switchMap` projector (the exact re-enterable-scope defect 14-02's hoist targeted, just at a second call site).
- `paginatedRequest`'s `logger` parameter renamed to `log` and its type/role changed from "an unextended base logger to derive from" to "the already fully-derived logger to use directly" — the internal `const log = logger?.extend(...)` line is gone entirely.
- The D-18 regression test (`packages/loaders/src/loaders/__tests__/sync-loader.test.ts`) widened from `expect(extendCalls.filter((ns) => ns === "request")).toHaveLength(1)` (unchanged, kept) to also assert `expect(extendCalls).toHaveLength(6)` — the total, unfiltered extend-call count for the negentropy-succeeds scenario — plus a positional value check on the four non-random indices (`"sync-loader"`, the per-relay `url`, `"request"`, `"backward"`). This closes the structural blind spot: a guard that filters to one namespace cannot observe a violation introduced on any other namespace, which is exactly how `paginatedRequest`'s own derivations survived a plan whose entire purpose was eliminating this defect class.
- Non-vacuity proven empirically (not assumed): Task 1's hoist was reverted with the `Edit` tool (not `git stash` — prohibited in this worktree per #3542), the widened guard was run and observed to fail with the exact pre-fix call count, then the hoist was restored and the guard re-run to green. Full RED→GREEN transcript below.

## Task Commits

Each task was committed atomically:

1. **Task 1: Hoist the surviving derivations in `paginatedRequest`** - `fff0883d` (refactor)
2. **Task 2: Widen the guard so it could have caught this** - `8c3de892` (test)

## Files Created/Modified

- `packages/loaders/src/loaders/sync-loader.ts` - `paginatedRequest`'s `logger?.extend("backward").extend(nanoid(8))` moved to `buildRelayStream`'s top level as `backwardLog`, threaded into `paginatedRequest`'s renamed `log` parameter instead of derived inside it
- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` - D-18 regression test widened to a total `extendCalls.length` assertion (6, for this scenario) plus fixed-position value checks, in addition to the existing `"request"`-namespace filter

## RED→GREEN Non-Vacuity Probe

Per the plan's explicit instruction, the widened guard's non-vacuity was verified empirically against the exact pre-Task-1 code, using the `Edit` tool to revert and restore (never `git stash`, which is prohibited in this worktree while plan 14-08 runs concurrently, per the shared `refs/stash` risk documented in #3542):

1. **Before widening (sanity):** ran the existing negentropy-succeeds test against the post-Task-1 code with a debug print of `extendCalls` — observed `["sync-loader","sMSn","wss://relay/","request","backward","PUq0lBzc"]`, confirming the total is 6 (4 fixed-value entries + 2 per-run nanoid entries) once the hoist is unconditional.
2. **RED:** Reverted `paginatedRequest`'s signature/body and the `request$()` call site (via `Edit`, restoring `logger?.extend("backward").extend(nanoid(8))` inline) and removed the now-dead `backwardLog` const from `buildRelayStream` — i.e. exactly the pre-Task-1 (post-14-02) code. Ran `pnpm exec vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts -t "derives the per-url request logger"`.

   **Observed failure:**
   ```
   AssertionError: expected [ 'sync-loader', 'V10e', …(2) ] to have a length of 6 but got 4

   - Expected
   + Received

   - 6
   + 4
   ```
   The negentropy-succeeds scenario never exercises the request path, so pre-fix `paginatedRequest` is never called and its two derivations (`"backward"`, `nanoid(8)`) never happen — exactly the "derived 0 times instead of unconditionally once" shape 14-02's own probe found for `requestLog`, now reproduced for `backwardLog`. The pre-existing `"request"`-filtered assertion still passed in this state (length 1), which is precisely the blind spot WR-07 identified: a namespace-filtered guard cannot see this violation.

3. **GREEN:** Restored Task 1's hoist exactly (`git diff` against the Task 1 commit was empty after restoring, confirming byte-identical round-trip). Re-ran the same test: **passed**, with `extendCalls` back to length 6, matching the pre-verification debug run.
4. Ran the full suite (`pnpm exec vitest run packages/loaders`) after restoring: **126/126 tests passing, 16/16 files**.

## Decisions Made

- **`backwardLog` hoisted immediately after `requestLog`** at `buildRelayStream`'s top level, matching 14-02's placement convention (per-relay values grouped at the top of the per-relay construction function) rather than scattering it elsewhere.
- **Guard widened by total count, not by adding a second namespace filter.** The plan's prohibition ("do not narrow the guard to just the specific new call sites") ruled out simply adding `.filter((ns) => ns === "backward")` — that would just relocate today's blind spot to the *next* namespace a future derivation introduces. Asserting `extendCalls.length` for the whole per-relay derivation set is the structural fix: any future logger derived inside a re-enterable scope in this function will change that total, regardless of what namespace it uses.
- **Per-relay (not per-paginatedRequest-call) nanoid(8).** `paginatedRequest` is only ever invoked once per relay per run in the current design (the `!negentropy` direct branch and the negentropy-fallback `catchError` branch are mutually exclusive), so hoisting the nanoid(8) suffix to `buildRelayStream`'s unconditional top level preserves its "one correlation id per pagination run" intent while removing the re-enterable-scope hazard the review flagged.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's described shape (mirror 14-02's hoist pattern; widen the guard by total count rather than narrowing it), and the RED→GREEN probe was performed and recorded per the plan's explicit instruction.

## Issues Encountered

- Initial `pnpm exec vitest run packages/loaders` failed across most test files with `Cannot find package 'applesauce-core/helpers'` / `Failed to resolve entry for package "applesauce-core"` — a stale-`dist/`-relative-to-checked-out-source workspace build-order issue identical to the one 14-02's summary documented, not caused by this plan's changes. Resolved by running `pnpm turbo build --filter='./packages/*'` once; `pnpm exec vitest run packages/loaders` then passed cleanly for every subsequent run in this session.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-07 is closed: every `Debugger` in `packages/loaders/src/loaders/sync-loader.ts` is now derived once, unconditionally, outside any scope a reactive pipeline can re-enter, and the D-18 regression guard can actually observe a violation of that property anywhere in the per-relay scope — not just on the `"request"` namespace 14-02 happened to touch.
- ALOG-03 as restated by 14-02 now genuinely holds for `packages/loaders/`; no known gaps remain in this package for that requirement.
- `pnpm exec vitest run packages/loaders` (126 tests / 16 files) and `tsc --noEmit` both green.
- Only `packages/loaders/src/loaders/sync-loader.ts` and its test file were touched, per the plan's file scope and its explicit prohibition on touching `packages/relay/` (owned by 14-08, running concurrently).

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
