---
phase: 15-concord-stream-auth-cleanup
plan: 02
subsystem: auth
tags: [nip-42, concord, relay-auth, rxjs, vitest, react, daisyui]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "plan 15-01's connectedRelays$ free function (client/auth.ts), the D-12 extraction that this plan re-homes both engines' connected$ onto"
provides:
  - "ConcordCommunityStatus / ConcordPrivateChannelStatus / ConcordClientStatus with no `authenticated` field — auth is a property of an individual operation now (D-10/D-11), never standing state"
  - "Both engines' connected$ derived from connectedRelays$(pool, transport()) in client/auth.ts, not from ConcordRelayAuth (the class scheduled for removal)"
  - "Both example status badges for the removed authenticated flag gone; the status.error badge (D-13's auth-failure surface) intact"
affects: [15-03, 15-04, 15-05, 15-06, 15-07, 15-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A removed standing-state field folds into the existing error$/status.error surface rather than gaining a replacement field (D-13)"

key-files:
  created: []
  modified:
    - packages/concord/src/types.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - apps/examples/src/examples/concord/admin-management.tsx

key-decisions:
  - "Two stale doc-comment references to the deleted authenticated$ observable, outside the plan's named read_first line ranges (community.ts's ExtraRelays constructor-ordering comment at the old line 364, and private-channel.ts's identical comment at the old line 149), were also updated -- same-outcome literal correction (Rule 1), not a scope change: the plan's own <action> text for client.ts already required removing an authenticated$ cross-reference from a doc comment, so leaving these two dangling would contradict the plan's own no-dangling-reference standard applied inconsistently across files"

requirements-completed: [CAUTH-03]

coverage:
  - id: D1
    description: "ConcordCommunityStatus, ConcordPrivateChannelStatus, and ConcordClientStatus no longer declare an authenticated field; every other field (phase, epoch, connected, error, communities, syncing, live) is unchanged"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts (full 59-test file, including the status$ snapshot test with the authenticated assertion removed)"
        status: pass
      - kind: other
        ref: "grep -c 'authenticated: boolean' packages/concord/src/types.ts == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both engines' connected$ derive from connectedRelays$(pool, transport()) in client/auth.ts rather than the deleted-class-scheduled ConcordRelayAuth.connected$, and still react to a later extraRelays emission"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#status$ (relay socket opens -> connected flips) and the extras-reactivity cases around EXTRAS_PROTOCOL_A/B"
        status: pass
      - kind: other
        ref: "grep -n 'connectedRelays\\$' packages/concord/src/client/community.ts packages/concord/src/client/private-channel.ts (one call site each)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nothing in concord reads authRequiredForRead/authRequiredForPublish to gate authenticated$/connected$ any more; the only remaining readers are relay-auth.ts and invite-watcher.ts (both slated for removal in later plans)"
    requirement: CAUTH-03
    verification:
      - kind: other
        ref: "grep -rn 'authRequiredForRead\\|authRequiredForPublish' packages/concord/src -- production hits confined to client/relay-auth.ts and client/invite-watcher.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "packages/concord and apps/examples both build; the concord suite is green; the two example badges for the removed field are gone and the status.error badge survives"
    requirement: CAUTH-03
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (576/576 pass, 55 files)"
        status: pass
      - kind: other
        ref: "pnpm exec turbo build --filter=applesauce-concord and --filter=applesauce-examples (both exit 0)"
        status: pass
      - kind: other
        ref: "grep -c 'status\\.authenticated' apps/examples/src/examples/concord/admin-management.tsx == 0; grep -n 'status.error' still present"
        status: pass
    human_judgment: false

# Metrics
duration: ~20min
completed: 2026-08-15
status: complete
---

# Phase 15 Plan 02: Delete the Authenticated Status Surface, Re-home connected$ Summary

**Removed the standing `authenticated` boolean from all three Concord status types and both engines' `status$`/`distinctUntilChanged` composites, and re-homed `connected$` on both engines onto plan 15-01's `connectedRelays$` free function -- concord build/tests and the examples app build stay green, and the two now-orphaned example badges are gone while the `status.error` auth-failure surface is untouched.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-15
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- `ConcordCommunityStatus.authenticated`, `ConcordPrivateChannelStatus.authenticated`, and `ConcordClientStatus.authenticated` deleted from `types.ts`; `ConcordCommunityStatus.error`'s doc comment now records that a failed NIP-42 AUTH surfaces through `error`, not a dedicated status field.
- `ConcordCommunity.authenticated$` and `ConcordPrivateChannel.authenticated$` deleted along with their doc blocks; both engines' `connected$` now call `connectedRelays$(pool, transport())` (imported from `./auth.js`) instead of `this.relayAuth.connected$(this.transport())`, keeping the `extras.relays$.pipe(switchMap(...))` reactivity to later `extraRelays` emissions verbatim.
- Both engines' `status$` `combineLatest` objects and `distinctUntilChanged` comparators drop the `authenticated` leg; `ConcordClient`'s aggregate `status$` fold no longer computes `connectedChildren.every((s) => s.authenticated)` or compares it.
- `client.ts`'s `extraRelays` option doc comment rewritten to drop the dangling `{@link ConcordCommunity.authenticated$}` and the "can hold `authenticated$` low" claim, keeping only the still-true `connected$` consequence.
- `community.test.ts`'s `status$` snapshot test no longer asserts `snap?.authenticated`; the adjoining comment now describes a connected-only flip.
- `admin-management.tsx`'s client-level "stream keys authed/pending" badge and the per-community "authenticated/authenticating" badge both removed; the per-community `status.error` badge (D-13's auth-failure UI surface) is kept byte-for-byte, and the unrelated `needsAuth`/`authenticateUser` banner (plan 15-06's scope) is untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete the authenticated status surface across types, both engines, and the client fold** - `f3d7c32a` (feat)
2. **Task 2: Update the status assertions and the two example badges** - `baacf362` (test)

**Plan metadata:** committed separately after this summary (docs)

## Files Created/Modified

- `packages/concord/src/types.ts` - removed `authenticated: boolean` from all three status interfaces
- `packages/concord/src/client/community.ts` - removed `authenticated$`, re-homed `connected$` onto `connectedRelays$`, trimmed `status$`/comparator, fixed a stale doc-comment cross-reference
- `packages/concord/src/client/private-channel.ts` - identical five edits mirrored for the private-channel engine
- `packages/concord/src/client/client.ts` - removed the `authenticated` leg of the aggregate fold/comparator, rewrote the `extraRelays` doc comment
- `packages/concord/src/client/__tests__/community.test.ts` - removed the `snap?.authenticated` assertion, reworded the adjoining comment
- `apps/examples/src/examples/concord/admin-management.tsx` - removed both "authenticated" badges, kept the `status.error` badge

## Decisions Made

- Fixed two stale `connected$/authenticated$` doc-comment references in `community.ts` and `private-channel.ts` (the `ExtraRelays`-constructor-ordering comments) that were outside the plan's named `read_first` line ranges but directly named the just-deleted observable -- a same-outcome literal correction under Rule 1, consistent with the plan's own instruction to fix an equivalent dangling reference in `client.ts`'s `extraRelays` doc comment.

## Deviations from Plan

None beyond the doc-comment fix recorded above, which is the plan's own "no dangling `{@link}`" standard applied to two more instances of the identical pattern it names once explicitly (client.ts) — not a scope change.

## Issues Encountered

- A bare `pnpm --filter applesauce-concord build` fails in this worktree because `node_modules` symlinks to source directories with no `dist/` built yet (same environment precondition plan 15-01 documented). Resolved identically: `pnpm exec turbo build --filter=applesauce-concord` (and `--filter=applesauce-examples` for the examples build), which builds the whole dependency graph first. Not a code deviation.

## Next Phase Readiness

- `ConcordCommunityStatus`/`ConcordPrivateChannelStatus`/`ConcordClientStatus` are one field lighter across every consumer; no concord type, engine, or example carries a standing `authenticated` boolean.
- `connected$` on both engines is now fully independent of `ConcordRelayAuth`'s status methods, unblocking plan 15-07's planned removal of that class's `connected$`/`authenticated$` (only `authenticateStreamKeys`/`registerStreamKeys`/`ensureAuth` remain as live call sites into `relayAuth` from these two engines, both explicitly out of this plan's scope).
- `authRequiredForRead`/`authRequiredForPublish` production readers remain confined to `relay-auth.ts` and `invite-watcher.ts`, exactly the set plan 15-02's own verification step expected and both already slated for removal in later plans (CAUTH-03's flag-reader closure completes there).
- Full `applesauce-concord` suite: 55 test files, 576 tests passing (unchanged from the 15-01 baseline — this plan removed one assertion and zero test cases).
- No blockers for 15-04 (or the parallel 15-03 example-migration plan, which touches three unrelated example files).

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-15*
