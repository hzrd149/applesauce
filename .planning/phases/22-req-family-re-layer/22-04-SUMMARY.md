---
phase: 22-req-family-re-layer
plan: 04
status: complete
subsystem: relay
tags: [sync, auth, regression]
---
# Phase 22 Plan 04: Sync and Regression Summary

Sync RECEIVE uses authenticated finite lifecycle composition and the Phase 13 auth, fresh-attempt, shared-gate, and progress regressions execute at their new policy-owning boundary.

## Mutation Evidence

### D-19 — Fresh attempt construction: RED → GREEN

- Baseline: `a48a99001b90f371fafc927a09f4ca9214bbc324` (probe captured against byte-equivalent Phase 22 source).
- Exact mutation: hoist `this.req(filters, { id }).pipe(...)` out of `defer`, reset the holder at call scope, and append attempt-local `share()` so synchronous auth resubscription rejoins the terminating attempt.
- Command: `/home/user/Projects/applesauce/node_modules/.bin/vitest run src/__tests__/relay.test.ts -t "CR-02: a synchronously-resolving auth phase produces a real REQ resend whose reply is observed" --reporter=verbose`.
- RED exit `1`: the named test failed because the server did not receive the resent REQ within 1000ms.
- Restore: `git restore --source=HEAD -- packages/relay/src/relay.ts packages/relay/src/group.ts`.
- GREEN exit `0`: identical command passed (`1 passed`, 209 skipped).

### D-20 — Call-scoped clean-CLOSED state: RED → GREEN

- Exact mutation: add attempt `finalize(() => { repeatAfterClosed.value = false; })`, clearing the completed outcome before the outer repeat predicate reads it.
- Command: `/home/user/Projects/applesauce/node_modules/.bin/vitest run src/__tests__/relay.test.ts -t "should resubscribe when relay sends clean CLOSED and resubscribe is enabled" --reporter=verbose`.
- RED exit `1`: the named test failed because the expected next REQ was absent for 1000ms.
- Restore: `git restore --source=HEAD -- packages/relay/src/relay.ts packages/relay/src/group.ts`.
- GREEN exit `0`: identical command passed (`1 passed`, 209 skipped).

### D-21 — Progress evidence and superseded Group ERROR oracle

- The independently reproduced synthetic-OPEN mutation remains causal: counting OPEN as progress breaks the exact auth retry bound.
- The old manufactured Group ERROR mutation is superseded/non-applicable. `RelayGroup.request()` calls `authSuspendableLifetime(opts?.timeout ?? 30_000, gate)`, which never consumes values to disarm or reset its deadline.
- Behavioral replacement: `CR-02: manufactured ERROR leaves the whole-operation timeout armed while another relay is silent` observes the declared 100ms failure window after one manufactured ERROR.
- Static replacement: `group.ts` has no timing/completion consumer of `isGroupReqProgress`; its sole occurrence is the retained legacy export, disposed to Phase 13 residual backlog 999.18 WR-07.

Restored implementation passes 374/374 relay package tests.

## Deviations from Plan

The former Group ERROR progress mutation was corrected as a provenance deviation because whole-lifetime timing superseded the earlier first-progress clock. No mutated production source was committed.

## Self-Check: PASSED
