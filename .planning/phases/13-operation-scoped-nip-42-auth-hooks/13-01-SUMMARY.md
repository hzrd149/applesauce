---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 01
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth]

# Dependency graph
requires: []
provides:
  - "RelayAuthOptions D-05 mixin (waitForAuth/onAuthRequired/authTimeout/authRetries) intersected into RelayReqOptions, PublishOptions, NegentropySyncOptions, RelayCountOptions, RelayEventOptions, RelaySyncOptions"
  - "RelayAuthContext/RelayAuthHandler/RelayAuthOperation types (RAUTH-01 contract)"
  - "PublishResponse.error optional field (D-18)"
  - "AuthHandlerError/AuthTimeoutError error classes extending RelayClosedError, pinned .name values (D-17)"
  - "Relay.missingPubkeysFor/buildAuthContext/authRetryOperator protected helper methods"
  - "operators/auth-retry.ts: authRetry (D-04 shared operator), AuthPhaseGate, suspendableTimeout (D-15), AUTH_PHASE_GATE symbol"
affects: [13-02, 13-03, 13-04, 13-05, 13-06, 13-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RxJS expand() + concat() for value-driven retry off the error channel, replacing retry({delay}) throw-driven auth handling"
    - "Counter-based AuthPhaseGate (not boolean) for operation-clock suspension, consumed by suspendableTimeout"
    - "D-05 mixin-intersection: one option type (RelayAuthOptions) declared once, intersected into every operation's option type"

key-files:
  created:
    - packages/relay/src/operators/auth-retry.ts
    - packages/relay/src/__tests__/auth-retry.test.ts
  modified:
    - packages/relay/src/types.ts
    - packages/relay/src/negentropy.ts
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/exports.test.ts

key-decisions:
  - "authRetry's expand() project function uses concat(runPhase(value), source), not switchMap — runPhase is an ignoreElements()-wrapped Observable<never> that only ever completes/errors, so switchMap's projector (which only fires on next emissions) would never subscribe to source. concat correctly waits for the phase to complete before resubscribing."
  - "AuthHandlerError sets this.cause = cause after super(reason) rather than passing it through super(reason, {cause}) — RelayClosedError's constructor signature only accepts (reason: string), so cause can't be forwarded through the super chain; ES2022 target makes direct assignment to .cause valid."
  - "Relay.authRetryOperator/missingPubkeysFor/buildAuthContext exist but are deliberately not wired into req/count/event/negentropy yet — this plan is pure foundation; wiring is 13-02 (types)/13-04/13-05/13-06's scope per the plan's own text."

requirements-completed: []

coverage:
  - id: D1
    description: "RelayAuthOptions D-05 mixin and auth context types declared once in types.ts; waitForAuth removed from RelayReqOptions/PublishOptions/NegentropySyncOptions in favor of the intersection; PublishResponse gains optional error field"
    verification:
      - kind: other
        ref: "pnpm --filter applesauce-relay build (structural grep acceptance criteria: RelayAuthOptions declared once, waitForAuth declared once, RelayCountOptions/RelayEventOptions/RelaySyncOptions exported)"
        status: pass
    human_judgment: false
  - id: D2
    description: "AuthHandlerError/AuthTimeoutError error classes (extend RelayClosedError, pinned .name, cross-package coupling comment) and Relay's missingPubkeysFor/buildAuthContext/authRetryOperator protected helpers"
    verification:
      - kind: other
        ref: "pnpm --filter applesauce-relay build (structural grep acceptance criteria: class declarations, .name pins, CLOSED_ERROR_PREFIXES exclusion, sync-loader.ts coupling comment)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Shared operators/auth-retry.ts operator (authRetry, AuthPhaseGate, suspendableTimeout) — internal-only, no import from relay.ts, proves the retry bound, single per-phase clock, waitForAuth:false short-circuit, and gate suspension"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts (13 tests, real timers, no fake timers)"
        status: pass
    human_judgment: false

duration: 19min
completed: 2026-08-05
status: complete
---

# Phase 13 Plan 01: Auth Options Mixin, Error Classes, and Shared Auth-Retry Operator Summary

**D-04's shared `authRetry` RxJS operator (expand/concat-based, value-driven, real-timer-tested) plus the D-05 `RelayAuthOptions` mixin and `AuthHandlerError`/`AuthTimeoutError` error classes — the foundation every other Phase 13 plan wires into `req`/`count`/`event`/`negentropy`.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-08-05T17:44:42Z (worktree base commit)
- **Completed:** 2026-08-05T18:03:43+01:00
- **Tasks:** 3
- **Files modified:** 6 (2 new, 4 modified)

## Accomplishments

- `RelayAuthOptions` mixin (`waitForAuth`/`onAuthRequired`/`authTimeout`/`authRetries`) declared exactly once in `types.ts` and intersected into `RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, plus three new named types (`RelayCountOptions`, `RelayEventOptions`, `RelaySyncOptions`) that replace the anonymous `{ waitForAuth?: AuthRequirement }` literals
- `RelayAuthContext`/`RelayAuthHandler`/`RelayAuthOperation` types satisfy RAUTH-01's seven-field context contract; `PublishResponse` gains an optional `error` field (D-18)
- `AuthHandlerError`/`AuthTimeoutError` extend `RelayClosedError`, pin their `.name`, and carry a comment documenting the cross-package coupling with `packages/loaders/src/loaders/sync-loader.ts`'s duck-typed check (D-06/D-17, resolves Open Question 3)
- `Relay.missingPubkeysFor`/`buildAuthContext`/`authRetryOperator` protected helpers exist as a thin adapter over the new operator, not yet wired into any call site
- `operators/auth-retry.ts`: `authRetry` (the D-04 shared operator), `AuthPhaseGate` (counter-based in-flight-phase tracker), `suspendableTimeout` (D-15 clock suspension), `AUTH_PHASE_GATE`/`WithAuthPhaseGate` (module-private gate-threading symbol) — internal-only, not barrel-exported, no import from `relay.js` (resolves Open Question 1)
- 13 unit tests directly exercising the operator: signal never reaches the subscriber, handler invoked once per phase (including when already satisfied), source resubscribed exactly `authRetries + 1` times against a persistently-signalling source, counter resets after a real value, `waitForAuth: false` short-circuits without invoking the handler, handler rejection carries `cause`, short `authTimeout` times out, `authTimeout: false` stays unbounded, and `suspendableTimeout` suspends/resumes around the gate

## Task Commits

Each task was committed atomically:

1. **Task 1: Declare the RelayAuthOptions mixin, auth context types, and PublishResponse.error** - `e03939d4` (feat)
2. **Task 2: Add AuthHandlerError / AuthTimeoutError and the Relay auth helper methods** - `7c91a95f` (feat)
3. **Task 3: Create the shared auth-retry operator with AuthPhaseGate and suspendableTimeout** - `358bc653` (test)

_Note: `operators/auth-retry.ts` was authored as part of Task 2's work session (Task 2's `authRetryOperator` imports it), but staged and committed only under Task 3, matching the plan's declared file ownership. Task 2's commit builds cleanly against the already-present-but-uncommitted file, since `tsc`/vitest read the working tree, not the git index._

## Files Created/Modified

- `packages/relay/src/types.ts` - `RelayAuthOperation`/`RelayAuthContext`/`RelayAuthHandler`/`RelayAuthOptions`/`RelayCountOptions`/`RelayEventOptions`/`RelaySyncOptions`; `PublishResponse.error`; `waitForAuth` centralized
- `packages/relay/src/negentropy.ts` - `NegentropySyncOptions` now intersects `RelayAuthOptions`
- `packages/relay/src/relay.ts` - `AuthHandlerError`/`AuthTimeoutError` classes; `missingPubkeysFor`/`buildAuthContext`/`authRetryOperator` protected methods
- `packages/relay/src/operators/auth-retry.ts` - the shared D-04 operator, `AuthPhaseGate`, `suspendableTimeout`
- `packages/relay/src/__tests__/auth-retry.test.ts` - 13 unit tests, real timers only
- `packages/relay/src/__tests__/exports.test.ts` - inline snapshot updated for the two new exported error classes (deviation, see below)

## Decisions Made

- `authRetry`'s `expand()` recursion uses `concat(runPhase(value), source)` rather than `switchMap` — `runPhase` returns an `ignoreElements()`-wrapped `Observable<never>` (only completes/errors, never emits `next`), so `switchMap`'s projector would never fire and `source` would never be resubscribed. `concat` correctly resubscribes `source` only once the phase observable completes.
- `AuthHandlerError` sets `this.cause = cause` after calling `super(reason)` rather than routing it through `super(reason, { cause })`, since `RelayClosedError`'s constructor signature is `(reason: string)` only. ES2022 target makes the direct `.cause` assignment valid and type-correct.
- `Relay.authRetryOperator` is a genuine adapter (resolves defaults, builds context, injects the three error constructors) but is intentionally not called from `req`/`count`/`event`/`negentropy`/`sync` yet — that wiring is explicitly out of this plan's scope per its own text (lands in 13-02/13-04/13-05/13-06).
- No requirements marked complete in `REQUIREMENTS.md`. RAUTH-01/03/04/06/07 all describe end-to-end behavior ("a consumer can pass `onAuthRequired` to a request-like operation and have it invoked... when that operation receives auth-required") that only becomes true once a later plan wires `authRetryOperator` into an actual call site. This plan delivers the foundation only, matching this repo's established precedent (see STATE.md's INVITE-01/WIRE-06..12/WIRE-08/WIRE-09 entries) of leaving a requirement `Pending` until the plan that completes the wire-level behavior lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `exports.test.ts`'s inline snapshot broken by Task 2's new exports**
- **Found during:** Task 3 (running the full `applesauce-relay` package test suite as part of the plan's overall verification)
- **Issue:** `src/__tests__/exports.test.ts` asserts an inline snapshot of every named export from `index.ts`. Task 2's new `AuthHandlerError`/`AuthTimeoutError` classes (exported via `relay.ts` -> `index.ts`'s `export *`) are legitimate, intentional new exports, but they made the pre-existing snapshot stale.
- **Fix:** Added `"AuthHandlerError"` and `"AuthTimeoutError"` to the sorted snapshot array, in their correct alphabetical position.
- **Files modified:** `packages/relay/src/__tests__/exports.test.ts`
- **Verification:** `pnpm --filter applesauce-relay test` — all 163 tests pass
- **Committed in:** `358bc653` (part of Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale test snapshot)
**Impact on plan:** Necessary correctness fix with zero scope creep; the snapshot's content is exactly what Task 2 intentionally added.

## Issues Encountered

- `pnpm --filter applesauce-relay build` initially failed with `Cannot find module 'applesauce-core/helpers/event'` etc. — `applesauce-core` (a workspace dependency) had never been built in this worktree, so its subpath `exports` map had no `dist/` targets to resolve. Built `applesauce-core` (and later `applesauce-signers`, needed transitively by `relay.test.ts`'s `FakeUser` fixture) before proceeding; pre-existing monorepo build-order requirement, not a defect introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `RelayAuthOptions`/`RelayAuthContext`/`RelayAuthHandler`/`RelayAuthOperation` and the two new error classes are stable, exported, and ready for the four auth-site conversions.
- `authRetryOperator`/`missingPubkeysFor`/`buildAuthContext` exist on `Relay` and are ready to be called from `req`/`count`/`event`/`negentropy`; `AuthPhaseGate`/`AUTH_PHASE_GATE`/`suspendableTimeout` are ready to replace the three bare operation-level `rxjs timeout()` sites.
- No blockers. `packages/relay/src/operators/index.ts` is unchanged, confirming `auth-retry.ts` stayed internal-only as designed.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-05*
