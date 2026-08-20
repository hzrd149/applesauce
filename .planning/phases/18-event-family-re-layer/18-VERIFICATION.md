---
phase: 18-event-family-re-layer
verified: 2026-08-20T16:24:00Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 12/13
  gaps_closed:
    - "publish() now retries only RelayEventTimeoutError and explicitly reconnectable unclean transport closes; arbitrary errors reject after one EVENT frame"
  gaps_remaining: []
  regressions: []
---

# Phase 18: EVENT Family Re-layer Verification Report

**Phase Goal:** `event()` becomes exactly one EVENT write and one reply; `publish()` becomes the sole owner of the retry, auth, and timeout policy around it.
**Verified:** 2026-08-20T16:24:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure in `95c2531b`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | A direct `event()` subscription is one readiness-aware EVENT/AUTH interaction with one write and no auth/resend policy. | ✓ VERIFIED | `Relay.event()` builds one deferred listener/write at `packages/relay/src/relay.ts:1204`; real-wire tests assert one raw attempt and readiness behavior. |
| 2 | EVENT auth-required replies throw `AuthRequiredError`; AUTH and ordinary EVENT verdicts remain values. | ✓ VERIFIED | Verb-gated translation at `relay.ts:1218`; tests `performs one raw EVENT attempt...`, `keeps an ordinary relay rejection...`, and RAUTH-06 pass. |
| 3 | A written attempt times out with a typed client error, while readiness delay and clean close do not fabricate a response. | ✓ VERIFIED | `RelayEventTimeoutError` at `relay.ts:171` and per-attempt timeout at `relay.ts:1229`; the focused timeout/readiness/close tests pass in the full suite. |
| 4 | `publish()` owns call-scoped auth, retry/reconnect, and suspendable whole-operation timeout policy. | ✓ VERIFIED | Gate/counter/attempt composition is local to `publish()` at `relay.ts:1535-1559`; `event()` has no option bag. |
| 5 | Auth and transient budgets are additive, and known terminal auth classifications do not consume generic retry. | ✓ VERIFIED | Call-scoped auth counter plus `RelayClosedError` skip; real-wire additive-budget and auth-exhaustion tests pass. |
| 6 | Generic retry admits only explicit transient timeout/reconnectable transport failures. | ✓ VERIFIED | `isRetryablePublishError()` positively admits only `RelayEventTimeoutError` or an unclean close-shaped transport error. The new real-wire arbitrary-error test passes with exactly one EVENT, and a deliberate retry-by-default mutation makes that named test fail. |
| 7 | Synchronous auth handling resends through a fresh attempt and concurrent publish calls have independent state. | ✓ VERIFIED | `defer(() => this.event(event))` creates fresh attempts; synchronous resend and concurrency tests pass. |
| 8 | `RelayGroup.event()` makes one raw attempt per relay and converts failures without adding policy. | ✓ VERIFIED | `group.ts:234-235` delegates to `relay.event(event)` through the aggregation error boundary; group raw/high test passes. |
| 9 | Group/Pool raw event surfaces reject policy options, while publish surfaces accept and forward policy. | ✓ VERIFIED | Narrow signatures in `group.ts:234`, `pool.ts:156`; publish forwarding at `group.ts:260` and `pool.ts:172`; declaration build passes. |
| 10 | `sync()` SEND uses `publish()` and retains auth behavior and settled-result isolation. | ✓ VERIFIED | `relay.ts:1615` awaits `this.publish(event, authOptions)` inside `Promise.allSettled`; RAUTH-08 SEND test passes. |
| 11 | D-01, D-07, RAUTH-07, and source comments truthfully record EVENT ownership and provenance. | ✓ VERIFIED | Phase-18 amendments exist in the v1.2 context and requirements; source citations match the runtime split. |
| 12 | Held changesets truthfully describe auth ownership, timeout rejection, and verdict error semantics. | ✓ VERIFIED | All five inspected changesets contain their mapped wording and target only `applesauce-relay`. |
| 13 | Obsolete EVENT symbol threading/message reconstruction is absent while shared-family machinery remains available elsewhere. | ✓ VERIFIED | Region-scoped searches found no `AUTH_PHASE_GATE`, `WithAuthPhaseGate`, `AuthRequiredSignal`, or message-prefix reconstruction in EVENT/publish regions. |

**Score:** 13/13 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/relay.ts` | Raw EVENT implementation and high-level publish policy | ✓ VERIFIED | Substantive and wired; the positive retry whitelist is consumed by `customRetryOperator()`, which is applied by `publish()`. |
| `packages/relay/src/types.ts` | Narrow event surface and typed verdict contract | ✓ VERIFIED | `PublishOptions`, `PublishResponse`, and error classes are wired and declarations build. |
| `packages/relay/src/operators/auth-retry.ts` | Shared auth machinery without EVENT gate threading | ✓ VERIFIED | `publish()` consumes it locally; EVENT region has no shared-symbol threading. |
| `packages/relay/src/group.ts` | Raw-event/high-level-publish aggregation split | ✓ VERIFIED | Both branches delegate to the correct Relay method. |
| `packages/relay/src/pool.ts` | Narrow forwarded public signatures | ✓ VERIFIED | Event forwards without options; publish forwards options. |
| Relay test files | Real-wire and forwarding regression evidence | ✓ VERIFIED | All 11 relay test files pass, 315 tests total, including arbitrary-error no-resend. |
| Historic decision/requirement files | D-01/D-07/RAUTH-07 provenance | ✓ VERIFIED | Dated Phase 18 amendments present. |
| Five EVENT changesets | One-change truthful release metadata | ✓ VERIFIED | Exact bodies and package scopes inspected. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `relay.ts` | `types.ts` | event signature / `PublishResponse.error` | ✓ WIRED | Manual inspection resolves the plan tool's invalid-regex result. |
| `relay.test.ts` | `relay.ts` | actual WebSocket frames | ✓ WIRED | Tests use mock-socket message assertions and passed. |
| `relay.ts` | `auth-retry.ts` | local `AuthPhaseGate` and typed auth conversion | ✓ WIRED | Imports and active calls present in `publish()`. |
| `group.ts` | `relay.ts` | `relay.event` vs `relay.publish` | ✓ WIRED | Direct delegates at lines 235 and 262. |
| `relay.ts` | `relay.ts` sync SEND | `this.publish(event, authOptions)` | ✓ WIRED | Direct call at line 1615. |
| changesets / provenance | runtime types and behavior | matched wording | ✓ WIRED | Static semantic audit and manual inspection agree. |

### Data-Flow Trace (Level 4)

Not applicable: this phase changes a relay protocol API and policy flow, not a dynamic rendering artifact. Protocol data was instead traced from socket `OK` frames through `event()`, `publish()`, Group, Pool, and sync.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full relay behavioral suite | `pnpm --filter applesauce-relay test` | 11 files, 315 tests passed | ✓ PASS |
| Public declarations compile | `pnpm --filter applesauce-relay build` | `tsc` exit 0 | ✓ PASS |
| EVENT/publish obsolete-symbol absence | region-scoped `sed` + `rg` checks | no forbidden matches | ✓ PASS |
| Arbitrary non-transient failure | named Vitest regression | rejects the original error; exactly one EVENT frame | ✓ PASS |
| Retry-classifier mutation gate | replace positive whitelist guard with retry-by-default guard, run the named regression, then restore | named test failed (timeout), proving the no-resend oracle detects the regression | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — Phase 18 declares no probe script and no conventional relay probe was found.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| EVT-01 | 18-01 | One EVENT write/reply; auth refusal throws | ✓ SATISFIED | Raw implementation plus real-wire tests. |
| EVT-02 | 18-02 | `publish()` owns auth retry | ✓ SATISFIED | Local publish gate/operator/resubscription and tests. |
| EVT-03 | 18-01, 18-02 | Publish timeout is retryable | ✓ SATISFIED | Typed error-channel timeout and retry tests pass. |
| EVT-04 | 18-02, 18-04, 18-05 | Remove EVENT gate/message round-trip | ✓ SATISFIED | Scoped absence audit is clean. |
| EVT-05 | 18-03, 18-04, 18-05 | Restate RAUTH-07 with provenance | ✓ SATISFIED | Dated requirement amendment and narrowed types. |
| EVT-06 | 18-03 | Deliberate Group/sync disposition | ✓ SATISFIED | Group stays raw; sync SEND uses publish; tests pass. |
| RESID-04 | 18-04, 18-05 | Shipped claims match behavior | ✓ SATISFIED | Comments/provenance and exact one-sentence changesets verified. |

No Phase 18 requirement is orphaned: all seven roadmap-mapped IDs appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/relay/src/__tests__/relay.test.ts` | 1208 | Removed third `event()` argument still supplied in a runtime-only test | ⚠️ Warning | The package build excludes tests, so this is not compile-time evidence of the narrowed API; JavaScript silently ignores the extra argument. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers were found in the phase-modified files.

### Human Verification Required

None. The phase behavior is protocol-level and covered by runnable tests; the remaining gap is directly observable in code.

### Gaps Summary

No blocking gaps remain. The previous retry-classification gap is closed by a positive whitelist and a real-wire arbitrary-error no-resend regression. Full relay tests, declaration build, artifact checks, exact method-boundary wiring checks, provenance/changeset audits, and the retry-classifier mutation gate all pass.

---

_Verified: 2026-08-20T16:24:00Z_
_Verifier: the agent (gsd-verifier)_
