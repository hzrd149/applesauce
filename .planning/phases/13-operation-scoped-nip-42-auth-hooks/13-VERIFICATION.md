---
phase: 13-operation-scoped-nip-42-auth-hooks
verified: 2026-08-06T12:01:27Z
status: gaps_found
score: 6/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "RAUTH-03: After the handler resolves, the operation waits for waitForAuth to be satisfied and retries, bounded by authRetries (default 1)"
    status: failed
    reason: >
      Bounding is broken on req()/request()/subscription() and on count() under a synchronously-resolving
      auth phase. Empirically reproduced by this verifier independently of 13-REVIEW.md's own repro:
      (1) req() against a relay that always answers auth-required with default authRetries:1 produced 11
      REQ frames / 10 onAuthRequired invocations / no error (expected 2 frames / 1 invocation /
      AuthRequiredError) — the root cause is auth-retry.ts:286-289's D-08 reset tap firing on req()'s
      synthetic OPEN control message (relay.ts ~905), which the operator cannot distinguish from real
      progress; (2) req() with waitForAuth:[] (already-satisfied) and a synchronous onAuthRequired handler
      produced 1 REQ frame, 1 handler call, and a silent complete with 0 events — the resend is dropped
      entirely because req()'s share()'d observable is still connected when the operator resubscribes
      synchronously from inside the current CLOSED dispatch; (3) the same scenario against count() sent 2
      COUNT frames + 2 CLOSE frames and completed with 0 values — the resend goes out on the wire into a
      listen stream that is already tearing down, so a real COUNT reply sent 50ms later is never observed.
      13-05-SUMMARY.md documents that this exact reentrancy bug class was found and fixed for event() only
      ("count()'s existing unshared-control/shared-listen split does not have this bug... Fixed by
      splitting event() the same way") — the fix was never carried to req()/count(), and no REQ-side or
      COUNT-side equivalent of the EVENT path's T-13-01 non-vacuity test (relay.test.ts:937) exists to
      catch it.
    artifacts:
      - path: "packages/relay/src/operators/auth-retry.ts"
        issue: "Lines 286-289: consecutive counter reset tap treats any non-signal value as progress, with no way for a call site to say 'this value is not real progress' (D-08 as implemented can't distinguish req()'s bookkeeping OPEN from an actual server response)"
      - path: "packages/relay/src/relay.ts"
        issue: "req() (~845-953): the send-side control is inside the same share()'d observable as the listen side, so a synchronous auth-phase resubscribe rejoins the still-connected share() instead of re-running the REQ send; also emits an OPEN value on every resubscribe that resets the retry counter"
      - path: "packages/relay/src/relay.ts"
        issue: "count() (~956-1034): send/listen are split (defer sends, then returns messages) but messages completes inclusively on the auth-required signal, so a synchronous resubscribe's new COUNT send joins the old, already-terminating shared messages stream instead of a fresh one"
    missing:
      - "A predicate (e.g. isProgress) threaded from req() into authRetry so OPEN does not reset the consecutive counter, plus a REQ-side non-vacuity test mirroring T-13-01 (persistently-auth-requiring relay -> exactly authRetries+1 REQ frames -> AuthRequiredError)"
      - "req()'s 13-05-style send/listen split (or an async resubscribe boundary in the operator) so a synchronous auth phase does not silently drop the resend, plus a regression test with a synchronous handler"
      - "count()'s messages stream restructured so a synchronous resubscribe gets its own live listen chain instead of joining the outgoing one, plus a regression test with a synchronous handler"
  - truth: "RAUTH-07: The behavior is available on req, request, subscription, count, publish, event, sync, and negentropy, and passes through RelayPool and RelayGroup"
    status: failed
    reason: >
      The phase's stated goal is that operation-scoped auth-required handling is a property of ONE shared
      operator, correctly available on all eight operations, rather than four independent implementations
      that happen to agree. Options ARE structurally threaded to all eight operations and through
      RelayPool/RelayGroup (pool.test.ts/group.test.ts assert call-argument pass-through and this part is
      genuine). But the underlying behavior the shared operator is supposed to guarantee — bounded retry,
      correct resend — does not actually hold on req(), request(), subscription(), or count() (see the
      RAUTH-03 gap above), which is 4 of the 8 operations. Because RelayGroup.request()/RelayPool wrap
      relay.req() directly, and SyncLoader's paginated path wraps relay.request(), the defect propagates to
      every consumer of the read path, not just single-relay callers. The existing RAUTH-07 test coverage
      (pool.test.ts, group.test.ts) only asserts that options are forwarded as call arguments to a mocked
      relay method — it does not exercise the real Relay's retry/resend behavior, so it cannot catch this
      class of gap.
    artifacts:
      - path: "packages/relay/src/relay.ts"
        issue: "req()/count() do not carry the shared operator's guarantees correctly (see RAUTH-03 gap)"
      - path: "packages/relay/src/group.ts"
        issue: "RelayGroup.request() (~243-269) additionally never threads an AuthPhaseGate into relay.req() and keeps a bare timeout({first}) instead of suspendableTimeout — the D-15 operation-clock-suspension property this phase advertises is absent on the group's most-used read API (WR-02), and is currently masked by a separate pre-existing defect (WR-01: Relay.request()'s own suspendableTimeout clock can never fire because req()'s OPEN satisfies its first-emission gate — reproduced independently by this verifier: request(filters,{timeout:200}) against a silent relay neither errors nor completes after 400ms)"
    missing:
      - "Fix the RAUTH-03 gaps in req()/count() (they are prerequisites for RAUTH-07 to hold)"
      - "Thread AuthPhaseGate from RelayGroup.request() into relay.req() and use suspendableTimeout, per WR-02"
      - "Give suspendableTimeout (or req()'s OPEN emission) a way to not count OPEN as a first emission, per WR-01, so the D-15 clock-suspension tests are non-vacuous"
  - truth: "RAUTH-08: SyncLoader threads onAuthRequired, authTimeout, and authRetries into both the negentropy sync path and the paginated request path"
    status: failed
    reason: >
      The threading itself is genuine and tested (sync-loader.test.ts asserts call-argument pass-through
      to both request() and sync()). Two behavioral gaps remain: (1) the paginated request path threads
      into relay.request(), which inherits req()'s RAUTH-03 defects (unbounded retries under a
      persistently-auth-requiring relay, dropped resends under a synchronous handler) — SyncLoader gets no
      benefit from authRetries bounding on that path; (2) D-16's "an auth-required failure on the
      negentropy path must not trigger the paginated fallback" guard (sync-loader.ts:592-608) is keyed on
      `RELAY_AUTH_ERROR_NAMES.has(error.name)` (sync-loader.ts:89, only "AuthRequiredError"/
      "AuthHandlerError"/"AuthTimeoutError"). A synchronously-throwing onAuthRequired handler (CR-04)
      escapes auth-retry.ts's error mapping and surfaces as a plain Error with .name === "Error" —
      confirmed by this verifier: relay.publish(event, {onAuthRequired: () => {throw new Error(...)}})
      rejects with a raw Error (not AuthHandlerError) and, en route, causes a second EVENT frame to be sent
      because the raw error is not a RelayClosedError so customRetryOperator's D-07 skip does not fire. The
      same escaped-Error shape reaching sync-loader.ts:601's check would NOT match RELAY_AUTH_ERROR_NAMES,
      so the negentropy path would fall back to the paginated request against the same auth wall — exactly
      what D-16 says must not happen.
    artifacts:
      - path: "packages/relay/src/operators/auth-retry.ts"
        issue: "Lines 242-258: config.onAuthRequired?.(context) is invoked inside the defer factory, above the catchError that maps rejections to AuthHandlerError — a synchronous throw is never routed through that mapping"
      - path: "packages/loaders/src/loaders/sync-loader.ts"
        issue: "Line 89: RELAY_AUTH_ERROR_NAMES only recognizes the three properly-mapped class names, so it silently under-matches when the upstream escape hatch (auth-retry.ts CR-04) leaks a raw Error"
    missing:
      - "Move the onAuthRequired invocation under try/catch (or under the existing catchError) in auth-retry.ts so a synchronous throw is mapped to AuthHandlerError identically to a promise rejection, closing CR-04 at the source"
      - "A regression test in auth-retry.test.ts using a vi.fn(() => { throw ... }) handler (the suite currently only covers mockRejectedValue)"
      - "A REQ-path-equivalent bound test for SyncLoader's paginated fallback once RAUTH-03 is fixed upstream"
human_verification: []
---

# Phase 13: Operation-Scoped NIP-42 Auth Hooks Verification Report

**Phase Goal:** Operation-Scoped NIP-42 Auth Hooks — make auth-required handling a property of ONE shared
operator available on all eight relay operations, rather than several independent implementations.
**Verified:** 2026-08-06T12:01:27Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Critical Input Disposition

A code review (`13-REVIEW.md`, committed at `6fe1b8b5`) reported 4 Critical findings reproduced against the
real `Relay` with `vitest-websocket-mock`. This verifier independently re-derived and re-ran all four
reproductions from scratch (new probe files, deleted after use; working tree left clean — confirmed via
`git status --short`), plus one of the two Warnings, rather than trusting the review's narration or
SUMMARY.md's "Phase 13 is complete" claim. All four are **confirmed live defects**, not false positives.

| # | Claim | My independent repro | Verdict |
|---|-------|----------------------|---------|
| CR-01 | `req()` auth retries are unbounded — OPEN resets the D-08 counter | `relay.req()` vs. a persistently-auth-requiring relay, default `authRetries:1`: **11 REQ frames, 10 handler invocations, no error** (expected 2 frames / 1 invocation / `AuthRequiredError`) | **LIVE DEFECT** |
| CR-02 | `req()` drops the resend under a synchronous auth phase | `waitForAuth:[]` + sync handler: **1 REQ frame, 1 handler call, complete=true, 0 events, no error** | **LIVE DEFECT** |
| CR-03 | `count()` resends into a dead listen stream under a synchronous auth phase | Same setup + a real COUNT reply sent 50ms later: **`["COUNT","COUNT","CLOSE","CLOSE"]`, complete=true, 0 values** — the real reply is never observed | **LIVE DEFECT** |
| CR-04 | A synchronously-throwing `onAuthRequired` escapes `AuthHandlerError` mapping | `relay.publish(event, {onAuthRequired: () => {throw ...}})`: result is a plain **`Error`** (`instanceof AuthHandlerError === false`), message `"Timeout has occurred"`, and **2 EVENT frames** were sent (the raw error isn't a `RelayClosedError`, so `customRetryOperator`'s D-07 skip never fires) | **LIVE DEFECT** |
| WR-01 | `Relay.request()`'s operation clock can never fire (OPEN satisfies the first-emission gate) | `relay.request(filters, {timeout:200})` vs. a silent relay: **no error, no completion after 400ms** | **LIVE DEFECT (Warning-tier, confirmed)** |

The mechanism behind CR-01 was also confirmed by reading `auth-retry.test.ts:118-134`
("resets the consecutive counter after a real value") — the operator does exactly what its own unit tests
say it should: treat any non-signal value as progress. The bug is entirely a call-site integration gap —
`req()`'s synthetic `OPEN` bookkeeping value has no way to identify itself as "not real progress" to the
shared operator. `13-05-SUMMARY.md` independently documents that the identical reentrancy-under-synchronous-handler
bug class (CR-02/CR-03) was found and fixed for `event()` only, and was never carried to `req()`/`count()`
— corroborating the review's framing that the shared-operator design is sound in isolation but its
guarantees did not survive conversion of all four call sites.

**Verdict on the requirements the human asked to be re-judged, against actual behavior (not plan text, not
13-07's checkmarks):**

- **RAUTH-02** — VERIFIED. The cross-operation "no pre-block" guarantee is intact and is not implicated by
  CR-01..04 — those are single-operation retry/resend/error-mapping bugs, not a reintroduction of
  cross-operation blocking. The existing RAUTH-02 tests (fresh publish/REQ sent immediately after an
  unrelated earlier auth failure) exercise a genuinely different code path than the one the CRs break.
- **RAUTH-03** — **FAILED.** See gap above. Not satisfied end-to-end on `req()`/`request()`/`subscription()`/`count()`.
- **RAUTH-05** — VERIFIED for its literal text (two concurrent operations each call their own handler
  independently, no relay-internal dedupe — well covered by real tests in `relay.test.ts` and
  `group.test.ts`, unaffected by CR-01..04). CR-04 is a real, confirmed defect, but it is a *distinct*
  contract (D-17's error-class mapping / D-07's retry-skip) — it does not cause one operation's handler
  failure to affect another *concurrent* operation, which is what RAUTH-05 specifically promises. It is
  recorded under RAUTH-08 below, where its consequence is concrete and testable (D-16's fallback guard).
- **RAUTH-07** — **FAILED.** See gap above. "The behavior is available on all eight operations" is false
  for `req`/`request`/`subscription`/`count` — 4 of 8 — even though the *options* are structurally present
  everywhere.
- **RAUTH-08** — **FAILED.** See gap above. Threading is genuine; the behavior it threads into is broken on
  the paginated path (inherits RAUTH-03's defects) and D-16's negentropy no-fallback guard is bypassable
  via CR-04's unmapped error.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | RAUTH-01: Handler receives operation-local context (relay, url, challenge, operation, requirement, missingPubkeys, reason) when that operation receives auth-required | ✓ VERIFIED | `buildAuthContext` (relay.ts:754-764) assembles all seven fields; `relay.test.ts` asserts the exact object shape on invocation (e.g. line ~1140-1148 range for publish) |
| 2 | RAUTH-02: An operation not itself auth-required is never pre-blocked by an earlier unrelated operation | ✓ VERIFIED | Ambient `waitForAuth()` pre-block deleted at all four sites; `relay.test.ts` "a fresh publish sends its EVENT frame immediately... even after an earlier publish already received auth-required" and the REQ/negentropy equivalents pass; not implicated by the CRs |
| 3 | RAUTH-03: After the handler resolves, the operation waits and retries, bounded by authRetries (default 1) | ✗ FAILED | CR-01/CR-02/CR-03 — see gap; confirmed live by independent reproduction |
| 4 | RAUTH-04: authTimeout bounds the wait (default 30_000ms); false waits indefinitely | ✓ VERIFIED | Per-phase timeout is independent of the retry-count bug (my CR-01 repro used `authTimeout:500` and no individual phase ever exceeded it — the defect is specifically the retry-count budget, not the timeout budget); `relay.test.ts` RAUTH-04 tests for req/publish pass and are not touched by the CRs |
| 5 | RAUTH-05: Handler rejection/timeout rejects only its own operation; concurrent operations independent, no dedupe | ✓ VERIFIED | `relay.test.ts`/`group.test.ts` concurrent-handler tests pass; CR-04 (see below) is a real defect but of a different, non-overlapping guarantee (error-class mapping), not cross-operation independence |
| 6 | RAUTH-06: waitForAuth:false → immediate AuthRequiredError, no handler call; event(...,"AUTH") never invokes it | ✓ VERIFIED | Short-circuits in relay.ts:1089 and auth-retry.ts:234 (documented as duplicated in IN-01, but both agree); tests pass |
| 7 | RAUTH-07: Behavior available on all 8 operations, passes through RelayPool/RelayGroup | ✗ FAILED | Options are threaded everywhere (structural), but the shared operator's actual guarantees are broken on 4/8 sites (req/request/subscription/count) and propagate through RelayGroup/RelayPool, which wrap relay.req()/request() directly; WR-02 additionally confirms RelayGroup.request() never threads the D-15 gate |
| 8 | RAUTH-08: SyncLoader threads onAuthRequired/authTimeout/authRetries into negentropy and paginated paths | ✗ FAILED | Threading confirmed genuine; paginated path inherits req()'s RAUTH-03 defects, and D-16's fallback guard is bypassable via CR-04's unmapped error (confirmed by code read of sync-loader.ts:89,601) |
| 9 | RAUTH-09: authRequiredForRead$/authRequiredForPublish$ keep updating as informational status | ✓ VERIFIED | `receivedAuthRequiredForReq`/`receivedAuthRequiredForEvent` still flip on every CLOSED/OK auth-required regardless of retry outcome (relay.ts:877-878, 1073-1076); RAUTH-09 tests pass, unaffected by the CRs; Concord smoke suite (559/559, per 13-VALIDATION.md) still reads them successfully |

**Score:** 6/9 truths verified (3 present-but-broken: RAUTH-03, RAUTH-07, RAUTH-08)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/relay/src/operators/auth-retry.ts` | Shared D-04 operator: handler invocation, retry counting, error mapping, gate suspension | ⚠️ SUBSTANTIVE BUT DEFECTIVE | Exists, exports match D-04 (`authRetry`/`AuthPhaseGate`/`suspendableTimeout`/`AUTH_PHASE_GATE`), its own unit tests pass — but two of its documented guarantees do not hold in integration: the D-08 reset tap can't distinguish "real progress" from a call site's bookkeeping value (CR-01), and the handler invocation at lines 242-258 is not under the `catchError` for synchronous throws (CR-04) |
| `packages/relay/src/relay.ts` (req/count/event/negentropy sites) | Four sites each normalize the auth-required signal and delegate to the shared operator (D-02) | ⚠️ WIRED BUT BUGGY | All four sites call `authRetryOperator`; `event()`/`negentropy()`/`sync()` behave correctly (13-05/13-06 fixed the reentrancy class for event()); `req()`/`count()` still have the reentrancy bug 13-05's own SUMMARY documents as event()-only-fixed (CR-02/CR-03), and `req()`'s OPEN emission defeats CR-01's retry bound |
| `packages/relay/src/group.ts` | RelayGroup pass-through + D-15 gate threading on request() | ⚠️ PARTIAL | `publish`/`subscription`/`sync`/`count` forward options correctly (RAUTH-07/RAUTH-05/D-18/D-19 tests pass); `request()` (line ~243) never threads an `AuthPhaseGate` into `relay.req()` and keeps a bare `timeout({first})` (WR-02) |
| `packages/relay/src/pool.ts` | RelayPool pass-through of all four options | ✓ VERIFIED (structural) | `pool.test.ts` asserts call-argument forwarding to all relay methods; inherits the same underlying relay.ts defects as any other caller |
| `packages/loaders/src/loaders/sync-loader.ts` | Threads onAuthRequired/authTimeout/authRetries into negentropy + paginated paths; D-16 stall-guard suspension and no-fallback-on-auth guard | ⚠️ PARTIAL | Threading (`relayMethodOptions`) genuine and tested; `RELAY_AUTH_ERROR_NAMES` (line 89) is a closed set that under-matches when auth-retry.ts leaks an unmapped error (CR-04 knock-on), defeating the D-16 fallback guard for that case |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `Relay.req()` | `operators/auth-retry.ts::authRetry` | `this.authRetryOperator("read", opts, gate)` (relay.ts:945) | ⚠️ WIRED BUT BUGGY | Connected correctly, but the OPEN value flowing back through this link defeats the retry bound (CR-01) and the reentrancy timing drops resends (CR-02) |
| `Relay.count()` | `operators/auth-retry.ts::authRetry` | `authOperator` (relay.ts:1020-1024) | ⚠️ WIRED BUT BUGGY | Connected correctly; reentrancy timing sends into a dying stream under a synchronous handler (CR-03) |
| `Relay.event()`/`publish()` | `operators/auth-retry.ts::authRetry` | `authRetryOperator("write"/"publish", ...)` | ✓ WIRED | Correct — 13-05 fixed the reentrancy class here; T-13-01 non-vacuity test passes |
| `Relay.negentropy()`/`sync()` | `operators/auth-retry.ts::authRetry` | via `NegentropyError` translation (D-02) | ✓ WIRED | Correct, per 13-06 |
| `RelayGroup.request()` | `Relay.req()` | `relay.req(filters, {...opts, reconnect})` | ⚠️ PARTIAL | Forwards `onAuthRequired`/`authTimeout`/`authRetries` (so the *handler* auth phase inside `relay.req()` still runs), but does not thread `AUTH_PHASE_GATE`, so `RelayGroup.request()`'s own operation clock is not suspended (WR-02) |
| `SyncLoader` | `relay.request()` / `relay.sync()` | `relayMethodOptions` (sync-loader.ts ~270) | ⚠️ WIRED BUT INHERITS DEFECTS | Correctly forwards all three options to both paths; paginated path inherits `req()`'s RAUTH-03 defects |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| req() bounded retry against a persistently-auth-requiring relay | scratch probe (`vitest-websocket-mock`, deleted after use) | 11 REQ frames / 10 handler calls / no error, expected 2/1/AuthRequiredError | ✗ FAIL |
| req() resend under synchronous auth phase | scratch probe | 1 REQ frame, complete=true, 0 events | ✗ FAIL |
| count() resend under synchronous auth phase | scratch probe | 2 COUNT + 2 CLOSE frames, complete=true, 0 values, real reply never observed | ✗ FAIL |
| publish() with a synchronously-throwing handler maps to AuthHandlerError | scratch probe | plain `Error`, not `AuthHandlerError`; 2 EVENT frames sent | ✗ FAIL |
| request() clock fires against a silent relay | scratch probe | no error, no completion after 400ms (timeout was 200ms) | ✗ FAIL (Warning-tier, WR-01) |
| Full workspace test suite (`applesauce-relay`, `applesauce-loaders`) | `pnpm --filter applesauce-relay test` / `pnpm --filter applesauce-loaders test` | 231/231, 118/118 green (per 13-VALIDATION.md, not re-run in full here — no new evidence from re-running a suite that doesn't cover these paths) | N/A — confirms the review's core claim: these paths are untested, not that they work |

All five scratch probe files were written under `packages/relay/src/__tests__/probe-*.test.ts`, run individually via `pnpm vitest run <path>`, and deleted immediately after. `git status --short` confirmed a clean working tree afterward.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RAUTH-01 | 13-01, 13-02 | Operation-local handler context | ✓ SATISFIED | See truth #1 |
| RAUTH-02 | 13-02, 13-04, 13-05, 13-06 | No pre-block by unrelated operation | ✓ SATISFIED | See truth #2 |
| RAUTH-03 | 13-01, 13-02, 13-04, 13-05, 13-06 | Retry bounded by authRetries | ✗ BLOCKED | CR-01/CR-02/CR-03 |
| RAUTH-04 | 13-01, 13-02, 13-05, 13-06 | authTimeout bounds the wait | ✓ SATISFIED | See truth #4 |
| RAUTH-05 | 13-02, 13-07 | Concurrent independence, no dedupe | ✓ SATISFIED | See truth #5 (CR-04 recorded under RAUTH-08 instead) |
| RAUTH-06 | 13-01, 13-02, 13-06 | waitForAuth:false / AUTH short-circuit | ✓ SATISFIED | See truth #6 |
| RAUTH-07 | 13-01, 13-02, 13-05, 13-06, 13-07 | Available on all 8 ops, through Pool/Group | ✗ BLOCKED | 4/8 operations broken; WR-02 group gap |
| RAUTH-08 | 13-03 | SyncLoader threads options into both paths | ✗ BLOCKED | Threading genuine, behavior broken (inherits RAUTH-03; D-16 guard bypassable) |
| RAUTH-09 | 13-02, 13-07 | Informational status flags | ✓ SATISFIED | See truth #9 |

No orphaned requirements — all nine RAUTH-01..09 IDs appear in at least one plan's `requirements:` frontmatter and are cross-referenced above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/relay/src/group.ts` | 334 | `console.debug` instead of the package's `debug`-logger convention (WR-06) | ℹ️ Info | Cosmetic/consistency, not functional |
| — | — | No `TBD`/`FIXME`/`XXX` markers found in any phase-modified file | — | — |

No debt-marker gate violations.

### Human Verification Required

None — all findings above were confirmed programmatically (code reading plus independent runtime reproduction against the real `Relay`/`vitest-websocket-mock`), not deferred to a human tester.

### Gaps Summary

The shared-operator architecture (D-04) is real and its own isolated unit tests (`auth-retry.test.ts`) are
correct — the operator does exactly what its contract says. The gap is entirely in the integration at the
four call sites converted across plans 13-02/13-04/13-05/13-06: `event()`/`publish()` (13-05) and
`sync()`/`negentropy()` (13-06) got it right, including a reentrancy fix 13-05 discovered and applied to
`event()` alone. `req()` (13-02) and `count()` (13-04) — planned and executed *before* 13-05 found that bug
class — never received the equivalent fix, and `req()` additionally has its own distinct defect (an OPEN
bookkeeping value that defeats the D-08 retry-counter reset). None of this is caught by the existing test
suite (274 files / 2563 tests, 0 failures) because, as the review states, there is no REQ-side or COUNT-side
equivalent of the EVENT path's T-13-01 non-vacuity test — a persistently-auth-requiring relay was never
exercised against `req()`/`count()`, and a synchronously-resolving auth phase was never exercised against
either. A fourth, independent defect (CR-04: synchronous throws in `onAuthRequired` escape the operator's
error mapping) breaks the D-17 error-class contract and has a concrete, confirmed downstream consequence in
`applesauce-loaders`' D-16 fallback guard.

REQUIREMENTS.md currently marks all of RAUTH-01..09 as Complete based on 13-07's own validation pass, which
only ran the existing (gap-blind) test suite. Three of nine — RAUTH-03, RAUTH-07, RAUTH-08 — are not
genuinely satisfied end-to-end and should be reopened. RAUTH-02 and RAUTH-05, despite being named in the
review's affected-requirements list, remain independently verified against their literal text; the review's
own findings that touch them (CR-02/CR-03 for the "operation waits and retries" behavior, CR-04 for handler
error mapping) are more precisely gaps in RAUTH-03 and RAUTH-08 respectively, and are recorded there to
avoid double-counting the same defect under multiple requirement IDs.

---

_Verified: 2026-08-06T12:01:27Z_
_Verifier: Claude (gsd-verifier)_
