---
phase: 24-negentropy-sync-re-layer
plan: 07
subsystem: relay-sync
tags: [mutation-testing, scheduler, auth-budget, reconnect]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 06
    provides: protocol-order mutation proofs
provides:
  - Causal mutation proof for the global concurrency bound
  - Causal mutation proof for SEND/RECEIVE lane fairness
  - Causal mutation proof for the global auth retry budget
  - Causal mutation proof for fresh reconnect negotiation state
affects: [relay-sync, protocol-regression-tests]
tech-stack:
  added: []
  patterns: [detached restore-safe mutation worktree, identical RED-GREEN commands]
key-files:
  created: []
  modified: []
key-decisions:
  - "Use the established relay integration oracles for auth and reconnect mutations because those contracts are exercised in relay.test.ts rather than the scheduler-focused sync.test.ts."
patterns-established:
  - "Scheduler and policy mutations must fail their exact named behavioral oracle before restored GREEN is accepted."
requirements-completed: [SYNC-03, SYNC-04]
duration: 4min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 07: Scheduler, Auth, and Reconnect Mutation Proof Summary

**Four isolated mutations prove the global concurrency cap, lane fairness, shared auth budget, and fresh reconnect-attempt boundary.**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Production files modified:** 0

## Accomplishments

- Executed mutations 4–7 independently from detached HEAD `10d07c0f67d42957eea91f6fdc152d3ae442b645` in `/tmp/applesauce-24-07.SHTF40`.
- Captured a specific causal assertion failure for every prescribed invariant.
- Restored each source mutation, reran the identical named gate to GREEN, verified a clean source diff, and removed the worktree.

## Mutation Evidence

### Mutation 4: Replace bounded scheduling with unbounded starts

- **Exact diff:** `while (!stopped && active < concurrency)` → `while (!stopped)` in `drain()`.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run packages/relay/src/__tests__/sync.test.ts -t 'global concurrency four'`
- **RED:** exit `1`; `enforces global concurrency four and emits settlement order` observed `pending.size` 6 instead of 4 at `sync.test.ts:52`.
- **Restore:** `git checkout -- packages/relay/src/relay.ts`.
- **GREEN:** identical command exited `0`; 1 passed, 5 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/relay.ts` exited `0`.

### Mutation 5: Always choose SEND before RECEIVE

- **Exact diff:** replaced alternating preferred/alternate lane selection and `nextLane` update with `return queues.send.shift() ?? queues.receive.shift()`.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run packages/relay/src/__tests__/sync.test.ts -t 'schedules RECEIVE fairly'`
- **RED:** exit `1`; `schedules RECEIVE fairly while SEND remains blocked and drains before completion` observed zero `req` calls instead of one at `sync.test.ts:81`.
- **Restore:** `git checkout -- packages/relay/src/relay.ts`.
- **GREEN:** identical command exited `0`; 1 passed, 5 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/relay.ts` exited `0`.

### Mutation 6: Restore independent per-operation auth counters

- **Exact diff:** created `const independentCounter = { consecutive: 0 }` inside `withSyncAuth()` and passed it to `authRetryOperator` instead of the call-scoped `authCounter`.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run packages/relay/src/__tests__/relay.test.ts -t 'sync auth uses one global budget'`
- **RED:** exit `1`; `sync auth uses one global budget across negotiation and EVENT` observed 2 EVENT subscriptions instead of 1 at `relay.test.ts:3352`.
- **Restore:** `git checkout -- packages/relay/src/relay.ts`.
- **GREEN:** identical command exited `0`; 1 passed, 213 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/relay.ts` exited `0`.

### Mutation 7: Reuse negotiation identity/state across reconnect

- **Exact diff:** moved `const id = nanoid()` and `withSyncAuth(this.negentropy(...))` outside the reconnect-controlled `defer`, causing retries to reuse the same negotiation Observable and ID.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run packages/relay/src/__tests__/relay.test.ts -t 'sync reconnects an unclean negotiation with a fresh id'`
- **RED:** exit `1`; the fresh reconnect oracle observed the second ID equal to the first at `relay.test.ts:3303`.
- **Restore:** `git checkout -- packages/relay/src/relay.ts`.
- **GREEN:** identical command exited `0`; 1 passed, 213 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/relay.ts` exited `0`.

## Final Gates

- `pnpm --filter applesauce-relay exec vitest run src/__tests__/sync.test.ts -t 'concurrency|fair|starv'` — exit `0`, 3 passed and 3 skipped by filter.
- `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t 'global budget|fresh id'` — exit `0`, 2 passed and 212 skipped by filter.
- `git diff --exit-code -- packages/relay/src/relay.ts` — exit `0`.
- `git worktree remove --force /tmp/applesauce-24-07.SHTF40` plus worktree-list absence check — exit `0`.

## Task Commits

- No source or oracle commit was required; existing named tests were sufficient and all mutations remained disposable.

## Decisions Made

- Used `relay.test.ts` for mutations 6 and 7 because it owns the existing global-budget and reconnect-freshness integration oracles; the plan's single `sync.test.ts` path does not contain those cases.

## Deviations from Plan

- Auth and reconnect mutation gates ran against their established location in `src/__tests__/relay.test.ts`; scheduler mutations ran against `src/__tests__/sync.test.ts` as planned.

## Issues Encountered

None.

## User Setup Required

None.

## Self-Check: PASSED

- Every mutation produced its required causal RED and identical restored GREEN.
- No mutation or production source diff remains.
- The detached worktree was removed.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
