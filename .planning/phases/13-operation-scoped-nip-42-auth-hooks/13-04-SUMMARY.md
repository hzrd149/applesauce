---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 04
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, count]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks
    provides: "13-01's RelayAuthOptions mixin, error classes, and the shared operators/auth-retry.ts operator (authRetry/AuthPhaseGate/suspendableTimeout/AUTH_PHASE_GATE)"
provides:
  - "count() emits an internal AuthRequiredSignal value instead of throwing for auth-required, while every other CLOSED prefix still throws its typed error unchanged (D-01/D-02/D-03)"
  - "count()'s pre-block (waitForAuth against authRequiredForRead$) and catch-and-rethrow are both deleted — a COUNT is sent immediately regardless of any other operation's auth state (closes RAUTH-02 for count())"
  - "count() takes the named RelayCountOptions type instead of an anonymous { waitForAuth?: AuthRequirement } literal (D-05, 1 of 5 anonymous literals retyped)"
  - "count() owns a local AuthPhaseGate and suspends its own 10s clock across the auth phase via suspendableTimeout, so a COUNT can survive an auth round-trip that it could never survive before (D-15's motivating case)"
  - "wire-trace test suite (11 tests) covering RAUTH-01/02/03/04/06/09, D-02/D-03, D-15 on real timers, plus a real-setTimeout-spy technique for proving D-15's clock suspension without a literal >10s wait"
affects: [13-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "count() mirrors req()'s D-01/D-02/D-03 value-signal shape exactly (prefix check on the raw CLOSED reason string), but — unlike req()/request() — constructs and owns its AuthPhaseGate locally in one method, since count() has no separate outer/inner operation split"
    - "take(1) moved outside (downstream of) the shared authRetryOperator rather than upstream of it — the operator's expand()/concat() retry mechanism needs to observe every auth-required signal as a value on its own source stream; placing take(1) upstream would have completed the stream on the first signal instead of the first genuine COUNT response"
    - "proving an operation-level clock is suspended (D-15) without a literal wait past the clock's own budget: spy on the real global setTimeout (no fake timers) and assert it is re-armed with ~its full original budget after the auth phase closes, rather than the auth-wait duration having been silently deducted — this distinguishes a suspending implementation from a reverted bare rxjs timeout() (which arms exactly once, never re-arms) using only real timers and a short real auth-wait"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "count()'s take(1) was relocated from inside the message/auth pipeline to the outer pipe, positioned between the shared authRetryOperator and suspendableTimeout — authRetryOperator's internal expand()/concat() retry needs the raw signal-carrying stream (not one already truncated to a single emission) to drive resubscription; take(1) only needs to see the operator's already-filtered, signal-free output to correctly cap the result at the first genuine COUNT response"
  - "this.authRetryOperator(\"read\", opts, gate)'s return value is bound to an explicitly-typed local (authOperator: OperatorFunction<RelayCountResponse | AuthRequiredSignal, RelayCountResponse>) rather than passed as a generic-inferred call directly inside .pipe(...) — TypeScript's pipe-overload unification otherwise back-propagates a `never` inference from the suspendableTimeout(...)'s `with` callback (which returns Observable<never> via throwError) onto take(1)'s output type, a chain-order quirk unrelated to count()'s own logic; the explicit local also keeps the acceptance criterion's literal `this.authRetryOperator(\"read\"` grep pattern intact (an inline <RelayCountResponse> generic argument would have broken that literal match)"
  - "D-15's COUNT test proves clock suspension via a real (non-fake) setTimeout spy asserting two >9s arm calls bracketing the auth phase, rather than a literal wait past 10 real seconds — count()'s 10s budget has no user-configurable knob (unlike request()'s opts.timeout, which 13-02's own D-15 test shrank to prove suspension quickly), so shrinking the budget itself wasn't an option here; the spy technique still uses only genuine setTimeout calls (D-20's 'real ordering, not mocked advance' requirement) and is falsifiable — verified via the non-vacuity probe to fail RED against the reverted implementation, which arms exactly once for the operation's whole lifetime"
  - "RAUTH-02/03/04/07/09 are NOT marked complete in REQUIREMENTS.md — each spans all eight auth sites (req/request/subscription/count/publish/event/sync/negentropy); count() is only 1 of the remaining 5 sites this plan converts (req/request/subscription already landed in 13-02). Matches 13-02's own precedent of leaving these same requirement IDs Pending in its own commit despite listing them in its SUMMARY frontmatter's requirements-completed field"

requirements-completed: []

coverage:
  - id: D1
    description: "count()'s messages stream signals auth-required as a value (AuthRequiredSignal) instead of throwing; every other CLOSED prefix still throws its typed error unchanged; the pre-block and catch-and-rethrow are both deleted so a fresh COUNT is never blocked behind an unrelated operation's auth state"
    requirement: "RAUTH-02"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-02: a fresh COUNT is sent immediately while an earlier, unrelated REQ is auth-blocked"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#D-02/D-03: a non-auth CLOSED prefix still throws RelayClosedError immediately, without invoking the handler"
        status: pass
    human_judgment: false
  - id: D2
    description: "count()'s auth handling (handler invocation, per-phase timeout, retry counting, error mapping) is fully delegated to Relay.authRetryOperator; RelayCountOptions replaces the anonymous option literal (D-05); RelayGroup.count/RelayPool.count require no edit since they already derive their option type via Parameters<>"
    requirement: "RAUTH-01, RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-01: invokes onAuthRequired with the full operation-local context"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-03: retries exactly once by default and resends the COUNT after the handler authenticates"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-03: authRetries:2 allows three COUNT frames total"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-03: authRetries:0 exhausts immediately without invoking the handler or retrying"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a short authTimeout errors with AuthTimeoutError when the requirement is never satisfied"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a rejecting handler errors with AuthHandlerError carrying the rejection as cause"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-06: waitForAuth:false never invokes the handler and errors with AuthRequiredError"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-09: authRequiredForRead$ flips true when a COUNT receives auth-required"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build (structural: grep -c 'opts?: RelayCountOptions' returns 1, grep -c 'this.authRetryOperator(\"read\"' returns 2, no edit needed in group.ts/pool.ts since RelayGroup.count/RelayPool.count already derive via Parameters<Relay[\"count\"]>[2])"
        status: pass
    human_judgment: false
  - id: D3
    description: "count() constructs a local AuthPhaseGate and replaces the bare 10s rxjs timeout() with suspendableTimeout against that gate, so the 10s COUNT clock does not run while waiting for auth and the operation gets its full 10s budget for the actual work afterwards (D-15)"
    requirement: "RAUTH-04"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#D-15: count()'s 10s clock is suspended across the auth phase"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-relay build (structural: grep -c 'timeout({ first: 10_000' returns 0, grep -c 'suspendableTimeout' returns 3, grep -c 'this.waitForAuth(this.authRequiredForRead' returns 1 — only negentropy's sync() site remains)"
        status: pass
    human_judgment: false

duration: ~17min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 04: count() Operation-Scoped Auth with a Suspendable Clock Summary

**Converted `count()`'s auth-required handling from a throw-driven pre-block + catch-and-rethrow to the shared value-signal `authRetryOperator` from plan 13-01, replaced its anonymous option literal with the named `RelayCountOptions` type (D-05), and re-expressed its hard 10s COUNT clock as a suspendable one via `suspendableTimeout` — the phase's motivating case for D-15, since a 10s budget could never previously absorb a 30s default `authTimeout`.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-08-06T10:33:00Z (approx., after Wave 2 merge)
- **Completed:** 2026-08-06T10:49:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `count()`'s third parameter is now the named `RelayCountOptions` type instead of an anonymous `{ waitForAuth?: AuthRequirement }` literal (D-05); `RelayGroup.count`/`RelayPool.count` needed no edit since they already derive their option type via `Parameters<Relay["count"]>[2]`
- `count()`'s `messages` stream now signals auth-required as an internal `AuthRequiredSignal` value (via `authRequiredSignal()`), checked via a direct prefix match on the raw CLOSED reason (mirroring `req()`'s existing style); every other CLOSED prefix still throws its typed `RelayClosedError` unchanged (D-01/D-02/D-03)
- Deleted the `catchError` block that flipped `receivedAuthRequiredForReq` and re-threw — the flag write moved into the `messages` map step where the signal is produced, so `authRequiredForRead$` still updates (RAUTH-09) with no error-channel involvement left
- Deleted the pre-block (`this.waitForAuth(this.authRequiredForRead$, countObservable, waitForAuth)`) — `count()` now sends its COUNT frame immediately regardless of any other operation's auth state, closing RAUTH-02 for `count()`
- `count()` constructs a local `AuthPhaseGate` (unlike `req()`/`request()`'s threaded gate, `count()` owns both the auth operator and its own clock in one method) and replaced the bare `timeout({first: 10_000, ...})` with `suspendableTimeout(10_000, gate, {with: ...})`, preserving the existing 10s budget and COUNT-timeout error message while suspending the clock across the auth phase (D-15)
- 11 new wire-trace tests in a dedicated `describe("operation-scoped COUNT auth (13-04)", ...)` block, covering RAUTH-01, RAUTH-02, RAUTH-03 (default retry, explicit `authRetries: 2`, and `authRetries: 0` exhaustion), RAUTH-04 (timeout and handler-rejection), RAUTH-06, RAUTH-09, D-02/D-03, and D-15, all on real timers
- Non-vacuity probe: temporarily restored the pre-13-04 `count()` (commit `857e60c8~1`) and confirmed both the RAUTH-02 test (times out waiting for the COUNT frame — the old pre-block makes it wait behind the unrelated REQ's auth state) and the D-15 test (uncaught `AuthRequiredError`, no resend) fail RED — then restored the Task 1/2 implementation with a clean `git diff` against the working tree

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert count() to the shared auth operator with a suspendable 10s clock** - `857e60c8` (feat)
2. **Task 2: COUNT auth wire-trace tests including the clock-suspension case** - `1f2c6473` (test)

## Files Created/Modified

- `packages/relay/src/relay.ts` - `count()`'s third parameter retyped to `RelayCountOptions`; its `messages` stream widened to `RelayCountResponse | AuthRequiredSignal`, pre-block and catch-and-rethrow deleted, delegates to a locally-constructed `AuthPhaseGate` + `authRetryOperator`; the bare 10s `timeout()` replaced with `suspendableTimeout`
- `packages/relay/src/__tests__/relay.test.ts` - new `describe("operation-scoped COUNT auth (13-04)", ...)` block with 11 tests

## Decisions Made

- `take(1)` moved from inside `count()`'s own auth/timeout pipeline to the outer pipe, positioned between `authRetryOperator` and `suspendableTimeout` — `authRetryOperator`'s `expand()`/`concat()` retry mechanism must see every auth-required signal as a `next()` value on its own source stream to drive resubscription; placing `take(1)` upstream of it (where the original code's `take(1)` sat, back when auth-required was a *thrown* error that bypassed `take(1)`'s counting entirely) would instead complete the stream on the very first signal, since `take(1)` only knows how to count `next()` emissions, not distinguish a signal from a genuine response.
- `this.authRetryOperator("read", opts, gate)`'s result is bound to an explicitly-typed local (`const authOperator: OperatorFunction<RelayCountResponse | AuthRequiredSignal, RelayCountResponse> = ...`) rather than called inline inside `.pipe(...)`. Calling it inline caused TypeScript's `.pipe()` overload unification to back-propagate a `never` inference from `suspendableTimeout(...)`'s `with` callback (`() => throwError(() => new Error("COUNT timeout"))`, which types as `Observable<never>`) onto `take(1)`'s output type two stages earlier — a chain-order quirk of generic inference across multiple bare generic-call arguments to `.pipe()`, unrelated to `count()`'s own logic. The explicit local also preserves the acceptance criterion's literal `this.authRetryOperator("read"` grep match, which an inline `<RelayCountResponse>` type argument would have broken.
- D-15's COUNT test proves clock suspension via a real (non-fake) `setTimeout` spy, asserting the 10s budget is armed once before the auth phase and re-armed with ~its full original budget after the phase closes — rather than literally waiting past 10 real seconds. `count()`'s 10s budget has no user-configurable knob (unlike `request()`'s `opts.timeout`, which 13-02's own D-15 test shrank to 40ms to prove suspension quickly in real time), so shrinking the budget itself wasn't an option. The spy technique still observes only genuine `setTimeout` calls made by `suspendableTimeout` (satisfying D-20's "real ordering, not a mocked advance"), and is a falsifiable, non-vacuous check — the non-vacuity probe confirmed it fails RED against the reverted, non-suspending implementation, which arms `setTimeout` exactly once for the operation's whole lifetime and never re-arms around an auth phase.
- RAUTH-02/03/04/07/09 are left `Pending` in `REQUIREMENTS.md`, matching 13-02's own precedent for the same requirement IDs. Each spans all eight auth sites (`req`/`request`/`subscription`/`count`/`publish`/`event`/`sync`/negentropy); `count()` is one of the five sites converted after 13-01's foundation (`req`/`request`/`subscription` landed in 13-02, `count()` lands here, `publish`/`event`/`sync`/negentropy remain for 13-05/13-06). Marking these complete now would misrepresent the milestone's actual completion state.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. The `take(1)` repositioning and the explicit `authOperator` local were both necessitated directly by the plan's own instructions (delegate to the shared operator, preserve the literal grep acceptance criteria) rather than by any bug or missing functionality discovered during implementation; they are documented above as decisions rather than deviations since no plan text was contradicted.

## Issues Encountered

None beyond the TypeScript inference quirk described above, which was resolved within Task 1 before its commit (not a runtime/behavioral issue, and never landed as broken code).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `count()` is fully converted to the shared operator model, alongside `req()`/`request()`/`subscription()` (13-02) and `SyncLoader` (13-03). `event()`/`publish()` and `negentropy()`/`sync()` (plans 13-05/13-06) remain the last two sites.
- `deferred-items.md` (created by 13-02) still carries the watchTower/keepAlive-during-wait finding forward; nothing new added by this plan.
- No blockers for 13-05/13-06, which run independently of `count()`'s conversion. 13-07 (changesets + final requirement closure) depends on all of 13-04/13-05/13-06 landing first — RAUTH-02/03/04/07/09 should be marked complete only once the last of those lands.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/relay.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-04-SUMMARY.md
- FOUND: 857e60c8 (Task 1)
- FOUND: 1f2c6473 (Task 2)
- FOUND: c4950a30 (SUMMARY commit)
