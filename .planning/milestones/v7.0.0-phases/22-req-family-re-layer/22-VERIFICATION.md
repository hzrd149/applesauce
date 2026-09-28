---
phase: 22-req-family-re-layer
verified: 2026-09-01T22:28:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps: []
---

# Phase 22: REQ Family Re-layer Verification Report

**Phase Goal:** `req()` becomes a single REQ interaction; `request()` and `subscription()` own reconnect, resubscribe, and auth retry, including subscription re-establishment.
**Verified:** 2026-09-01T22:28:00Z
**Status:** passed
**Re-verification:** Yes — Plan 22-09 closed the sole REQ-04 evidence gap

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Raw `req()` performs one readiness-aware interaction and owns no auth, reconnect, repeat, resend, or timeout policy. | ✓ VERIFIED | `relay.ts:990-1114` contains one cold wire interaction; `RelayReqOptions` is positively ID-only; runtime lifecycle/teardown tests and negative type tests pass. |
| 2 | Raw lifecycle, dynamic filters, sharing, and teardown remain exact. | ✓ VERIFIED | Filter factories resolve inside outer `defer`; OPEN/EVENT/EOSE/CLOSED mapping, one listener/write per shared interaction, and CLOSE finalization are exercised by relay tests. |
| 3 | `request()` owns auth/reconnect/repeat with stable call-scoped state and fresh attempts. | ✓ VERIFIED | Unexported symbol compositor at `relay.ts:1117-1139` creates call-scoped ID/repeat/auth state and a deferred raw attempt; positive reconnect and terminal-error tests pass. |
| 4 | Direct request has one auth-suspendable 30-second-default whole lifetime that activity does not disarm. | ✓ VERIFIED | `relay.ts:1677-1701` applies `authSuspendableLifetime`; silent and early-event-then-hang tests pass. |
| 5 | `subscription()` owns re-establishment, reuses its ID, hides OPEN, emits repeated EOSE, and has no clock. | ✓ VERIFIED | `relay.ts:1661-1673` uses the compositor without a timeout operator; runtime/fake-timer tests and type negatives pass. |
| 6 | Reconnect is a positive transport-error allowlist and arbitrary/programming failures are terminal. | ✓ VERIFIED | `customConnectionRetryOperator` checks `isReconnectableTransportError` at `relay.ts:1594-1613`; named arbitrary-error and unclean-close tests pass. |
| 7 | Function-valued filters are cold per interaction and errors use the Observable channel. | ✓ VERIFIED | Factory evaluation occurs at `relay.ts:1002-1009`; review-fix regression tests pass. |
| 8 | The lifecycle compositor is package-internal rather than public API. | ✓ VERIFIED | Access uses `RELAY_REQ_LIFECYCLE` from unexported `internal.ts`; package exports omit the internal subpath and the public-method negative type test passes. |
| 9 | Group and Pool preserve policy, settlement, dedupe, failure, and no-timeout behavior across all paths. | ✓ VERIFIED | Group invokes the symbol compositor, retains call-scoped `EventMemory`, and Pool delegates via `Parameters<>`; Group/Pool tests and type fixtures pass. |
| 10 | Sync RECEIVE retains operation-scoped auth and finite composition. | ✓ VERIFIED | `relay.ts:1793-1811` invokes the internal compositor with sync auth options and completes at EOSE; synchronous auth resend test passes. |
| 11 | Public Relay/Group/Pool types, docs, changesets, and Phase 21 reversal provenance match current policy. | ✓ VERIFIED | Type fixture rejects raw policy and every subscription timeout; docs and workspace build pass; both changesets are one-package/one-sentence major records; every Phase 21 artifact carries a D-23/D-24 supersession notice. |
| 12 | Applicable historical mutations have independently verifiable evidence and superseded oracles are amended honestly. | ✓ VERIFIED | D-19/D-20 now record exact causal RED→GREEN results; synthetic OPEN remains independently reproduced; the Group ERROR oracle is superseded/non-applicable under value-agnostic `authSuspendableLifetime` and replaced by deadline behavior plus a static no-consumer proof. |

**Score:** 12/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/relay.ts` | Raw interaction, private policy composition, request/subscription, sync wiring | ✓ VERIFIED | Substantive, wired, and behaviorally tested. |
| `packages/relay/src/internal.ts` | Package-internal compositor key | ✓ VERIFIED | Unexported unique symbol used by Relay and Group. |
| `packages/relay/src/group.ts` | Lifecycle-aware settlement and dedupe | ✓ VERIFIED | Uses internal compositor and retains Phase 21 aggregate semantics without subscription clocks. |
| `packages/relay/src/pool.ts` | Derived forwarding | ✓ VERIFIED | Direct Group delegation with `Parameters<>`. |
| `packages/relay/src/types.ts` | Positive public option surfaces | ✓ VERIFIED | Raw ID-only; request policy-bearing; subscription policy-bearing but clock-free. |
| `packages/relay/type-tests/req-family-types.ts` | Positive/negative compiler contract | ✓ VERIFIED | Included and passes. |
| `22-04-SUMMARY.md` | Exact applicable mutation evidence and supersession proof | ✓ VERIFIED | D-19/D-20 include commands, exit codes, causal output, restore and GREEN; D-21 records amended architecture evidence. |
| `22-VALIDATION.md` | Independent reconciled validation | ✓ VERIFIED | REQ-04 row cites applicable mutations and behavioral/static replacement evidence. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `request()` / `subscription()` | raw `req()` | unexported symbol compositor | ✓ WIRED | Fresh attempt factory and call-scoped state are preserved. |
| Group | Relay compositor | `RELAY_REQ_LIFECYCLE` | ✓ WIRED | Lifecycle metadata reaches settlement without duplicating policy. |
| Pool | Group | direct `Parameters<>` delegation | ✓ WIRED | No local policy or timeout translation. |
| Sync RECEIVE | Relay compositor | symbol-keyed invocation | ✓ WIRED | Auth options and reconnect policy reach finite receive flow. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Focused Relay/Group/Pool/export | `vitest run relay.test.ts group.test.ts group-error.test.ts pool.test.ts exports.test.ts` | 5 files, 285 tests passed | ✓ PASS |
| Full relay regression | `pnpm --filter applesauce-relay test` | 13 files, 380 tests passed | ✓ PASS |
| Public type boundary | `tsc -p tsconfig.type-tests.json --noEmit` | exit 0 | ✓ PASS |
| Relay and workspace packages | relay build + `turbo build --filter='./packages/*'` | 14/14 packages successful | ✓ PASS |
| Documentation | `pnpm --dir apps/docs build` | passed; chunk warning only | ✓ PASS |
| Dependency integrity | manifest/lockfile diff gate | exit 0 | ✓ PASS |
| Synthetic OPEN mutation | change `isReqProgress` to always true; run named auth bound test in isolated worktree | `T-13-09-01` timed out RED; production tree remained unchanged and full suite is GREEN | ✓ PASS |
| D-19/D-20 mutations | named focused Relay commands in isolated detached worktree | causal exit-1 RED, restore, identical exit-0 GREEN | ✓ PASS |
| Group ERROR whole-lifetime replacement | named Group deadline test plus static source audit | 100ms deadline remains armed; no timing consumer of legacy classifier | ✓ PASS |

### Probe Execution

No Phase 22 probe scripts are declared or present. Mutation checks are the phase-specific adversarial probes; one of four was independently reproduced.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| REQ-01 | ✓ SATISFIED | Raw code, runtime tests, and ID-only type surface. |
| REQ-02 | ✓ SATISFIED | Relay/Group/Pool/sync policy ownership and behavior tests. |
| REQ-03 | ✓ SATISFIED | Stable ID, hidden OPEN, repeated EOSE, re-establishment and dedupe tests. |
| REQ-04 | ✓ SATISFIED | D-19/D-20/OPEN mutation evidence plus amended Group ERROR whole-lifetime behavioral/static proof. |
| REQ-05 | ✓ SATISFIED | Explicit compiler fixture across Relay, Group, and all Pool entry points. |

No Phase 22 requirement is orphaned.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers, placeholder implementation, public internal export, subscription timeout branch, or raw policy operator was found in modified production files.

### Human Verification Required

None. The remaining gap is deterministic and should be closed with automated mutation evidence, not subjective UAT.

### Gaps Summary

The sole evidence gap is closed. Plan 22-09 recorded exact D-19/D-20 RED→GREEN results and amended the obsolete Group ERROR progress oracle to match the accepted value-agnostic whole-lifetime clock without claiming a causal failure.

---

_Verified: 2026-09-01T22:28:00Z_
_Verifier: the agent (gsd-verifier)_
