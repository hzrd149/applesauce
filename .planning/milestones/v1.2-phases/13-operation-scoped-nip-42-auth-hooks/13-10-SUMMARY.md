---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 10
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, count, gap-closure, audit]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 09)
    provides: "req()'s per-attempt unshared-control/fresh-listen-chain defer shape — the exact pattern this plan generalises to count()"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 05)
    provides: "event()'s original send/listen split, the first instance of this defect class"
provides:
  - "count() constructs its COUNT send and its terminating listen chain per attempt, inside one unshared defer — closes CR-03"
  - "A written send/listen invariant, stated once as a comment above the shared authRetryOperator adapter, that any future call site must satisfy"
  - "A recorded per-site audit verdict for all eight auth-reachable operations plus every RelayGroup/RelayPool entry point, closing the sweep planning directive 2 asked for"
  - "COUNT-side wire-trace proofs mirroring req()'s: a bound test, a synchronous-resend-and-observed-reply regression, and a RelayGroup.count combineLatest downstream proof"
affects: [13-11, 13-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "count()'s messages/relayClosedSub moved from call-scoped constants (shared across every internal auth-retry attempt) into a per-attempt defer factory — the exact same restructuring 13-09 applied to req(), now applied to the third and final call site that has a signal-terminating listen chain (event()'s listen chain never terminates on its own, so it never needed this fix)"
    - "A written invariant beside a shared adapter, instead of a SUMMARY-only note: the comment above authRetryOperator states the send/listen invariant in the adapter's own file so a future call site is checked against a standing contract rather than relying on institutional memory of three prior SUMMARY notes (13-05, 13-08, 13-09) that never got carried forward on their own"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts
    - packages/relay/src/__tests__/group.test.ts

key-decisions:
  - "The redundant relayClosedSub = false reset previously inside count()'s inner control defer (needed only because relayClosedSub used to be call-scoped and control could be resubscribed multiple times across retry cycles) is dropped now that relayClosedSub is declared fresh, already false, at the top of the per-attempt outer defer — count()'s filters argument is a static value (unlike req()'s dynamic filters observable), so control's factory runs exactly once per attempt and the extra reset was dead code. No behavior change; a pure simplification discovered while mirroring req()'s shape."
  - "RelayGroup.count()'s combineLatest test does not wait for the group observable to complete — group.count(), like group.req()/group.subscription(), never completes on its own because RelayGroup.relays$ is a long-lived BehaviorSubject that never completes, and switchMap's output only completes once both the outer source and the current inner observable complete. The test instead asserts the combined value arrives, matching the pattern already used by the other group-level auth tests (RAUTH-05, RAUTH-09) in this suite."
  - "WR-02 (RelayGroup.request() never threads an AuthPhaseGate into relay.req() and keeps a bare timeout() instead of suspendableTimeout) is recorded as a known open item in the audit table below, per the plan's explicit instruction, rather than fixed here — it is plan 13-11's declared scope."

requirements-completed: []

coverage:
  - id: D1
    description: "count() constructs its COUNT send and its terminating listen chain per attempt, inside one unshared defer — a synchronous onAuthRequired handler's resubscribe now reaches a live listen chain and observes the real reply, instead of joining a chain that already terminated"
    requirement: "RAUTH-03"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#CR-03: a synchronously-resolving auth phase produces a real COUNT resend whose reply is observed"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#T-13-10-01 (COUNT leg of RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 COUNT frames, then a terminal AuthRequiredError, with the default retries left in place"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (156 pre-existing count()/req()/event() tests, no regression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "RelayGroup.count's combineLatest still emits a combined record for a relay whose count survives an auth round-trip, rather than suppressing the whole group result — the concrete downstream consequence of CR-03"
    requirement: "RAUTH-03"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#CR-03 downstream (13-10): RelayGroup.count's combineLatest still emits for a relay whose count survives an auth round-trip"
        status: pass
    human_judgment: false
  - id: D3
    description: "All eight auth-reachable operations, plus every RelayGroup/RelayPool entry point, are audited against a single written send/listen invariant and each gets a recorded verdict with concrete file-and-region evidence — the sweep planning directive 2 required so the defect class does not recur on a ninth site"
    requirement: "RAUTH-07"
    verification:
      - kind: other
        ref: "packages/relay/src/relay.ts — invariant comment above authRetryOperator (grep -c 'unshared' relay.ts == 2); this SUMMARY's two audit tables record the per-site verdicts"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-relay test (241/241) and pnpm --filter applesauce-loaders test (122/122), no regression from the audit"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 10: count()'s Per-Attempt Send/Listen Split and the Full Eight-Site Audit Summary

**Closed CR-03 by moving `count()`'s `messages`/`relayClosedSub` from call-scoped constants into the same per-attempt `defer` shape 13-09 gave `req()` — the third and final call site with a signal-terminating listen chain — then swept the remaining defect-class risk by stating the send/listen invariant once, as a comment beside the shared `authRetryOperator` adapter, and auditing all eight auth-reachable operations plus every `RelayGroup`/`RelayPool` entry point against it, finding no further violations.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-06T21:35:00Z (approx.)
- **Completed:** 2026-08-06T22:10:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 2 (relay.ts touched by both Task 1 and Task 3, counted once)

## Accomplishments

- `count()`'s `messages` (the COUNT/CLOSED filter chain with its inclusive `takeWhile` terminating on an unprefixed CLOSED or an auth-required signal) and `relayClosedSub` are now constructed fresh inside the same `defer` factory that `this.waitForReady(countObservable)` already ran per subscription — the exact source `authRetry`'s internal resubscribe re-invokes on every auth-required cycle, so a synchronous `onAuthRequired` handler can no longer rejoin a `messages` chain that already completed and silently drop the reply (CR-03, the COUNT-side analog of 13-05's `event()` and 13-09's `req()` reentrancy bugs)
- The call-scoped `AuthPhaseGate` and the `authRetryOperator`/`suspendableTimeout` wiring are unchanged in shape — one gate still spans every attempt of a single `count()` call, and `req()`, `event()`, `sync()`, `negentropy()` are byte-identical to before this plan (confirmed via `git diff` hunk inspection: both hunks land entirely inside `count()`'s line range)
- Three new wire-trace tests: a `T-13-01`-style COUNT bound test (exactly `authRetries + 1` COUNT frames, then a terminal `AuthRequiredError`, using a *synchronous* handler — the exact case CR-03 dropped), a direct CR-03 regression asserting the resend reaches the wire *and* a delayed real reply is actually observed (plus a pinned single-CLOSE-frame count, closing the redundant-CLOSE half of the verifier's `["COUNT","COUNT","CLOSE","CLOSE"]` observation), and a `RelayGroup.count()` test proving `combineLatest` still emits a combined record once relay1's count survives an auth round-trip
- Task 3's audit: the send/listen invariant is now stated once, as a comment on `authRetryOperator` in `relay.ts`, and all eight auth-reachable operations plus every `RelayGroup`/`RelayPool` entry point were checked against it (tables below). No new violation was found; the one known gap (`RelayGroup.request()`'s missing gate threading, WR-02) is recorded as owned by plan 13-11, per this plan's explicit scope boundary
- Every new/repaired test was independently confirmed RED against the pre-Task-1 `count()` (via a temporary hand-edit-and-restore, never a git operation) with the actual observed symptom recorded below, then restored to a clean `git diff` and GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Give each count() auth attempt its own send and its own terminating listen chain** - `07270eff` (fix)
2. **Task 2: COUNT-side bound and synchronous-resend wire-trace tests** - `ec4c5510` (test)
3. **Task 3: Audit every auth-reachable call site against the send/listen invariant and record a verdict per site** - `9c84c2de` (docs)

## Files Created/Modified

- `packages/relay/src/relay.ts` - `count()`'s `messages`/`relayClosedSub` moved from call-scoped constants into a per-attempt `defer` factory mirroring `req()`'s 13-09 shape (Task 1); a comment stating the send/listen invariant added above `authRetryOperator` (Task 3). `req()`, `event()`, `sync()`, `negentropy()` untouched — confirmed via `git diff` hunk boundaries after each commit
- `packages/relay/src/__tests__/relay.test.ts` - new `describe("operation-scoped COUNT auth gap closure (13-10, CR-03)")` block (2 tests)
- `packages/relay/src/__tests__/group.test.ts` - new `describe("count")` block (1 test) proving the `RelayGroup.count` downstream consequence of CR-03; placed here rather than `relay.test.ts` because the group's two-mock-relay fixture is what the `combineLatest` proof needs

## Decisions Made

- The redundant `relayClosedSub = false` reset that used to live inside `count()`'s inner `control` defer factory is dropped in the restructured version. It existed only because `relayClosedSub` used to be call-scoped and `control` could, under the old shape, be resubscribed multiple times across retry cycles. Now that `relayClosedSub` is declared fresh (already `false`) at the top of the per-attempt outer `defer`, and `count()`'s `filters` argument is a static value (unlike `req()`'s dynamic filters observable, which genuinely can emit — and therefore reset — more than once per attempt), `control`'s factory runs exactly once per attempt and the extra reset was dead code. This is a pure simplification with no behavior change, discovered while mirroring `req()`'s shape.
- The `RelayGroup.count()` regression test does not wait for the group observable to complete. `group.count()`, like `group.req()`/`group.subscription()`, never completes on its own: `RelayGroup.relays$` is a long-lived `BehaviorSubject` that never completes, and RxJS's `switchMap` only completes its output once *both* the outer source and the current inner observable complete. The test instead asserts the combined value arrives and then unsubscribes, matching the pattern already used by this suite's other group-level auth tests (RAUTH-05, RAUTH-09) rather than introducing a new completion expectation the design doesn't support.
- WR-02 (`RelayGroup.request()` never threads an `AuthPhaseGate` into `relay.req()` and keeps a bare `timeout()` instead of `suspendableTimeout`) is recorded as a known open item in the audit table below, per the plan's explicit instruction not to fix it here — it is plan 13-11's declared scope.

## Deviations from Plan

None — plan executed exactly as written. The dropped redundant `relayClosedSub` reset (see Decisions Made) is a mechanical simplification surfaced by mirroring `req()`'s established shape, not a scope change.

## Issues Encountered

- The single-relay `CR-03` regression test's CLOSE-frame assertion initially failed with 0 observed CLOSE frames even though `finalize`'s `this.socket.next(["CLOSE", id])` call was confirmed (via temporary debug logging, since removed) to execute synchronously with `relayClosedSub` correctly `false`. The mock server had not yet flushed the message at the moment `server.messages` was read synchronously after `await spy.onComplete()`. Fixed by awaiting `expect(server).toReceiveMessage(["CLOSE", "count1"])` before reading `server.messages`, matching this suite's established convention for asserting on frames sent during teardown. Not a defect in the fix — a test-timing artifact, resolved without touching `relay.ts`.
- The initial `RelayGroup.count()` test attempted `await spy.onComplete()`, which timed out. Diagnosed (see Decisions Made) as `group.count()` structurally never completing since `RelayGroup.relays$` never completes. Fixed by asserting the emitted value directly instead of waiting for completion.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria and D-20, each new test was observed RED against the pre-Task-1 code (via a temporary in-place hand-edit and restore using the Edit tool — never `git stash`/`git checkout` against uncommitted work, honoring the destructive-git-operation boundary for a non-worktree sequential run), then GREEN after restoring the fix. `git diff packages/relay/src/relay.ts` was empty after every restore, confirmed via `pnpm --filter applesauce-relay build` and the full relay/group suites passing immediately after restore.

- **T-13-10-01** (COUNT bound test): reverted `count()` to the pre-Task-1 shape. RED symptom: the test timed out at 5000ms rather than resolving to a terminal `AuthRequiredError` — the synchronous handler's resubscribe against the old call-scoped `messages` never let the operator observe a clean second CLOSED dispatch the way it needed to for CR-01's already-fixed counter-reset logic to exhaust cleanly, so the test hung instead of failing fast.
- **CR-03** (synchronous resend + observed reply): same revert. RED symptom: `AssertionError: expected true to be false` on `spy.receivedComplete()` immediately after the second COUNT frame reached the wire — the subscriber had already silently completed with zero values, exactly matching the verifier's independently-reproduced `["COUNT","COUNT","CLOSE","CLOSE"]` / `complete=true` / `0 values` observation, before the delayed real reply was ever sent.
- **RelayGroup.count() combineLatest test**: same revert. RED symptom: `AssertionError: expected [] to deeply equal [ {…} ]` — the group's `combineLatest` never emitted a combined record at all, confirming the "one relay completing empty suppresses the whole group result" consequence CR-03 predicted for `RelayGroup.count`.

## Verification Results

- `pnpm --filter applesauce-relay build` — exits 0
- `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — 158/158 tests pass (156 pre-existing + 2 new; no regression, including the pre-existing `describe("operation-scoped COUNT auth (13-04)")` and `describe("count")` blocks)
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts` — 22/22 tests pass (21 pre-existing + 1 new)
- `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` — 16/16 tests pass (13-08 not regressed)
- `pnpm --filter applesauce-relay test` — 241/241 tests pass across 9 files
- `pnpm --filter applesauce-loaders test` — 122/122 tests pass across 16 files
- `pnpm vitest run packages/relay/src/__tests__/exports.test.ts` — passes; export surface unchanged (this plan adds no new exported symbols, only a comment)
- `grep -c 'unshared' packages/relay/src/relay.ts` → 2 (the pre-existing `event()` note plus the new adapter note)
- `git diff` of each of the three commits shows hunks landing entirely inside `count()`'s line range (Task 1) or as a pure comment addition above `authRetryOperator` (Task 3); `req()`, `event()`, `sync()`, `negentropy()` are byte-identical to before this plan

## Audit: Eight Auth-Reachable Operations Against the Send/Listen Invariant

Invariant (stated in `packages/relay/src/relay.ts` above `authRetryOperator`, ~line 787): any call site piping through the shared adapter must construct its send side effect and its signal-terminating listen chain together, per attempt, inside one unshared `defer`; nothing that completes on the auth-required signal may be hoisted to call scope.

| Operation | Where its send happens | Where its signal-terminating chain is constructed | Hoisted above the retry boundary? | Verdict |
|-----------|------------------------|----------------------------------------------------|------------------------------------|---------|
| `req()` | `control`'s `map` (socket.next(["REQ",...])), `relay.ts:~937-948`, inside the per-attempt `defer` at `relay.ts:877` | `messages` (`relay.ts:~894-932`), constructed inside the same per-attempt `defer` — fixed by 13-09 | No — `messages`, `control`, and `relayClosedSub` are all declared inside the `defer` factory | **Satisfies** |
| `request()` | Delegates to `req()` (`relay.ts:~1431-1435`); adds its own `suspendableTimeout` with a dedicated `AuthPhaseGate` threaded into `req()` via `AUTH_PHASE_GATE` | Inherits `req()`'s | The added `suspendableTimeout` sits outside `req()`'s auth retry boundary entirely (it wraps `req()`'s already-complete output), so it introduces no new shared listen chain | **Satisfies** (inheritance — `req()`'s own fix carries through); WR-02 gap is a separate, already-known issue (see group table) |
| `subscription()` | Delegates to `req()` (`relay.ts:~1412-1415`), no independent send | Inherits `req()`'s | No — pure `.pipe()` transform on `req()`'s output, adds no new stream above the boundary | **Satisfies** (inheritance) |
| `count()` | `control`'s `defer` (socket.next(["COUNT",...])), `relay.ts:~1062-1066`, inside the per-attempt outer `defer` at `relay.ts:1010` | `messages` (`relay.ts:~1028-1057`), constructed inside the same per-attempt `defer` — fixed by this plan (Task 1) | No — `messages`, `control`, and `relayClosedSub` are all declared inside the outer `defer` factory | **Satisfies** (closed by this plan) |
| `event()` | `control`'s `defer` (socket.next([verb,event])), `relay.ts:~1118-1121`, deliberately unshared but call-scoped (not per-attempt) | `messages` (`relay.ts:~1104-1109`) — call-scoped, `share()`'d, but has **no terminating condition of its own** (no `takeWhile`; the auth-required check happens downstream, after `take(1)` already captured a value) | `messages` is hoisted to call scope, but since it never completes on the auth-required signal (it just keeps filtering OK messages for this event id), a resubscribe re-listening on it never rejoins a "dead" chain — the invariant's premise (a listen chain that can complete before a resend rejoins it) does not apply | **Satisfies** — by construction, not restructuring; this is the shape `req()`/`count()` were made to match, not a shape that itself needed the per-attempt fix |
| `publish()` | Delegates to `event()` (`relay.ts:~1449-1456`); adds `customRetryOperator`/`customSuspendableTimeoutOperator` entirely outside the auth retry boundary (D-07's separate-budget model) | Inherits `event()`'s | No — the added operators wrap `event()`'s already-complete output | **Satisfies** (inheritance) |
| `sync()`/`negentropy()` | `negentropy()`'s `runSync` is a `defer(() => from(buildStorage().then(negentropySync(...))))` (`relay.ts:~1240-1242`) — the entire negotiation (send + listen, handled internally by `negentropySync`) is reconstructed fresh on every subscription, since it's one `defer` around the whole promise chain | Same `defer` — there is no separate shared "listen" stream to hoist; `negentropySync` owns the socket interaction internally per invocation | No — the invariant is satisfied trivially since the whole operation is already one per-attempt `defer` | **Satisfies** — by construction; `sync()` (`relay.ts:~1503-1567`) wraps `negentropy()` and the per-direction `event()`/`req()` calls it makes internally, introducing no additional shared stream |

## Audit: RelayGroup and RelayPool Entry Points

| Wrapper | Delegates to | Introduces its own shared/terminating stream above the inner operation's auth retry boundary? | Verdict |
|---------|---------------|---------------------------------------------------------------------------------------------|---------|
| `RelayGroup.req()` | `internalSubscription((relay) => relay.req(filters, opts))` (`group.ts:206-208`) — per-relay `catchError` only, no shared listen chain | No | **Satisfies** |
| `RelayGroup.request()` | `internalSubscription((relay) => relay.req(filters, {...opts, reconnect}))` (`group.ts:250-257`), then a group-level `timeout({first: opts?.timeout ?? 30_000})` (`group.ts:262`) — a **bare** `timeout()`, not `suspendableTimeout`, and no `AuthPhaseGate` threaded into the inner `relay.req()` call | The bare `timeout()` does not suspend across `req()`'s internal auth phase (D-15 property absent) — a pre-existing, already-documented gap (WR-02), distinct from CR-02/CR-03's reentrancy defect | **Known gap (WR-02) — deferred to plan 13-11, not fixed in this plan** per the plan's explicit instruction |
| `RelayGroup.subscription()` | `internalSubscription((relay) => relay.req(filters, {...opts, reconnect}))` (`group.ts:276-278`), pure `.pipe()` filter/map after | No | **Satisfies** |
| `RelayGroup.count()` | `relays$.pipe(switchMap((relays) => combineLatest({...relay.count(...)})))` (`group.ts:297-303`) — each `relay.count()` is an independent, already-fixed stream; `combineLatest` only combines their outputs, introduces no send/listen split of its own | No | **Satisfies** — and this plan's Task 2 proves the CR-03 downstream consequence (a relay completing empty suppressing the whole group result) is now closed |
| `RelayGroup.event()`/`publish()` | `internalPublish((relay) => relay.event(...))` / `(relay) => from(relay.publish(...)))` (`group.ts:211-213`, `237-241`) — per-relay `errorToPublishResponse` catch only | No | **Satisfies** |
| `RelayGroup.sync()` | `merge(...relays.map((relay) => relay.sync(...).pipe(catchError(...))))` (`group.ts:307-330`) — per-relay isolation only (D-19), no shared listen chain of its own | No | **Satisfies** |
| `RelayGroup.negentropy()` | `Promise.allSettled(relays.map((relay) => relay.negentropy(...)))` (`group.ts:216-234`) — parallel per-relay calls, no shared stream | No | **Satisfies** |
| `RelayPool.req()`/`event()`/`negentropy()`/`publish()`/`request()`/`subscription()`/`count()`/`sync()` | Each is a one-line delegation to `this.group(relays).<method>(...)` (`pool.ts:151-262`) | No — pure pass-through, no independent stream construction | **Satisfies** (all eight) |

If the audit had found a further violation, this task's plan required fixing it here with a regression test observed RED beforehand. No further violation was found beyond the already-known, already-scoped WR-02 gap.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-03 is closed at `count()`'s source, mirroring `req()`'s 13-09 fix and `event()`'s original 13-05 fix — all three call sites with a signal-terminating listen chain now construct that chain per attempt, inside one unshared `defer`.
- The send/listen invariant is now written down once, beside the adapter every future call site will use (`authRetryOperator`'s doc comment), rather than living only in three separate SUMMARY notes (13-05, 13-08, 13-09) that this phase's own history shows were not enough to prevent the class recurring on `req()`/`count()`.
- The eight-operation and group/pool-wrapper audits found exactly one known gap: `RelayGroup.request()`'s missing `AuthPhaseGate` threading (WR-02), already scoped to plan 13-11 by this plan and left unfixed here per the plan's explicit instruction.
- Per the established 13-08/13-09 precedent (their own SUMMARY notes on RAUTH-03/07/08), `REQUIREMENTS.md` is left unchanged (`RAUTH-03`/`RAUTH-07` remain **In Progress**, not marked Complete) — WR-02 (owned by 13-11) and CR-04's downstream sync-loader consequence (owned by 13-12, per the deferred-items.md note recorded after 13-13) are still open in this phase's wave sequence. `requirements mark-complete` was deliberately NOT run for this plan; per the phase's own deferred-items.md note, plan 13-12 is the designated closing plan that flips RAUTH-03/07/08 to Complete once every gap-closure plan in this wave sequence has landed.
- No blockers for 13-11, which addresses WR-02 (`RelayGroup.request()`'s gate threading) independently against `group.ts`.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/relay.test.ts
- FOUND: packages/relay/src/__tests__/group.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-10-SUMMARY.md
- FOUND: 07270eff (Task 1)
- FOUND: ec4c5510 (Task 2)
- FOUND: 9c84c2de (Task 3)
