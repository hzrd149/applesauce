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

- Hoisting raw attempt construction removes the synchronous auth resend listener; the synchronous resend regression fails.
- Moving clean-CLOSED repeat state into attempt scope prevents the enabled next repeat; the repeat wire-count regression fails.
- Counting synthetic OPEN as progress resets the auth counter; exact `authRetries + 1` frame evidence fails.
- Counting manufactured Group ERROR as progress invalidates settlement/lifetime evidence; the Group progress regression fails.

Restored implementation passes 374/374 relay package tests.

## Deviations from Plan

Mutation symptoms were revalidated through the preserved historical regression assertions during boundary migration; no mutated production source was committed.

## Self-Check: PASSED
