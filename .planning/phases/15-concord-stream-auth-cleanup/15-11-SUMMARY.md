---
phase: 15-concord-stream-auth-cleanup
plan: 11
subsystem: testing
tags: [concord, react, stream-auth, structural-guard, examples]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: operation-scoped StreamSigners API (packages/concord/src/client/auth.ts) that the examples consume, and the original no-ambient-auth.test.ts structural guard (plan 15-07)
provides:
  - Three concord examples (crypto-history.tsx, rumor-stores.tsx, direct-invites.tsx) that construct StreamSigners inside the React scope whose lifetime it represents, instead of at module scope
  - A no-ambient-auth.test.ts guard whose four checks all scan both packages/concord/src and apps/examples/src/examples/concord
affects: [15-14, future concord example additions, future auth-guard maintenance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope-lifetime holder construction: useMemo(() => new StreamSigners(), [material]) for walker examples keyed on the active community/material; useMemo(() => new StreamSigners(), []) for a component-instance-scoped holder with no single material to key on"
    - "Shared two-root file-list helper (allFiles()) reused by every structural-guard check, except the anti-vacuity test which deliberately keeps its per-root counts separate"

key-files:
  created: []
  modified:
    - apps/examples/src/examples/concord/crypto-history.tsx
    - apps/examples/src/examples/concord/rumor-stores.tsx
    - apps/examples/src/examples/concord/direct-invites.tsx
    - packages/concord/src/__tests__/no-ambient-auth.test.ts

key-decisions:
  - "fetchWraps/loadEpoch in crypto-history.tsx and rumor-stores.tsx take signers: StreamSigners as an explicit parameter (fetchWraps: first positional; loadEpoch: appended last) rather than reaching a module-level singleton"
  - "direct-invites.tsx's ConcordDirectInvites keeps its StreamSigners component-scoped (useMemo(() => new StreamSigners(), [])) rather than per-material, since this inbox accepts invites for many different communities and has no single material to key a holder on"
  - "no-ambient-auth.test.ts's allFiles() helper is used by 3 of 4 checks; the anti-vacuity test deliberately keeps its two separate collectFiles(SRC_ROOT)/collectFiles(EXAMPLES_ROOT) counts so a broken path fails loudly rather than silently halving the file set"

patterns-established:
  - "A React example that needs a scope-owned holder from applesauce-concord constructs it via useMemo keyed on whatever value defines that scope's lifetime (material/community, or the component instance itself when no single material exists), never at module scope"

requirements-completed: [CAUTH-01, CAUTH-03]

coverage:
  - id: D1
    description: "crypto-history.tsx and rumor-stores.tsx construct StreamSigners inside Walker via useMemo(() => new StreamSigners(), [material]), threaded through fetchWraps/loadEpoch as an explicit parameter, so a repointed walk starts from an empty holder"
    requirement: "CAUTH-01"
    verification:
      - kind: other
        ref: "grep -rn 'new StreamSigners' apps/examples/src/examples/concord/ — 3 hits, all inside component bodies"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-examples build"
        status: pass
    human_judgment: false
  - id: D2
    description: "direct-invites.tsx's ConcordDirectInvites constructs a component-scoped StreamSigners via useMemo(() => new StreamSigners(), [])"
    requirement: "CAUTH-01"
    verification:
      - kind: other
        ref: "grep -n 'new StreamSigners' apps/examples/src/examples/concord/direct-invites.tsx — inside ConcordDirectInvites"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-examples build"
        status: pass
    human_judgment: false
  - id: D3
    description: "All four no-ambient-auth.test.ts checks scan both packages/concord/src and apps/examples/src/examples/concord via a shared allFiles() helper, with the anti-vacuity test's per-root counts kept separate; non-vacuity proven by planting and reverting one violation per newly-widened check"
    requirement: "CAUTH-03"
    verification:
      - kind: unit
        ref: "packages/concord/src/__tests__/no-ambient-auth.test.ts (5 tests)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (584 tests)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-08-18
status: complete
---

# Phase 15 Plan 11: Concord Example Holder Lifetimes + Guard Roots Summary

**Concord examples now construct `StreamSigners` inside the React scope they represent (per-material `useMemo` for the two walkers, component-scoped for the invite inbox), and all four `no-ambient-auth.test.ts` checks scan both `packages/concord/src` and the concord examples through one shared file-list helper.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-18T09:46:53Z (base commit)
- **Completed:** 2026-08-18T09:56:21Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Deleted the module-scope `const streamSigners = new StreamSigners();` singletons in `crypto-history.tsx`, `rumor-stores.tsx`, and `direct-invites.tsx` — each previously outlived the React scope it claimed to represent
- `crypto-history.tsx`/`rumor-stores.tsx`: `fetchWraps`/`loadEpoch` now take an explicit `signers: StreamSigners` parameter; `Walker` constructs the holder via `useMemo(() => new StreamSigners(), [material])`, so repointing the walker at a different invite/material starts from an empty holder
- `direct-invites.tsx`: `ConcordDirectInvites` constructs a component-scoped `useMemo(() => new StreamSigners(), [])` holder, since this inbox accepts invites from many communities and has no single material to key on
- `no-ambient-auth.test.ts`'s ambient-auth-trigger, retry-budget-override, and missing-pubkeys-handler checks now scan `apps/examples/src/examples/concord` in addition to `packages/concord/src`, via a shared `allFiles()` helper — the examples are the code most likely to be copied, so they are the more important root for these checks
- Proved all three newly-widened checks non-vacuous: planted one real violation per check in `direct-invites.tsx`, observed RED naming the planted file, reverted, observed GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Bind each example's StreamSigners lifetime to the scope it represents** - `d9850e91` (fix)
2. **Task 2: Make all four no-ambient-auth checks scan both roots** - `f1e65064` (test)

**Plan metadata:** commit pending (docs: complete plan) — see `<final_commit>` step.

## Files Created/Modified
- `apps/examples/src/examples/concord/crypto-history.tsx` - `StreamSigners` construction moved from module scope into `Walker` via `useMemo(() => new StreamSigners(), [material])`; `fetchWraps`/`loadEpoch` take `signers` as an explicit parameter
- `apps/examples/src/examples/concord/rumor-stores.tsx` - same shape as crypto-history.tsx
- `apps/examples/src/examples/concord/direct-invites.tsx` - `StreamSigners` construction moved from module scope into `ConcordDirectInvites` via `useMemo(() => new StreamSigners(), [])`
- `packages/concord/src/__tests__/no-ambient-auth.test.ts` - hoisted a shared `allFiles()` two-root helper; the three previously-`SRC_ROOT`-only checks now use it; renamed those three test names to drop the "under packages/concord/src" scoping

## Decisions Made
- `fetchWraps`'s new `signers` parameter is positioned first (reads as the auth context for the request); `loadEpoch`'s is appended last, keeping every existing call site's argument order otherwise unchanged
- `direct-invites.tsx` keeps its holder component-scoped rather than per-material — the file's own comment (kept, reworded) explains the inbox accepts invites for different communities from one place, so there is no single material to key on
- The anti-vacuity test in `no-ambient-auth.test.ts` was deliberately NOT switched to the shared `allFiles()` helper — it must keep counting each root separately so a broken path (e.g. `EXAMPLES_ROOT` resolving to an empty or wrong directory) fails loudly rather than silently halving the combined file set

## Deviations from Plan

None — plan executed exactly as written. The three non-vacuity probes were planted and reverted in `direct-invites.tsx` as scratch, uncommitted edits; only the two intended task commits landed.

## Non-Vacuity Probes (recorded verbatim per the plan's mandatory instruction)

All three probes were planted in `apps/examples/src/examples/concord/direct-invites.tsx`, one at a time, each reverted via `git checkout --` before planting the next.

**Probe 1 — ambient-auth-trigger check (`challenge$`/`authRequiredForRead`/`authRequiredForPublish`)**

Planted:
```ts
function probeChallengeSubscriber(relay: { challenge$: { subscribe: (cb: () => void) => void } }) {
  relay.challenge$.subscribe(() => {});
}
void probeChallengeSubscriber;
```
RED:
```
× no non-test file under packages/concord/src or the concord examples subscribes to a relay
  challenge stream or reads a relay-wide auth-required flag
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ ".../apps/examples/src/examples/concord/direct-invites.tsx" ]
```
Reverted via `git checkout -- apps/examples/src/examples/concord/direct-invites.tsx`.
GREEN: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

**Probe 2 — retry-budget-override check (`authRetries`/`authTimeout`)**

Planted:
```ts
const probeOptions = { authRetries: 3 };
void probeOptions;
```
RED:
```
× no non-test file under packages/concord/src or the concord examples overrides the auth
  retry count or the auth timeout
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ ".../apps/examples/src/examples/concord/direct-invites.tsx" ]
```
Reverted via `git checkout -- apps/examples/src/examples/concord/direct-invites.tsx`.
GREEN: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

**Probe 3 — missing-pubkeys-handler check (`missingPubkeys`)**

Planted:
```ts
function probeHandler(ctx: { missingPubkeys: string[] | null }) {
  return ctx.missingPubkeys;
}
void probeHandler;
```
RED:
```
× only client/auth.ts implements a handler over the relay-supplied missing-pubkeys field
  across packages/concord/src and the concord examples — one handler, not a family of
  hand-rolled copies
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ ".../apps/examples/src/examples/concord/direct-invites.tsx" ]
```
Reverted via `git checkout -- apps/examples/src/examples/concord/direct-invites.tsx`.
GREEN (final, restored): `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

`git status --short` on `direct-invites.tsx` was empty after the final revert, confirming no probe residue reached the task commit.

## Issues Encountered
- The first attempt at probe 2 (`const probeAuthRetries = 3;`) did not turn the retry-budget-override check RED — `probeAuthRetries` does not contain the literal case-sensitive substring `authRetries` (it contains `AuthRetries`, capital A). Corrected to `const probeOptions = { authRetries: 3 };`, which does contain the exact substring the guard's regex matches, and reran successfully.
- `pnpm --filter applesauce-examples build` initially failed with ~100 unrelated `Cannot find module 'applesauce-*'` errors across other examples (`wallet.tsx`, `zap/*`) — the workspace packages' `dist/` output did not exist yet in this worktree. Ran `pnpm turbo build --filter='./packages/*'` first (the workspace's `build_command` per `.planning/config.json`), which resolved it; none of the errors referenced the concord examples or this plan's files.

## Next Phase Readiness
- WR-05 and WR-08 (this plan's gap-closure scope) are closed: zero module-scope `StreamSigners` declarations remain in the concord examples, and all four structural-guard checks now cover both roots with proven non-vacuity.
- No blockers for plan 15-14 (final phase gate) or any future concord example additions — the `useMemo`-scoped-holder pattern established here is the one to follow.

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-18*
