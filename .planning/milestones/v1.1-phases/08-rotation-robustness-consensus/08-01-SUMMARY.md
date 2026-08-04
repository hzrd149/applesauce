---
phase: 08-rotation-robustness-consensus
plan: 01
subsystem: auth
tags: [concord, rekey, refounding, epoch-walk, race-convergence, vitest]

# Dependency graph
requires: []
provides:
  - "rekeyHandled: Map<epoch, key> down-only latch in both community.ts (root) and private-channel.ts (channel), replacing the boolean Set that could never revisit a decided epoch"
  - "Shared isStrictlyLowerKey helper (rekey.ts) — lowerKeyWins + byte-inequality — the single down-only comparison used by the live checkRekey latch, the root-scope sync-walk cascade, and the channel-scope backward re-read"
  - "sync.ts: syncEpoch's 'known' branch folds a historical epoch's already-fetched rekey plane via readRekey instead of discarding it, surfacing EpochResult.reReadAdopted"
  - "sync.ts: syncEpochs cascades a strictly-lower reReadAdopted winner into the walk — discards chain[i+1..] and rebuilds the continuation from the corrected root"
  - "channel-sync.ts: syncChannelEpochs runs a backward re-read pass over channelKey.held (oldest-first) before the forward walk, with the same strictly-lower cascade-and-rebuild shape"
affects: [08-02, 08-03, 08-04, 08-05, 08-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Down-only anti-refork latch: Map<epoch, key> compared via a shared isStrictlyLowerKey(existing, candidate) predicate, reused identically by every call site that could re-decide an epoch"
    - "Re-read spine: a walk that already fetched an epoch's rekey plane folds it via the SAME read function used for the tip, instead of discarding it once the epoch is classified 'known'/held"
    - "Cascade rebuild: when a re-read finds a strictly-lower winner for a settled epoch, discard the pre-built continuation from that point and let the normal forward walk regenerate it fresh from the corrected key (never retroactively patch persisted material)"

key-files:
  created:
    - packages/concord/src/client/__tests__/sync.test.ts
    - packages/concord/src/client/__tests__/channel-sync.test.ts
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/private-channel.ts
    - packages/concord/src/helpers/rekey.ts
    - packages/concord/src/client/sync.ts
    - packages/concord/src/client/channel-sync.ts
    - packages/concord/src/helpers/__tests__/channel-rekey.test.ts

key-decisions:
  - "isStrictlyLowerKey centralized in rekey.ts (not duplicated per call site) so the live latch, root-scope cascade, and channel-scope cascade provably use the identical down-only ordering"
  - "The 'known' branch's re-read only surfaces an 'adopt' outcome (reReadAdopted); a 'removed' outcome for a historical epoch is not reconsidered — out of this plan's scope (racing-rotation convergence only)"
  - "Cascade rebuild regenerates chain[i+1..] (root) / the forward continuation (channel) purely via the normal walk mechanism from the corrected root/key — no retroactive mutation of persisted material, matching the plan's Open Question 2 resolution"

patterns-established:
  - "Pattern: any future scope that gains its own rekey/rotation concept should route its down-only decision through isStrictlyLowerKey rather than hand-rolling a comparison"

requirements-completed: [ROTATE-06]

coverage:
  - id: D1
    description: "A held/adopted (non-tip) epoch's rekey plane is re-read on a later full sync, discovering a strictly-lower authorized sibling that arrived late (root and channel scopes)"
    requirement: "ROTATE-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/sync.test.ts#re-reads a known epoch's rekey plane; a late-arriving strictly-lower sibling cascades into N+2"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/channel-sync.test.ts#heals a held epoch to a late-arriving strictly-lower sibling and rebuilds N+2 from it"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/channel-rekey.test.ts#re-reading with a late-arriving lower sibling heals down to the CORD-06 §3 minimum (D-04 down-only re-heal)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A settled epoch can never re-fork: once a key is latched (live checkRekey) or re-derived as the walk's chain entry, only a strictly-lower key ever replaces it — an equal-or-higher sibling is ignored"
    requirement: "ROTATE-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/sync.test.ts#re-reading the SAME (non-strictly-lower) winner again leaves a settled epoch untouched (down-only)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/channel-sync.test.ts#re-reading a held epoch with no strictly-lower sibling leaves the chain untouched"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-concord test -- community.test.ts private-channel.test.ts (rekeyHandled Map regression coverage)"
        status: pass
    human_judgment: false
  - id: D3
    description: "When a re-read of a historical epoch discovers a strictly-lower winner than the walk's already-recorded next epoch, the continuation is discarded and rebuilt from the corrected lower root (cascades into N+2, not just N+1)"
    requirement: "ROTATE-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/sync.test.ts#re-reads a known epoch's rekey plane; a late-arriving strictly-lower sibling cascades into N+2"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/channel-sync.test.ts#heals a held epoch to a late-arriving strictly-lower sibling and rebuilds N+2 from it"
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 1: Down-only re-read spine + anti-refork latch (D-04) Summary

**Replaced `rekeyHandled: Set<number>` with a per-epoch `Map<epoch, key>` down-only latch and made both the root (`sync.ts`) and channel (`channel-sync.ts`) epoch walks re-read a settled epoch's rekey plane on every full sync, cascading a strictly-lower late-arriving sibling into the continuation.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-19T14:26:00Z (approx, first commit 14:28:56)
- **Completed:** 2026-07-19T14:45:47Z
- **Tasks:** 3
- **Files modified:** 8 (6 modified, 2 new test files)

## Accomplishments
- `rekeyHandled` is a `Map<number, Uint8Array>` in both `community.ts` (root scope) and `private-channel.ts` (channel scope); a second outcome for an already-latched epoch is adopted only when `isStrictlyLowerKey(latched, candidate)` — an equal-or-higher sibling is ignored, closing the "boolean can't express down-only" gap (Pitfall 4).
- `syncEpoch`'s `chainHasNext` ("known") branch now folds the already-fetched rekey events via `readRekey` instead of discarding them, surfacing a strictly-lower re-adopted root on `EpochResult.reReadAdopted` without changing the "known" classification for the normal case.
- `syncEpochs` compares a known epoch's `reReadAdopted` winner against the already-built `chain[i+1]`; a strictly-lower sibling discards `chain[i+1..]` and rebuilds the continuation from the corrected root, letting the forward walk regenerate everything past it (Open Question 2's "no retroactive persisted mutation needed" resolution).
- `syncChannelEpochs` gained a symmetric backward re-read pass over `channelKey.held` (oldest-first), reusing `syncRekeyAndAdvance` per held epoch and cascading a strictly-lower correction forward exactly like the root scope.
- A single shared `isStrictlyLowerKey` helper (rekey.ts) — `lowerKeyWins` + a byte-inequality check — is the one down-only comparison every call site (live latch, root cascade, channel cascade) uses, so all three provably agree on the same ordering (the plan's `key_links` requirement).

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace rekeyHandled Set with a per-epoch down-only latch (both scopes)** - `75ec9792` (feat)
2. **Task 2: Root-scope re-read spine + down-only cascade rebuild (sync.ts)** - `69e18b92` (feat)
3. **Task 3: Channel-scope backward re-read spine over channel.held (channel-sync.ts)** - `d923dc10` (feat)

_No plan-metadata commit yet — SUMMARY.md/STATE.md/ROADMAP.md land in the final docs commit._

## Files Created/Modified
- `packages/concord/src/helpers/rekey.ts` - added `isStrictlyLowerKey(existing, candidate)`, the shared down-only comparison
- `packages/concord/src/client/community.ts` - `rekeyHandled` → `Map<epoch, Uint8Array>`; `checkRekey` and `refound()` use the graded latch
- `packages/concord/src/client/private-channel.ts` - same latch change for the channel scope's `checkRekey`
- `packages/concord/src/client/sync.ts` - `EpochResult.reReadAdopted`; `syncEpoch`'s known branch re-reads; `syncEpochs` cascades the correction
- `packages/concord/src/client/channel-sync.ts` - new `reReadHeldChannelEpochs` backward pass wired into `syncChannelEpochs`
- `packages/concord/src/client/__tests__/sync.test.ts` - new; 3-epoch root cascade oracle + a down-only idempotency case, hand-derived fixed-byte keys
- `packages/concord/src/client/__tests__/channel-sync.test.ts` - new; the same two-case shape for the channel scope, driving `syncChannelEpochs` directly
- `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` - new down-only re-heal case proving `readChannelRekey` converges to the CORD-06 §3 minimum

## Decisions Made
- Centralized `isStrictlyLowerKey` in `rekey.ts` rather than duplicating the comparison in `community.ts`/`private-channel.ts`/`sync.ts`/`channel-sync.ts` — the plan's `key_links` explicitly requires the live latch and the re-sync cascades to agree on exactly the same ordering, and a shared function is the only way to guarantee that by construction rather than by convention.
- The "known" branch's re-read (`sync.ts`) and the channel backward pass (`channel-sync.ts`) only surface/act on an "adopt" outcome — a "removed" outcome discovered for a historical/held epoch is left unhandled, matching the plan's explicit scope (racing-rotation convergence, ROTATE-06/07) rather than expanding into removal-reconsideration semantics not asked for here.
- Cascade rebuild is purely a forward-walk regeneration (root: `chain = [...chain.slice(0, i+1), correctedMaterial]`; channel: re-walk `syncRekeyAndAdvance` from the corrected key) — no retroactive mutation of persisted `material`/`held_roots`, matching Pitfall 3's recommended resolution to Open Question 2 (the in-memory latch, A3, doesn't need to persist either — a fresh walk always re-derives correctly from whatever material is passed in).

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria (source assertions + required tests) were met without needing any Rule 1-4 auto-fixes; the only additions beyond the plan's literal file list were the shared `isStrictlyLowerKey` helper (implied by the plan's `key_links` requirement that "both must agree on strictly-lower-only") and one extra client-level test file (`channel-sync.test.ts`) added for direct coverage of the new `syncChannelEpochs` cascade branch beyond the plan-mandated `channel-rekey.test.ts` helper-level test.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The down-only latch + re-read spine this plan lands is the prerequisite the plan's objective calls out: 08-03's ROTATE-05/06/07 decision-logic plans can now build on a walk that actually revisits settled epochs, rather than a `syncEpochs` that marks every non-tip epoch permanently "known".
- No blockers. `pnpm --filter applesauce-concord test` is green (45 files / 217 tests), the full downstream build (`core`, `signers`, `common`, `loaders`, `relay`, `concord`) is green, and the concord exports snapshot is unchanged (no new public API surface — `isStrictlyLowerKey`/`reReadAdopted` are internal implementation details, not part of the rolled-up `Helpers`/top-level export contract this snapshot checks).

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 9 created/modified files confirmed present on disk; all 3 task commit hashes (`75ec9792`, `69e18b92`, `d923dc10`) confirmed in git history.
