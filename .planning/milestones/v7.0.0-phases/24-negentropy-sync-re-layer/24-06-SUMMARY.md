---
phase: 24-negentropy-sync-re-layer
plan: 06
subsystem: relay-sync
tags: [mutation-testing, negentropy, protocol-ordering, scheduler]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 05
    provides: completed sync implementation and loader migration
provides:
  - Causal mutation proof for follow-up frame existence
  - Causal mutation proof for send-before-emit ordering
  - Causal mutation proof that transfers do not block negotiation
affects: [relay-sync, protocol-regression-tests]
tech-stack:
  added: []
  patterns: [detached restore-safe mutation worktree, named causal oracles]
key-files:
  created: []
  modified: [packages/relay/src/__tests__/negentropy.test.ts, packages/relay/src/__tests__/sync.test.ts]
key-decisions:
  - "Keep mutation probes outside the production checkout and require an explicit restored GREEN and source-diff gate for every probe."
patterns-established:
  - "Protocol invariants have named tests whose failure modes identify the violated causal contract."
requirements-completed: [SYNC-01, SYNC-02]
duration: 5min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 06: Protocol Mutation Proof Summary

**Three isolated mutations prove that follow-up frames, send-before-emit ordering, and transfer-independent negotiation are each protected by a named causal oracle.**

## Performance

- **Duration:** 5 min
- **Tasks:** 2
- **Files modified:** 2 test files; no production changes

## Accomplishments

- Named the real multi-round ordering oracle and added a round-two progress oracle with a blocked first transfer.
- Produced RED evidence for all three prescribed mutations from detached HEAD `43692f3a50784f467c1d1e09e297ee056b9aa532` in `/tmp/applesauce-24-06.lM2Rfi`.
- Restored every mutation, proved GREEN with the identical named command, verified no source diff, and removed the temporary worktree.

## Mutation Evidence

### Mutation 1: Delete the follow-up NEG-MSG write

- **Exact diff:** `if (followUp !== null) socket.next(["NEG-MSG", id, followUp]);` → `if (followUp !== null) void followUp;`
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run src/__tests__/negentropy.test.ts -t 'genuine multi-round'`
- **RED:** exit `1`; `drives a genuine multi-round negotiation with synchronous send-before-emit ordering` timed out after 5000 ms because the terminal negotiation state was never reached.
- **Restore:** `git checkout -- src/negentropy.ts` from the detached worktree's `packages/relay` directory.
- **GREEN:** identical command exited `0`; 1 passed, 3 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/negentropy.ts` exited `0`.

### Mutation 2: Emit before the follow-up write

- **Exact diff:** synchronous `socket.next(["NEG-MSG", id, followUp])` → `setTimeout(() => socket.next(["NEG-MSG", id, followUp]), 0)`.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run src/__tests__/negentropy.test.ts -t 'synchronous send-before-emit ordering'`
- **RED:** exit `1`; the named test failed at `negentropy.test.ts:69` with `wireCounts.every((count) => count > 0)` receiving `false`.
- **Restore:** `git checkout -- packages/relay/src/negentropy.ts` from the detached worktree root.
- **GREEN:** identical command exited `0`; 1 passed, 3 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/negentropy.ts` exited `0`.

### Mutation 3: Await transfer completion inside negotiation

- **Exact diff:** imported `concatMap` and inserted a `concatMap(async (round) => ...)` after cancellation handling that waited while `active > 0` or either transfer queue was non-empty before returning the next round.
- **Command:** `/home/user/Projects/applesauce/node_modules/.bin/vitest run packages/relay/src/__tests__/sync.test.ts -t 'protocol speed|round two|blocked transfer'`
- **RED:** exit `1`; `keeps protocol speed through round two while a first-round transfer is blocked` observed only the first `event` call and failed waiting for the second event at `sync.test.ts:105`.
- **Restore:** `git checkout -- packages/relay/src/relay.ts` from the detached worktree root.
- **GREEN:** identical command exited `0`; 1 passed, 5 skipped.
- **Residue gate:** `git diff --exit-code -- packages/relay/src/relay.ts` exited `0`.

## Final Gates

- `pnpm --filter applesauce-relay exec vitest run src/__tests__/negentropy.test.ts` — exit `0`, 4/4 passed.
- `pnpm --filter applesauce-relay exec vitest run src/__tests__/sync.test.ts -t 'protocol speed|round two|blocked transfer'` — exit `0`, 1 passed and 5 skipped by filter.
- `git diff --exit-code -- packages/relay/src/negentropy.ts packages/relay/src/relay.ts` — exit `0`.
- `git worktree remove --force /tmp/applesauce-24-06.lM2Rfi` plus worktree-list absence check — exit `0`.

## Task Commits

1. **Mutation oracle preparation** - `43692f3a`

## Decisions Made

- Used the repository's existing Vitest binary inside the detached worktree because pnpm attempted to resolve a separate `/tmp` store; this preserved the exact checked-out source while avoiding dependency installation or mutation.

## Deviations from Plan

- The prescribed mutations were implemented only in the detached worktree and intentionally produced no commits or production-source residue.
- Added the missing blocked-transfer/round-two named oracle before probing mutation 3; no implementation gap was found.

## Issues Encountered

- The detached `/tmp` worktree could not use the repository-native pnpm store directly. Ignored dependency symlinks were used only inside the disposable worktree, and the causal commands invoked the existing Vitest binary directly.

## User Setup Required

None.

## Self-Check: PASSED

- Both modified test files exist and commit `43692f3a` exists.
- All restored verification gates pass.
- The detached mutation worktree was removed with no tracked source residue.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
