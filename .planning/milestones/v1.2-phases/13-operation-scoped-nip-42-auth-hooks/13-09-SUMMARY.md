---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 09
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, req, gap-closure]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 08)
    provides: "ProgressPredicate<T>/isReqProgress (required firstWhen), CR-04's synchronous-throw mapping — the structural prerequisites this plan's req() restructuring and its clock-fires test build on"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 05)
    provides: "event()'s unshared-control/shared-listen send/listen split — the shape this plan generalises to req()"
provides:
  - "req() constructs its REQ send and its terminating listen chain per attempt, inside one unshared defer — closes CR-02"
  - "relayClosedSub is attempt-scoped; shouldResubscribe's outcome is mirrored into a call-scoped holder object so customRepeatOperator's condition callback (evaluated after the auth retry boundary) reads the most recently completed attempt's result"
  - "REQ-side wire-trace proofs for CR-01/RAUTH-03 (bound), CR-02 (synchronous resend + observed reply), and RAUTH-07 (subscription() inheritance)"
  - "WR-01 proof that request()'s operation clock fires against a silent relay, and a de-vacuified D-15 suspension test (RED without gate suspension, GREEN with it)"
affects: [13-10, 13-11, 13-12, 13-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "req()'s messages/control/observable are all constructed inside the same per-attempt defer that authRetryOperator's expand()-driven resubscribe re-invokes — the fix generalizes event()'s 13-05 unshared-control/shared-listen split to a stream shape with a third layer (watchTower merge + filtersComplete) and call-scoped id/reqs$ bookkeeping"
    - "Attempt-scoped mutable state (relayClosedSub) vs. call-scoped externally-readable state (resubscribeHolder): a plain local variable cannot survive past the attempt that declared it, but an operator outside the retry boundary (customRepeatOperator) still needs to read the most recent attempt's outcome — a call-scoped holder object each attempt writes into bridges the two scopes without smuggling attempt state across the retry boundary"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "resubscribeHolder is reset to false at the same point the original shouldResubscribe local was reset (inside control's per-filters-emission map, right before the REQ send) rather than at the top of the defer factory — preserves the exact original reset timing for the common case (one filters emission per attempt) and correctly reflects the outcome of a filters observable that emits multiple times within a single attempt"
  - "The REQ-side bound test (Task 2) passes reconnect: true explicitly, unlike the pre-existing RAUTH-03 tests — this is what makes the test's 1200ms post-error wait a genuine non-vacuous proof of customConnectionRetryOperator's pre-existing RelayClosedError skip (D-07), mirroring T-13-01's identical role for publish()'s customRetryOperator. Bare req() has no default reconnect, so without this the wait would clear nothing"
  - "Task 3's clock-fires test and the D-15 repair both use a temporary hand-edit + revert (not a permanent test-harness toggle) to prove non-vacuity, following this phase's established convention (13-04, 13-06, 12.1-01): a fresh AuthPhaseGate substituted at request()'s own suspendableTimeout call site (not the gate threaded into req()) isolates the suspension mechanism from the already-fixed isReqProgress predicate"

requirements-completed: []

coverage:
  - id: D1
    description: "req() sends its REQ and constructs its listen chain fresh per auth-retry attempt, inside one unshared defer — a synchronous onAuthRequired handler driving a resubscribe from inside the current CLOSED dispatch now writes a real second REQ frame to the socket and observes its reply, instead of silently rejoining a still-connected share with 0 events"
    requirement: "RAUTH-03"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#CR-02: a synchronously-resolving auth phase produces a real REQ resend whose reply is observed"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#T-13-09-01 (REQ leg of RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 REQ frames, then a terminal AuthRequiredError, with the default retries left in place"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (152 pre-existing req()/request()/subscription() tests, no regression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The bound and resend guarantees hold through subscription(), which inherits req() without a copy of its own — proving the inheritance leg of RAUTH-07 for the read path"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-07 (inheritance leg): subscription()'s REQ resend is bounded exactly like req()'s own, not an unbounded loop"
        status: pass
    human_judgment: false
  - id: D3
    description: "request()'s operation clock fires against a relay that accepts the REQ and then says nothing at all (WR-01), and the pre-existing D-15 clock-suspension test is proven non-vacuous by failing when handed a gate that never opens"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#WR-01: request()'s operation clock fires against a relay that accepts the REQ and then says nothing at all"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#D-15: request()'s operation clock is suspended across the auth phase"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 09: req()'s Per-Attempt Send/Listen Split and REQ-Side Wire-Trace Proofs Summary

**Closed CR-02 by moving `req()`'s REQ-sending `control` and its listen-only `messages` chain into the same per-attempt `defer` the shared auth operator's internal resubscribe re-invokes — generalizing `event()`'s 13-05 unshared-control/shared-listen split to `req()`'s three-layer stream shape — then added four wire-trace tests proving CR-01/RAUTH-03's bound, CR-02's actual resend-and-observed-reply, RAUTH-07's `subscription()` inheritance, and WR-01's silent-relay clock-fire, all confirmed RED against the pre-fix code before being restored GREEN.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-06T14:49:00Z (approx.)
- **Completed:** 2026-08-06T14:49:10Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `req()`'s `messages` (listen-only, `share()`'d within the attempt) and `control` (the REQ send side effect) are now constructed fresh inside the same `defer` factory that `this.waitForReady(observable)` already ran per subscription — this is the exact source `authRetry`'s `expand()`-driven internal resubscribe re-invokes on every auth-required cycle, so a synchronous `onAuthRequired` handler can no longer rejoin a still-connected `share()` and silently drop the resend (CR-02, the REQ-side analog of 13-05's `event()` reentrancy bug)
- The outer `share()` previously wrapping the send-carrying `observable` is removed entirely; the returned pipe's own `share()` (outside the auth retry boundary) is the only share left dedup-ing downstream subscribers, matching `event()`'s established shape
- `relayClosedSub` moved to attempt scope (a stale value from a prior attempt could send a redundant CLOSE for a REQ the relay already closed, or delete the new attempt's just-registered `reqs$[id]` entry). `shouldResubscribe`'s outcome is mirrored into a call-scoped `resubscribeHolder` object so `customRepeatOperator`'s condition callback — evaluated *after* the auth retry boundary, once no attempt-scoped local survives — always reads the most recently completed attempt's result
- Four new wire-trace tests: a T-13-01-style bound test (exactly `authRetries + 1` REQ frames, then terminal `AuthRequiredError`, using a *synchronous* handler — the exact case CR-02 dropped), a direct CR-02 regression asserting the resend reaches the wire *and* its reply is observed, a short `subscription()` inheritance test, and a `request()` clock-fires test proving `WR-01` against a totally silent relay
- The pre-existing D-15 suspension test was repaired with a comment stating both timing numbers (100ms auth phase vs. 40ms operation timeout) and the ordering rationale, then verified non-vacuous via a temporary substitution (a fresh, never-opened `AuthPhaseGate` at `request()`'s own `suspendableTimeout` call site)
- Every new/repaired test was independently confirmed RED against the pre-fix code (or a temporary broken substitution) with the actual observed symptom recorded below, then restored to a clean `git diff` and GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Give each req() auth attempt its own send and its own terminating listen chain** - `b92ff0e7` (fix)
2. **Task 2: REQ-side bound and synchronous-resend wire-trace tests** - `248f0dd7` (test)
3. **Task 3: Prove request()'s operation clock fires, and de-vacuify the existing D-15 suspension test** - `27e266f6` (test)

## Files Created/Modified

- `packages/relay/src/relay.ts` - `req()`'s `messages`/`control`/`observable` moved from call-scoped constants (constructed once, shared across every internal auth-retry attempt) into a single per-attempt `defer` factory; the outer `share()` on the send-carrying `observable` removed; `relayClosedSub` made attempt-scoped; `shouldResubscribe` replaced by a call-scoped `resubscribeHolder` object each attempt writes into. `count()`, `event()`, `sync()`, `negentropy()` untouched (confirmed via `git diff --stat` showing a single contiguous hunk covering only `req()`)
- `packages/relay/src/__tests__/relay.test.ts` - new `describe("operation-scoped REQ auth gap closure (13-09, CR-02/WR-01)")` block (3 tests); a new `WR-01` test added to the existing `describe("request", ...)` block; the pre-existing D-15 suspension test repaired in place with a non-vacuity comment

## Decisions Made

- `resubscribeHolder` is reset to `false` at the same point the original `shouldResubscribe` local was reset — inside `control`'s per-filters-emission `map`, immediately before the REQ send — rather than at the top of the defer factory. This preserves the original reset timing exactly for the common (single filters emission per attempt) case and correctly reflects the true outcome if a caller-supplied dynamic filters observable emits more than once within a single attempt.
- The REQ-side bound test (`T-13-09-01`) passes `reconnect: true` explicitly, which none of the pre-existing RAUTH-03 tests do. Bare `req()` has no default `reconnect`, so `customConnectionRetryOperator(undefined)` is `identity` and would never retry regardless of the wait — passing `reconnect: true` is what makes the test's 1200ms post-error wait a genuine, non-vacuous proof of `customConnectionRetryOperator`'s pre-existing `RelayClosedError` skip (D-07), mirroring T-13-01's identical role for `publish()`'s `customRetryOperator`.
- Task 3's non-vacuity verification for both the clock-fires test and the D-15 repair used a temporary hand-edit-and-revert (not a permanent test-harness toggle), following this phase's established convention (13-04/13-06/12.1-01 precedent): a fresh, never-opened `AuthPhaseGate` substituted at `request()`'s own `suspendableTimeout` call site (deliberately *not* the gate threaded into `req()`) isolates the suspension mechanism itself from the already-13-08-fixed `isReqProgress` predicate, so the RED observation attributes to the right cause.

## Deviations from Plan

None — plan executed exactly as written. Task 1's `shouldResubscribe` local variable became fully redundant once its outcome was mirrored into `resubscribeHolder` at every write site (a `tsc` unused-variable error caught this immediately); removed it and read `resubscribeHolder.value` directly at both the write sites and the `customRepeatOperator` condition callback. This is a mechanical simplification of the plan's own instruction ("use a call-scoped holder... rather than a call-scoped boolean each attempt resets"), not a scope change.

## Issues Encountered

None.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria and D-20, each new/repaired test was observed RED against the pre-fix code (or a targeted temporary substitution), then GREEN after restoring the fix. `git diff packages/relay/src/relay.ts` was empty after every restore.

- **T-13-09-01** (REQ bound test) and **CR-02** (synchronous resend) and **RAUTH-07 inheritance** (`subscription()`): reverted `req()` to the pre-Task-1 commit (`b92ff0e7~1`). RED symptom for all three: `Error: expect(WS).toReceiveMessage(expected) — Expected the websocket server to receive a message, but it didn't receive anything in 1000ms` — the second REQ frame never reached the socket, matching CR-02's stated pre-fix symptom exactly (1 REQ frame, silent complete, 0 events).
- **WR-01** (`request()`'s clock fires against silence): temporarily changed `request()`'s `suspendableTimeout` call from `firstWhen: isReqProgress` to `firstWhen: () => true`. RED symptom: `Test timed out in 5000ms` — with a permissive `firstWhen`, `req()`'s own synthetic `OPEN` message (the only value ever emitted by a silent relay) immediately satisfies the predicate and cancels the clock before it can ever fire, so the subscriber neither errors nor completes.
- **D-15** (suspension test repair): temporarily substituted a fresh, never-opened `AuthPhaseGate` at `request()`'s own `suspendableTimeout` call site (`suspendableTimeout(opts?.timeout ?? 30_000, new AuthPhaseGate(), { firstWhen: isReqProgress })`), leaving the gate threaded into `req()` unchanged. RED symptom: an uncaught `Error: Timeout has occurred` fired at the 40ms mark (the clock was never suspended, since `gate.active$` on the substituted gate never reports "in an auth phase"), followed by `expect(WS).toReceiveMessage(expected)` timing out waiting for the resend REQ that never happens because the subscription already errored out.

## Verification Results

- `pnpm --filter applesauce-relay build` — exits 0
- `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — 156/156 tests pass (152 pre-existing + 4 new; no regression, including the pre-existing `describe("operation-scoped REQ auth (13-02)")` block)
- `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` — 16/16 tests pass (13-08 not regressed)
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts packages/relay/src/__tests__/pool.test.ts` — 47/47 tests pass
- `pnpm --filter applesauce-relay test` — 238/238 tests pass across 9 files
- `pnpm vitest run packages/relay/src/__tests__/exports.test.ts` — passes; export surface unchanged (this plan adds no new exported symbols)
- `git diff packages/relay/src/relay.ts` — a single contiguous hunk covering only `req()`; `count()`, `event()`, `sync()`, `negentropy()` are byte-identical to before this plan

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-02 is closed at `req()`'s source, with `subscription()`/`request()` proven to inherit the fix (they take no independent code path).
- `count()`'s CR-03 (the same defect class, but without `req()`'s additional "REQ nested inside the send-carrying share" problem) remains open — plan 13-10's explicit scope, per this plan's objective. Do not treat CR-02/CR-03 as jointly closed until 13-10 lands.
- Per the established 13-08 precedent (its own SUMMARY note on RAUTH-03/07/08), `REQUIREMENTS.md` is left unchanged (`RAUTH-03`/`RAUTH-07` remain **In Progress**, not marked Complete) — both requirements span all eight auth sites, and `count()`'s CR-03 gap is still open. `requirements mark-complete` was deliberately NOT run for this plan; mark RAUTH-03/07 complete only once 13-10 (and the phase's own audit sweep) closes the remaining gap.
- No blockers for 13-10, which runs independently against `count()`.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/relay.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-09-SUMMARY.md
- FOUND: b92ff0e7 (Task 1)
- FOUND: 248f0dd7 (Task 2)
- FOUND: 27e266f6 (Task 3)
