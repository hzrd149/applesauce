---
phase: 06-refounding-rotation-authority-correctness
plan: 03
subsystem: concord
tags: [nostr, concord, authority, rank, elevation-of-privilege, fail-closed, refounding, rekey]

# Dependency graph
requires:
  - phase: 06-01
    provides: spec-derived guestbook/base-rekey address probes + memo-armed spread guards (ROTATE-01/02)
  - phase: 06-02
    provides: epoch-scoped Guestbook plane store keying and a scoped observed set (ROTATE-04), which this plan's refound()/readRekey changes build on top of
provides:
  - "refound()'s per-target BAN outrank loop (AUTH-02): a non-outranking exclusion throws before anything is built or published, aborting the whole Refounding atomically"
  - "readRekey's fail-closed root-path removal guard (AUTH-01): a removal is honored only when canRemoveSelf(rotator) === true, denying it when the predicate is absent or false"
  - "Both readRekey call sites (checkRekey in community.ts, syncEpoch in sync.ts) supplying canRemoveSelf built from canActOn/hasPerm over PERM.BAN"
  - "The channel-scope sync-walk path (channel-sync.ts) now also threads the already-existing canRemoveSelf predicate, closing a walk-vs-live inconsistency the shared fail-closed change exposed"
affects: [07-channel-keying, 08-rotation-robustness, 09-permission-grant-folds]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mirror the channel path onto the root path: any root-scoped guard has a channel-scoped sibling already implementing the correct (fail-closed, outrank-checked) behavior — check the sibling first, copy-and-adapt rather than design new logic"
    - "Fail-closed optional predicate: an omitted authority predicate (canRemoveSelf?) must deny the gated outcome, never default-permit it (held.canRemoveSelf?.(rotator) === true, not !held.canRemoveSelf || ...)"

key-files:
  created:
    - .changeset/concord-refound-outrank-send.md
    - .changeset/concord-rekey-outrank-receive-failclosed.md
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/sync.ts
    - packages/concord/src/client/channel-sync.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts
    - packages/concord/src/helpers/__tests__/channel-rekey.test.ts

key-decisions:
  - "D-05/D-06: refound() gained a per-target `this.canDo(PERM.BAN, this.standingOf(target).position)` outrank loop, positioned after the refoundAuthority(state) check and before buildRefounding/any publish, mirroring rotateChannel's existing loop verbatim (swap MANAGE_CHANNELS -> BAN)."
  - "D-07/D-08/D-09: readRekeyScoped:508's removal branch changed from `(!held.canRemoveSelf || held.canRemoveSelf(set.rotator))` (default-permit) to `held.canRemoveSelf?.(set.rotator) === true` (fail-closed); readRekey gained a trailing canRemoveSelf? param threaded into its root ScopedHeld, mirroring readChannelRekey; both call sites (checkRekey, syncEpoch) now supply it via admin.hasPerm/canActOn with PERM.BAN — no new rank logic."
  - "Rule 1 auto-fix (out-of-plan-file, in-scope-of-change): the shared readRekeyScoped fail-closed guard also gates the channel scope, since readChannelRekey delegates to the same function. Two pre-existing channel-rekey.test.ts removal assertions omitted canRemoveSelf entirely and needed a truthful predicate to keep passing. More significantly, channel-sync.ts's sync-WALK call to readChannelRekey never threaded canRemoveSelf at all (only private-channel.ts's LIVE checkRekey path did) — under the old default-permit guard this was silently masked, but under fail-closed it would have permanently broken walk-time channel-removal detection. Fixed by adding `ChannelSyncContext.canRemoveSelf` and threading the already-existing `ConcordPrivateChannelOptions.canRemoveSelf` predicate through `syncContext()` — no new rank logic invented, purely a thread-through of an existing, already-correct predicate to the one call site missing it."

requirements-completed: [AUTH-01, AUTH-02]

coverage:
  - id: D1
    description: "refound() rejects excluding a target the caller does not strictly outrank, throwing before anything is built or published (atomic abort); owner-path exclusions remain unaffected"
    requirement: "AUTH-02"
    verification:
      - kind: integration
        ref: "packages/concord/src/client/__tests__/community.test.ts#refound() rejects excluding a target the caller does not outrank, and publishes nothing (AUTH-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "readRekey's root path honors a removal only from an outranking rotator, denies it from a non-outranking rotator, and denies it when canRemoveSelf is omitted entirely (fail-closed-on-absence)"
    requirement: "AUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#readRekey's root path honors removal only from an outranking rotator, and denies it when canRemoveSelf is absent (AUTH-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both readRekey call sites (checkRekey/community.ts, syncEpoch/sync.ts) supply canRemoveSelf built from the existing hasPerm/canActOn primitives over PERM.BAN, and the shared fail-closed guard's cascade into the channel scope (channel-sync.ts's walk path) is proven by the updated existing test suite, with the full applesauce-concord suite (202 tests) green"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-16
status: complete
---

# Phase 6 Plan 3: Refounding Rotation Authority Correctness Summary

**refound() now rejects excluding any target the caller does not strictly outrank (atomic abort before publish), and readRekey's root-path removal guard fails closed instead of defaulting to permit, closing two Elevation-of-Privilege holes (H03/AUTH-01/AUTH-02) by mirroring the already-correct channel path.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-16T20:11:00Z
- **Completed:** 2026-07-16T20:21:29Z
- **Tasks:** 2 completed
- **Files modified:** 8 (+ 2 changesets created)

## Accomplishments

- `refound()` (`community.ts`) gained a per-target `PERM.BAN` outrank loop mirroring `rotateChannel`'s existing loop, positioned after the `refoundAuthority` bare-bit check and before `buildRefounding`/any `this.pool.publish(...)` call — a failed check throws and aborts the whole Refounding atomically, with no partial rotation.
- `readRekeyScoped`'s removal branch (`keys.ts:508`) is now fail-closed: `held.canRemoveSelf?.(set.rotator) === true`, replacing the `!held.canRemoveSelf || held.canRemoveSelf(...)` default-permit shape that was the milestone's recurring defect class.
- `readRekey` gained a trailing optional `canRemoveSelf?: (rotator: string) => boolean` parameter threaded into its root `ScopedHeld`, mirroring `readChannelRekey`'s existing 6th parameter.
- The misleading `ScopedHeld.canRemoveSelf` docstring (`keys.ts:451-458`) no longer states the root-path omission is intentional; it now documents that the predicate is REQUIRED to honor a removal (CORD-06 §3 "in both").
- Both `readRekey` call sites now supply `canRemoveSelf`: `community.ts`'s `checkRekey` via `this.admin.hasPerm(rotator, PERM.BAN, this.standingOf(this.pubkey).position)` (mirroring `spawnPrivateChannel`'s existing precedent); `sync.ts`'s `syncEpoch` via `canActOn(resolveStanding(rotator, ...), resolveStanding(ctx.self, ...), PERM.BAN)` (no admin instance available there).
- **Rule 1 deviation, discovered during full-suite verification:** the shared `readRekeyScoped` fail-closed change also gates the channel scope (`readChannelRekey` delegates to the same function). Two pre-existing `channel-rekey.test.ts` removal assertions that omitted `canRemoveSelf` broke and were updated with a truthful predicate. More significantly, `channel-sync.ts`'s sync-WALK call to `readChannelRekey` never threaded `canRemoveSelf` at all — only `private-channel.ts`'s LIVE `checkRekey` path did. Under the old default-permit guard this asymmetry was silently masked; under fail-closed it would have permanently broken walk-time channel-removal detection (a member removed while a client was offline would never register as removed once the client reconnects and walks forward). Fixed by adding `ChannelSyncContext.canRemoveSelf` and threading the already-existing `ConcordPrivateChannelOptions.canRemoveSelf` predicate through `syncContext()` — no new rank logic invented, purely closing a thread-through gap.
- New tests: a send-path outrank-rejection test (`community.test.ts`, a non-owner BAN holder at position 5 excluding the owner at position 0 is rejected and publishes nothing) and a root-path receive test (`keys.test.ts`, three outcomes: outranking rotator removes, non-outranking rotator does not, absent predicate does not).
- Full `applesauce-concord` suite: 202 tests green (was 200 before this plan; +2 new tests), 43 test files, `tsc` build clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: AUTH-02 send-path — refound() per-target BAN outrank loop + test (D-05/D-06)** - `996c6130` (fix)
2. **Task 2: AUTH-01 receive-path — fail-closed readRekey + both call sites + test (D-07/D-08/D-09)** - `20778b27` (fix)

_No separate plan-metadata commit needed beyond this SUMMARY/STATE update — see final commit below._

## Files Created/Modified

- `packages/concord/src/client/community.ts` - `refound()`'s per-target BAN outrank loop; `checkRekey`'s new `canRemoveSelf` argument
- `packages/concord/src/client/sync.ts` - `syncEpoch`'s new `canRemoveSelf` built from `canActOn`/`resolveStanding`/`PERM.BAN`; import of `canActOn` and `PERM`
- `packages/concord/src/client/channel-sync.ts` - `ChannelSyncContext.canRemoveSelf` field; `syncRekeyAndAdvance` now passes it to `readChannelRekey` (Rule 1 fix)
- `packages/concord/src/client/private-channel.ts` - `syncContext()` now threads `this.opts.canRemoveSelf` into the walk context (Rule 1 fix)
- `packages/concord/src/helpers/keys.ts` - `readRekeyScoped`'s fail-closed removal guard; `readRekey`'s new `canRemoveSelf?` parameter threaded into its root `ScopedHeld`; rewritten `ScopedHeld.canRemoveSelf` docstring
- `packages/concord/src/client/__tests__/community.test.ts` - new AUTH-02 send-path outrank-rejection test
- `packages/concord/src/helpers/__tests__/keys.test.ts` - new AUTH-01 root-path outrank test; updated the pre-existing "excluded member is removed" test to supply a truthful `canRemoveSelf`
- `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` - updated two pre-existing removal assertions to supply a truthful `canRemoveSelf` (Rule 1 fix)
- `.changeset/concord-refound-outrank-send.md` - patch changeset (created)
- `.changeset/concord-rekey-outrank-receive-failclosed.md` - patch changeset (created)

## Decisions Made

- D-05/D-06 (send-path outrank, atomic abort) and D-07/D-08/D-09 (receive-path fail-closed, both call sites, no new rank logic) implemented exactly as locked in `06-CONTEXT.md`, using the exact code shapes pinned in `06-RESEARCH.md`'s "Mirror the channel path onto the root path" pattern.
- The send-path test excludes the owner (position 0) from a non-owner BAN holder (position 5) rather than a peer role, since the owner's supreme/unremovable rank gives the cleanest, spec-grounded "does not outrank" case (CORD-04 §2) without needing a second role grant.
- The receive-path test reuses `buildRefounding` (not `readRekeyScoped` directly) so the oracle stays a black-box call through the public `readRekey` API, matching the milestone's spec-derived-test discipline of asserting outcomes rather than internals.
- The channel-scope thread-through fix (Rule 1) reuses the exact `canRemoveSelf` predicate already constructed in `community.ts`'s `spawnPrivateChannel` and already correctly wired to `private-channel.ts`'s LIVE `checkRekey` — no new predicate construction, purely extending its reach to the WALK path that was missing it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Channel-scope readChannelRekey callers broke under the shared fail-closed guard**
- **Found during:** Task 2, full-suite verification (`pnpm --filter applesauce-concord test`)
- **Issue:** `readRekeyScoped` is shared between the root path (`readRekey`) and the channel path (`readChannelRekey`). Making its removal branch fail-closed (D-07) is correct for both scopes per CORD-06 §3's "in both," but two pre-existing `channel-rekey.test.ts` tests asserted `removed` while calling `readChannelRekey` with no `canRemoveSelf` argument at all, and `channel-sync.ts`'s sync-WALK call site (`syncRekeyAndAdvance`) never threaded `canRemoveSelf` either — unlike `private-channel.ts`'s LIVE `checkRekey`, which already correctly passed `this.opts.canRemoveSelf`. Under the old default-permit guard this walk-vs-live asymmetry was invisible; under fail-closed it would have silently and permanently broken legitimate channel-removal detection during the initial sync walk.
- **Fix:** Added `ChannelSyncContext.canRemoveSelf?: (rotator: string) => boolean`, threaded `this.opts.canRemoveSelf` into it from `private-channel.ts`'s `syncContext()`, and passed `ctx.canRemoveSelf` into `channel-sync.ts`'s `readChannelRekey` call. Updated the two `channel-rekey.test.ts` removal assertions to pass `isOwner` (the owner strictly outranks everyone, so the predicate is truthful) as `canRemoveSelf`.
- **Files modified:** `packages/concord/src/client/channel-sync.ts`, `packages/concord/src/client/private-channel.ts`, `packages/concord/src/helpers/__tests__/channel-rekey.test.ts`
- **Verification:** Full `applesauce-concord` suite (202 tests) green; `tsc` build clean.
- **Committed in:** `20778b27` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug, cascading from the shared fail-closed guard)
**Impact on plan:** Necessary for correctness — without it, the plan's own AUTH-01 fix would have introduced a silent regression in the channel scope's sync-walk removal detection. No scope creep: no new rank logic was written, only an existing, already-correct predicate was threaded to the one call site missing it. No changes to `channel-sync.ts`/`private-channel.ts` were in the plan's stated `files_modified`, but the fix is a direct, minimal consequence of the plan's own D-07 change to shared code.

## Issues Encountered

None beyond the deviation above. Both tasks' scoped test runs and the full `applesauce-concord` suite passed after the deviation fix; `tsc` (`pnpm --filter applesauce-concord build`) compiled cleanly throughout with no type errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- AUTH-01 and AUTH-02 (H03) are closed: both the send-path (`refound()`) and receive-path (`readRekey`) now require the rotator to strictly outrank every removed target, matching CORD-06 §3's "in both" requirement, with the channel path's own removal-authority guard (already correct, now also correctly threaded through its sync-walk path) reconfirmed rather than regressed.
- This closes Phase 6's full scope: ROTATE-01/ROTATE-02 (06-01), ROTATE-04 (06-02), and AUTH-01/AUTH-02 (06-03) are all complete. TEST-01 (standing, does not close at this phase) has this phase's slice satisfied via spec-derived oracles across all three plans.
- No blockers for Phase 7. The channel-scope thread-through fix (this plan's deviation) is a small, self-contained addition that Phase 7's channel-keying work should be aware of (`ChannelSyncContext.canRemoveSelf` now exists) but does not conflict with or duplicate any of Phase 7's planned scope.

---
*Phase: 06-refounding-rotation-authority-correctness*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/sync.ts
- FOUND: packages/concord/src/client/channel-sync.ts
- FOUND: packages/concord/src/client/private-channel.ts
- FOUND: packages/concord/src/helpers/keys.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: packages/concord/src/helpers/__tests__/channel-rekey.test.ts
- FOUND: .changeset/concord-refound-outrank-send.md
- FOUND: .changeset/concord-rekey-outrank-receive-failclosed.md
- FOUND: commit 996c6130 (Task 1)
- FOUND: commit 20778b27 (Task 2)
