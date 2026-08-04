---
phase: 07-private-channel-keying
plan: 02
subsystem: concord
tags: [concord, rxjs, reactive-state, access-control, client-api]

# Dependency graph
requires:
  - phase: 07-private-channel-keying (Plan 01)
    provides: material.channels as the sole source of channel key material; hasChannelKey(material, channelId) shared affordance in helpers/community.ts
provides:
  - ChannelView type (ChannelMetadata & { accessible: boolean }) exported from client/community.ts, re-exported via client/index.ts
  - channels$ retyped Observable<ChannelView[]>, reacting to both control-plane folds AND out-of-band material.channels mutations
  - materialChanged$ internal Subject + sameChannelViews content comparator
affects: [07-03, accordian-downstream-consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-local enrichment via combineLatest, not folded state: accessible rides the emitted ChannelView, never merged back into CommunityState/ChannelMetadata"
    - "materialChanged$ reactivity plumbing: an internal Subject that every material.channels mutation site calls .next() on, combined into a derived stream so client-local state changes with no control-plane fold still re-emit"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "sameChannelViews compares length + per-entry channel_id/accessible, mirroring members$'s sameSet precedent — a mapped array needs a content comparator, not reference identity"
  - "materialChanged$.next() placed at all four material.channels mutation sites (receiveChannelKeys, persistChannelKey, dropChannelKey, mintChannelKey callback) rather than a single centralized setter, matching each site's existing onMaterialChange? callback placement"

patterns-established:
  - "Client-local, non-consensus-relevant flags (accessible) ride an emitted view object combining state$ with a purpose-built internal Subject — never folded into CommunityState itself"

requirements-completed: [CHAN-06]

coverage:
  - id: D1
    description: "channels$ emits ChannelView[] carrying accessible: boolean — true for public channels, true iff material.channels holds a key for a private channel"
    requirement: "CHAN-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#channels$ flips accessible:true when a key is granted out-of-band with no control-plane fold (CHAN-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "channels$ re-emits when a key is granted (receiveChannelKeys) or dropped (dropChannelKey) with NO simultaneous control-plane fold — closing the reactivity gap RESEARCH.md surfaced"
    requirement: "CHAN-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#channels$ flips accessible:true when a key is granted out-of-band with no control-plane fold (CHAN-06)"
        status: pass
    human_judgment: false
  - id: D3
    description: "accessible never touches ChannelMetadata or folded CommunityState — it exists only on the emitted ChannelView"
    requirement: "CHAN-06"
    verification:
      - kind: other
        ref: "grep -n \"accessible\" packages/concord/src/types.ts returns no matches"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-17
status: complete
---

# Phase 07 Plan 02: channels$ reactive ChannelView with accessible flag Summary

**`channels$` now emits `ChannelView[]` carrying a client-local `accessible: boolean` that reacts to an out-of-band key grant/drop alone — no simultaneous control-plane fold required — closing the exact Accordian scenario (a Direct Invite landing with no metadata edition change) via a new `materialChanged$` Subject combined into the stream.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-17T19:02:00Z
- **Completed:** 2026-07-17T19:06:33Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Adopted `hasChannelKey(material, channelId)` (Plan 01) for `dropChannelKey`'s presence-only guard, replacing a hand-rolled `material.channels.some(...)` lookup; `reconcilePrivateChannels`'s value-needing `find(...)` was deliberately left intact since it needs the key object itself.
- Added `export type ChannelView = ChannelMetadata & { accessible: boolean }` and retyped `channels$` from `Observable<ChannelMetadata[]>` to `Observable<ChannelView[]>`.
- Added a private `materialChanged$` Subject and redefined `channels$` as `combineLatest([state channels slice, materialChanged$.pipe(startWith(undefined))])`, mapping each channel to `{ ...c, accessible: !c.private || hasChannelKey(this.material, c.channel_id) }`, terminating in a new `sameChannelViews` content comparator (mirrors `members$`'s `sameSet`).
- Wired `materialChanged$.next()` into all four sites that mutate `this.keys.material.channels`: `receiveChannelKeys`, `persistChannelKey`, `dropChannelKey`, and the `mintChannelKey` callback passed to `ConcordCommunityAdmin`.
- Added a CHAN-06 reactivity test that mints a private channel, drops the key locally via `leaveChannel` (no fold), subscribes to `channels$`, then calls `receiveChannelKeys` alone (no other community activity) and asserts a fresh `accessible: true` emission — proving the grant itself is the sole trigger, not a co-occurring `state$` fold.

## Task Commits

Each task was committed atomically:

1. **Task 1: Adopt hasChannelKey at the two existing ad-hoc lookup sites** - `2130b691` (refactor)
2. **Task 2: ChannelView + materialChanged$ + redefined channels$** - `8aa949f1` (feat)
3. **Task 3: CHAN-06 reactivity test — grant with no control-plane fold** - `2ba682fe` (test)

## Files Created/Modified

- `packages/concord/src/client/community.ts` - Added `ChannelView` type, `sameChannelViews` comparator, private `materialChanged$` Subject; redefined `channels$` as a `combineLatest` composite; adopted `hasChannelKey` in `dropChannelKey`.
- `packages/concord/src/client/__tests__/community.test.ts` - Added the CHAN-06 reactivity test (grant-only trigger, no intervening state activity).

## Decisions Made

- Followed the plan's task ordering (implement in Task 2, add the targeted regression test in Task 3) rather than a strict per-task RED→GREEN cycle — Task 2's acceptance criteria explicitly required only "existing client suite still green," with the dedicated reactivity assertion deferred to Task 3 by design (the plan structures the two as separate commits, not an interleaved TDD pair). Verified non-vacuity by tracing that without `materialChanged$.next()` in `receiveChannelKeys`, the new test's post-grant assertion would observe no additional emission and fail against the stale `accessible: false` value.
- `sameChannelViews` compares `channel_id` + `accessible` per-entry only (not the full `ChannelMetadata` shape) — sufficient because `channels` (the upstream slice) already suppresses reference-identical no-op folds via its own `distinctUntilChanged()`; the combinator only needs to additionally guard against a `materialChanged$` tick that didn't actually change any channel's `accessible` value.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ChannelView`, `hasChannelKey`, and the `materialChanged$` reactivity idiom are all available for Plan 03's `MissingChannelKeyError` guard in `sendMessage` (CHAN-02), which can reuse `hasChannelKey(this.material, channelId)` directly.
- `client/index.ts`'s existing `export *` from `client/community.ts` already re-exports `ChannelView` — no additional export wiring needed.
- Full `applesauce-concord` package suite (209 tests) and full monorepo `pnpm vitest run` (2084 tests) both green; full monorepo `pnpm run build` (18/18 tasks) green.
- No consumer of `channels$` exists yet outside this package's own tests (confirmed via repo-wide grep), so the `ChannelMetadata[]` → `ChannelView[]` breaking type change has no other call sites to update this phase.

---
*Phase: 07-private-channel-keying*
*Completed: 2026-07-17*

## Self-Check: PASSED

Both modified files confirmed present on disk; all 3 commit hashes (`2130b691`, `8aa949f1`, `2ba682fe`) confirmed in `git log --oneline --all`.
