---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 03
subsystem: loaders
tags: [rxjs, applesauce-loaders, nip-42, auth, sync-loader]

# Dependency graph
requires:
  - phase: 13-01
    provides: "AuthHandlerError/AuthTimeoutError pinned .name values that this plan's RELAY_AUTH_ERROR_NAMES duck-types against"
provides:
  - "SyncAuthRelay/SyncAuthContext/SyncAuthHandler local structural mirrors of applesauce-relay's auth types (D-06, no new dependency)"
  - "onAuthRequired/authTimeout/authRetries threaded through SyncMethodOptions/SyncLoadRequest into both the negentropy sync and paginated request paths from one methodOptions construction point (RAUTH-08)"
  - "Per-relay auth-phase suspension that pauses SyncLoader's own stall guard for the full auth phase (handler execution plus the post-handler wait), closing RESEARCH Assumption A2 (D-16)"
  - "Negentropy fallback gated on the pinned relay auth error name set so an auth-required failure errors the relay instead of burning the paginated path (D-16)"
affects: [15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-relay closure-scoped suspension counter (mirrors applesauce-relay's AuthPhaseGate structurally, without importing it) constructed inside buildRelayStream, not shared across relays"
    - "Custom Observable-based stall guard replacing rxTimeout({first, each}) so its clock can pause/resume around a suspension signal"
    - "Duck-typed error identity via a pinned module-level Set of .name strings, the only channel D-06 allows for cross-package error coupling"

key-files:
  created: []
  modified:
    - packages/loaders/src/loaders/sync-loader.ts
    - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
    - packages/loaders/src/loaders/__tests__/exports.test.ts

key-decisions:
  - "onAuthRequired's wrapper is only constructed when the caller supplies a handler (relayOnAuthRequired = onAuthRequired ? wrapper : undefined), not unconditionally — an always-present wrapper would change methodOptions' shape even when no auth handling is requested, breaking every pre-existing test that asserts an exact options object without touching onAuthRequired. This also keeps Task 2's own verification (pre-existing 24 tests) green before Task 3 adds new ones."
  - "RELAY_AUTH_ERROR_NAMES is exported (not just module-private) so tsc's noUnusedLocals does not flag it as unused between Task 1 (declares it) and Task 2 (consumes it) landing in separate commits; required updating the loaders exports.test.ts inline snapshot"
  - "The auth-aware withTimeout pauses/resumes the existing remaining budget across a suspension (D-15 parity — an auth wait doesn't grant extra time) but resets to a fresh timeoutMs on every actual emission, preserving the pre-existing first+each-are-equal stall-guard semantics"
  - "Per-relay suspension state (authPhases counter, pendingAuthCloses set) is closure-scoped inside buildRelayStream(url), which already runs fresh per url per subscription — matches the plan's per-relay requirement without a separate Map<url, gate> registry"

requirements-completed: [RAUTH-08]

coverage:
  - id: D1
    description: "SyncAuthRelay/SyncAuthContext/SyncAuthHandler declared locally with the structural-mirror doc convention, and onAuthRequired/authTimeout/authRetries added to SyncMethodOptions/SyncLoadRequest, threaded from the single methodOptions construction point into both sync() and paginatedRequest()"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > threads onAuthRequired, authTimeout and authRetries into the negentropy sync (RAUTH-08)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > threads onAuthRequired, authTimeout and authRetries into the paginated request (RAUTH-08)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > passes the exact same auth options object to both the negentropy sync and its paginated fallback (RAUTH-08)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > maps a relay pool to the internal methods, threading the three auth options (RAUTH-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The withTimeout stall guard is suspended for the whole auth phase (handler execution plus the post-handler authTimeout wait), closing RESEARCH's Assumption A2 residual window, held out and verified RED against a handler-execution-only suspension before landing"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > suspends the stall guard while a slow onAuthRequired handler is running (D-16)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > suspends the stall guard through the post-handler auth wait, not just the handler call (D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The negentropy fallback re-throws (does not fall back to the paginated request) when the caught error's name is a pinned relay auth error name, and still falls back for a genuine non-auth sync failure"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > errors the relay without falling back when negentropy sync fails with an auth error name (D-16)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > still falls back to a request when negentropy sync fails with a non-auth error (D-16)"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 03: SyncLoader Auth Threading, Stall-Guard Suspension, and Fallback Gating Summary

**`SyncLoader` mirrors `applesauce-relay`'s auth types locally (no new dependency), threads `onAuthRequired`/`authTimeout`/`authRetries` identically into both the negentropy and paginated paths from one `methodOptions` construction point, and makes its own 30s stall guard and negentropy fallback auth-aware so an auth-gated relay never gets spuriously timed out or double-charged against the same wall.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-06T09:01:12Z (first task commit)
- **Completed:** 2026-08-06T09:14:27Z
- **Tasks:** 3
- **Files modified:** 3 (0 new, 3 modified)

## Accomplishments

- `SyncAuthRelay`/`SyncAuthContext`/`SyncAuthHandler` declared locally in `sync-loader.ts` with the same "structurally matches applesauce-relay's ..." doc convention as the pre-existing `SyncAuthRequirement`/`SyncLoaderRelay`, keeping D-06's zero-`applesauce-relay`-dependency invariant (`packages/loaders/package.json` unchanged: `applesauce-core`, `nanoid`, `rxjs` only)
- `onAuthRequired`/`authTimeout`/`authRetries` added to `SyncMethodOptions` and `SyncLoadRequest`, threaded from the single `methodOptions` object both `sync(url, filter, methodOptions)` and `paginatedRequest(..., methodOptions)` read — pinned directly by a test asserting the two call sites receive the literal same object (RAUTH-08)
- A per-relay auth-phase suspension (closure-scoped inside `buildRelayStream`, never shared across relays) replaces the bare `rxTimeout({ first, each })` stall guard with a suspendable version: the clock pauses the instant the wrapped `onAuthRequired` is invoked and resumes only after the later of the handler settling and `authTimeout` ms past that — closing RESEARCH's Assumption A2 residual window, which the held-out test proved fails against a handler-execution-only suspension before this fix landed
- The negentropy fallback `catchError` re-throws (instead of falling back to the paginated path) when the caught error's `.name` is in the pinned `RELAY_AUTH_ERROR_NAMES` set, so an auth-gated relay errors once via the existing per-relay `catchError` rather than logging a spurious "sync failed, falling back" and burning a second request against the same auth wall
- 8 new unit tests covering RAUTH-08 threading on both paths, structural pinning of the shared options object, the D-16 stall-guard handler-execution and held-out post-handler-wait windows, and the fallback-suppression/still-falls-back pair — all 118 tests in `applesauce-loaders` pass, all 32 in `sync-loader.test.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Mirror the auth types and thread the three options through methodOptions** - `3bbfb177` (feat)
2. **Task 2: Make the stall guard auth-aware and gate the negentropy fallback on error identity** - `6551c33c` (feat)
3. **Task 3: SyncLoader threading, stall-guard and fallback tests including the held-out slow-wait case** - `37eca131` (test)

## Files Created/Modified

- `packages/loaders/src/loaders/sync-loader.ts` - `SyncAuthRelay`/`SyncAuthContext`/`SyncAuthHandler` types, `RELAY_AUTH_ERROR_NAMES` constant, the three new option fields, the per-relay `relayOnAuthRequired` wrapper and auth-aware `withTimeout`, the fallback error-identity gate
- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` - 8 new tests (threading x3, D-16 stall guard x2, fallback suppression x2, pool-backed threading extension) plus a reusable `authContext()` fixture helper and a `throwError(error?)` parameter to construct pinned-name auth errors
- `packages/loaders/src/loaders/__tests__/exports.test.ts` - inline snapshot updated for `RELAY_AUTH_ERROR_NAMES`, the one new exported symbol (deviation, see below)

## Decisions Made

- Kept `onAuthRequired`'s wrapper conditional on the caller supplying a handler (`relayOnAuthRequired = onAuthRequired ? wrapper : undefined`) rather than always constructing SyncLoader's own no-op wrapper. An unconditional wrapper would change `methodOptions`' shape (a real `Function` value instead of `undefined`) for every call that doesn't request auth handling, breaking 4+ pre-existing tests that assert an exact options object without an `onAuthRequired` field, and would have failed Task 2's own verification step (which runs against the test file as it existed before Task 3 extended it). The conditional design still satisfies every test the plan's own text lists, since the held-out and handler-execution tests both require a handler to exist in the first place to invoke.
- `RELAY_AUTH_ERROR_NAMES` is `export`ed rather than module-private, purely so `tsc`'s `noUnusedLocals` does not fail Task 1's own build acceptance criterion (the constant is declared in Task 1 but only consumed in Task 2, and each task must build cleanly on its own per the task-level acceptance criteria). This is a legitimate, harmless new export (a frozen set of three strings) but it did require updating `exports.test.ts`'s inline snapshot to keep that suite green.
- `withTimeout`'s suspension pauses and resumes the *remaining* countdown (not a full reset) across an auth phase, mirroring D-15's pause/resume model on the relay side (an auth wait doesn't grant the operation extra time, it just stops the clock) — but a genuine stream emission still resets the budget to a fresh `timeoutMs`, preserving the pre-existing `first === each` stall-guard behavior for ordinary progress.
- Per-relay suspension state (`authPhases` counter, `pendingAuthCloses` set, `authPhaseChange$`) is closure-scoped inside `buildRelayStream(url)`, which the existing code already re-invokes fresh per url per subscription — this satisfies the plan's "constructed per relay, not once for the whole loader" requirement without introducing a separate `Map<url, gate>` registry.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `RELAY_AUTH_ERROR_NAMES` to satisfy Task 1's own build acceptance criterion**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 text declares the auth error name constant purely for Task 2's later consumption, but Task 1's acceptance criteria independently requires `pnpm --filter applesauce-loaders build` to exit 0. With `noUnusedLocals: true` in `packages/loaders/tsconfig.json`, an unreferenced module-private `const` fails the build before Task 2 lands.
- **Fix:** Declared the constant with `export` instead of leaving it module-private. It is genuinely consumed by Task 2 in the same file; exporting it is a harmless, minimal widening of the public surface.
- **Files modified:** `packages/loaders/src/loaders/sync-loader.ts`
- **Verification:** `pnpm --filter applesauce-loaders build` exits 0 after Task 1 alone
- **Committed in:** `3bbfb177` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed `exports.test.ts`'s stale inline snapshot from the new export**
- **Found during:** Task 2 (running `pnpm --filter applesauce-loaders test`, the full package suite, as part of verification)
- **Issue:** `src/loaders/__tests__/exports.test.ts` asserts an inline snapshot of every named export from `loaders/index.ts`. Exporting `RELAY_AUTH_ERROR_NAMES` (deviation 1 above) made the pre-existing snapshot stale, mirroring the exact precedent from 13-01's `AuthHandlerError`/`AuthTimeoutError` exports.
- **Fix:** Added `"RELAY_AUTH_ERROR_NAMES"` to the sorted snapshot array in its correct alphabetical position.
- **Files modified:** `packages/loaders/src/loaders/__tests__/exports.test.ts`
- **Verification:** `pnpm --filter applesauce-loaders test` — all 110 tests pass (post-Task-2, before Task 3's additions)
- **Committed in:** `6551c33c` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking build issue, 1 stale test snapshot caused by the same root cause)
**Impact on plan:** Both fixes are necessary, minimal, and directly traceable to the plan's own Task 1/Task 2 split landing as separate commits under a strict `noUnusedLocals` build. No scope creep — no behavior changed beyond what Tasks 1-3 specify.

## Issues Encountered

- **Acceptance criterion `grep -c 'applesauce-relay' packages/loaders/src/loaders/sync-loader.ts` returns 0 is unsatisfiable as literally written.** The pre-existing baseline file (before this plan touched it) already contains 3 occurrences of the substring `applesauce-relay` in doc comments (`SyncAuthRequirement`'s "Structurally matches applesauce-relay's `AuthRequirement`", and `SyncLoaderRelay`/`SyncLoaderPool`'s "structurally satisfied by applesauce-relay's ..."). The plan's own Task 1 action text explicitly instructs writing MORE such comments for the new types ("carrying the same 'structurally matches applesauce-relay's ...' doc-comment convention"), which necessarily adds more occurrences, not fewer. I treated this as a plan-authoring imprecision — the actual D-06 invariant this check is meant to enforce is "no source-level dependency" (no `import` statement, no `package.json` dependency entry), which I verified directly: zero `import` lines referencing `applesauce-relay`, and `grep -c 'applesauce-relay' packages/loaders/package.json` returns 0. I did not delete the existing (or new) documentation comments just to force a literal substring match to 0, since the plan's own text requires writing them. The plan-level `<verification>` section repeats the identical unsatisfiable check for the same reason.
- The full `pnpm --filter applesauce-concord build` fails in this worktree with 62 pre-existing module-resolution errors (`applesauce-common`/`applesauce-relay` subpath exports unresolved because those packages' `dist/` hasn't been built in this fresh worktree checkout). Confirmed none of these errors reference `sync-loader.ts`, `SyncMethodOptions`, or any symbol this plan touches — this is the same pre-existing monorepo build-order artifact 13-01's summary already documented, not a regression introduced here. Not fixed, out of this plan's scope (`packages/loaders/` only).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `SyncLoader`'s auth surface (`onAuthRequired`/`authTimeout`/`authRetries`, `SyncAuthContext`/`SyncAuthHandler`) is stable and ready for Phase 15's Concord engines to consume through a `RelayPool`-backed loader.
- The stall-guard suspension and fallback-gate mechanisms are self-contained to `sync-loader.ts` and require no further wiring from other Phase 13 plans — this plan's file scope (`packages/loaders/`) does not overlap with 13-02's `packages/relay/` work happening in parallel.
- No blockers. `RELAY_AUTH_ERROR_NAMES`'s three strings (`AuthRequiredError`, `AuthHandlerError`, `AuthTimeoutError`) must stay in sync with `packages/relay/src/relay.ts`'s pinned `.name` values — both sides now carry a cross-referencing comment recording the coupling.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/loaders/src/loaders/sync-loader.ts
- FOUND: packages/loaders/src/loaders/__tests__/sync-loader.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-03-SUMMARY.md
- FOUND: 3bbfb177 (Task 1)
- FOUND: 6551c33c (Task 2)
- FOUND: 37eca131 (Task 3)
- FOUND: 054f641a (SUMMARY commit)
