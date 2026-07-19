---
phase: 08-rotation-robustness-consensus
plan: 05
subsystem: auth
tags: [concord, nostr, rekey, refounding, vac, grant, access-control, cord-04, cord-06]

# Dependency graph
requires:
  - phase: 08-rotation-robustness-consensus (08-01..08-04)
    provides: isStrictlyLowerKey/D-04 re-read spine, chunk consistency guards, decrypt-vs-opaque readRekeyScoped partition, per-wrap majority gate
provides:
  - RekeyRotation.vac citation threaded through includeRekeyChunk/buildRekeyRumors/buildRefounding/buildChannelRekey
  - ParsedRekey.vac / RekeyRotationSet.vac round-tripped through parseRekey/groupRotations
  - vacVerifier (helpers/permissions.ts) — a fail-closed, opt-in predicate over folded CommunityState
  - ScopedHeld.verifyVac gate in readRekeyScoped, threaded through readRekey/readChannelRekey and wired at all four receive call sites (root walk, root live-check, channel walk, channel live-check)
affects: [09-consensus-and-authority-fold]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vac citation as a second, independent access-control gate alongside isAuthorized — a rotation set failing verifyVac is excluded from BOTH adopt and removed, not merely from removal"
    - "verifyVac predicates rebuilt fresh per call from live state ($/state()) at live-check sites, mirroring the existing admin.hasPerm/canRemoveSelf freshness convention"

key-files:
  created: []
  modified:
    - packages/concord/src/operations/rekey.ts
    - packages/concord/src/helpers/rekey.ts
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/helpers/permissions.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/sync.ts
    - packages/concord/src/client/channel-sync.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/helpers/__tests__/rekey.test.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts
    - packages/concord/src/client/__tests__/sync.test.ts

key-decisions:
  - "vac lives on the RekeyRotation descriptor (rotation.vac) rather than as a separate includeRekeyChunk function parameter — buildRekeyRumors already forwards the whole rotation object to includeRekeyChunk, so no new parameter needed to thread it through"
  - "Centralized a shared vacVerifier(state, requiredPerm) builder in helpers/permissions.ts next to refoundAuthority, rather than inlining the eid/permission check separately in sync.ts and channel-sync.ts — both scopes need the identical owner-exempt + grantLocator + hasPerm logic, differing only in the required permission bit (PERM.BAN vs PERM.MANAGE_CHANNELS)"
  - "Extended vac emission (Task 1) beyond the plan's literal scope to also cover rotateChannel/buildChannelRekey, and extended vac verification (Task 2) beyond sync.ts/channel-sync.ts to also cover community.ts's and private-channel.ts's live checkRekey() call sites — see Deviations"

requirements-completed: [ROTATE-08]

coverage:
  - id: D1
    description: "A non-owner rotation cites the Grant it acts under as a ['vac', eid, version, hash] tag; the owner is exempt"
    requirement: "ROTATE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/rekey.test.ts#a non-owner rotation's vac citation round-trips through includeRekeyChunk → parseRekey (D-08)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/rekey.test.ts#an owner rotation (no vac) parses with vac undefined"
        status: pass
    human_judgment: false
  - id: D2
    description: "A receiver verifies the cited vac structurally resolves to grantLocator AND the current folded Roster still grants the permission, fail-closed on a missing/unverifiable vac from a non-owner, and this is a pure function of folded state (no live control-plane re-fetch)"
    requirement: "ROTATE-08"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#a non-owner rotation whose vac eid does not resolve to grantLocator is rejected — excluded from both adopt and removed"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#a non-owner rotation whose vac correctly resolves is honored (positive control)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#the owner's rotation is honored with no vac at all (owner exemption, D-08)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 05: vac citation + fail-closed receive verification Summary

**A non-owner rekey now cites the Grant it acts under (`vac`), and every receive path — root and channel, sync-walk and live-check — independently verifies that citation against the folded Roster before honoring the rotation, closing the "just-demoted admin" gap (M03/ROTATE-08).**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-19T14:27:00Z
- **Completed:** 2026-07-19T14:36:18Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- `includeRekeyChunk` emits the `["vac", eid, version, hash]` tag from `RekeyRotation.vac` (mirroring `includeKickTarget`), and `parseRekey`/`groupRotations` round-trip it onto `ParsedRekey.vac`/`RekeyRotationSet.vac`
- `refound()` and `rotateChannel()` both compute `admin.vacFor(this.pubkey)` and thread it through `buildRefounding`/`buildChannelRekey` (owner exempt) — including channel rekeys bundled inside a Refounding
- A new `vacVerifier(state, requiredPerm)` helper in `helpers/permissions.ts` builds a fail-closed, opt-in predicate: owner exempt; otherwise the citation's eid must structurally equal `grantLocator(community_id, rotator)` AND the current folded Roster must still grant `requiredPerm` — pure over folded state, no live edition re-fetch (D-12)
- `ScopedHeld.verifyVac` gates `readRekeyScoped`'s candidate filter — a non-owner set failing verification is excluded from BOTH `adopt` and `removed`, independent of the existing `isAuthorized` roster-bit check
- Wired at all four receive call sites: `sync.ts`'s `syncEpoch` walk (root/`PERM.BAN`), `community.ts`'s live `checkRekey` (root/`PERM.BAN`), `channel-sync.ts`'s `syncRekeyAndAdvance` walk (channel/`PERM.MANAGE_CHANNELS`), and `private-channel.ts`'s live `checkRekey` (channel/`PERM.MANAGE_CHANNELS`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Emit — thread vac onto the rekey wire** - `f56fef5e` (feat)
2. **Task 2: Receive — verify vac against the folded Roster** - `9c8400b8` (feat)
3. **Task 3: Spec-derived oracles — vac round-trip and verification reject** - `2d1535ed` (test)

_Plan metadata commit follows this summary._

## Files Created/Modified
- `packages/concord/src/operations/rekey.ts` - `includeRekeyChunk` emits `rotation.vac` as a `["vac", ...]` tag
- `packages/concord/src/helpers/rekey.ts` - `RekeyRotation.vac`, `ParsedRekey.vac`, `RekeyRotationSet.vac`; `parseRekey` reads the tag; `groupRotations` captures `vac` at bucket creation
- `packages/concord/src/helpers/keys.ts` - `buildRefounding`/`buildChannelRekey` thread `opts.vac`; `ScopedHeld.verifyVac` + the `readRekeyScoped` gate; `readRekey`/`readChannelRekey` gain the optional `verifyVac` param
- `packages/concord/src/helpers/permissions.ts` - new `vacVerifier(state, requiredPerm)` shared predicate builder, next to `refoundAuthority`
- `packages/concord/src/client/community.ts` - `refound()`/`rotateChannel()` compute+thread `vacFor`; `checkRekey()` threads `vacVerifier(state, PERM.BAN)`; `spawnPrivateChannel()` supplies a fresh-per-call `verifyVac` for `PERM.MANAGE_CHANNELS`
- `packages/concord/src/client/sync.ts` - `syncEpoch` builds `verifyVac` from `vacVerifier(state, PERM.BAN)` and threads it into both `readRekey` calls (known-branch re-read + tip/adopt)
- `packages/concord/src/client/channel-sync.ts` - `ChannelSyncContext.verifyVac` field, threaded into `readChannelRekey`
- `packages/concord/src/client/private-channel.ts` - `ConcordPrivateChannelOptions.verifyVac`, threaded through `syncContext()` and the live `checkRekey()`
- `packages/concord/src/helpers/__tests__/rekey.test.ts` - vac round-trip + owner-no-vac control
- `packages/concord/src/helpers/__tests__/keys.test.ts` - verification-reject, positive-control, and owner-exempt oracles (hand-rolled `verifyVac`, hand-derived `grantLocator` eids)
- `packages/concord/src/client/__tests__/sync.test.ts` - the D-04 racing-rotation fixture's second (non-owner) rotator now hand-cites its own Grant so it still clears the new vac gate

## Decisions Made
- vac lives on `RekeyRotation` (the descriptor already forwarded end-to-end) rather than as a bolted-on `includeRekeyChunk` parameter — no call site needed a signature change beyond the descriptor's own new optional field
- Centralized `vacVerifier` in `permissions.ts` next to `refoundAuthority` instead of duplicating the owner-exempt/`grantLocator`/`hasPerm` logic across `sync.ts` and `channel-sync.ts` — the two scopes differ only in `requiredPerm`
- Live-check call sites (`community.ts`, `private-channel.ts`) build `verifyVac` fresh per call from current live state, matching the existing `admin.hasPerm`/`canRemoveSelf` freshness convention rather than freezing state at engine-spawn time

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended vac emission to the channel-scope rotation path (`rotateChannel`/`buildChannelRekey`)**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 action text and `<files>` list describe vac emission only for `refound()`/`buildRefounding` (the root Refounding path). But Task 2 explicitly wires the receive-side `verifyVac` gate into BOTH the root scope (`sync.ts`) and the channel scope (`channel-sync.ts`) — per its own read_first and action text ("Build the predicate in `sync.ts` (root scope) and `channel-sync.ts` (channel scope)"). Without also emitting a `vac` on channel rekeys, every non-owner `rotateChannel()` call (any `MANAGE_CHANNELS` admin who isn't the owner) would have its rotation silently rejected the moment Task 2 landed — a regression this very plan would have introduced into existing, working functionality.
- **Fix:** Added an optional `vac` field to `buildChannelRekey`'s opts (threaded into its `buildRekeyRumors` descriptor, mirroring `buildRefounding`), and had `rotateChannel()` compute `admin.vacFor(this.pubkey)` and pass it through — symmetric to `refound()`. Also threaded `opts.vac` into `buildRefounding`'s own bundled-channel-rekeys loop (a Refounding may rotate private channels alongside the root; those rekeys are minted by the same rotator and need the same citation).
- **Files modified:** `packages/concord/src/helpers/keys.ts`, `packages/concord/src/client/community.ts`
- **Verification:** `channel-rekey.test.ts` and `private-channel.test.ts`'s existing non-owner rotation tests remained green after Task 2's verifyVac wiring landed.
- **Committed in:** `f56fef5e` (Task 1 commit)

**2. [Rule 1 - Bug/consistency] Extended verifyVac wiring to the live checkRekey() paths (community.ts, private-channel.ts)**
- **Found during:** Task 2
- **Issue:** Task 2's `<files>` list and read_first cite only `sync.ts`/`channel-sync.ts` (the sync-WALK paths). But both scopes also have a separate LIVE-check path — `community.ts`'s `checkRekey()` (root) and `private-channel.ts`'s `checkRekey()` (channel) — that call `readRekey`/`readChannelRekey` directly and already thread `canRemoveSelf` there. Phase 06-03's own deviation log (STATE.md) records the mirror-image gap: `canRemoveSelf` was originally wired only at the live-check sites and had to be back-filled into the sync-walk paths. Leaving the live-check paths unwired here would repeat that same class of gap for `vac` — a lagging client's live rotation check would honor an unverified non-owner rotation even though the same rotation would be correctly rejected on the next full walk.
- **Fix:** Added `ConcordPrivateChannelOptions.verifyVac` (private-channel.ts), threaded through `syncContext()` and `checkRekey()`; `community.ts`'s `checkRekey()` threads `vacVerifier(state, PERM.BAN)`; `spawnPrivateChannel()` supplies a fresh-per-call `verifyVac` closure over `vacVerifier(this.state$.value, PERM.MANAGE_CHANNELS)`.
- **Files modified:** `packages/concord/src/client/community.ts`, `packages/concord/src/client/private-channel.ts`
- **Verification:** Full `applesauce-concord` suite green (230/230); `pnpm --filter applesauce-concord build` clean.
- **Committed in:** `9c8400b8` (Task 2 commit)

**3. [Rule 1 - Bug] Fixed a pre-existing test broken by the new vac gate**
- **Found during:** Task 2
- **Issue:** `sync.test.ts`'s D-04 racing-rotation fixture ("re-reads a known epoch's rekey plane...") has a second rotator (`member`, granted `PERM.BAN` via a role) call `buildRefounding` directly without a `vac`. Once `syncEpoch`'s `verifyVac` gate went live, `member`'s rotation — no longer owner-exempt — was excluded from candidacy, breaking the test's expected re-read cascade.
- **Fix:** Hand-computed `member`'s Grant citation via `computeEditionHash` (mirroring `admin.vacFor`'s own recompute) against the GRANT edition the test already publishes, and passed it as `vac` into `member`'s `buildRefounding` call.
- **Files modified:** `packages/concord/src/client/__tests__/sync.test.ts`
- **Verification:** `pnpm --filter applesauce-concord test` — 230/230 passing.
- **Committed in:** `9c8400b8` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 missing-critical-functionality, 1 bug fix)
**Impact on plan:** All three were necessary to avoid a regression this plan would otherwise have introduced (channel-scope rotations silently rejected, live-check paths left unprotected) or to keep pre-existing coverage green. No scope creep beyond what Task 2's own receive-side design already implied.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ROTATE-08 fully closed: vac citation on emit, fail-closed structural verification on receive, at every walk and live-check path in both scopes.
- `packages/concord/src/helpers/permissions.ts`'s new `vacVerifier` is available for 09-consensus-and-authority-fold if any authority-fold work needs the same owner-exempt/Grant-citation pattern.
- No open blockers for 08-06.

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 11 key files found on disk; all 3 task commit hashes (`f56fef5e`, `9c8400b8`, `2d1535ed`) found in git history.
