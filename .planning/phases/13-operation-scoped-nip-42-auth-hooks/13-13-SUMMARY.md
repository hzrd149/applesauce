---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 13
subsystem: loaders
tags: [rxjs, applesauce-loaders, nip-42, auth, sync-loader, gap-closure]

# Dependency graph
requires:
  - phase: 13-03
    provides: "SyncLoader's per-relay auth-phase suspension (authPhases counter, pendingAuthCloses set, forceCloseAuthPhases) and the conditionally-installed relayOnAuthRequired wrapper this plan makes unconditional"
  - phase: 13-08
    provides: "AuthHandlerError's guaranteed .name on a synchronous-throw handler failure, which this plan's own synchronous-throw-to-close mapping mirrors on the loader side"
provides:
  - "sync-loader's stall-guard suspension is opened by the auth phase itself on every path, including a caller that supplies no onAuthRequired (WR-03 closed structurally: relayOnAuthRequired is non-optionally typed and relayMethodOptions is built unconditionally)"
  - "sync-loader's per-phase close-timer handle is retained, cleared on close(), refused for an already-closed phase, and force-cleared by a new finalize() hook on buildRelayStream's terminal pipeline so no timer outlives the relay stream that armed it (WR-04 closed on all three exit paths)"
  - "a synchronously throwing onAuthRequired handler now closes its own auth phase before re-raising the original error unchanged"
affects: [15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unconditional wrapper construction as the structural fix for a bypassable guarantee — the handler-less path is made unrepresentable rather than special-cased, mirroring the 'prefer structural over enumerated fixes' pattern used elsewhere in this milestone"
    - "finalize() on a terminal RxJS pipeline as the one hook that covers complete/error/unsubscribe alike, used specifically because withTimeout returns its source unwrapped (no teardown of its own) whenever the stall guard is disabled"

key-files:
  created: []
  modified:
    - packages/loaders/src/loaders/sync-loader.ts
    - packages/loaders/src/loaders/__tests__/sync-loader.test.ts

key-decisions:
  - "relayOnAuthRequired declared with the non-optional SyncAuthHandler type and constructed unconditionally (no ternary), so relayMethodOptions is always a single unconditional object literal carrying the wrapper — the type system now forbids the state where auth-phase accounting is absent, per the plan's explicit 'do not fix this with an if (handler) special case' instruction"
  - "The phase's setTimeout handle is retained in a per-invocation closure variable and cleared inside close() (the existing single idempotent exit point), rather than tracked in a separate map or Set — matches the existing per-phase-closure shape with minimal structural change"
  - "scheduleClose() checks the phase's own closed flag and no-ops if already true, closing WR-04 leak path 1 (a handler settling after its phase was force-closed) without needing any new state beyond the flag that already existed"
  - "The synchronous-throw path (WR-04 leak path 2) is handled with a try/catch around the delegation call inside relayOnAuthRequired itself, calling close() then re-throwing the original error unchanged — this keeps the fix local to the wrapper rather than requiring changes to the relay layer's own error mapping"
  - "finalize(forceCloseAuthPhases) is placed on buildRelayStream's terminal pipe (after the existing per-relay catchError), not inside withTimeout, because withTimeout returns its source completely unwrapped whenever timeoutMs <= 0 — a hook placed inside it would silently disappear for callers with the stall guard disabled (WR-04 leak path 3)"
  - "Task 3's WR-04 tests use fake timers with vi.advanceTimersByTimeAsync (required for asapScheduler's microtask-based startup) and restore real timers unconditionally via try/finally; Test 4's mock defers its emission via a microtask (Promise.resolve().then(...)) rather than emitting synchronously, to avoid mapEventsToStore's documented share()/mergeWith double-subscription gotcha (the same one this file's pre-existing asyncOf() helper exists to avoid) — a synchronous emission was found during authoring to double-invoke the wrapper and was fixed before the test was finalized"

requirements-completed: [RAUTH-08]

coverage:
  - id: D1
    description: "relayOnAuthRequired is declared with a non-optional SyncAuthHandler type and relayMethodOptions is built as a single unconditional object literal, so the stall-guard suspension is opened by the auth phase itself on every path including a caller that supplies no onAuthRequired (WR-03)"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-13: handler-less auth-phase suspension and auth-phase timer lifetime (WR-03/WR-04) > suspends the stall guard for a handler-less caller when the relay requires auth (WR-03)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-13: handler-less auth-phase suspension and auth-phase timer lifetime (WR-03/WR-04) > still errors a handler-less caller once authTimeout elapses with no relay response (WR-03 control)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > createSyncLoader > uses negentropy sync when the relay supports NIP-77 (repaired, asserts onAuthRequired is a function despite no caller handler)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > createSyncLoader > maps a relay pool to the internal methods (repaired, asserts onAuthRequired is a function despite no caller handler)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The auth phase's own close-timer handle is retained and cleared on close(), scheduleClose() no-ops for an already-closed phase, a synchronously throwing handler closes its phase before re-raising, and a new finalize() hook force-closes every remaining phase when the relay stream ends by any means — no auth-phase timer outlives the phase or the loader run (WR-04)"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-13: handler-less auth-phase suspension and auth-phase timer lifetime (WR-03/WR-04) > clears the auth-phase timer when the run is torn down before the phase closes (WR-04)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-13: handler-less auth-phase suspension and auth-phase timer lifetime (WR-03/WR-04) > does not arm a fresh timer when a handler settles after its phase was already force-closed (WR-04)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 13: SyncLoader Handler-less Auth Suspension and Auth-Phase Timer Lifetime Summary

**Made `SyncLoader`'s stall-guard suspension a property of the auth phase itself (not of whether the caller passed `onAuthRequired`) by installing the wrapper unconditionally with a non-optional type, and closed all three ways an auth-phase `setTimeout` could outlive its phase — a stale reschedule, a synchronous throw, and the relay stream simply ending.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-06T21:17:33Z (first task commit)
- **Completed:** 2026-08-06T21:26:24Z
- **Tasks:** 3
- **Files modified:** 2 (0 new, 2 modified)

## Accomplishments

- `relayOnAuthRequired` is now declared with the non-optional `SyncAuthHandler` type and constructed unconditionally — no `if (handler)` ternary — so a handler-less caller's stall clock can no longer race a relay's own `authTimeout` wait; `relayMethodOptions` is likewise built as a single unconditional object literal that always carries the wrapper
- The wrapper's `auth-retry.ts:274/278`-confirmed equivalence (`config.onAuthRequired?.(context)` optionally invoked, `result instanceof Promise ? from(result) : of(undefined)`) means delegating to an absent caller handler produces the identical `of(undefined)` the relay layer already treats as "no handler" — so installing the wrapper unconditionally changes nothing about relay-side semantics
- The auth phase's `setTimeout` handle is retained and cleared in `close()`; `scheduleClose()` refuses to arm a fresh timer for an already-closed phase; a synchronously throwing handler closes its own phase before re-raising the original error untouched; and a new `finalize(forceCloseAuthPhases)` step on `buildRelayStream`'s terminal pipeline force-closes every remaining phase on complete, error, or unsubscribe — placed outside `withTimeout` since that function returns its source completely unwrapped whenever the stall guard is disabled
- 4 pre-existing exact-object test assertions (negentropy sync x2, paginated request, pool-mapped sync) rewritten to field-level assertions, each additionally pinning that the wrapper is installed even with no caller handler
- 4 new tests: the handler-less suspension defect itself, its bounded-suspension control, a post-teardown pending-timer test, and a settles-after-close pending-timer test — all confirmed RED against the pre-fix code before landing (see Non-Vacuity Verification below)

## Task Commits

Each task was committed atomically:

1. **Task 1: Make the per-relay auth-phase wrapper unconditional (WR-03)** - `fe8965f4` (feat)
2. **Task 2: Give the auth phase a timer that cannot outlive it (WR-04)** - `b092a5a5` (fix)
3. **Task 3: Four tests, each failing against today's code** - `c0aeff04` (test)

## Files Created/Modified

- `packages/loaders/src/loaders/sync-loader.ts` - `relayOnAuthRequired` non-optionally typed and unconditionally constructed; `relayMethodOptions` unconditional object literal; the phase's timer handle retained/cleared in `close()`; `scheduleClose()` no-ops for a closed phase; synchronous-throw try/catch around the delegation; new `finalize` import and its use on `buildRelayStream`'s terminal pipeline
- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` - 4 repaired exact-object assertions (now field-level with a wrapper-presence assertion each), and a new `describe` block with 4 tests (WR-03 defect, WR-03 control, WR-04 teardown leak, WR-04 settles-after-close leak)

## Decisions Made

- Kept the phase's closure-scoped design (per-invocation `let handle`, `let closed`) rather than introducing a separate `Map`/registry for timer handles — the existing `close()`/`pendingAuthCloses` shape already gave each phase its own closure, so retaining one more variable in that closure was the minimal structural change
- Placed the synchronous-throw try/catch inside `relayOnAuthRequired` itself (loader-local), not by relying on the relay layer's own CR-04 fix (13-08) — the loader's wrapper can itself throw synchronously in ways the relay layer never sees, since the wrapper's own bookkeeping runs before delegating to the caller's handler
- Chose `finalize()` over adding teardown logic inside `withTimeout`, per the plan's explicit reasoning: `withTimeout` returns its source completely unwrapped when `timeoutMs <= 0`, so any hook placed inside it would silently vanish for callers with the stall guard disabled (a case exercised directly by two of Task 3's own new tests, both of which pass `timeout: false`)
- Test 4's mock defers its emission via `Promise.resolve().then(...)` instead of emitting synchronously — a synchronous emission was found during authoring to double-invoke the wrapper (`onAuthRequired` called twice) via `mapEventsToStore`'s internal `share()`/`mergeWith` combination re-subscribing a fully-synchronous source. This is the exact gotcha already documented at the top of this test file by the pre-existing `asyncOf()` helper; Test 4 needed the same treatment since, unlike the other new tests, it deliberately emits an event

## Deviations from Plan

None — plan executed exactly as written. The synchronous-emission/double-subscription issue in Test 4 was caught and fixed during authoring itself (before any test was run against the fixed code), not discovered as a later deviation from a landed test.

## Issues Encountered

None beyond the Test 4 authoring issue documented above, which was resolved before any commit.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria, all four new tests were confirmed RED by temporarily restoring the pre-fix source (via `git show <parent-commit>:<file>`), running the new tests, and then restoring the fixed file (`git diff` empty afterward — confirmed via `git diff --stat` showing no changes).

- **Test 1** ("suspends the stall guard for a handler-less caller ... (WR-03)"), reverted to before Task 1: `AssertionError: expected [] to deeply equal [ {content: "a", ...} ]` — the handler-less call was a genuine no-op, the loader's 20ms stall clock ran through the mock's 40ms wait, timed out with a generic (non-auth-named) error, fell back to a `request()` mock configured to fail loudly, and the relay's final state read `"error"` with zero events delivered instead of `"complete"` with `[a]`.
- **Test 2** (WR-03 control), reverted to before Task 1: passed unchanged — confirming the control is genuinely independent of the fix and does not itself carry a RED observation, per the plan's instruction.
- **Test 3** ("clears the auth-phase timer when the run is torn down ... (WR-04)"), reverted to before Task 2 only (Task 1 kept applied, isolating the WR-04-specific defect): `AssertionError: expected 1 to be +0` — after unsubscribing, one auth-phase timer remained pending (`vi.getTimerCount()` read `baseline + 1`) because no `finalize` hook existed yet to force-close the still-open phase on teardown.
- **Test 4** ("does not arm a fresh timer when a handler settles after its phase was already force-closed ... (WR-04)"), reverted to before Task 2 only: `AssertionError: expected 1 to be +0` — `scheduleClose()` armed a fresh `authTimeout`-long timer against a phase that had already been force-closed by the stream's own emission, and nothing would ever have cleared it, since the pre-fix `scheduleClose()` had no closed-phase guard.

(Reverting all the way to before Task 1 — the wrapper-conditional state — also fails Tests 3/4, but for the coarser reason that the handler-less wrapper never runs at all in that state, so no timer is ever armed to begin with; the Task-1-applied/Task-2-reverted isolation above is the more precise WR-04-only RED signal and is what's recorded here.)

## Verification Results

- `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` — 36/36 pass (32 pre-existing + 4 new)
- `pnpm --filter applesauce-loaders test` — 122/122 pass
- `pnpm --filter applesauce-loaders build` — exits 0
- `pnpm exec turbo build --filter='./packages/*'` — 14/14 packages build clean
- `pnpm vitest run` (full workspace) — 274/275 test files pass (1 pre-existing skip), 2574/2576 tests pass (2 pre-existing skips)
- `grep -c 'const relayOnAuthRequired: SyncAuthHandler =' packages/loaders/src/loaders/sync-loader.ts` → 1
- `grep -c 'const relayMethodOptions: SyncMethodOptions = {' packages/loaders/src/loaders/sync-loader.ts` → 1
- `grep -c 'clearTimeout' packages/loaders/src/loaders/sync-loader.ts` → 2
- `grep -c 'finalize' packages/loaders/src/loaders/sync-loader.ts` → 3 (import, invariant comment mentioning it, and the pipeline usage)
- `git diff packages/loaders/package.json` — empty, no dependency added

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-03 and WR-04 are closed structurally in `sync-loader.ts` — the handler-less bypass is unrepresentable (non-optional type, unconditional construction) rather than merely handled, and no auth-phase timer can outlive its phase or the relay stream that armed it.
- No blockers. This plan's file scope (`packages/loaders/src/loaders/sync-loader.ts` and its test file) does not overlap with any other open gap-closure plan in this round.
- Phase 15's Concord engines, the eventual consumer of `SyncLoader`'s auth surface (per 13-03's readiness note), now inherit a suspension guarantee that holds even for a handler-less caller and a timer lifecycle with no leak paths.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/loaders/src/loaders/sync-loader.ts
- FOUND: packages/loaders/src/loaders/__tests__/sync-loader.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-13-SUMMARY.md
- FOUND: fe8965f4 (Task 1)
- FOUND: b092a5a5 (Task 2)
- FOUND: c0aeff04 (Task 3)
