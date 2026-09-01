---
phase: 22-req-family-re-layer
verified: 2026-09-01T22:28:00Z
status: gaps_found
score: 11/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "All four Phase 13 regression mutations fail RED for the named causal reason and restore GREEN."
    status: failed
    reason: "Only the synthetic-OPEN mutation was independently reproduced. The required artifact records the other three as narrative claims without commands, named failing tests, captured output, or another durable result that can be verified independently."
    artifacts:
      - path: ".planning/phases/22-req-family-re-layer/22-04-SUMMARY.md"
        issue: "Mutation Evidence lists four one-line outcomes but omits the exact mutation commands, failing test names, and observed output required by Plan 22-04."
      - path: ".planning/phases/22-req-family-re-layer/22-VALIDATION.md"
        issue: "Marks all four mutations passed by referring back to summary evidence, so it provides no independent evidence."
    missing:
      - "Re-run the fresh-attempt-hoist, repeat-holder-scope, and manufactured-Group-ERROR mutations in isolation and record each exact command, named failing test, and causal RED output."
      - "Restore production source after each mutation and record a final GREEN command/result."
---

# Phase 22: REQ Family Re-layer Verification Report

**Phase Goal:** `req()` becomes a single REQ interaction; `request()` and `subscription()` own reconnect, resubscribe, and auth retry, including subscription re-establishment.
**Verified:** 2026-09-01T22:28:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification after review fixes

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
| 12 | All four required historical mutations have independently verifiable RED→GREEN evidence. | ✗ FAILED | Synthetic OPEN was independently mutated and caused the named `T-13-09-01` test to time out RED. The other three have only unverifiable summary narration; exact commands/tests/results required by Plan 22-04 are absent. |

**Score:** 11/12 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/relay/src/relay.ts` | Raw interaction, private policy composition, request/subscription, sync wiring | ✓ VERIFIED | Substantive, wired, and behaviorally tested. |
| `packages/relay/src/internal.ts` | Package-internal compositor key | ✓ VERIFIED | Unexported unique symbol used by Relay and Group. |
| `packages/relay/src/group.ts` | Lifecycle-aware settlement and dedupe | ✓ VERIFIED | Uses internal compositor and retains Phase 21 aggregate semantics without subscription clocks. |
| `packages/relay/src/pool.ts` | Derived forwarding | ✓ VERIFIED | Direct Group delegation with `Parameters<>`. |
| `packages/relay/src/types.ts` | Positive public option surfaces | ✓ VERIFIED | Raw ID-only; request policy-bearing; subscription policy-bearing but clock-free. |
| `packages/relay/type-tests/req-family-types.ts` | Positive/negative compiler contract | ✓ VERIFIED | Included and passes. |
| `22-04-SUMMARY.md` | Four exact mutation commands and RED symptoms | ✗ STUB | Contains claims but not the promised reproducible evidence. |
| `22-VALIDATION.md` | Independent reconciled validation | ⚠ PARTIAL | Full gates reconcile, but mutation row depends on the incomplete summary. |

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
| Remaining three required mutations | — | No independently reproducible artifact/result supplied | ✗ FAIL |

### Probe Execution

No Phase 22 probe scripts are declared or present. Mutation checks are the phase-specific adversarial probes; one of four was independently reproduced.

### Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| REQ-01 | ✓ SATISFIED | Raw code, runtime tests, and ID-only type surface. |
| REQ-02 | ✓ SATISFIED | Relay/Group/Pool/sync policy ownership and behavior tests. |
| REQ-03 | ✓ SATISFIED | Stable ID, hidden OPEN, repeated EOSE, re-establishment and dedupe tests. |
| REQ-04 | ✗ BLOCKED | Four RED→GREEN mutation proofs are mandatory; only one is independently evidenced. |
| REQ-05 | ✓ SATISFIED | Explicit compiler fixture across Relay, Group, and all Pool entry points. |

No Phase 22 requirement is orphaned.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers, placeholder implementation, public internal export, subscription timeout branch, or raw policy operator was found in modified production files.

### Human Verification Required

None. The remaining gap is deterministic and should be closed with automated mutation evidence, not subjective UAT.

### Gaps Summary

The shipping implementation appears correct and every normal gate passes. Phase completion still fails its explicit non-vacuity contract: three of four mandatory deliberate reversions lack independently inspectable RED evidence. Re-run and record those mutations, restore GREEN, then re-verify REQ-04.

---

_Verified: 2026-09-01T22:28:00Z_
_Verifier: the agent (gsd-verifier)_
