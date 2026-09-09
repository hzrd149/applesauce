---
phase: 07-private-channel-keying
plan: 01

# Dependency graph
requires:
  - phase: 06-refounding-rotation-authority-correctness
    provides: non-enumerable cache memo (Phase 5/5.1) that makes rollForwardChannel's spread drop stale plane-key memos
provides:
  - material.channels as the SOLE source of channel key material (ChannelMetadata.key/.epoch removed)
  - Total (never-fallthrough) channelSecret/channelKeyFor/voiceKeysFor/deriveKeys returning null for a keyless private channel
  - hasChannelKey(material, channelId) shared affordance in helpers/community.ts
  - channelEpochs sourced from the held key's own epoch, never the edition's
  - foldControl channel loop rewritten: explicit typed field pick (name/private/deleted/voice/custom), never key/epoch from edition JSON
  - Sticky channel-deletion terminality with heads pinned to the deleting edition, surviving a compaction + fresh-joiner fold
affects: [07-02, 07-03, accordian-downstream-consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Total (never-partial) branches for key derivation: null return for 'no key held', never a silent fallthrough to a different (wrong) address"
    - "Sticky-deleted fold: heads.set AND the emitted-list decision derive from ONE scan result, never two independent computations"
    - "Spec-derived, non-self-referential tests: expected values computed only from crypto.ts primitives, cited to the spec section"

key-files:
  created: []
  modified:

key-decisions:
  - "channelSecret/channelKeyFor/voiceKeysFor/deriveKeys all return null (never throw, never fall through) for a keyless private channel — a routine, expected state during a whole-community fold pass"
  - "Multiple simultaneous authorized deleted:true editions for one channel id tiebreak on lowest rumorId, mirroring headCandidates' existing convention"
  - "channelKeyMemo's null result is itself memoized via cache.has (not truthiness) so a cached 'no key' verdict isn't recomputed every call"

patterns-established:
  - "Total (never-partial) branches for key derivation — every 'key absent' case returns null and is skipped by the caller, never defaulted"
  - "Sticky-deleted fold: both heads.set and the push/skip decision must derive from the same single scan of ALL authorized candidates for an entity"

requirements-completed: [CHAN-01, CHAN-03, CHAN-04, CHAN-05, CHAN-07, ROTATE-03, TEST-02]

coverage:
  - id: D1
    description: "A private channel with visible metadata but no held key derives no channel GroupKey, no keys.channels entry, no channelEpochs entry, and registers no plane (CHAN-01/H07)"
    requirement: "CHAN-01"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "Public and keyed-private channels still derive channel_pk from the CORD-03 §1 formula (hand-derived, non-self-referential)"
    requirement: "TEST-02"
    verification:
      - kind: unit
        status: pass
      - kind: unit
        status: pass
    human_judgment: false
  - id: D3
    description: "channelEpochs records the held key's actual epoch, never ch.epoch ?? 1 off the edition"
    requirement: "CHAN-03"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D4
    description: "foldControl picks name/private/deleted/voice/custom explicitly with type validation and never reads key/epoch from edition JSON"
    requirement: "CHAN-04"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D5
    description: "A channel with any authorized deleted:true edition is permanently dropped and heads is pinned to that deleting edition, surviving a compaction + fresh-joiner fold"
    requirement: "CHAN-07"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D6
    description: "rollForwardChannel's output addresses the new epoch's channel plane, independently derived from the CORD-03 §1 private formula (ROTATE-03)"
    requirement: "ROTATE-03"
    verification:
      - kind: unit
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-07-17
status: complete
---

# Phase 07 Plan 01: Channel key single-source-of-truth refactor + sticky-delete fold Summary

**Removed `ChannelMetadata.key`/`.epoch` and made `material.channels` the sole source of channel key material — a keyless private channel now derives nothing instead of silently deriving the public address (H07), `foldControl` never reads key material from edition JSON (H06), and sticky channel-deletion survives a compaction + fresh-joiner fold (CHAN-07).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-17T18:43:00Z
- **Completed:** 2026-07-17T18:57:00Z
- **Tasks:** 3 (+ 1 auto-fixed downstream call site)
- **Files modified:** 7

## Accomplishments

- `channelSecret`/`channelKeyFor`/`voiceKeysFor`/`deriveKeys` in `community.ts` became total over the private branch, returning `null` for a keyless private channel instead of falling through to the `community_root`-derived public address.
- Added `hasChannelKey(material, channelId)` — the shared "do I hold a key for this?" affordance replacing hand-rolled `material.channels.find(...)` lookups, consumed by Plans 02/03.
- Rewrote `foldControl`'s channel loop (`control.ts`) to pick `name`/`private`/`deleted`/`voice`/`custom` explicitly with type validation, drop the edition-JSON key merge entirely, and enforce sticky channel-deletion: any authorized `deleted:true` candidate permanently drops the channel AND pins `heads` to that deleting edition (not the ordinary version-chain head), so a later compaction cannot republish a resurrection attempt.
- Added four hand-derived spec-derived tests to `keys.test.ts` (CHAN-01 keyless-derives-nothing, both CORD-03 §1 branches, CHAN-03 held-epoch) and two fold-level tests to `control.test.ts` (CHAN-04 explicit field pick + malformed-input resilience, CHAN-07 delete→resurrect→compact→fresh-joiner-fold round trip).
- Confirmed `channel-rekey.test.ts`'s existing ROTATE-03 spec-derived probe still passes unchanged post-refactor.

## Task Commits

Each task was committed atomically:

1. **Task 1: Atomic channel-key source-of-truth refactor + foldControl loop rewrite** - `7d926b85` (feat)
2. **Task 2: Derivation spec-derived tests — CHAN-01, CHAN-03, TEST-01 both branches** - `f92bbf31` (test)
3. **Task 3: Fold-level tests — CHAN-04 explicit field pick + CHAN-07 compaction round-trip** - `372df9e8` (test)

Auto-fixed downstream call site (Rule 3 — blocking build error caused directly by Task 1's type removal): `f4ec1c84` (fix)

## Files Created/Modified


## Decisions Made

- Kept the plan's adopted tiebreak for multiple simultaneous authorized `deleted:true` editions at different versions: lowest `rumorId`, mirroring `headCandidates`' existing convention at `control.ts:85`. No spec ruling was needed since any deterministic tiebreak is correct as long as every client picks the same one.
- `channelKeyMemo`'s cache stores `GroupKey | null` and is checked with `cache.has(sig)` rather than truthiness, so a cached "no key held" result is honored rather than recomputed on every call within the same `material` object's lifetime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed a downstream compile error caused by removing `ChannelMetadata.epoch`**
- **Found during:** Post-Task-1 verification (`pnpm run build`)
- **Fix:** Dropped the epoch badge display entirely (display-only, not load-bearing; the per-channel epoch is client-local key state not exposed on `ChannelMetadata` post-refactor, and reconstructing it would need new plumbing out of this plan's scope).
- **Verification:** `pnpm --filter applesauce-examples exec tsc -b --force` clean; full monorepo `pnpm run build` green (18/18 tasks).
- **Committed in:** `f4ec1c84`

---

**Total deviations:** 1 auto-fixed (1 blocking build error, downstream of the plan's intentional breaking type removal)
**Impact on plan:** Necessary to keep the build green per the plan's own atomicity requirement ("the package must compile + the existing suite pass at commit time," extended here to the full monorepo build gate). No scope creep — the fix is a one-line display removal, not new functionality.

## Issues Encountered

None beyond the auto-fixed downstream call site above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `hasChannelKey` is exported and ready for Plans 02/03 to consume (CHAN-06's `accessible` view enrichment, CHAN-02's `sendMessage` guard).
- `channelKeyFor`/`voiceKeysFor`/`channelSecret` are now `T | null` throughout — any new call site added in 02/03 must handle the null case (never re-add a fallthrough).
- No `!` non-null assertions were added around the nullable-ripple functions (`channelSecret`/`channelKeyFor`/`voiceKeysFor`) — confirmed by diff grep.

---
*Phase: 07-private-channel-keying*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 7 files created/modified confirmed present on disk; all 4 commit hashes (`7d926b85`, `f92bbf31`, `372df9e8`, `f4ec1c84`) confirmed in `git log --oneline --all`.
