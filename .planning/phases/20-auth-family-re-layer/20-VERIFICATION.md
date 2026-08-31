---
phase: 20-auth-family-re-layer
verified: 2026-08-31T16:53:03Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 20: AUTH Family Re-layer Verification Report

**Phase Goal:** `authenticate()` owns bounded challenge acquisition and freshness, retries a challenge that moves under a slow signer, and keeps terminal auth classifiers aligned downstream.
**Verified:** 2026-08-31T16:53:03Z
**Status:** passed
**Re-verification:** No — initial verification after code-review fixes

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | A fresh `authenticate()` waits for a challenge under a bounded whole-operation clock. | ✓ VERIFIED | `relay.ts:1484-1567`; real-socket tests `waits for a challenge and rejects at the whole-operation deadline`, `connects from fresh state...`, and `applies one deadline across signer latency` pass. |
| 2 | A challenge changed during signing discards the stale candidate and re-signs within the explicit retry budget. | ✓ VERIFIED | Freshness comparison precedes `authExchange` at `relay.ts:1551-1558`; stale-re-sign and exact-exhaustion tests pass and assert no stale AUTH frame. |
| 3 | All `authenticate()` failures are Promise rejections with await/`.catch()` parity. | ✓ VERIFIED | The public method immediately returns an async invocation; tests cover option validation, no-challenge timeout, signer identity, freshness exhaustion, abort, raw reply timeout, and transport lifecycle. |
| 4 | `auth()` emits one fixed AUTH frame through the shared raw exchange and never enters publish policy. | ✓ VERIFIED | `eventExchange(event, "AUTH")` is reached only through `authExchange`; `auth()` contains no `event()`/`publish()` call. Real-wire routing tests and the compile fixture pass. |
| 5 | Relay Group and loaders recognize every terminal authenticate error by pinned name. | ✓ VERIFIED | Both classifier sets include the five names; focused tests instantiate the real new relay errors and pass, with non-auth controls retained. |
| 6 | The outer timeout and abort cancel an AUTH already written and suppress late state mutation. | ✓ VERIFIED | `cancel$` is applied before and inside the queued raw exchange; both post-write abort and post-write timeout tests pass and assert keyed/deprecated state remains unset after late OK. |
| 7 | Duplicate deterministic AUTH IDs remain distinct logical calls with newest-attempt bookkeeping. | ✓ VERIFIED | Per-call Symbols guard state and `authEventQueues` serializes equal IDs. The adversarial real-WebSocket test passes with equal IDs, opposite verdicts, two frames, distinct Promise results, and both mirrors newest-only. |
| 8 | Public numeric options reject invalid policies before connection work and define zero semantics. | ✓ VERIFIED | Finite/non-negative/integer validation at `relay.ts:1487-1498`; table tests cover negative, fractional, NaN, Infinity, zero timeout, and zero retries. |
| 9 | Authentication lifecycle logging is stage-complete and redacts/bounds sensitive values. | ✓ VERIFIED | Dedicated lifecycle logging suite passes within the 356-test relay run; it covers challenge, signer, send, verdict, timeout, abort, and bounded messages. |
| 10 | Vertex consumes auto-auth rejection and resets its in-flight guard; Concord preserves verdict/rejection semantics. | ✓ VERIFIED | Vertex catches and reports rejection before `finally`; focused rejection/reset test passes. Concord's complete 602-test suite and build pass against the new Promise surface. |
| 11 | Production loaders stay structurally coupled without a relay runtime dependency. | ✓ VERIFIED | `sync-loader.ts` keeps a structural relay interface and `.name` set; actual relay classes occur only in tests. Loader package test/build pass. |
| 12 | Docs and provenance accurately describe high-level/manual AUTH and the Phase 18 selector supersession. | ✓ VERIFIED | Relay docs describe the whole deadline, retries, AbortSignal, fixed verbs, and manual `auth()`; Phase 18 context has a dated `Phase 20 amendment`. Docs build passes. |
| 13 | The source break has one valid focused major changeset and all phase gates pass. | ✓ VERIFIED | Changeset targets only `applesauce-relay`, bump `major`, with exactly one Markdown sentence. Type fixture, four package suites/builds, and docs build all pass. |

**Score:** 13/13 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/relay.ts` | Fixed raw routing plus high-level AUTH policy | ✓ VERIFIED | Substantive, exported through existing Relay surface, exercised by real WebSocket tests. |
| `packages/relay/src/types.ts` | `RelayAuthenticateOptions` | ✓ VERIFIED | Exported type matches implementation and docs. |
| `packages/relay/type-tests/event-auth-types.ts` | Public selector-removal proof | ✓ VERIFIED | Positive fixed calls plus `@ts-expect-error` negative call; compiler gate passes. |
| `packages/relay/src/__tests__/relay.test.ts` | AUTH policy and review-regression matrix | ✓ VERIFIED | 204 tests in file; relevant behavior tests pass independently and in suite. |
| `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | Logging/redaction proof | ✓ VERIFIED | Included in green relay suite. |
| `packages/relay/src/group.ts` | Terminal auth classifier parity | ✓ VERIFIED | Actual-error focused tests pass. |
| `packages/loaders/src/loaders/sync-loader.ts` | Dependency-free terminal classifier | ✓ VERIFIED | Actual-error tests pass; no production relay import. |
| `packages/extra/src/vertex.ts` | Safe challenge-driven auto-auth | ✓ VERIFIED | Rejection consumed; guard reset test passes. |
| `apps/docs/loading/relays/relays.md` | Current API guidance | ✓ VERIFIED | Matches declarations and builds in VitePress. |
| `.changeset/relay-auth-family-re-layer.md` | Focused release metadata | ✓ VERIFIED | One package, major bump, one sentence. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `authenticate()` | challenge/socket | `challenge$` merged with `watchTower` | WIRED | Fresh call activates connection and waits for non-null challenge. |
| `authenticate()` | `authExchange()` | fresh candidate after abort/deadline/freshness checks | WIRED | No stale candidate reaches wire. |
| `authExchange()` | `eventExchange()` | fixed `"AUTH"` discriminator | WIRED | Shared readiness/listener/reply mechanics, separate family policy. |
| relay errors | Group/loaders | pinned `.name` parity | WIRED | Real-instance tests pass in both consumers. |
| Vertex challenge | `authenticate(this.signer)` | guarded subscription with caught rejection | WIRED | Success and rejection/reset tests pass. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| Relay authentication mirrors | attempt token, AUTH event/result | relay challenge, signer, matching socket OK | Yes | ✓ FLOWING |
| Loader relay status | terminal error | injected sync/request observable | Yes | ✓ FLOWING |
| Vertex auto-auth guard | challenge/authenticated state | live BehaviorSubjects and returned Promise | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Cancellation, deadline, freshness, duplicate-ID isolation | focused `relay.test.ts` run with four named patterns | 4 passed | ✓ PASS |
| Loader recognizes actual new error instances | focused `sync-loader.test.ts` run | 2 passed | ✓ PASS |
| Group recognizes actual new error instances | focused `group.test.ts` run | 2 passed | ✓ PASS |
| Vertex consumes rejection/reset guard | focused `vertex.test.ts` run | 1 passed | ✓ PASS |

### Probe Execution

No Phase 20 probe scripts are declared or present; behavioral real-wire and compiler fixtures are the phase's executable probes.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| AUTHF-01 | 20-02, 20-04 | ✓ SATISFIED | Fresh challenge acquisition and whole deadline tests. |
| AUTHF-02 | 20-02, 20-04 | ✓ SATISFIED | Slow-signer freshness retry and exhaustion tests. |
| AUTHF-03 | 20-02, 20-03, 20-04 | ✓ SATISFIED | Rejection identity/cancellation/error-path tests and consumer suites. |
| AUTHF-04 | 20-01, 20-04 | ✓ SATISFIED | Fixed routing, private exchange, runtime and compile proofs. |
| AUTHF-05 | 20-03, 20-04 | ✓ SATISFIED | Group/loader name parity with real exported error instances. |

No Phase 20 requirements are orphaned.

### Anti-Patterns Found

No unreferenced `TBD`, `FIXME`, or `XXX`, placeholders, empty implementations, hardcoded user-visible data, or console-only handlers were found in the Phase 20 production/docs/changeset files. The docs build emits only its pre-existing large-chunk warning.

### Full Gate Evidence

- Relay type fixture: passed.
- `applesauce-relay`: 12 files, 356 tests passed; build passed.
- `applesauce-loaders`: 16 files, 128 tests passed; build passed.
- `applesauce-concord`: 55 files, 602 tests passed; build passed.
- `applesauce-extra`: 1 file, 2 tests passed; build passed.
- VitePress docs: client/server build and page rendering passed.

### Disconfirmation Pass

- Partial-requirement search: the earlier review's three blockers and two warnings are now backed by direct regression tests; no remaining partial must-have was observed.
- Misleading-test search: the former duplicate-ID and pre-write-only cancellation coverage was replaced by opposite-verdict and post-write cases; these fail at the previously broken boundaries rather than merely counting calls.
- Uncovered-error-path search: invalid option inputs, no challenge, signer rejection, freshness exhaustion, raw reply timeout, post-write abort/timeout, negative relay verdict, and Vertex rejection are exercised. No goal-critical untested error path was found.

### Human Verification Required

None. The concurrency/cancellation state transitions that previously warranted concern are exercised by deterministic real-WebSocket tests, so CR-02 does not require a human-only check.

### Gaps Summary

No blocking gaps. `20-VALIDATION.md` still describes its pre-execution checklist as draft/pending, but this stale planning metadata does not contradict the executed code/test evidence or phase goal.

---

_Verified: 2026-08-31T16:53:03Z_
_Verifier: the agent (gsd-verifier)_
