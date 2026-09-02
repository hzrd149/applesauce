---
phase: 24-negentropy-sync-re-layer
plan: 08
subsystem: relay-public-api
tags: [type-tests, exports, documentation, negentropy, sync]
requires:
  - phase: 24-negentropy-sync-re-layer
    plan: 07
    provides: complete mutation evidence for sync invariants
provides:
  - Compiler-enforced new and removed negentropy/sync surfaces
  - Observable round and structured result migration guidance
  - Explicit caller-owned lifetime and upload-failure documentation
affects: [relay-consumers, docs, release-migration]
tech-stack:
  added: []
  patterns: [negative TypeScript fixtures, discriminated-result examples]
key-files:
  created: [packages/relay/type-tests/sync-types.ts]
  modified: [apps/docs/loading/relays/negentropy.md, apps/docs/loading/relays/relays.md, apps/docs/loading/relays/pool.md]
key-decisions:
  - "Prove type-only exports and removals through the compiler while keeping runtime export snapshots limited to runtime values."
  - "Describe completion as queue drain and require callers to inspect send-failed and relay-failed outcomes."
patterns-established:
  - "Raw multi-relay negotiation is composed through pool.relay(url).negentropy rather than a removed Pool convenience method."
requirements-completed: [SYNC-01, SYNC-02, SYNC-03, SYNC-04]
duration: 5min
completed: 2026-09-02
status: complete
---

# Phase 24 Plan 08: Public Type and Documentation Migration Summary

**Compiler fixtures pin exact sync unions and removed APIs while concise docs teach Observable rounds, structured outcomes, and caller-owned lifetime.**

## Performance

- **Duration:** 5 min
- **Tasks:** 2
- **Files created:** 1
- **Files modified:** 3

## Accomplishments

- Added exact type coverage for `NegentropyRound`, `NegentropyOptions`, `SyncMessage`, and `GroupSyncMessage` across Relay, Group, and Pool.
- Proved callback-era types/methods, Group/Pool raw negentropy, sync timeout, and nonnumeric concurrency are rejected.
- Replaced stale callback, Promise, and raw-event documentation with concise Observable and discriminated-union examples.
- Documented AbortSignal/RxJS lifetime composition and separated drained completion from transfer success.

## TDD Evidence

- **RED:** `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` exited `1` at `sync-types.ts:6`: `timeout` does not exist in `RelaySyncOptions`.
- **GREEN:** the same compiler gate exited `0` after converting the rejected surface into an explicit `@ts-expect-error` contract and completing the fixture.
- **Runtime export gate:** `pnpm --filter applesauce-relay exec vitest run src/__tests__/exports.test.ts` passed 1/1; no runtime snapshot change was needed for type-only exports.

## Task Commits

1. **Task 1 RED** - `161bc3c4`
2. **Task 1 GREEN** - `f39718bb`
3. **Task 2 docs** - `441e95ef`

## Decisions Made

- Left `tsconfig.type-tests.json` unchanged because its existing `type-tests/**/*.ts` include already compiles the new fixture.
- Left the runtime export snapshot unchanged because the migrated public additions are types, not runtime values or error classes.

## Deviations from Plan

- No snapshot or tsconfig edit was necessary; existing coverage wiring and runtime exports were already exact.

## Issues Encountered

- The docs build reports the repository's existing large-chunk advisory; the build completes successfully.

## Final Gates

- `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` — exit `0`.
- `pnpm --filter applesauce-relay exec vitest run src/__tests__/exports.test.ts` — exit `0`, 1/1 passed.
- `pnpm --dir apps/docs build` — exit `0`.
- Required `NegentropyRound|subscribe`, `send-failed|type.*received`, and forbidden `Upload complete` searches — exit `0`.

## User Setup Required

None.

## Self-Check: PASSED

- The type fixture and three documentation files exist.
- Commits `161bc3c4`, `f39718bb`, and `441e95ef` exist.
- Type, export, documentation build, and stale-guidance gates pass.

---
*Phase: 24-negentropy-sync-re-layer*
*Completed: 2026-09-02*
