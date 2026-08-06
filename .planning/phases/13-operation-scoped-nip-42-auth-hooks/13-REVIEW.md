---
phase: 13-operation-scoped-nip-42-auth-hooks
reviewed: 2026-08-06T11:48:11Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/loaders/src/loaders/sync-loader.ts
  - packages/loaders/src/loaders/__tests__/exports.test.ts
  - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/negentropy.ts
  - packages/relay/src/operators/auth-retry.ts
  - packages/relay/src/pool.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/__tests__/auth-retry.test.ts
  - packages/relay/src/__tests__/exports.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/types.ts
findings:
  critical: 4
  warning: 6
  info: 3
  total: 13
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-08-06T11:48:11Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The shared-operator design (`operators/auth-retry.ts`) is sound in isolation and its unit tests pass, but
the design's guarantees do **not** survive the conversion of all four call sites. Three of the four
guarantees the phase set out to make structural are broken at the `req()` and `count()` call sites, and
one is broken inside the operator itself:

- **Retry accounting is unbounded on `req()`** — `req()` emits an `OPEN` control message on every
  (re)subscription, and `authRetry`'s D-08 "any real value resets the counter" tap treats it as progress.
  A relay that keeps answering `auth-required` drives an infinite REQ/handler loop.
- **The 13-05 reentrancy fix was applied only to `event()`** — `req()` and `count()` still bundle their
  send into (or behind) a stream that completes on the auth-required signal, so a synchronously resolving
  auth phase silently drops the operation.
- **A synchronously *throwing* `onAuthRequired` escapes the operator's error mapping** — it propagates raw
  instead of as `AuthHandlerError`, which defeats both the `RelayClosedError` retry skip in
  `publish()` (D-07) and the loader's `RELAY_AUTH_ERROR_NAMES` duck-typing (D-06/D-16).

All four Critical findings were reproduced against the real `Relay` with `vitest-websocket-mock`; the
observed frame counts and stream outcomes are quoted verbatim in each finding. The probe files were
deleted after use — no source file was modified by this review.

Secondary concerns: `Relay.request()`'s operation clock can never fire (pre-existing, but the phase
rewrote and re-documented that line as the D-15 budget), `RelayGroup.request()` was left off the D-15
suspension entirely, and the sync-loader's stall-guard suspension is conditional on the caller supplying a
handler.

## Critical Issues

### CR-01: `req()` auth retries are unbounded — the `OPEN` message resets the retry budget

**File:** `packages/relay/src/relay.ts:905` (the `OPEN` emission) with `packages/relay/src/operators/auth-retry.ts:286-289` (the reset `tap`)
**Issue:**
`authRetry` resets `consecutive = 0` on *any* value that is not an auth-required signal (D-08). Every
re-subscription of `req()`'s source re-sends the REQ and immediately emits
`{ type: "OPEN", ... }` before anything from the relay arrives. That `OPEN` flows through the operator as a
real value and zeroes the counter, so `consecutive >= authRetries` can never be reached: the operator runs
an auth phase, retries, sees `OPEN`, resets, and repeats forever.

Reproduced (default `authRetries: 1`, relay answers `CLOSED … auth-required` to every REQ, handler resolves
on a macrotask and satisfies auth):

```
relay.req(...)      -> 25 REQ frames, 25 onAuthRequired invocations, no error   (expected 2 / 1 / AuthRequiredError)
relay.request(...)  -> 30 REQ frames, 30 onAuthRequired invocations, no error   (expected 2 / 1 / AuthRequiredError)
relay.count(...)    ->  2 COUNT frames, 1 invocation, AuthRequiredError          (correct — COUNT has no OPEN message)
```

The COUNT contrast isolates the cause. In a real app each extra cycle is another signer prompt / AUTH event
and another REQ to a hostile relay; `subscription()`, `request()`, `RelayGroup.req/request/subscription` and
`RelayPool` all inherit it. The existing REQ tests never exercise a persistently auth-requiring relay (the
EVENT path has exactly that test — `T-13-01`, relay.test.ts:937 — the REQ path does not), which is why this
is not caught.

**Fix:** make "progress" explicit instead of "any value". Add a predicate to the operator config and pass it
from `req()`:

```ts
// auth-retry.ts
export type AuthRetryConfig = {
  /** Values that count as real progress and reset the consecutive counter (default: all) */
  isProgress?: (value: unknown) => boolean;
  // ...
};
// ...
tap((value) => {
  if (config.isProgress?.(value) ?? true) consecutive = 0;
}),

// relay.ts req()
this.authRetryOperator("read", opts, gate, (m) => (m as RelayReqMessage).type !== "OPEN"),
```

Add a REQ-side non-vacuity test mirroring `T-13-01`: a relay that always answers `auth-required` must
receive exactly `authRetries + 1` REQ frames and then terminate with `AuthRequiredError`.

### CR-02: `req()` silently drops the resend (and completes with no events) when the auth phase resolves synchronously

**File:** `packages/relay/src/relay.ts:855-953`
**Issue:**
`req()` puts the REQ-sending `control` *inside* the `share()`d `observable` (line 924-935), and its
`messages` stream completes on the auth-required signal (`takeWhile(..., true)`, line 889). When the auth
phase resolves synchronously — a synchronous `onAuthRequired` plus an already-satisfied requirement, which
D-11 explicitly supports ("the handler always runs, even if `waitForAuth` is already satisfied") — the
operator re-subscribes the source from inside the current message dispatch. At that instant the `share()` is
still connected (refCount 1), so the re-subscription joins the *existing* subject instead of re-running
`control`; no REQ is sent, and the in-flight completion then terminates both subscribers.

Reproduced with `waitForAuth: []` (satisfied synchronously) and a synchronous handler:

```
socket frames attempted: ["REQ"]      // the resend was never even written to the socket
handler invocations:     1
subscriber outcome:      complete = true, 0 events, no error   // silent data loss
```

This is the identical failure shape plan 13-05 fixed for `event()` (`9aa18b07 fix(13-05): split event()'s
send from its shared listen stream to fix a resend reentrancy bug`); the same probe against `event()` gives
the correct `["EVENT","EVENT"]` + `{ok:true}`. The fix was never carried over to `req()`.

**Fix:** apply the 13-05 split here — keep a share on the pure *listen* path and leave the sending `control`
unshared so every subscription re-sends, e.g. move the `share()` off `observable` (the outer `share()` at
line 951 already dedupes downstream subscribers) or wrap the send in its own `defer` that is not behind a
`share()`. Alternatively, break the synchronous re-entrance in the operator by scheduling the resubscribe:

```ts
isAuthRequiredSignal(value)
  ? concat(runPhase(value), defer(() => source).pipe(subscribeOn(asapScheduler)))
  : EMPTY,
```

(the second option fixes CR-03 in the same edit). Add a regression test with a synchronous handler for each
of the four call sites.

### CR-03: `count()` resends the COUNT into a dead listen stream when the auth phase resolves synchronously

**File:** `packages/relay/src/relay.ts:961-1034`
**Issue:**
`count()` does split send from listen, but its `messages` stream *completes* on the auth-required signal
(line 986, `takeWhile(..., true)` inclusive). Under a synchronous auth phase the re-subscription happens
before that completion has propagated, so the new `control` joins the still-live-but-terminating shared
`messages`: the second COUNT goes out on the wire and is then immediately abandoned.

Reproduced with `waitForAuth: []` and a synchronous handler; the relay's real `COUNT` reply arrives 50 ms
later and is never observed:

```
socket frames attempted: ["COUNT", "COUNT", "CLOSE", "CLOSE"]
subscriber outcome:      complete = true, values = []        // no count response at all
```

A completion with zero values also means `firstValueFrom(relay.count(...))` rejects with `EmptyError`
instead of returning a count, and `RelayGroup.count`'s `combineLatest` never emits for that relay.

**Fix:** same as CR-02 — either make the auth resubscribe asynchronous inside `authRetry`, or stop letting
the *shared* `messages` be the thing that both terminates the current attempt and serves the next one (give
each subscription of `control` its own listen chain, as `event()` does with a `messages` stream that never
completes).

### CR-04: a synchronously throwing `onAuthRequired` is not mapped to `AuthHandlerError`

**File:** `packages/relay/src/operators/auth-retry.ts:242-258`
**Issue:**
`config.onAuthRequired?.(context)` is called *inside* the `defer` factory, above the `catchError` that maps
handler failures. A handler that throws synchronously (as opposed to returning a rejected promise) therefore
errors the `defer` with the raw thrown value; `config.errors.handler` is never invoked, contradicting the
documented contract on `AuthHandlerError` ("Thrown when a caller-supplied `onAuthRequired` handler rejects or
throws (D-17)").

Reproduced: `relay.req(..., { onAuthRequired: () => { throw new Error("sync boom") } })` errors with a plain
`Error`, `err instanceof AuthHandlerError === false`.

Two downstream guarantees break as a result:

1. `publish()` — the raw error is not a `RelayClosedError`, so `customRetryOperator`'s D-07 skip
   (relay.ts:1259) does not fire and the caller's EVENT is **re-sent**. Reproduced:
   `relay.publish(event, { onAuthRequired: () => { throw ... }, timeout: 2000 })` produced **2 EVENT
   frames** and finally rejected with `Error: Timeout has occurred` instead of a terminal
   `AuthHandlerError`. This is exactly the hot-loop RESEARCH flagged and D-07 was written to close.
2. `applesauce-loaders` — `RELAY_AUTH_ERROR_NAMES` (sync-loader.ts:89) matches on `.name`, so the raw
   `"Error"` is not recognised and the negentropy path falls back to the paginated request against the same
   auth wall, which D-16 explicitly forbids (sync-loader.ts:601).

**Fix:** move the handler invocation under the error mapping:

```ts
const phase$: Observable<boolean> = defer(() => {
  config.gate.begin();
  config.log?.(`Auth required for ${config.operation}: ${signal.reason}`);

  let result: void | Promise<void>;
  try {
    result = config.onAuthRequired?.(context);
  } catch (cause) {
    return throwError(() => config.errors.handler(signal.reason, cause));
  }
  // ...
```

and extend `auth-retry.test.ts` ("maps a rejecting handler to the handler error", line 156) with a
`vi.fn(() => { throw ... })` case — the suite currently only covers `mockRejectedValue`.

## Warnings

### WR-01: `Relay.request()`'s operation clock can never fire — the `OPEN` message satisfies its first-emission gate

**File:** `packages/relay/src/relay.ts:1365`
**Issue:** `suspendableTimeout` implements *first-emission* semantics (`firstEmitted = true; clearTimer()`,
auth-retry.ts:153-156), and `req()` emits `OPEN` synchronously on subscription, upstream of this operator.
The 30 s request budget is therefore cancelled before the relay has said anything, and a relay that never
answers hangs forever. Reproduced: `relay.request(filters, { timeout: 200 })` against a silent relay — no
error and no completion after 300 ms; the same probe against an auth-looping relay ran 600 ms without the
200 ms clock firing. The behaviour is pre-existing (`timeout({ first })` had the identical flaw), but this
phase rewrote the line, documented it as the operation budget D-15 suspends, and shipped a passing "D-15:
request()'s operation clock is suspended across the auth phase" test (relay.test.ts:1619) that asserts a
timeout which cannot fire either way — i.e. the new guarantee is vacuous here.
**Fix:** either place the clock after `OPEN` is filtered out, or give `suspendableTimeout` a predicate for
what counts as a first emission:

```ts
suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: (m) => m.type !== "OPEN" }),
```

Then re-assert the D-15 test so it fails without the gate.

### WR-02: `RelayGroup.request()`'s clock is not suspended across the auth phase

**File:** `packages/relay/src/group.ts:262`
**Issue:** Every other operation clock in the phase was converted to `suspendableTimeout` with a threaded
`AUTH_PHASE_GATE`; the group request still uses a bare `timeout({ first: opts?.timeout ?? 30_000 })` and
never threads a gate into `relay.req`. `pool.request()` / `group.request()` is the most-used read API, so
the D-15 property the phase advertises is absent on the main path. (Currently masked by WR-01 — the group
stream also emits `OPEN` first, so the clock never fires at all. Fixing WR-01 without fixing this turns the
latent gap into a live one: any auth prompt slower than the request timeout kills the request.)
**Fix:** create an `AuthPhaseGate` in `RelayGroup.request`, thread it into each `relay.req(...)` via
`AUTH_PHASE_GATE`, and swap the bare `timeout` for `suspendableTimeout`.

### WR-03: the sync loader's stall-guard suspension only exists when the caller passes `onAuthRequired`

**File:** `packages/loaders/src/loaders/sync-loader.ts:417-450`
**Issue:** `authPhases` is only incremented from inside `relayOnAuthRequired`, which is `undefined` when the
caller supplies no handler (line 443). A relay that answers `auth-required` with no handler configured still
makes the relay layer wait up to `authTimeout` (default 30 s) for external auth — while the loader's stall
clock (default `timeout: 30_000`) keeps running and errors the relay out from under it. D-16's suspension is
therefore conditional on an unrelated option.
**Fix:** drive the suspension off the auth phase itself rather than off the handler — e.g. always install a
wrapper (`onAuthRequired: relayOnAuthRequired` even when the caller's handler is absent, delegating to a
no-op), so the phase accounting is independent of whether the caller wants a callback.

### WR-04: the sync loader's auth-phase close timer is never cleared

**File:** `packages/loaders/src/loaders/sync-loader.ts:432-436`
**Issue:** `scheduleClose()` arms `setTimeout(close, authTimeout ?? 30_000)` and nothing ever clears it —
not `forceCloseAuthPhases()` (which only calls `close()` and drops the callback from the set), not the
`withTimeout` teardown, not the relay stream's completion. Every auth phase leaves a pending timer for up to
30 s after the loader is torn down, which keeps a Node process alive and fires callbacks on state belonging
to a finished run.
**Fix:** keep the handle and clear it in `close()`:

```ts
let handle: ReturnType<typeof setTimeout> | undefined;
const close = () => {
  if (closed) return;
  closed = true;
  if (handle !== undefined) clearTimeout(handle);
  // ...
};
const scheduleClose = () => {
  if (authTimeout !== false) handle = setTimeout(close, authTimeout ?? 30_000);
};
```

### WR-05: `relayClosedSub` / `shouldResubscribe` are shared mutable flags across overlapping auth-retry cycles

**File:** `packages/relay/src/relay.ts:851-852, 895-913` (and `958, 993-1004` for `count`)
**Issue:** These per-call flags are reset by the *new* cycle's `control` before the *previous* cycle's
`finalize` runs (the retry subscribe happens inside the old subscription's terminal dispatch). Two
consequences: the old cycle sends a redundant `["CLOSE", id]` for a REQ the relay already closed
(observed in the CR-03 probe: `["COUNT","COUNT","CLOSE","CLOSE"]`), and the old cycle's
`finalize` deletes `reqs$[id]` that the new cycle just re-registered, so `relay.reqs` under-reports live
REQs after an auth retry. `shouldResubscribe` is read later by `customRepeatOperator`'s condition and is
subject to the same cross-cycle staleness.
**Fix:** scope the flags to a subscription rather than to the `req()`/`count()` call — e.g. move them into
the `defer` that creates each attempt, or key the `reqs$` bookkeeping on the attempt object so a stale
finalize cannot remove a live entry.

### WR-06: `console.debug` in library code

**File:** `packages/relay/src/group.ts:334`
**Issue:** `RelayGroup.sync`'s D-19 catch writes directly to the console. Every other diagnostic in this
package goes through the `debug` logger (`logger.extend(...)`), which consumers can switch off; a bare
`console.debug` cannot be silenced and is inconsistent with the codebase convention (`Relay` has
`this.log`, `negentropy.ts` has `const log = logger.extend("negentropy")`).
**Fix:** add a hoisted logger to `RelayGroup` (`protected log = logger.extend("RelayGroup")`) and use
`this.log(...)`; do not `.extend()` at the call site.

## Info

### IN-01: RAUTH-06 (`waitForAuth: false`) is implemented twice

**File:** `packages/relay/src/relay.ts:1089` and `packages/relay/src/operators/auth-retry.ts:234`
**Issue:** `event()` short-circuits before the operator when `waitForAuth` is falsy, and the operator
implements the same rule again. The two must agree forever; the `event()` copy also coerces
`waitForAuth: ""` (a falsy but type-legal `AuthRequirement`) to `false`, which the operator's strict
`waitForAuth === false` check does not.
**Fix:** keep only the `verb === "AUTH"` short-circuit in `event()` and let the operator own RAUTH-06.

### IN-02: `event()`'s auth-exhaustion response drops the `error` field D-18 just added

**File:** `packages/relay/src/relay.ts:1117-1121`
**Issue:** `catchError` rebuilds `{ ok: false, from, message: err.reason }` without `error: err`, so the one
failure shape a consumer most wants to branch on structurally (auth exhausted) is the one that arrives as a
bare string, while `errorToPublishResponse` (group.ts:56) now attaches `error` for every other failure.
**Fix:** `of<PublishResponse>({ ok: false, from: this.url, message: err.reason, error: err })`.

### IN-03: `suspendableTimeout` keeps its gate subscription after the first emission

**File:** `packages/relay/src/operators/auth-retry.ts:151-157`
**Issue:** Once `firstEmitted` is set the timer is cleared but `gateSub` stays subscribed to `gate.active$`
for the life of the operation, doing nothing but re-entering the no-op branch on every gate transition.
`AuthPhaseGate.end()`'s `Math.max(0, …)` similarly hides an unbalanced `begin`/`end` rather than surfacing
it.
**Fix:** `gateSub.unsubscribe()` alongside `clearTimer()` in the `firstEmitted` branch.

---

_Reviewed: 2026-08-06T11:48:11Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
