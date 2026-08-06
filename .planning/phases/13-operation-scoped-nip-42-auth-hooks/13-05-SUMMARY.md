---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 05
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, event, publish]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks
    provides: "13-01's RelayAuthOptions mixin, error classes, and the shared operators/auth-retry.ts operator (authRetry/AuthPhaseGate/suspendableTimeout/AUTH_PHASE_GATE); 13-04's count() conversion as the closest structural analog"
provides:
  - "event() takes the named RelayEventOptions type (D-05, 2 of 5 anonymous literals retyped) and routes its post-response auth-required wait through the shared authRetryOperator, with the ambient publish-auth pre-block deleted (closes RAUTH-02 for event())"
  - "event() keeps its pre-existing value-shaped response contract on exhaustion (D-01/D-02) — a caught AuthRequiredError from the shared operator is converted back into {ok:false, message:'auth-required:...'} so auth()/negentropy()/sync() callers see no contract change; a handler rejection (AuthHandlerError) or phase timeout (AuthTimeoutError) still propagate as genuine errors"
  - "customRetryOperator (publish()'s sole retry) skips RelayClosedError like customConnectionRetryOperator already does, closing RESEARCH gap 1 — an exhausted auth failure is now terminal instead of retried, so max EVENT sends is authRetries + 1 independent of retries"
  - "publish() forwards the full RelayAuthOptions set (onAuthRequired/authTimeout/authRetries, not just waitForAuth) to event() and suspends publishTimeout across the auth phase via a dedicated AuthPhaseGate threaded through the module-private AUTH_PHASE_GATE symbol (D-15, RAUTH-07)"
  - "customTimeoutOperator replaced by customSuspendableTimeoutOperator (its sole caller was publish(); the old helper is fully deleted, not left dead)"
  - "wire-trace test suite (11 tests) covering T-13-01 (bounded EVENT-frame count), RAUTH-01/02/03/04/06/07/09 and D-15 on real timers"
affects: [13-06, 13-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "event() mirrors count()'s D-01/D-02/D-03 value-signal shape, but additionally catches the shared operator's exhausted AuthRequiredError and converts it back to a value — the one auth site whose pre-existing contract already promised never to throw for auth-required"
    - "event()'s send/listen split (unshared `control` defer that always re-sends on subscribe + a listen-only shared `messages`) mirrors count()'s existing send/listen separation — required because a synchronous onAuthRequired handler can drive the shared operator's resubscription from inside the very socket dispatch that delivered the auth-required response, and a combined send+listen shared defer's refCount-reset timing is not guaranteed to have settled by then"
    - "publish()'s AuthPhaseGate is constructed once per publish() call and threaded into event() via AUTH_PHASE_GATE, exactly matching request()'s gate-threading pattern into req()"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "Found and fixed a genuine reentrancy bug in event()'s pre-existing messages stream (Rule 1, unrelated to this plan's own new code but only exercised by it): the original `defer(() => {send; return this.socket.pipe(...)}).pipe(share())` bundled the send side effect and the shared listen stream into one object. When a SYNCHRONOUS onAuthRequired handler drives the shared operator's resend from inside the current OK-message dispatch (a scenario that never existed pre-13-05, since event() never retried itself), the resend was silently dropped — only 1 EVENT frame was ever sent instead of 2. count()'s existing unshared-control/shared-listen split does not have this bug. Fixed by splitting event() the same way. Verified via a targeted debug harness: a synchronous handler reproduced 1-frame drops against the old structure and 2-frame correct resends against count()'s structure; an async (microtask-deferred) handler always worked either way."
  - "event()'s catchError intercepts only AuthRequiredError (the operator's exhausted-retries outcome) and converts it to a value; AuthHandlerError/AuthTimeoutError are NOT caught and propagate as genuine errors — per D-17 and the plan's explicit exhaustion contract. RelayGroup's per-relay catch converts those into a response carrying the error object once plan 13-07 lands D-18."
  - "customTimeoutOperator deleted outright (not left as dead code) since publish() was its only caller; customSuspendableTimeoutOperator (new name, deliberately not a substring match for the old grep pattern) replaces it with the identical false/true/number branching, driven by suspendableTimeout instead of simpleTimeout."
  - "D-15's publish test simulates successful authentication via `relay.authenticationResponse$.next(...)` (this suite's established out-of-band convention, see 13-02-SUMMARY.md) rather than a live relay.authenticate() round trip — this fixture's keepAlive=0 can drop the connection (and wipe the challenge) while nothing is subscribed during a real async handler delay, the same gap 13-02 already documented and deferred."
  - "The RAUTH-02 test checks the ambient flag/second-EVENT-send immediately, with no wait between the first response and the second event() call — this fixture's keepAlive=0 resets receivedAuthRequiredForEvent within a few ms of nothing being subscribed (resetState() on disconnect), which would make even the OLD pre-blocked model appear to 'pass' if checked after a delay. Confirmed empirically: a 10ms gap let the OLD code pass falsely; checking immediately correctly reproduces both the RED (old code) and GREEN (new code) outcomes."

requirements-completed: []

coverage:
  - id: D1
    description: "event()'s messages stream signals auth-required as a value handled by the shared authRetryOperator instead of an ambient pre-block; the AUTH-verb/waitForAuth:false short-circuit and the value-shaped exhaustion response are unchanged; RelayEventOptions replaces the anonymous option literal (D-05)"
    requirement: "RAUTH-02"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-02: a fresh publish sends its EVENT frame immediately, before any AUTH frame, even after an earlier publish already received auth-required"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-06: event(..., \"AUTH\") never invokes the handler even when the relay answers auth-required"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-06: waitForAuth:false never invokes the handler"
        status: pass
    human_judgment: false
  - id: D2
    description: "customRetryOperator (publish()'s sole retry) skips RelayClosedError so an exhausted auth failure is terminal; publish() forwards the full auth option set and suspends publishTimeout across the auth phase via a threaded AuthPhaseGate"
    requirement: "RAUTH-04, RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#T-13-01 (RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 EVENT frames, then a terminal AuthRequiredError, with the default retries left in place"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-01/RAUTH-03: invokes onAuthRequired with operation \"publish\" and resends the EVENT after the handler authenticates"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a short authTimeout rejects the publish with AuthTimeoutError"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a rejecting handler rejects the publish with AuthHandlerError carrying the rejection as cause"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: authTimeout:false leaves the EVENT pending past a short window"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#D-15: publish's timeout is suspended across the auth phase"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-07: publish() forwards onAuthRequired to the underlying EVENT auth phase"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-09: authRequiredForPublish$ flips true when an EVENT receives auth-required"
        status: pass
    human_judgment: false

duration: ~24min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 05: event()/publish() Operation-Scoped Auth with a Bounded Retry Budget Summary

**Converted `event()`'s post-response auth-required handling from an ambient publish-wide pre-block to the shared value-signal `authRetryOperator`, gave `customRetryOperator` (publish's sole retry) the `RelayClosedError` skip so an exhausted auth failure can no longer hot-loop against a hostile relay, and suspended `publish()`'s `publishTimeout` across the auth phase — closing 13-RESEARCH.md's gap 1 with a bounded-EVENT-frame test (`authRetries + 1`, never more) as the non-vacuity proof.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-08-06T10:29:00Z (approx.)
- **Completed:** 2026-08-06T10:28:58+01:00
- **Tasks:** 3 (plus one Rule-1 bug-fix commit discovered during Task 3's own non-vacuity verification)
- **Files modified:** 2

## Accomplishments

- `event()`'s third parameter is now the named `RelayEventOptions` type instead of an anonymous `{ waitForAuth?: AuthRequirement }` literal (D-05); the AUTH-verb and `waitForAuth: false` short-circuits are unchanged (RAUTH-06 survives verbatim)
- Deleted `event()`'s ambient pre-block (`this.waitForAuth(this.authRequiredForPublish$, observable, waitForAuth)`) — an EVENT is now sent immediately regardless of any other publish's auth state (RAUTH-02), with the post-response wait routed through `this.authRetryOperator("publish", opts, gate)`
- `event()` keeps its pre-existing value-shaped response contract on exhaustion: the shared operator's `AuthRequiredError` (retries exhausted) is caught and converted back into `{ ok: false, message: "auth-required:..." }`, so `auth()`/`negentropy()`/`sync()` callers observe no contract change (D-01/D-02); a handler rejection (`AuthHandlerError`) or phase timeout (`AuthTimeoutError`) propagate as genuine errors (D-17)
- `customRetryOperator` (used only by `publish()`) now skips `RelayClosedError` exactly like `customConnectionRetryOperator` already does — closing 13-RESEARCH.md's gap 1: without it, publish's default 3-retry linear-backoff loop would multiply against the auth operator's own retries and repeatedly resend the caller's EVENT to a hostile relay
- `publish()` forwards the full auth option set (`onAuthRequired`/`authTimeout`/`authRetries`, not just `waitForAuth`) to `event()`, threads a fresh `AuthPhaseGate` via `AUTH_PHASE_GATE`, and replaced `customTimeoutOperator` with `customSuspendableTimeoutOperator` so `publishTimeout` does not run during the auth phase (D-15) — `customTimeoutOperator` itself is fully deleted since it had exactly one caller
- 11 new wire-trace tests in a dedicated `describe("operation-scoped EVENT/PUBLISH auth (13-05)", ...)` block, covering T-13-01's bounded EVENT-frame count, RAUTH-01/02/03/04/06/07/09, and D-15, all on real timers
- Fixed a genuine reentrancy bug in `event()`'s pre-13-05 `messages` stream, found via this plan's own non-vacuity check (see Deviations)
- Non-vacuity: both T-13-01 (bounded frame count) and RAUTH-02 (no pre-block) were manually reverted-and-observed RED against, respectively, the pre-Task-2 `customRetryOperator` and the pre-Task-1 `event()`, then restored with a clean `git diff`

## Task Commits

Each task was committed atomically:

1. **Task 1: Move event()'s auth wait onto the shared operator** - `a21110ee` (feat)
2. **Task 2: Give customRetryOperator the RelayClosedError skip and suspend publish's clock** - `31335466` (feat)
3. **[Rule 1 bug fix, found during Task 3] Split event()'s send from its shared listen stream** - `9aa18b07` (fix)
4. **Task 3: Publish auth tests with a bounded EVENT-frame assertion** - `eaa14fb8` (test)

## Files Created/Modified

- `packages/relay/src/relay.ts` - `event()`'s third parameter retyped to `RelayEventOptions`, pre-block deleted, delegates to `authRetryOperator` with a value-shaped exhaustion catch; `event()`'s send/listen split fixed (reentrancy bug); `customRetryOperator` gained the `RelayClosedError` skip; `customTimeoutOperator` deleted, replaced by `customSuspendableTimeoutOperator`; `publish()` forwards the full auth option set and suspends its clock via a threaded `AuthPhaseGate`
- `packages/relay/src/__tests__/relay.test.ts` - new `describe("operation-scoped EVENT/PUBLISH auth (13-05)", ...)` block with 11 tests; rewrote one obsolete pre-13-05 test that asserted the now-removed ambient pre-block behavior

## Decisions Made

- Found and fixed a genuine reentrancy bug in `event()`'s pre-existing `messages` stream (Rule 1 — the defect predates this plan but was only ever exercised by this plan's own new internal-retry behavior, since `event()` never resubscribed itself before): the original `defer(() => {send; return this.socket.pipe(...)}).pipe(share())` bundled the send side effect and the shared listen stream into one object. When a synchronous `onAuthRequired` handler drives the shared operator's resend from inside the very socket dispatch that delivered the auth-required OK response, the resend was silently dropped (only 1 EVENT frame sent instead of 2), while an async (microtask-deferred) handler always worked correctly either way. `count()`'s existing unshared-`control`/shared-`messages` send/listen split does not have this bug — `event()` was restructured to match it exactly.
- `event()`'s `catchError` intercepts only `AuthRequiredError` (the shared operator's exhausted-retries outcome) and converts it to a value; `AuthHandlerError`/`AuthTimeoutError` are NOT caught and propagate as genuine errors, per D-17 and the plan's explicit exhaustion contract.
- `customTimeoutOperator` deleted outright rather than left as dead code (its sole caller, `publish()`, now calls the new `customSuspendableTimeoutOperator`), matching the plan's explicit instruction and the package's unused-local build check.
- D-15's publish test simulates successful authentication via `relay.authenticationResponse$.next(...)` (this suite's established out-of-band convention per 13-02-SUMMARY.md) rather than a live `relay.authenticate()` round trip, since this fixture's `keepAlive=0` can drop the connection mid-wait.
- RAUTH-02's test checks the ambient flag/second-EVENT-send immediately with no wait between the first response and the second `event()` call — confirmed empirically that a 10ms gap lets `resetState()` (triggered by `keepAlive=0`'s connection drop) clear the flag and make even the OLD pre-blocked code falsely "pass".
- RAUTH-02/03/04/06/07/09 remain `Pending` in `REQUIREMENTS.md` per 13-02/13-04's own precedent — each spans all eight auth sites; this plan closes the `event()`/`publish()` pair, leaving `negentropy()`/`sync()` (13-06) as the last site before 13-07 can mark these complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a resend reentrancy bug in event()'s send/listen structure**
- **Found during:** Task 3 (writing and verifying the new synchronous-handler-driven wire-trace tests)
- **Issue:** `event()`'s pre-existing `messages` stream bundled its send side effect and its shared listen stream into one `defer(() => {send; return ...}).pipe(share())`. Once Task 1 made `event()` capable of internally retrying itself (new behavior — it never did before this plan), a synchronous `onAuthRequired` handler poking auth state from inside the current OK-message dispatch caused the resend to be silently dropped (only 1 EVENT frame sent). Async handlers were unaffected. Isolated via a temporary debug harness comparing `event()`'s structure against `count()`'s (which already correctly resends under a synchronous handler).
- **Fix:** Split `event()`'s stream into an unshared `control` (the send side effect, `defer`, always re-executes on subscribe) plus a listen-only shared `messages`, mirroring `count()`'s existing send/listen separation exactly.
- **Files modified:** `packages/relay/src/relay.ts`
- **Verification:** `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — all 141 tests pass, including the new synchronous-handler T-13-01 test; `pnpm --filter applesauce-relay build` exits 0.
- **Committed in:** `9aa18b07` (standalone fix commit, immediately before Task 3's test commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a pre-existing reentrancy defect exposed for the first time by this plan's own internal-retry behavior)
**Impact on plan:** Necessary correctness fix with zero scope creep — the fix is a structural rename/split with no behavior change for the single-attempt case, and restores the exact resend guarantee `count()`/`req()` already provide.

## Issues Encountered

- The non-vacuity probes for T-13-01 and RAUTH-02 required care around this fixture's `keepAlive: 0` connection-drop quirk (already documented by 13-02/13-04): a naive RAUTH-02 probe with a short wait between the two `event()` calls let `resetState()` clear the auth-required flag before the second call checked it, making even the un-fixed pre-block code appear to pass. Resolved by checking immediately, matching the established convention from the COUNT/REQ `RAUTH-09` tests.
- T-13-01's bounded-frame assertion originally waited only 50ms after the terminal `AuthRequiredError` to confirm no further EVENT frames arrive — too short to distinguish from the unfixed `customRetryOperator`'s ~1000ms first-retry delay. Widened to 1200ms so the assertion is a genuine (non-vacuous) proof rather than an artifact of a short wait window.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `event()`/`publish()` are fully converted to the shared operator model, alongside `req()`/`request()`/`subscription()` (13-02), `SyncLoader` (13-03), and `count()` (13-04). `negentropy()`/`sync()` (13-06) is the last remaining site.
- The reentrancy fix in `event()`'s send/listen split is a reusable lesson for 13-06: any site that lets the shared operator drive a synchronous resend from inside its own message-dispatch callback needs the same unshared-`control`/shared-`messages` separation `count()` and now `event()` both use.
- No blockers for 13-06, which runs independently. 13-07 (changesets + final requirement closure) still depends on 13-06 landing before RAUTH-02/03/04/06/07/09 can be marked complete.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/relay.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-05-SUMMARY.md
- FOUND: a21110ee (Task 1)
- FOUND: 31335466 (Task 2)
- FOUND: 9aa18b07 (Rule 1 bug-fix commit)
- FOUND: eaa14fb8 (Task 3)
