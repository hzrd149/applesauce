---
phase: 07-private-channel-keying
plan: 03
subsystem: concord
tags: [concord, nostr, key-derivation, errors, client-api, spec-derived-tests]

# Dependency graph
requires:
  - phase: 07-private-channel-keying (Plan 01)
    provides: material.channels as the sole source of channel key material; hasChannelKey(material, channelId) shared affordance in helpers/community.ts
  - phase: 07-private-channel-keying (Plan 02)
    provides: ChannelView/channels$ reactivity idiom (materialChanged$) that this plan's tests reuse for the keyless/granted-key scenarios
provides:
  - MissingChannelKeyError, exported from client/community.ts and reachable from the package root
  - sendMessage/sendEvent guard (requireChannelKey) that throws MissingChannelKeyError for a known, private, keyless channel BEFORE channelEpoch/planeKeyFor
  - TEST-02 case 4 (keyless send rejects) and case 5 (grant-flow round-trip send succeeds) client-level tests
  - ROTATE-03/CHAN-05 client-level test: a post-rotation send addresses the hand-derived epoch-2 CORD-03 §1 plane, differing from epoch-1
affects: [accordian-downstream-consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed, instanceof-catchable error thrown by a client guard BEFORE the pure-helper backstop's generic throw is reached — the guard has richer context (channel state + key-holding) than the helper it fronts"
    - "Spec-derived, non-self-referential plane assertion at the client level: capture the actual published wrap's pubkey and compare against channelGroupKey(...) computed directly, never via channelKeyFor/deriveConcordKeys"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts
    - packages/concord/src/__tests__/exports.test.ts

key-decisions:
  - "MissingChannelKeyError is a minimal standalone class (no base error class — none exists anywhere in packages/concord), mirroring RelayManagementError's extends-Error/set-.name/one-typed-field convention"
  - "The guard is factored into a private requireChannelKey(channelId) helper shared identically by sendMessage and sendEvent, rather than duplicating the check inline in both"
  - "TEST-02 case 5 reuses the case-4 setup shape (single community engine: mint private channel, leaveChannel to drop the key locally, then receiveChannelKeys to re-grant) rather than a second cross-engine grant test — the existing multi-engine grant test (Direct Invite round-trip) never syncs control-plane data between engines, so a member engine's own sendMessage would fail for an unrelated reason (no folded channel entry) rather than proving the CHAN-02/case-5 behavior"

patterns-established:
  - "instanceof-catchable client guard in front of a pure-helper's generic backstop throw — establishes the first custom error class + convention in packages/concord"

requirements-completed: [CHAN-02, CHAN-05, ROTATE-03, TEST-02]

coverage:
  - id: D1
    description: "Sending to a known private channel with no held key rejects with an exported MissingChannelKeyError ('missing private channel key'), never the generic 'unknown channel'"
    requirement: "CHAN-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#sendMessage to a keyless private channel throws MissingChannelKeyError, not unknown channel (CHAN-02 / TEST-02 case 4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "planeKeyFor's generic 'unknown channel' throw stays as the backstop for truly-unknown ids, untouched by the new guard"
    requirement: "CHAN-02"
    verification:
      - kind: other
        ref: "packages/concord/src/helpers/keys.ts:planeKeyFor unchanged (no diff to this function in this plan) — confirmed by diff review"
        status: pass
    human_judgment: false
  - id: D3
    description: "The direct-invite / private-channel grant flow still works once key material is received and folded — a send succeeds after receiveChannelKeys"
    requirement: "TEST-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#direct-invite grant flow: send succeeds after receiveChannelKeys folds the key (TEST-02 case 5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A channel Rekey takes effect immediately in-session: after rotateChannel, a subsequent send addresses the NEW epoch's plane, verified against the hand-derived CORD-03 §1 private address"
    requirement: "ROTATE-03"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#spawns a sub-engine for a private channel and rotates its key"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-17
status: complete
---

# Phase 07 Plan 03: MissingChannelKeyError guard + client-level TEST-02/ROTATE-03 tests Summary

**`sendMessage`/`sendEvent` now guard a known-but-keyless private channel with an exported, `instanceof`-catchable `MissingChannelKeyError` before `planeKeyFor`'s generic backstop, and the two remaining client-level TEST-02/ROTATE-03 gaps (grant round-trip send, post-rotation send-to-new-plane) are closed with spec-derived, non-self-referential assertions.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-17T19:14:00Z
- **Completed:** 2026-07-17T19:18:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Added `export class MissingChannelKeyError extends Error` (co-located near `sendMessage`, mirroring `RelayManagementError`'s convention — the first custom error class in `packages/concord`), carrying a typed `readonly channelId` field and the exact message `"missing private channel key"`.
- Factored the CHAN-02 guard into a private `requireChannelKey(channelId)` helper shared identically by `sendMessage` and `sendEvent`: throws `MissingChannelKeyError` when the channel is folded (in `state$.value.channels`), private, and `hasChannelKey(this.material, channelId)` is false — before `channelEpoch`/`planeKeyFor` are ever reached. `planeKeyFor`'s generic `unknown channel` throw is untouched and remains the backstop for a truly-unknown id.
- Confirmed the export is reachable from the package root (`applesauce-concord`'s `client/index.ts` → root `index.ts` `export *` chain); the concord exports inline snapshot now lists `MissingChannelKeyError`.
- Added TEST-02 case 4: a keyless private channel's `sendMessage` rejects `instanceof MissingChannelKeyError` with the exact message and `channelId`, explicitly distinct from the generic `unknown channel` throw.
- Added TEST-02 case 5: after `receiveChannelKeys` folds a previously-dropped key back in, a subsequent `sendMessage` resolves and the message lands in the channel's plane timeline — closing the "grant flow still works once folded" gap.
- Extended the existing rotate test (`community.test.ts:144+`) with the ROTATE-03/CHAN-05 client-level assertion: captured the actual published wrap's `pubkey` after a post-rotation `sendMessage` and asserted it equals the hand-derived epoch-2 `channelGroupKey(...)` address (CORD-03 §1 private branch, computed directly — never via `channelKeyFor`/`deriveConcordKeys`) and differs from the epoch-1 address.

## Task Commits

Each task was committed atomically:

1. **Task 1: MissingChannelKeyError + sendMessage/sendEvent guard** - `5c57ff41` (feat)
2. **Task 2: CHAN-02 reject + TEST-02 case 5 grant round-trip** - `f7c9b2a6` (test)
3. **Task 3: ROTATE-03 client-level — rotate then send addresses the new plane** - `2600a8c4` (test)

## Files Created/Modified

- `packages/concord/src/client/community.ts` - Added `MissingChannelKeyError`; added `requireChannelKey` private guard called at the top of `sendMessage` and `sendEvent`.
- `packages/concord/src/client/__tests__/community.test.ts` - Added TEST-02 case 4 (keyless send rejects) and case 5 (grant round-trip send succeeds) tests; extended the existing private-channel rotation test with a post-rotation send + spec-derived plane-address assertion; captured `pool.publish` in both tests to inspect the actual wrap.
- `packages/concord/src/__tests__/exports.test.ts` - Updated the concord exports inline snapshot to include `MissingChannelKeyError` (Rule 1 auto-fix, see Deviations).

## Decisions Made

- `MissingChannelKeyError` stays a minimal standalone class with no shared base — no base error class exists anywhere in `packages/concord`, and inventing one was explicitly out of scope per RESEARCH.md §5.
- TEST-02 case 5 reuses the single-engine setup shape of case 4 (mint → drop key locally via `leaveChannel` → re-grant via `receiveChannelKeys`) rather than extending the existing cross-engine Direct Invite test at `community.test.ts:253+`. The cross-engine test's `memberEngine` never syncs the owner's control-plane editions (the fake pool's `subscription()` returns `NEVER`), so `memberEngine.sendMessage` would fail there for an unrelated reason (no folded `ChannelMetadata` entry to derive a plane from) rather than exercising the CHAN-02/case-5 behavior the plan asks for. The plan's own behavior spec ("same channel; call receiveChannelKeys([key]); a subsequent sendMessage... resolves") matches the single-engine continuation shape used here.
- For the ROTATE-03 client-level assertion, plane identity was verified via the actual `NostrEvent.pubkey` on the wrap captured from a stubbed `pool.publish` (the gift wrap is signed by the plane's stream secret key, so its `pubkey` is exactly the plane's `GroupKey.pk`) rather than adding any new introspection API — no production code needed to change to make this observable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated the concord exports inline snapshot broken by Task 1's new package-root export**
- **Found during:** Task 3's full-package verification (`pnpm --filter applesauce-concord test`)
- **Issue:** `src/__tests__/exports.test.ts` asserts an inline snapshot of every symbol exported from the package root. Task 1's `MissingChannelKeyError` export (intentional, and the acceptance criterion "reachable from the package root") is new, so the pre-existing snapshot no longer matched.
- **Fix:** Regenerated the inline snapshot (`vitest -u` on the single test file), then manually confirmed `MissingChannelKeyError` appears in the correct alphabetized position and no other export changed.
- **Files modified:** `packages/concord/src/__tests__/exports.test.ts`
- **Verification:** `pnpm --filter applesauce-concord test` — 211/211 green (was 210/211 with 1 failing before the fix).
- **Committed in:** `2600a8c4` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — stale snapshot, directly caused by this plan's intentional new export)
**Impact on plan:** Necessary to keep the full package suite green per the plan's own atomicity requirement. No scope creep — the fix is a one-line snapshot regeneration confirming the intended new export, not new functionality.

## Issues Encountered

None beyond the auto-fixed snapshot above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All five TEST-02 Accordian-named cases now pass across Plans 01 (cases 1-3) and 03 (cases 4-5).
- CHAN-01 through CHAN-07, ROTATE-03, and TEST-01/TEST-02 are all closed for this phase; `MissingChannelKeyError` is the phase's headline consumer-facing artifact for the field-confirmed Accordian composer bug.
- Full `applesauce-concord` package suite (211 tests) and full monorepo `pnpm vitest run` (2086 tests, 2 pre-existing skipped) both green; full monorepo `pnpm run build` (18/18 tasks) green.
- No further work identified for this phase; ready for `/gsd-verify-work` / phase closeout.

---
*Phase: 07-private-channel-keying*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 3 modified files confirmed present on disk; all 3 commit hashes (`5c57ff41`, `f7c9b2a6`, `2600a8c4`) confirmed in `git log --oneline --all`.
