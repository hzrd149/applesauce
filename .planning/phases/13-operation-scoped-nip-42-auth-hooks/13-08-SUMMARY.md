---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 08
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, gap-closure]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 06)
    provides: "req()/count()/event()/negentropy()/sync() all wired through Relay.authRetryOperator and suspendableTimeout"
provides:
  - "ProgressPredicate<T> exported type — required (never defaulted) at every authRetry/suspendableTimeout call site"
  - "AuthRetryConfig<T> generic with required isProgress field gating the D-08 consecutive-counter reset"
  - "suspendableTimeout's third parameter is a required { firstWhen, with? } object, not an optional literal"
  - "isReqProgress — the single REQ progress predicate (excludes the synthetic OPEN bookkeeping message), exported from relay.ts for group.ts (plan 13-11) to reuse"
  - "runPhase's onAuthRequired invocation wrapped in try/catch so a synchronous throw maps to AuthHandlerError identically to a rejected promise (CR-04)"
  - "Three operator-level regression tests (CR-01, CR-04, WR-01) in auth-retry.test.ts, each independently confirmed RED against the pre-fix operator"
affects: [13-09, 13-10, 13-11, 13-12, 13-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Required (never optional-with-default) typed predicate parameter as a structural fix — makes 'what counts as progress' a compile-time obligation at every consumer rather than an enumerable per-site convention"

key-files:
  created: []
  modified:
    - packages/relay/src/operators/auth-retry.ts
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/auth-retry.test.ts

key-decisions:
  - "isReqProgress lives in relay.ts (not auth-retry.ts) since it must not create a value-level dependency from the internal-only operator module back to relay.ts's RelayReqMessage type — matches the plan's explicit 'exported so group.ts can import it' instruction and auth-retry.ts's existing no-import-from-relay.js constraint"
  - "count()/event()/sync() pass an inline `() => true` progress predicate at their call site (with a one-line comment) rather than a shared named constant, since each response type (RelayCountResponse/PublishResponse/boolean) genuinely carries no bookkeeping value and the reasoning differs slightly per site"
  - "CR-04's try/catch types `result` as `void | Promise<void>` (RelayAuthHandler's actual return type) rather than a broader unknown/ReturnType construction, keeping the fix minimal and type-exact"

requirements-completed: []

coverage:
  - id: D1
    description: "authRetry's D-08 consecutive-counter reset and suspendableTimeout's first-emission gate both require an explicit, typed ProgressPredicate<T> at every call site; omitting one is a compile error"
    requirement: "RAUTH-03"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts#does not let a non-progress bookkeeping value reset the consecutive counter (CR-01)"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts#still fires after the budget when firstWhen rejects the first emission (WR-01)"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build (compile-fail probe: removing firstWhen from request()'s suspendableTimeout call site fails tsc)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A synchronously-throwing onAuthRequired handler is mapped to AuthHandlerError, identically to a promise rejection, so applesauce-loaders' RELAY_AUTH_ERROR_NAMES duck-typing cannot under-match"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts#maps a synchronously-throwing handler to the handler error, carrying the thrown value as cause (CR-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An operation clock built on suspendableTimeout is not cancelled by a call-site bookkeeping emission (req()'s synthetic OPEN)"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts#still fires after the budget when firstWhen rejects the first emission (WR-01)"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (152 tests, no regression)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 08: Required Progress Predicates and Synchronous-Throw Mapping Summary

**Made "what counts as progress" a required, typed parameter (`ProgressPredicate<T>`) at `authRetry`'s D-08 counter reset and `suspendableTimeout`'s first-emission gate, and mapped a synchronously-throwing `onAuthRequired` to `AuthHandlerError` — closing CR-01/WR-01 and CR-04 structurally rather than by special-casing `req()`'s `OPEN` message.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-06T13:41:00Z (approx, worktree base)
- **Completed:** 2026-08-06T14:46:16+01:00
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `ProgressPredicate<T>` exported from `auth-retry.ts`; `AuthRetryConfig<T>` is now generic with a **required** `isProgress` field, and the D-08 reset `tap` gates `consecutive = 0` on `config.isProgress(value)` instead of resetting unconditionally
- `suspendableTimeout<T>`'s third parameter changed from an optional `{ with? }` literal to a **required** `{ firstWhen: ProgressPredicate<T>; with?: () => Observable<T> }` object; a value `firstWhen` rejects is still forwarded to the subscriber but never starts/cancels the clock
- `Relay.authRetryOperator` and `Relay.customSuspendableTimeoutOperator` both gained a **required** trailing `isProgress`/`firstWhen` parameter — no default value, so a future call site cannot silently inherit permissive "any value is progress" behavior
- `isReqProgress` defined exactly once, at module scope in `relay.ts`, exported for `group.ts` (plan 13-11) to reuse; every REQ-shaped call site (`req()`, `request()`'s `suspendableTimeout`) passes it, and every response-shaped call site (`count()`, `event()`, `sync()`/`negentropy()`, `publish()`) passes an inline always-true predicate with a one-line reasoning comment
- `runPhase`'s `onAuthRequired` invocation wrapped in `try`/`catch`: a synchronous throw now constructs `config.errors.handler(signal.reason, cause)` immediately, converging with the existing rejected-promise path onto the same `AuthHandlerError`-shaped outcome, with `gate.begin()`/`finalize(gate.end())` still balanced on the throw path
- Three new operator-level tests added to `auth-retry.test.ts` (CR-01, CR-04, WR-01), each independently confirmed RED against a temporarily-reverted pre-fix operator before being restored to GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Make progress and first-emission explicit, required obligations at every call site** - `2132af2b` (feat)
2. **Task 2: Route a synchronously-thrown handler failure through the handler-error constructor** - `f8073b76` (fix)
3. **Task 3: Operator-level regression tests for the progress predicate, the first-emission predicate, and the synchronous throw** - `859e5c79` (test)

_Note: Tasks 1 and 2 both modify `auth-retry.ts`; Task 2's try/catch change was temporarily reverted, Task 1 committed alone, then Task 2's change reapplied and committed separately, keeping each task's diff isolated per the plan's declared file ownership._

## Files Created/Modified

- `packages/relay/src/operators/auth-retry.ts` - `ProgressPredicate<T>` type; generic `AuthRetryConfig<T>` with required `isProgress`; `suspendableTimeout`'s required `firstWhen`; CR-04 try/catch around `onAuthRequired`
- `packages/relay/src/relay.ts` - `isReqProgress` module-level predicate; `authRetryOperator`/`customSuspendableTimeoutOperator` required trailing parameter; explicit predicate wired at every `req`/`count`/`event`/`sync`/`request`/`publish` call site
- `packages/relay/src/__tests__/auth-retry.test.ts` - `baseConfig`'s default `isProgress: () => true`; `firstWhen: () => true` added to all pre-existing `suspendableTimeout` calls; three new tests (CR-01, CR-04, WR-01)

## Decisions Made

- `isReqProgress` placed in `relay.ts`, not `auth-retry.ts` — the internal-only operator module must not import from `relay.ts` (existing constraint, documented at the top of `auth-retry.ts`), and the plan explicitly wants it exported for `group.ts`'s future reuse in plan 13-11
- `count()`/`event()`/`sync()` each pass an inline `() => true` predicate at their call site rather than a shared named constant — each response type genuinely carries no bookkeeping value, and a one-line comment at each site documents why, matching the plan's literal instruction ("Write it inline as an arrow returning true, with a short comment saying why")
- The CR-04 fix types the captured handler result as `void | Promise<void>` (matching `RelayAuthHandler`'s real signature) rather than a broader `unknown`/`ReturnType<>` construction

## Deviations from Plan

None - plan executed exactly as written. Tasks 1 and 2 were interleaved during authoring (both touch `auth-retry.ts`) but split back into two isolated commits before finalizing, matching the plan's declared per-task file ownership; no deviation-rule fix was needed for this.

## Issues Encountered

None.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria, each new/modified test was observed RED against the pre-fix code, then GREEN after restoring the fix. `git diff` was empty for `auth-retry.ts` after each probe.

- **CR-01** ("does not let a non-progress bookkeeping value reset the consecutive counter"): reverted the D-08 tap to unconditional `consecutive = 0`. RED symptom: `AssertionError: expected 6 to be 2` — `subscribeCount` hit the fixture's explicit `SUBSCRIPTION_CAP` of 5 (6th subscription errored) instead of exhausting at 2, confirming the bound does not hold against an unconditional reset. The fixture's subscription cap turned what would otherwise be an infinite loop into a fast, deterministic failed assertion.
- **CR-04** ("maps a synchronously-throwing handler to the handler error..."): reverted `runPhase`'s try/catch, restoring the direct `config.onAuthRequired?.(context)` call. RED symptom: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` on `errors.handler` — the raw thrown `Error` escaped the `defer` factory instead of being mapped, so `spy.onError()` resolved with the unmapped exception and `errors.handler` was never invoked.
- **WR-01** ("still fires after the budget when firstWhen rejects the first emission"): reverted `suspendableTimeout`'s `next` handler to set `firstEmitted = true` unconditionally. RED symptom: `AssertionError: expected undefined to be an instance of Error` — the rejected bookkeeping value (`0`) incorrectly marked first emission and cancelled the clock, so the timeout never fired within the test's wait window.

## Verification Results

- `pnpm --filter applesauce-relay build` — exits 0
- Compile-fail probe: removing `firstWhen` from `request()`'s `suspendableTimeout` call caused `tsc` to fail with `TS2554: Expected 3 arguments, but got 2`, confirming the obligation is compiler-enforced; restored afterward, `git diff` empty
- `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` — 16/16 tests pass (13 pre-existing + 3 new)
- `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — 152/152 tests pass, no regression (RAUTH-01/02/04/05/06/09 hold)
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts packages/relay/src/__tests__/pool.test.ts` — 47/47 tests pass
- `grep -c 'ProgressPredicate' packages/relay/src/operators/auth-retry.ts` → 4 (type declaration + 3 consuming signatures)
- `grep -rn 'isReqProgress' packages/relay/src | grep -c 'function isReqProgress\|const isReqProgress'` → 1
- `grep -c 'errors.handler' packages/relay/src/operators/auth-retry.ts` → 2 (rejection path + synchronous-throw path)
- `grep -c 'isProgress' / 'firstWhen'` in `auth-retry.test.ts` → 4 / 8 (both > 0)
- No stream-shape change was made to `req()` or `count()`, and no scheduler hop was added to `authRetry`'s `expand`/`concat` resubscribe — confirmed by reviewing the full diff of `relay.ts` and `auth-retry.ts` against the pre-plan commit

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `isReqProgress` is exported and ready for `group.ts` to import in plan 13-11 rather than redeclaring its own copy
- `ProgressPredicate<T>` is available for any future call site that needs to state its own progress semantics
- CR-01, CR-04, and WR-01 are closed at the shared operator's source; no blockers for plans 13-09/13-10 (which address CR-02/CR-03 via the send/listen split, explicitly out of this plan's scope) or 13-12 (cross-package `AuthHandlerError`/`RELAY_AUTH_ERROR_NAMES` assertion)

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/operators/auth-retry.ts
- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/auth-retry.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-08-SUMMARY.md
- FOUND: 2132af2b (Task 1)
- FOUND: f8073b76 (Task 2)
- FOUND: 859e5c79 (Task 3)
