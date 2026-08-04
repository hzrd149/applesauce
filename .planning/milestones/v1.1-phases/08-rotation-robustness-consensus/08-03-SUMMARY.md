---
phase: 08-rotation-robustness-consensus
plan: 03
subsystem: concord
tags: [rekey, refounding, nip44, convergence, rotation]

# Dependency graph
requires:
  - phase: 08-01
    provides: down-only re-read spine / per-epoch latch (helpers/rekey.ts's isStrictlyLowerKey, client/sync.ts, client/channel-sync.ts) — this plan's `none` outcome relies on that spine for passive retry
provides:
  - readRekeyScoped restructured around a decryptable-vs-opaque candidate partition
  - A caught decrypt error at our own locator is positive evidence of inclusion, never removal (ROTATE-05, D-06)
  - An opaque competing fork (no blob, or decrypt-threw) coexisting with a decryptable candidate forces defer (none, D-10) instead of blind adoption (ROTATE-07)
  - Spec-strict removal is unchanged when the winner is fully decryptable and excludes us
affects: [08-04, 08-05, 08-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decryptable-vs-opaque candidate partition inside a scope-generic convergence fold: classify each complete/authorized/continuity set into a decryptable winner-candidate or an unranked opaque set (no blob at all, or a blob whose decrypt threw), then gate adoption on the absence of opaque competitors and removal on the presence of a genuine no-blob set"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts

key-decisions:
  - "D-06's transient-decrypt case reuses the existing {kind:\"none\"} outcome — no new ScopedRekeyOutcome/RekeyOutcome/ChannelRekeyOutcome variant; the external contract is byte-identical to before this plan"
  - "A decrypt-throw at our own locator is tracked separately from a genuine no-blob exclusion: it can only contribute to the ambiguity/defer check (forcing none when a decryptable candidate also exists), never to the removal path — matching D-06's 'must not contribute to removal' requirement precisely"
  - "D-10's opaque-fork deferral only fires when a decryptable candidate ALSO exists; with zero decryptable candidates, a decrypt-throw-only situation still resolves to none (not removed), since only a genuine no-blob set can justify removal"

requirements-completed: [ROTATE-05, ROTATE-06, ROTATE-07]

coverage:
  - id: D1
    description: "A transient decrypt failure at our own locator (e.g. a NIP-46 bunker blip) never self-evicts — outcome resolves to none, retried passively via the 08-01 re-read spine"
    requirement: "ROTATE-05"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#a transient decrypt failure at our own locator yields none, never removed (ROTATE-05, D-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A decryptable candidate coexisting with an authorized+complete+continuity opaque competing fork we cannot decrypt defers (none) rather than blindly adopting a non-provable winner"
    requirement: "ROTATE-07"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#a decryptable candidate coexisting with an opaque competing fork defers (none), never adopts (ROTATE-07, D-10)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Among multiple decryptable candidates with no opaque competitor, the lexicographically lowest new key wins (down-only convergence settles via the 08-01 latch)"
    requirement: "ROTATE-06"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#among two decryptable candidates, the lexicographically lowest new key wins (ROTATE-06/07, D-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Spec-strict removal is unchanged when the winner is fully decryptable (by other holders) and excludes us, with no opaque competitor in play"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#a single complete authorized fork excluding us still removes (spec-strict removal control, D-03)"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 03: Decryptable-vs-Opaque Rekey Convergence Summary

**Restructured `readRekeyScoped`'s per-set fold into an explicit decryptable-vs-opaque candidate partition, closing H09 (transient bunker blip self-evicts) and M02 (winner computed only among sets carrying our blob), with the external `ScopedRekeyOutcome`/`RekeyOutcome`/`ChannelRekeyOutcome` shapes unchanged.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-19T13:45:00Z
- **Completed:** 2026-07-19T14:06:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `readRekeyScoped` now partitions each complete/authorized/continuity-checked rotation into a decryptable candidate (blob found and decrypted) or an opaque one (no blob at all, or a blob whose decrypt threw), tracked with a `noBlobRotators` list (genuine exclusion, removal-eligible) distinct from a `opaqueCompetitor` ambiguity flag (both no-blob AND decrypt-throw contribute to ambiguity, but only no-blob contributes to removal)
- A caught decrypt error at our own locator (D-06) now only ever contributes to the defer/ambiguity check, never to `removed` — verified by a spec-derived oracle asserting `{kind: "none"}` against a signer whose `nip44.decrypt` always throws, even with an outranking `canRemoveSelf`
- An opaque competing fork alongside a decryptable candidate now forces `{kind: "none"}` (D-10 defer) instead of the prior silent adoption of a possibly-non-winning fork — verified by racing two authorized Refoundings to the same epoch, one decryptable and one excluding the victim entirely
- Spec-strict removal (winner fully decryptable by other holders, excludes us, no opaque competitor) is unchanged — a dedicated control test confirms `{kind: "removed"}` still fires in that unambiguous case
- Lowest-key tie-break among multiple decryptable candidates (no opaque competitor) verified against a hand-computed lexicographic comparison, independent of `lowerKeyWins`/`readRekeyScoped` themselves

## Task Commits

Each task was committed atomically:

1. **Task 1: Partition readRekeyScoped into decryptable vs opaque candidates** - `c9a36bcc` (fix)
2. **Task 2: Spec-derived oracles — transient decrypt, opaque-fork defer, lowest-key tie-break** - `17ae8ce7` (test)

## Files Created/Modified
- `packages/concord/src/helpers/keys.ts` - `readRekeyScoped` restructured: decryptable/opaque partition, `noBlobRotators` (removal-eligible), `opaqueCompetitor` (defer-eligible, includes decrypt-throw); doc comment rewritten to describe the new partition
- `packages/concord/src/helpers/__tests__/keys.test.ts` - New `describe("readRekeyScoped convergence — ROTATE-05/06/07 (D-06/D-10)")` block with 5 spec-derived oracles: transient-decrypt, opaque-fork-deferral, lowest-key tie-break, spec-strict removal control, plus the `withThrowingDecrypt` signer-wrapper test helper

## Decisions Made
- D-06's transient-decrypt case reuses `{kind: "none"}` — no new outcome variant, per the plan's `key_links` requirement that the external contract stay unchanged
- Decrypt-throw and genuine no-blob exclusion are tracked as two SEPARATE signals internally (`opaqueCompetitor` boolean vs `noBlobRotators` array), not one combined "opaque" bucket — this was necessary to satisfy D-06's "never contributes to removal" requirement precisely: a decrypt-throw-only situation (zero decryptable candidates, zero genuine no-blob sets) now correctly falls through to `none`, not `removed`
- No changeset created — `packages/concord` is unreleased (per project instructions, concord changes skip changesets)

## Deviations from Plan

None - plan executed exactly as written. The restructure matched the 6-step design from 08-RESEARCH.md's Pitfall 1 (with the decrypt-throw refinement from Pitfall 2 folded in as a third internal classification rather than literally merging it into "opaque"), and both tasks' acceptance criteria passed without needing follow-up fixes.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `readRekeyScoped`'s partition is scope-generic, so both `readRekey` (root) and `readChannelRekey` (channel) inherit the fix from this one restructure — no channel-specific follow-up needed for ROTATE-05/06/07
- Full `applesauce-concord` suite (224 tests) and `tsc --noEmit` both pass clean after this plan
- 08-04/08-05/08-06 (remaining phase 8 plans covering `vac` citation, majority-gated publish confirmation, and remaining rulings) are unaffected by and do not depend on this plan's internal restructure beyond the unchanged `ScopedRekeyOutcome`/`RekeyOutcome`/`ChannelRekeyOutcome` contract

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED
- FOUND: packages/concord/src/helpers/keys.ts
- FOUND: packages/concord/src/helpers/__tests__/keys.test.ts
- FOUND: c9a36bcc
- FOUND: 17ae8ce7
