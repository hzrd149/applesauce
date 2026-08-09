---
phase: 14-auth-lifecycle-debug-logging
plan: 03
subsystem: testing
tags: [debug, vitest, relay, nip-42, logging]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks
    provides: "RelayGroup.sync's per-relay catchError isolation (D-19/13-07) and the RELAY_AUTH_ERROR_NAMES duck-typed precedent in packages/loaders/src/loaders/sync-loader.ts"
provides:
  - "packages/relay/src/__tests__/debug-capture.ts — shared, restore-safe debug-output capture oracle (captureDebugOutput, messagesOf, withDebugCapture) for every later ALOG-01/02 test in this phase"
  - "RelayGroup.sync's dropped-relay log line reworded to human prose naming the auth failure class, with the internal (D-19) citation stripped"
affects: [14-04, 14-05, 14-06, 14-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "debug-package output capture: enable a concrete namespace, override the shared sink, collect calls, restore in a finally — reused verbatim from packages/concord/src/helpers/__tests__/relays.test.ts, now generalized with a namespace parameter"
    - "duck-typed auth-error-name set (RELAY_AUTH_ERROR_NAMES) local to group.ts, mirroring sync-loader.ts's precedent — match on err.name string, never instanceof, never import the error classes across the loaders/relay boundary"

key-files:
  created:
    - packages/relay/src/__tests__/debug-capture.ts
  modified:
    - packages/relay/src/group.ts
    - packages/relay/src/__tests__/group.test.ts
    - packages/relay/package.json (debug/@types/debug added as devDependencies)

key-decisions:
  - "withDebugCapture declared as export function returning a Promise (Promise.resolve().then().finally()) rather than export async function, so the plan's literal acceptance grep (\"export function (captureDebugOutput|messagesOf|withDebugCapture)\" == 3) passes without weakening the restore-in-finally guarantee"
  - "debug and @types/debug added as devDependencies of applesauce-relay (not dependencies) since the only import is in a test-support module, not production source — mirrors Phase 12.2-01's precedent of adding debug as a direct dependency once a package's transitive resolution assumption proved false at runtime under pnpm's strict node_modules"
  - "RELAY_AUTH_ERROR_NAMES declared locally in group.ts (not imported from relay.ts, not imported from loaders) per the plan's explicit instruction to duck-type on err.name rather than import the error classes into a new place"
  - "Test 1's auth-class assertion checks for the literal phrase \"auth failure\" (case-insensitive) rather than AuthRequiredError.name — the raw error object is deliberately still passed as this.log's trailing argument (D-11 requirement: keep the stack trace available), and util.format's rendering of that trailing Error argument includes the class name via the Error's own toString() regardless of whether the prose itself names it. Asserting the class name alone would have been vacuously true both before and after the fix; the RED→GREEN probe below confirms \"auth failure\" is the non-vacuous signal"

requirements-completed: [ALOG-01, ALOG-02]

coverage:
  - id: D1
    description: "Shared, restore-safe debug-output capture oracle (captureDebugOutput/messagesOf/withDebugCapture) available in packages/relay/src/__tests__/"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts — dropped-relay diagnostics describe block (uses withDebugCapture)"
        status: pass
    human_judgment: false
  - id: D2
    description: "RelayGroup.sync's dropped-relay line is human prose, carries no internal decision id, and names the failure class (auth vs. non-auth) so an operator can tell them apart from captured output alone"
    requirement: ALOG-01
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#dropped-relay diagnostics (14-03): human prose names the failure class > an auth-family failure names the auth error class..."
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#dropped-relay diagnostics (14-03): human prose names the failure class > an ordinary connection error is NOT reported as an auth failure..."
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-09
status: complete
---

# Phase 14 Plan 03: Debug-Capture Harness + RelayGroup Dropped-Relay Diagnostics Summary

**Lifted the concord-proven `debug`-output capture harness into `applesauce-relay`'s test suite and reworded `RelayGroup.sync`'s existing dropped-relay log line so an operator can tell an auth-caused drop from a network-caused drop by reading captured output alone.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-09T17:53Z (base commit)
- **Completed:** 2026-08-09T18:29Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `packages/relay/src/__tests__/debug-capture.ts` created: `captureDebugOutput(namespace)`, `messagesOf(calls)`, `withDebugCapture(namespace, body)`, all restore-safe (conditional re-disable, `finally`-guaranteed restore).
- `RelayGroup.sync`'s pre-existing (Phase 13, plan 13-07) dropped-relay log call reworded to sentence-case human prose that names the failure class (`an auth failure (AuthRequiredError)` vs. the error's own message), with the internal `(D-19)` citation removed.
- Two new tests in `group.test.ts` prove an auth-family drop and a network-drop are distinguishable from captured debug output alone, both driven through `withDebugCapture`.
- RED→GREEN non-vacuity probe performed and recorded (see below).

## Task Commits

1. **Task 1: Lift the debug-output capture harness into the relay test suite** - `45db6357` (feat)
2. **Task 2: Reword RelayGroup.sync's dropped-relay line and pin it with a captured-output assertion** - `bf5e0644` (feat)

## Files Created/Modified
- `packages/relay/src/__tests__/debug-capture.ts` - New test-support module: `captureDebugOutput`, `messagesOf`, `withDebugCapture`
- `packages/relay/src/group.ts` - Reworded dropped-relay log call; added local `RELAY_AUTH_ERROR_NAMES` duck-typed set
- `packages/relay/src/__tests__/group.test.ts` - New `describe` block with two `withDebugCapture`-driven tests
- `packages/relay/package.json` - Added `debug`/`@types/debug` as devDependencies (previously only transitively available)

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- `withDebugCapture` is a plain `export function` (not `async function`) returning a `Promise`, to satisfy the plan's literal acceptance grep while keeping restore-in-`finally` semantics.
- `debug`/`@types/debug` added as `applesauce-relay` devDependencies — Rule 3 auto-fix, not a new-package install. `debug` was already resolved in the workspace lockfile (declared by `applesauce-core`, `applesauce-concord`) but not hoisted into `packages/relay`'s own resolution scope under pnpm's strict `node_modules`; the new test-support module's direct `import debugFactory from "debug"` failed to resolve at runtime until declared. This exactly mirrors the documented Phase 12.2-01 precedent for `applesauce-concord` (STATE.md: "debug/@types/debug added as concord's own direct dependencies — RESEARCH-verified correction to a transitive assumption"). No new package entered the lockfile; `pnpm install --filter applesauce-relay` resolved purely from already-audited existing lockfile entries.
- `RELAY_AUTH_ERROR_NAMES` is a local `const` in `group.ts`, not an import from `relay.ts` or a shared module — per the plan's explicit instruction to duck-type on `.name` and not import the error classes into a new place, mirroring `sync-loader.ts`'s identical precedent for the identical reason (a rename of the pinned `.name` values must be updated at each duck-typing site independently).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `debug`/`@types/debug` as `applesauce-relay` devDependencies**
- **Found during:** Task 2 (running `pnpm vitest run packages/relay/src/__tests__/group.test.ts` after adding the `debug-capture.ts` import)
- **Issue:** `Error: Cannot find package 'debug' imported from .../debug-capture.ts` — the research's "already transitively available" assumption did not hold at runtime under pnpm's strict `node_modules` layout, even though `tsc --noEmit`/`build` succeeded (type resolution differs from Node's runtime module resolution).
- **Fix:** Added `debug: ^4.4.3` and `@types/debug: ^4.1.13` as devDependencies of `packages/relay/package.json`, then `pnpm install --filter applesauce-relay` (resolved entirely from the existing lockfile — no new package versions entered the workspace).
- **Files modified:** `packages/relay/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm vitest run packages/relay/src/__tests__/group.test.ts` (29/29 passing) and `pnpm --filter applesauce-relay test` (248/248 passing)
- **Committed in:** `bf5e0644` (Task 2 commit)

**2. [Rule 1 - Bug in test authoring, caught before commit] Fixed a vacuous assertion in the auth-class test**
- **Found during:** Task 2's mandated RED→GREEN non-vacuity probe
- **Issue:** The first draft of the auth-family test asserted `droppedLines[0]).toContain(AuthRequiredError.name)`. Because `this.log`'s trailing argument is the raw error object (kept per D-11's "full stack still available" requirement), `util.format`'s rendering of that argument always includes the Error's own `name` via its `toString()` — so the assertion passed even against the pre-edit source (which never named the class in its own prose). This would have shipped a test that could never catch a regression.
- **Fix:** Changed the assertion to check for the literal phrase `"auth failure"` (case-insensitive), which only appears in the new prose, not in the raw error's stack dump. Verified empirically: RED against the pre-edit `this.log(\`dropping relay from group sync (D-19): ${relay.url}\`, err)\`, GREEN against the edited line.
- **Files modified:** `packages/relay/src/__tests__/group.test.ts`
- **Verification:** Manual revert/restore of `group.ts` (see below), confirmed RED then GREEN
- **Committed in:** `bf5e0644` (Task 2 commit; caught before commit, so only the corrected version ever landed)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency gap, 1 test-authoring bug caught by the plan's own mandated non-vacuity discipline)
**Impact on plan:** Both were necessary for a genuinely load-bearing test suite. No scope creep — no production behavior changed beyond the plan's own scope (the dropped-relay line's prose).

## RED→GREEN Non-Vacuity Probe (Task 2, mandated by the plan)

Performed by temporarily reverting `packages/relay/src/group.ts` to its pre-edit content (via `git checkout -- packages/relay/src/group.ts`, with the edited version backed up to the session scratchpad first — **not** via `git stash`, which is prohibited in worktree mode; an initial attempt used `git stash` in error and was immediately corrected via `git stash pop` before any other operation, restoring the exact prior state) and rebuilding:

- **RED:** Against the pre-edit `this.log(\`dropping relay from group sync (D-19): ${relay.url}\`, err)\` line, the new auth-family test failed with:
  `AssertionError: expected '...dropping relay from group sync (d-19): wss://relay1.test authrequirederror: auth-required...' to contain 'auth failure'`
  (28/29 tests passed; the 1 new auth-class test failed as expected — the other 28 pre-existing/new tests were unaffected by the revert).
- **GREEN:** After restoring the edited `group.ts` (reason clause producing `"Dropped relay <url> from group sync: an auth failure (AuthRequiredError)"`), all 29/29 tests passed, confirmed twice for run-to-run stability, and the full `applesauce-relay` suite (248/248) passed.

## Issues Encountered

During the non-vacuity probe, `git stash` was used in error to preserve uncommitted changes across a temporary revert — this is explicitly prohibited by the executor's worktree-safety rules (shared stash list across worktrees). The mistake was caught immediately (before any other git operation ran) and corrected via a single `git stash pop`, which returned the exact previously-stashed content (confirmed via `git status --short` matching pre-stash state and `git stash list` empty afterward). No data was lost and no cross-worktree contamination occurred, since the stash was popped before any other worktree could have pushed onto the shared stack. Subsequent reverts in the same probe used `git checkout -- <file>` plus a scratchpad backup instead, per the sanctioned pattern.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `debug-capture.ts`'s `captureDebugOutput`/`messagesOf`/`withDebugCapture` are ready for plan 14-06 (the `:auth` sub-namespace lifecycle oracle) to import directly — no further harness work needed.
- `RelayGroup.sync`'s dropped-relay line is closed out for this phase; no outstanding work on it. The Phase 13 deferred-items.md's "connection-drop-mid-auth-wait at low `keepAlive`" backlog candidate (flagged in 14-RESEARCH.md Open Question 3) remains unaddressed by this plan — it is out of ALOG-01/02's scope and should be filed as a backlog entry at phase closeout, not in this plan.
- No blockers for 14-04/14-05 (the `applesauce-relay` wire-verb union and two-track connection logging work) or 14-06 (the `:auth` namespace lifecycle tests) — this plan's deliverables are additive infrastructure only.

## Self-Check: PASSED

- FOUND: `packages/relay/src/__tests__/debug-capture.ts`
- FOUND: commit `45db6357` (Task 1)
- FOUND: commit `bf5e0644` (Task 2)
- FOUND: `.planning/phases/14-auth-lifecycle-debug-logging/14-03-SUMMARY.md`

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-09*
