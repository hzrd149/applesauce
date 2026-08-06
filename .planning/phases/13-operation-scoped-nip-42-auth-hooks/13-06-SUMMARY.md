---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 06
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, negentropy, sync, nip-77]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks
    provides: "13-01's RelayAuthOptions mixin, error classes, and the shared operators/auth-retry.ts operator (authRetry/AuthPhaseGate/suspendableTimeout/AUTH_PHASE_GATE); 13-02's req() conversion (AuthRequiredSignal value-signal pattern); 13-04's count() conversion (take(1) downstream of authRetryOperator); 13-05's event() conversion (the unshared-control/shared-messages reentrancy fix, reused conceptually here since negentropy()'s per-attempt teardown has an analogous shape)"
provides:
  - "negentropy() signals auth-required as a value at the NegentropyError edge translation instead of throwing, has no pre-block, and delegates the whole auth flow to Relay.authRetryOperator (D-01/D-02, closes RAUTH-02 for negentropy())"
  - "Relay.sync takes the named RelaySyncOptions type (D-05, last of 5 anonymous literals) and threads the caller's full auth option set into all three relay operations it performs: the negentropy negotiation, the internal SEND-direction event() call, and the internal RECEIVE-direction req() call (RAUTH-08 — closes RESEARCH gap 4)"
  - "the dead protected pre-gate waitForAuth() helper (and its now-unused mergeWith import) is deleted — no site in relay.ts can reintroduce the RAUTH-02 ambient pre-block"
  - "wire-trace test suite (11 tests) covering RAUTH-01/02/03/04/06/09 for negentropy(), an abort-mid-auth-phase case, and RAUTH-08's two internal-call threading cases for sync(), using a real two-party NIP-77 exchange"
affects: [13-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "negentropy() mirrors count()'s D-01/D-02/D-03 value-signal shape at its edge translation: parseClosedError(err.reason) still runs on every NegentropyError, but an AuthRequiredError result now becomes an authRequiredSignal value instead of a re-thrown error; every other parsed prefix (and unparseable reasons) still re-throw unchanged"
    - "sync() extracts its caller's auth options into one forwarded object once, then threads that same object into all three relay operations it performs — a future added auth option field lands on all three sites simultaneously rather than needing three separate edits"
    - "test-only: a real two-party NIP-77 negotiation can be driven against the mock relay by constructing a second Negentropy/NegentropyStorageVector server-side and calling its own .reconcile() against the client's NEG-OPEN message — with both sides under 32 items this always resolves in one round trip (lib/negentropy.ts's splitRange emits a single IdList frame below that threshold), which is what lets RAUTH-08's tests reach sync()'s internal event()/req() calls with genuine have/need arrays"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "negentropy()'s auth-required detection lives inside an async function's await continuation (negentropySync's internal Promise chain), unlike req()/count()/event() where the flag update happens synchronously within the same WebSocketSubject observer-notification stack as server.send(). Tests asserting RAUTH-09's flag flip needed a short real wait (not an immediate check) to observe it, and RAUTH-02/RAUTH-08 tests needed a background keepalive req() to hold the connection open — negentropy() never subscribes watchTower itself, so this fixture's keepAlive=0 would otherwise drop the connection (and resetState() would clear the flag) during the gap between the failed attempt's own subscription tearing down and the assertion running"
  - "negentropySync's own per-attempt cleanup sends a NEG-CLOSE frame as soon as a NEG-ERR causes it to throw internally (independent of, and observed to arrive before, an auth handler's async AUTH round trip) — tests that resend after authenticating explicitly consume this NEG-CLOSE frame before waiting for the next NEG-OPEN, otherwise a subsequent server.send(['OK', ...]) call would target the wrong frame"
  - "the RAUTH-01/RAUTH-03 negentropy tests simulate successful authentication via relay.authenticationResponse$.next(...) (this suite's established out-of-band convention) rather than a live relay.authenticate() round trip — a real AUTH challenge is never observed by relay.challenge during a negentropy test since negentropy() doesn't subscribe watchTower (where ListenForChallenge lives), so relay.authenticate() would throw 'Have not received authentication challenge' with no other operation concurrently holding the connection open to receive one"
  - "RAUTH-02/03/04/06/07/09 are now fully covered across all eight auth sites (req/request/subscription/count/publish/event/sync/negentropy) as of this plan — 13-07 can mark them complete in REQUIREMENTS.md"

requirements-completed: []

coverage:
  - id: D1
    description: "negentropy()'s edge translation still parses NegentropyError via parseClosedError, but an AuthRequiredError result now produces an auth-required signal value instead of a re-thrown error; every other parsed prefix and unparseable reasons still re-throw unchanged; the pre-block is deleted so a fresh negotiation starts immediately regardless of any other operation's auth state; the whole auth flow delegates to Relay.authRetryOperator(\"sync\", opts, gate)"
    requirement: "RAUTH-02"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-02: after an earlier REQ received auth-required, a fresh negentropy negotiation still sends its NEG-OPEN frame immediately"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-01/RAUTH-03: invokes onAuthRequired with operation \"sync\" and resends the negotiation after the handler authenticates"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-03: a relay that keeps rejecting receives exactly authRetries + 1 NEG-OPEN frames (default authRetries:1)"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-03: authRetries:0 exhausts immediately without invoking the handler or retrying"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a short authTimeout rejects the negotiation with AuthTimeoutError"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-04: a rejecting handler rejects the negotiation with AuthHandlerError carrying the rejection as cause"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-06: waitForAuth:false rejects immediately with AuthRequiredError without invoking the handler"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#Abort: aborting the caller's signal while an auth phase is pending resolves the sync rather than rejecting"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-09: authRequiredForRead$ flips true when a negentropy negotiation receives auth-required"
        status: pass
    human_judgment: false
  - id: D2
    description: "Relay.sync's fourth parameter is retyped from an anonymous { waitForAuth?: AuthRequirement } literal to the named RelaySyncOptions type (D-05, last of 5); the caller's full auth option set (waitForAuth/onAuthRequired/authTimeout/authRetries) is extracted once and threaded into all three of sync()'s relay operations — the negentropy negotiation, the internal SEND-direction event() call, and the internal RECEIVE-direction req() call — closing 13-RESEARCH.md's gap 4"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-08: sync()'s internal SEND-direction event() call invokes the caller's onAuthRequired"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts#RAUTH-08: sync()'s internal RECEIVE-direction req() call invokes the caller's onAuthRequired"
        status: pass
    human_judgment: false
  - id: D3
    description: "the dead protected pre-gate waitForAuth() helper (the ambient combineLatest/mergeWith/filter/take(1)/switchMap wrapper every one of the four auth sites used to call) is deleted now that negentropy() no longer calls it — no site in relay.ts retains a pre-block mechanism that could reintroduce RAUTH-02; the now-unused rxjs mergeWith and first imports are removed alongside it"
    verification:
      - kind: other
        ref: "pnpm --filter applesauce-relay build (structural: grep -c 'protected waitForAuth<' returns 0, grep -c 'protected waitForReady<' returns 1, grep -c 'waitForAuth?: AuthRequirement' returns 0, grep -c 'authRequiredForRead\\$|authRequiredForPublish\\$' returns 10 — declarations/wiring/status/log subscriptions all intact)"
        status: pass
    human_judgment: false

duration: ~22min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 06: negentropy()/sync() Operation-Scoped Auth — the Last of the Four Sites Summary

**Converted `negentropy()`'s auth-required handling from a throw-driven ambient pre-block plus `retry({delay})` to the shared value-signal `authRetryOperator`, retyped `Relay.sync` to the named `RelaySyncOptions` (D-05's last literal), and closed 13-RESEARCH.md's gap 4 by threading the caller's auth options into `sync()`'s two previously-unthreaded internal relay calls — the direct prerequisite for Phase 15's stream-key-scoped auth, which must apply uniformly across everything `sync()` does.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-06T11:38:59+01:00 (previous plan's docs commit)
- **Completed:** 2026-08-06T12:00:29+01:00
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `negentropy()`'s edge translation is preserved in spirit (a `NegentropyError` from `negentropySync` still has its reason parsed by `parseClosedError` — translating a lower layer's error at the boundary is not throw-as-signal, D-02) but its result now differs: an `AuthRequiredError` parse produces an `authRequiredSignal` value instead of a re-thrown error, flipping `receivedAuthRequiredForReq` at the same point so `authRequiredForRead$` keeps updating (RAUTH-09); every other parsed prefix and unparseable reasons still re-throw unchanged
- Deleted `negentropy()`'s pre-block (`this.waitForAuth(this.authRequiredForRead$, runSync, waitForAuth)`) and its `retry({ delay: ... })` auth branch — the negotiation observable now feeds `this.authRetryOperator("sync", opts, gate)` directly with a locally constructed `AuthPhaseGate`, closing RAUTH-02 for `negentropy()`
- Abort behavior is unchanged: `opts.signal` aborting (including mid-auth-phase) still resolves the promise to `false` via the pre-existing `merge(observable, abort$).pipe(take(1))` race
- `Relay.sync`'s fourth parameter is retyped from an anonymous `{ waitForAuth?: AuthRequirement }` literal to the named `RelaySyncOptions` (D-05, the last of the phase's 5 anonymous literals — `RelayGroup.sync`/`RelayPool.sync` remain for 13-07 per the plan's own scope)
- `sync()` extracts its caller's full auth option set into one forwarded object and threads it into all three relay operations it performs — the negentropy negotiation, the internal SEND-direction `this.event(event, "EVENT", authOptions)` call, and the internal RECEIVE-direction `this.req({ ids: need }, authOptions)` call — closing 13-RESEARCH.md's gap 4: previously those two internal calls passed no options at all, so each independently defaulted to `waitForAuth: true` with no handler and the 30s default `authTimeout`, entirely disconnected from what the caller configured for the rest of the `sync()` call
- Deleted the now-dead protected pre-gate `waitForAuth()` helper (the ambient `combineLatest`/`mergeWith`/`filter`/`take(1)`/`switchMap` wrapper all four original auth sites used as a pre-block) along with its now-unused `mergeWith` and `first` rxjs imports — `waitForReady`, `authSatisfied$`, `authenticatedFor$`, and `isAuthenticated` all remain untouched and in use
- 11 new wire-trace tests in a dedicated `describe("operation-scoped negentropy/sync auth (13-06)", ...)` block: RAUTH-01/02/03/04/06/09 for `negentropy()`, an abort-mid-auth-phase case, and RAUTH-08's two internal-call threading cases for `sync()` — the latter two drive a real two-party NIP-77 negotiation to completion (a first for this test suite; no prior test drove `reconcile()` with genuine `have`/`need` arrays) via a `serverRespondToNegOpen` helper that constructs a second `Negentropy`/`NegentropyStorageVector` server-side and reconciles it against the client's `NEG-OPEN` message
- Non-vacuity: the RAUTH-02 test and both RAUTH-08 tests were observed RED (5000ms timeout — no `NEG-OPEN`/handler invocation ever arrives) against the pre-task `negentropy()`/`sync()` (commit `1f3bf6e4`), then GREEN against the Task 1/2 implementation

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert negentropy() to the shared auth operator** - `2179bc28` (feat)
2. **Task 2: Type Relay.sync with RelaySyncOptions, thread it into both internal calls, and remove the dead pre-gate helper** - `c6eeb1bc` (feat)
3. **Task 3: Sync and negentropy auth tests including the SEND-direction handler assertion** - `386b509f` (test)

## Files Created/Modified

- `packages/relay/src/relay.ts` - `negentropy()`'s auth-required handling converted to the shared value-signal operator with no pre-block; `Relay.sync` retyped to `RelaySyncOptions` and threads its caller's auth options into all three of its relay operations; the dead protected `waitForAuth()` pre-gate helper deleted along with its now-unused `mergeWith`/`first` imports
- `packages/relay/src/__tests__/relay.test.ts` - new `describe("operation-scoped negentropy/sync auth (13-06)", ...)` block with 11 tests, including a `serverRespondToNegOpen` helper that drives a real two-party NIP-77 round trip against the mock relay

## Decisions Made

- `negentropy()`'s auth-required detection runs inside an async function's `await` continuation (part of `negentropySync`'s internal Promise chain), unlike `req()`/`count()`/`event()` where the flag update happens synchronously within the same `WebSocketSubject` observer-notification stack as `server.send()`. This meant: (a) the RAUTH-09 test needed a short real wait rather than an "immediate" check to observe the flag flip, and (b) RAUTH-02/RAUTH-08/RAUTH-01//RAUTH-03 tests needed a background keepalive `req()` subscription to hold the raw socket connection open — `negentropy()` never subscribes `watchTower` itself, so once the auth-blocked REQ's own inner observable completes (unsubscribing from `watchTower`) this fixture's `keepAlive=0` would otherwise drop the connection and `resetState()` would clear the flag before the test's assertion or `negentropy()`'s own check ever ran.
- `negentropySync`'s own per-attempt cleanup sends a `NEG-CLOSE` frame as soon as a `NEG-ERR` causes it to throw internally — this was observed to arrive *before* an auth handler's async `AUTH` round trip in the retry tests, so those tests explicitly consume the `NEG-CLOSE` frame before waiting for the next `NEG-OPEN`/`AUTH` frame, otherwise a subsequent `server.send(["OK", ...])` would target the wrong (`NEG-CLOSE`-shaped) message.
- The RAUTH-01/RAUTH-03 negentropy retry tests simulate successful authentication via `relay.authenticationResponse$.next(...)` (this suite's established out-of-band convention, see 13-02-SUMMARY.md) rather than a live `relay.authenticate()` round trip — since `negentropy()` doesn't subscribe `watchTower` (where `ListenForChallenge` lives), a real `AUTH` challenge from the relay is never observed by `relay.challenge` during a negentropy-only test, so `relay.authenticate()` would throw `"Have not received authentication challenge"`.
- No existing test in this suite previously drove a *completed* negentropy negotiation (only auth-required/error/abort paths). RAUTH-08's two tests needed one to reach `sync()`'s internal `event()`/`req()` calls, so a `serverRespondToNegOpen` test helper was added that constructs a fresh server-side `Negentropy`/`NegentropyStorageVector` and calls its own `.reconcile()` against the client's `NEG-OPEN` initial message — with both sides holding fewer than 32 items this always resolves in a single round trip (per `lib/negentropy.ts`'s `splitRange`, which emits a direct `IdList` frame below that bucket threshold), giving the client's own `reconcile(have, need)` genuine arrays without needing to simulate the full multi-round protocol.
- RAUTH-02/03/04/06/07/09 are now covered across all eight auth sites (`req`/`request`/`subscription`/`count`/`publish`/`event`/`sync`/`negentropy`) as of this plan — 13-07 can mark them complete in `REQUIREMENTS.md` since this was explicitly the last remaining site per 13-02/13-04/13-05's own precedent of leaving them `Pending`.

## Deviations from Plan

None - plan executed as written. The test-timing decisions above (background keepalive `req()`, `NEG-CLOSE` consumption, `authenticationResponse$` over a live `authenticate()` round trip) were necessitated by pre-existing behavior of `negentropy()`/`negentropySync` and this fixture's `keepAlive=0` setting, not by any bug introduced in this plan's own code — they are documented as decisions rather than deviations since no plan text was contradicted, matching 13-04's own precedent for this distinction.

## Issues Encountered

- While validating the RAUTH-02/RAUTH-08 non-vacuity probes, an initial version of the RAUTH-02 test (with no background keepalive subscription) coincidentally reported GREEN even against the pre-task pre-blocked `negentropy()`, because this fixture's `keepAlive=0` had already reset `receivedAuthRequiredForReq` back to `false` by the time the reverted pre-block code checked it (the earlier REQ's own auth-wait phase unsubscribes from `watchTower`, tearing down the connection almost immediately). Traced via temporary debug logging against the pre-task implementation, then fixed by adding the background keepalive `req()` subscription described above, and re-verified genuine RED before restoring the implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All eight auth sites (`req`/`request`/`subscription`/`count`/`publish`/`event`/`sync`/`negentropy`) are now converted to the shared operator model, alongside `SyncLoader` (13-03). This was the last relay-layer conversion.
- `RelayGroup.sync`/`RelayPool.sync` still carry the anonymous `{ waitForAuth?: AuthRequirement }` literal (D-05's remaining 2 of 5) — explicitly deferred to 13-07 per this plan's own scope.
- 13-07 (changesets + final requirement closure) can now mark RAUTH-02/03/04/06/07/09 complete in `REQUIREMENTS.md`, since `negentropy()`/`sync()` was the last remaining site blocking that.
- No blockers for Phase 15's stream-key-scoped auth work, which depends on `sync()`'s auth options reaching all three of its relay operations uniformly — that is now true.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/relay.ts
- FOUND: packages/relay/src/__tests__/relay.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-06-SUMMARY.md
- FOUND: 2179bc28 (Task 1)
- FOUND: c6eeb1bc (Task 2)
- FOUND: 386b509f (Task 3)
