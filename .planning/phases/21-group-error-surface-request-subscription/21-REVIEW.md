---
phase: 21-group-error-surface-request-subscription
reviewed: 2026-09-01T15:45:15Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - .changeset/relay-group-error-surface.md
  - apps/docs/loading/relays/pool.md
  - apps/docs/migration/v5-v6.md
  - packages/relay/src/__tests__/exports.test.ts
  - packages/relay/src/__tests__/group-error.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/operators/auth-retry.ts
  - packages/relay/src/types.ts
  - packages/relay/type-tests/group-error-types.ts
findings:
  critical: 4
  warning: 0
  info: 0
  total: 4
status: issues_found
---

# Phase 21: Code Review Report

> **Phase 22 D-23/D-24 amendment:** Subscription timeout support described here is historical and superseded by the clock-free persistent contract.

**Reviewed:** 2026-09-01T15:45:15Z
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The Group state machine, timeout operator, Pool forwarding tests, public types, release metadata, and documentation were reviewed across their call chains. The existing relay suite passes (370 tests), but four untested correctness failures remain in dynamic cohort replacement, normalized ordering, synchronous per-relay setup, and custom completion error propagation.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Same-URL relay replacement keeps the removed relay subscribed

**File:** `packages/relay/src/group.ts:267-305`
**Issue:** Membership is keyed only by normalized URL, and an existing `relaySubscriptions` entry causes the new `Relay` instance to be skipped. If a dynamic cohort replaces relay A with relay B at the same normalized URL, A remains subscribed, B is never subscribed, and A's later events or failure mutate the state of the latest cohort. This violates latest-membership settlement and can raise `RelayGroupError` with a cause from a relay that is no longer active.
**Fix:** Track both the relay instance and subscription per normalized URL. On each membership emission, unsubscribe and reset the state when the instance associated with a URL changes, then subscribe the replacement after the entire replacement cohort has been installed.

### CR-02: Removing and re-adding a URL duplicates native aggregate causes

**File:** `packages/relay/src/group.ts:228,242-247,280`
**Issue:** `order` is append-only. Removing a URL deletes only its state; re-adding it appends the same URL again. `current = order.filter(...)` then contains duplicates, so a one-relay active cohort can produce `error.errors` with the same cause multiple times while `outcomes` contains one key. The two public aggregate views no longer derive from the same active URL-entry sequence.
**Fix:** Represent ordering as the current normalized cohort (replace it on every membership emission), or remove a URL from the ordering structure when it leaves before allowing it to be appended again.

### CR-03: Synchronous per-relay request construction bypasses aggregate settlement

**File:** `packages/relay/src/group.ts:284-303`
**Issue:** `project(relay)` is invoked outside any per-relay error boundary. `Relay.req()` synchronously invokes function-valued filter inputs, so a filter factory that throws for one relay escapes the cohort loop and is delivered as the raw membership-subscription error. Remaining relays are never initialized and the caller receives neither normalized outcomes nor `RelayGroupError`, despite the failure occurring in one relay's projected operation.
**Fix:** Wrap projection in `defer(() => project(relay))` (or an explicit try/catch converted to a per-relay error) before subscribing, so synchronous construction failures follow the same state transition as Observable errors and cohort initialization continues deterministically.

### CR-04: Errors from custom completion operators are detached from the returned Observable

**File:** `packages/relay/src/group.ts:260-262`
**Issue:** The internal subscription to the caller-supplied completion operator provides only a `next` callback. If that operator throws or emits an error, RxJS reports it as an unhandled error while the public request remains active until another settlement path or timeout. The previous `completeWhen` composition propagated notifier errors to the returned Observable, so this is also a behavioral regression for supported custom completion logic.
**Fix:** Subscribe with an observer that forwards `error` through `finish("error", error)`, while retaining the current arbitration ordering that evaluates all-failed state before sending the final ERROR message to the completion stream.

---

_Reviewed: 2026-09-01T15:45:15Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
