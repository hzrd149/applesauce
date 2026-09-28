---
phase: 19-count-becomes-the-high-level-member
verified: 2026-08-21T10:22:11Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 10/10
  gaps_closed:
    - "Clean transport completion before COUNT is now a typed terminal RelayCountResponseError."
    - "Retry, deadline, terminal-error, and concurrent-call behavior now has real-wire regression coverage."
  gaps_remaining: []
  regressions: []
---

# Phase 19: COUNT Becomes the High-Level Member Verification Report

> **Phase 23 D-24 amendment:** Group/Pool aggregation claims are historical and superseded by progressive `RelayOutcome` records. `Relay.count()` remains scalar, HLL utilities remain available, and the outer Observable-of-record topology is preserved.

**Phase Goal:** `count()` gains the same configurable policy every other high-level method has, and its response models what NIP-45 actually defines instead of one field reached by an unchecked cast.
**Verified:** 2026-08-21T10:22:11Z
**Status:** passed
**Re-verification:** Yes — after review fixes `167c3f0c` and `2483f9fa`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Relay, Group, and Pool preserve Observable COUNT APIs and forward caller id/options. | VERIFIED | `Relay.count()` returns `Observable<RelayCountResponse>`; Group/Pool derive and forward the third parameter. Full relay suite includes exact forwarding and Observable assertions. |
| 2 | Valid replies are strict, forward-compatible, fresh, and prototype-safe. | VERIFIED | `parseRelayCountResponse()` validates before copying own enumerable properties with `Object.defineProperty`; NIP-45 and real-wire tests pass. |
| 3 | Malformed replies, refusal, and response-less completion fail through typed terminal errors before emission. | VERIFIED | `RelayCountResponseError`/`RelayClosedError` paths are exercised. Review fix `167c3f0c` plus `2483f9fa` converts clean empty completion and preserves unclean transport errors for retry classification. |
| 4 | HLL merge is a non-mutating lowercase maximum over exactly 256 registers. | VERIFIED | Shared decoder enforces 512 hex characters; independent winner, malformed-member, normalization, and frozen-input tests pass. |
| 5 | HLL estimation matches independent fixed cardinality fixtures. | VERIFIED | Zero/small-range/raw and composed two-relay union fixtures pass in `nip45.test.ts`. |
| 6 | COUNT has one configurable whole-request deadline spanning readiness, retry, reconnect, and backoff. | VERIFIED | Deadline is downstream of retry and readiness in `Relay.count()`; real-wire custom/disabled timeout and expiry-during-backoff tests pass. |
| 7 | Deadline expiry is terminal and typed. | VERIFIED | `suspendableTimeout(... with RelayCountTimeoutError)` is outside generic retry; timeout tests pass without resend. |
| 8 | Only reconnectable unclean transport failures consume generic retry; terminal/application errors do not. | VERIFIED | Positive `isReconnectableTransportError` classifier is wired; resend, `retries:false`, malformed reply, CLOSED, and clean empty-completion regressions pass. |
| 9 | Auth and generic retry state are distinct and call-scoped; concurrent calls and subscribers behave correctly. | VERIFIED | Gate/auth counter are allocated per `count()` call, final `share()` is outside policy; auth, four-subscriber sharing, and independent concurrent retry-budget tests pass. |
| 10 | Public exports, documentation, and release metadata match the shipped contract. | VERIFIED | Root exports include both COUNT errors and HLL helpers but not parser; relay build, VitePress build, export snapshot, guarded pool guidance, and one-sentence changeset pass. |

**Score:** 10/10 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact group | Status | Details |
|---|---|---|
| Runtime (`nip45.ts`, `types.ts`, `relay.ts`) | VERIFIED | All exist, are substantive, compile, and are wired from the COUNT WebSocket boundary through public types. |
| Behavioral tests (`nip45`, `relay`, `group`, `pool`) | VERIFIED | All exist and execute in the full package suite: 12 files, 335 tests passed. |
| Public contract (`index.ts`, docs, changeset) | VERIFIED | Root exports resolve, docs build, and changeset is one package/one sentence/minor. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `relay.ts` | `nip45.ts` | `parseRelayCountResponse` on matching COUNT frames | WIRED | No unchecked response cast remains. |
| `relay.ts` | auth/retry timeout operators | call-scoped gate, positive classifier, outer suspendable deadline | WIRED | Operator order and focused behavioral tests agree. |
| `group.ts` | `Relay.count()` | `combineLatest` with exact id/options | WIRED | Existing all-relay semantics deliberately remain for Phase 23. |
| `pool.ts` | `RelayGroup.count()` | direct delegation | WIRED | Exact option object and id forwarding are tested. |
| package root/docs | NIP-45 helpers and errors | named exports and root imports | WIRED | Export snapshot and docs build passed. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `Relay.count()` | `RelayCountResponse` | matching WebSocket COUNT frame | Yes; parsed and validated before emission | FLOWING |
| `RelayGroup.count()` | per-relay response record | each underlying `Relay.count()` Observable | Yes; `combineLatest` retains validated responses | FLOWING |
| HLL utilities | caller/relay sketch strings | strict shared decoder | Yes; max-merge feeds estimator in composed fixture | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full relay behavior, including review regressions and mutation-sensitive fixtures | `pnpm --filter applesauce-relay test` | 12 files, 335 tests passed | PASS |
| Relay declarations/build | `pnpm --filter applesauce-relay build` | TypeScript build passed | PASS |
| Documentation integration | `pnpm --dir apps/docs build` | VitePress build and markdown-source copy passed; chunk-size warning only | PASS |
| Structural artifact and key-link gates | `gsd-tools query verify.artifacts/key-links` for all three plans | 15/15 artifacts and 11/11 links passed | PASS |

Mutation-sensitive checks are present for parser validation, HLL max/linear-counting behavior, retry/deadline ordering, positive error classification, and final sharing. The current implementation passes those discriminating tests; no mutation remains in the worktree.

### Probe Execution

No Phase 19 probe scripts are declared or present; probe execution is not applicable.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| COUNT-01 | 19-02, 19-03 | High-level policy with reconnect/retries/configurable timeout and error-channel failures | SATISFIED | Typed clean completion, timeout forms, retry taxonomy, backoff deadline, concurrency, forwarding, suite/build/docs all pass. |
| COUNT-02 | 19-01, 19-02, 19-03 | Strict NIP-45 response model and validation | SATISFIED | Parser and real-wire malformed/forward-compatible/prototype-safe tests pass. |
| COUNT-03 | 19-01, 19-03 | Register-wise HLL merge enabling correct cross-relay totals | SATISFIED | Merge and estimator helpers are tested, built, exported, and documented. |

COUNT-04 and COUNT-05 are explicitly assigned to Phase 23 and are not Phase 19 gaps.

### Anti-Patterns Found

No `TBD`, `FIXME`, `XXX`, placeholder, empty implementation, unchecked COUNT response cast, or orphaned runtime export was found in Phase 19 files. The docs build emits only VitePress's existing large-chunk advisory.

### Human Verification Required

None. All runtime state-transition claims have focused behavioral coverage.

### Gaps Summary

No blocking gaps or regressions remain. The two code-review findings are closed by typed clean-completion handling and focused real-wire policy coverage. Progressive Group isolation and emission remain specifically deferred to Phase 23.

---

_Verified: 2026-08-21T10:22:11Z_
_Verifier: the agent (gsd-verifier)_
