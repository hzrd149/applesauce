# Phase 13 — Deferred Items

Out-of-scope discoveries logged per the executor's scope-boundary rule. Not fixed as part of the
plan that discovered them.

## 13-02: watchTower/connection can drop during an in-flight auth wait when keepAlive is very low

**Discovered during:** Task 3 (writing RAUTH-04's `authTimeout:false` and D-15 wire-trace tests).

**Finding:** While a REQ's auth phase is waiting on `authSatisfied$` (handler resolved, requirement
not yet satisfied), nothing keeps `Relay.watchTower` subscribed for that operation — `req()`'s
`observable` completes the instant the auth-required signal is emitted (D-01's terminal-signal
design), and the shared `authRetry` operator's wait step (`operators/auth-retry.ts`) only watches
`authSatisfied$`, not the connection itself. If `keepAlive` elapses with zero other subscribers
during that wait (this test suite's fixture sets `relay.keepAlive = 0`), the underlying socket
closes, `resetState()` fires, and `authentications$` / `receivedAuthRequiredForReq` / `challenge$`
are all wiped — even though the same operation is still mid-retry.

**Verified NOT a regression from this plan:** reproduced the identical behavior (flag flips true then
resets to false within ~10ms, `connected$` cycles true→false) against the pre-13-02 `req()`
implementation (commit `c3be26c2`, `retry({delay})` + the old pre-block), using a standalone debug
test. The old `waitForAuth()` wrapper's `mergeWith(this.watchTower)` only keeps the watch tower alive
for as long as the wrapper's own subscription is live, and `retry({delay})` unsubscribes the whole
upstream (including that `mergeWith`) while evaluating its `delay()` notifier — the identical gap.

**Why not fixed here:** no truth/decision in `13-CONTEXT.md` (D-01 through D-20) covers connection
lifetime during the wait phase; fixing it correctly needs a design decision (e.g. threading a
"keep the watch tower alive" observable into `authRetry`'s wait step, or into `Relay.waitForAuth`-style
call sites) that's out of this plan's declared scope (`req`/`request`/`subscription` signal-shape and
pipe-order conversion only). With the real-world default `keepAlive` (30s), this only bites a
genuinely slow (>30s) out-of-band `authTimeout: false` wait with no other operation keeping the
connection warm — narrow enough that the affected tests were rewritten to assert via
`authenticationResponse$.next(...)` (this suite's existing convention for "simulate out-of-band
auth") rather than a real `relay.authenticate()` round trip, sidestepping the gap rather than hiding
a live defect.

**Candidate follow-up:** worth a backlog entry once the phase's four auth sites are all wired up —
decide whether the shared `authRetry` operator's wait phase should accept an optional "keepalive"
observable to merge in, or whether `Relay`-level call sites should wrap the wait in
`mergeWith(this.watchTower)` explicitly (mirroring the removed `waitForAuth()` wrapper's own trick,
scoped only to the wait, not as a pre-block).
