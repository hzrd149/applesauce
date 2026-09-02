---
phase: 24-negentropy-sync-re-layer
reviewed: 2026-09-02T17:19:24Z
depth: deep
files_reviewed: 23
files_reviewed_list:
  - .changeset/loaders-sync-fallback-auth.md
  - .changeset/relay-group-sync-per-relay-isolation.md
  - .changeset/relay-negentropy-rounds.md
  - .changeset/relay-sync-outcomes.md
  - .changeset/silver-pugs-marry.md
  - .changeset/sync-loader-auth-hooks.md
  - .changeset/wait-for-auth-pubkeys.md
  - apps/docs/loading/relays/negentropy.md
  - apps/docs/loading/relays/pool.md
  - apps/docs/loading/relays/relays.md
  - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
  - packages/loaders/src/loaders/sync-loader.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/negentropy.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/__tests__/sync.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/negentropy.ts
  - packages/relay/src/pool.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/types.ts
  - packages/relay/type-tests/sync-types.ts
findings:
  critical: 3
  warning: 0
  info: 0
  total: 3
status: issues_found
---

# Phase 24: Code Review Report

**Reviewed:** 2026-09-02T17:19:24Z
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

The raw multi-round protocol stream, high-level sync auth/reconnect/scheduler, structured outcomes and store handling, Group/Pool attribution, loader fallback transition, public types, docs, changesets, and mutation evidence were reviewed across their call chains. The relay suite passes 402 tests and loaders pass 130 tests, but three untested lifecycle defects remain.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Reconnect retains work and results from the failed negotiation attempt

**File:** `packages/relay/src/relay.ts:1714-1817`
**Issue:** `customConnectionRetryOperator` wraps only the negentropy Observable, while `queues`, `active`, and all transfer promises are allocated outside the retried `defer`. When an unclean transport failure triggers a fresh negotiation, queued-but-not-started work from the failed attempt is not discarded and in-flight work continues settling against the same observer. Transport-failed SENDs may emit `send-failed`, then the fresh negotiation can enqueue the same event again and later emit `sent`; queued items can likewise run after reconnect even if the rebuilt vector no longer requests them. This violates the fresh-attempt boundary and makes outcomes dishonest.
**Fix:** Put negotiation plus its attempt-owned queues/transfers inside one retryable attempt boundary. On reconnectable failure, abort and drain/cancel that attempt without publishing stale settlements, clear queued work, then build fresh storage, ID, listeners, scheduler state, and transfers. Keep only completed successful store effects across attempts.

### CR-02: Premature protocol completion is accepted as successful negotiation

**File:** `packages/relay/src/negentropy.ts:78-97`
**Issue:** Completion of `socket.multiplex()` flows directly to normal Observable completion even when no terminal round (`followUp === null`) was decoded. A clean socket/listener completion, adapter completion, or other premature upstream termination therefore looks identical to successful NIP-77 completion. High-level sync marks `negotiationDone` and may complete successfully, contrary to the contract that premature transport termination uses the error channel.
**Fix:** Track whether a terminal round was processed. If the incoming stream completes before that flag is set (and cancellation was not requested), emit a typed transport/protocol error. Add raw and high-level tests for premature completion distinct from abort/unsubscribe.

### CR-03: Group sync captures membership eagerly and ignores later removal

**File:** `packages/relay/src/group.ts:518-536`
**Issue:** `from(this.relays)` evaluates the mutable group's relay array when `sync()` is called, not when its cold Observable is subscribed. Removing or replacing a relay between method call and subscription still syncs the stale instance; removing an active relay also does not cancel its sync and its later values/failure remain attributed as current. For observable-controlled groups, accessing `this.relays` throws synchronously before an Observable is returned. This is inconsistent with Group's membership-aware APIs and makes Pool's declared observable relay input unsafe for `sync()`.
**Fix:** Build Group sync from `relays$` with instance-aware normalized membership tracking: subscribe/cancel per current relay, ignore late removed signals, and attribute only active instances. At minimum defer snapshot acquisition to subscription and reject unsupported controlled input in the Observable error channel, but live removal requires the same token/subscription pattern used by other Group operations.

---

_Reviewed: 2026-09-02T17:19:24Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
