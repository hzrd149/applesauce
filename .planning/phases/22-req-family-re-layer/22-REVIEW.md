---
phase: 22-req-family-re-layer
reviewed: 2026-09-01T22:18:55Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - .changeset/relay-group-error-surface.md
  - .changeset/relay-req-family-re-layer.md
  - apps/docs/loading/relays/pool.md
  - apps/docs/migration/v5-v6.md
  - packages/relay/src/__tests__/auth-lifecycle-logging.test.ts
  - packages/relay/src/__tests__/group-error.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/types.ts
  - packages/relay/type-tests/group-error-types.ts
  - packages/relay/type-tests/req-family-types.ts
findings:
  critical: 3
  warning: 1
  info: 0
  total: 4
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-09-01T22:18:55Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The raw REQ interaction, lifecycle compositor, Relay/Group/Pool call chains, auth/retry/repeat policy, sync RECEIVE path, option types, tests, docs, and release metadata were reviewed. All 374 relay tests pass, but three shipping correctness defects and one public-surface defect remain.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Request lifetime timeout is still cancelled by the first progress value

**File:** `packages/relay/src/relay.ts:1693-1700`
**Issue:** `request()` applies `suspendableTimeout(..., { firstWhen: isReqProgress })`, whose implementation clears the timer permanently after the first EVENT, EOSE, or CLOSED-classified progress. Phase 22 requires a whole returned-Observable deadline that activity never resets or disarms. A relay can emit one event and then hang forever, bypassing the documented 30-second default. Group request uses the correct lifetime operator, so direct Relay and Group behavior also diverge.
**Fix:** Apply `authSuspendableLifetime(opts?.timeout ?? 30_000, gate)` to the direct Relay request pipeline, preserving auth suspension but never cancelling the budget on activity. Add an early-event-then-hang regression test.

### CR-02: REQ reconnect retries arbitrary and programming errors

**File:** `packages/relay/src/relay.ts:1601-1618`
**Issue:** `customConnectionRetryOperator` rejects only `RelayClosedError`; every other error is retried. That includes filter-stream errors, thrown programming errors, malformed internal failures, and any future terminal error not subclassing `RelayClosedError`. The implementation already has `isReconnectableTransportError`, but this operator does not use it. This violates the positive transport allowlist and can duplicate REQ writes or hide terminal failures behind reconnect delays.
**Fix:** In the retry delay callback, return `throwError(() => error)` unless `isReconnectableTransportError(error)` is true. Add tests proving an arbitrary `Error` is single-attempt while an unclean transport `CloseEvent` retries.

### CR-03: Function-valued filters execute eagerly instead of per cold interaction

**File:** `packages/relay/src/relay.ts:988-1005`
**Issue:** `req()` calls `filters(this)` while constructing the Observable, before anyone subscribes or readiness is reached. Side effects and exceptions therefore occur at method-call time, and a later subscription after `share()` resets reuses the stale function result rather than creating a fresh interaction input. This contradicts the cold-on-first-subscription contract and makes synchronous filter-factory errors impossible to observe through the Observable error channel.
**Fix:** Move function evaluation and input/filter-completion construction inside the outer `defer`, wrapping the result with `defer`/`from` semantics so exceptions are emitted to the subscriber and every reset interaction evaluates the factory afresh.

## Warnings

### WR-01: The private lifecycle compositor is exposed as public API

**File:** `packages/relay/src/relay.ts:1123-1145`
**Issue:** `reqLifecycle` has no `private` or `protected` modifier, so it is emitted in `Relay`'s public TypeScript surface even though the phase contract defines it as a private compositor. It accepts policy-bearing options, exposes lifecycle messages, and is already called directly by tests, making an accidental implementation seam appear supported and undermining the intended raw/high-level API boundary.
**Fix:** Move the compositor to a module-private helper or expose it through a symbol/internal adapter usable by `RelayGroup`; at minimum mark and exclude it from the supported declaration surface rather than publishing it as a normal Relay method.

---

_Reviewed: 2026-09-01T22:18:55Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
