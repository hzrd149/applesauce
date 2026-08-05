---
phase: 05-cache-identity-memo-fix
plan: 03
subsystem: core
tags: [documentation, cache, symbols, taxonomy, concord]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix
    provides: "05-01's non-enumerable cache.ts fix and its landed identity-memo/carry-forward/accumulated-state taxonomy prose, which this plan's comments cite"
provides:
  - "Every hand-rolled symbol-write site in applesauce-core and applesauce-common (35 sites: 15 core + 20 common) carries a one-line category comment naming its taxonomy category and citing cache.ts"
  - "The corrected CONCORD-H01 reasoning at concord/helpers/keys.ts's BaseKeysSymbol and ChannelPlaneKeysSymbol block comments, safe for Phase 6-7 authors to read while working on rollForward/rollForwardChannel"
affects: [06-refounding-core, 07-channel-rekey-robustness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Category comment convention: identity memo | carry-forward payload | accumulated state, one-liner immediately above (or on the last line immediately above) the write, citing cache.ts"

key-files:
  created: []
  modified:
    - packages/core/src/helpers/relays.ts
    - packages/core/src/helpers/hidden-tags.ts
    - packages/core/src/helpers/encrypted-content.ts
    - packages/core/src/helpers/filter.ts
    - packages/core/src/helpers/event.ts
    - packages/core/src/helpers/contacts.ts
    - packages/core/src/casts/cast.ts
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/async-event-store.ts
    - packages/core/src/operations/event.ts
    - packages/core/src/operations/tags.ts
    - packages/common/src/helpers/mute.ts
    - packages/common/src/helpers/encrypted-content-cache.ts
    - packages/common/src/helpers/lists.ts
    - packages/common/src/helpers/bookmark.ts
    - packages/common/src/helpers/groups.ts
    - packages/common/src/helpers/emoji-pack.ts
    - packages/common/src/helpers/app-data.ts
    - packages/common/src/helpers/trusted-assertions.ts
    - packages/common/src/helpers/gift-wrap.ts
    - packages/common/src/operations/gift-wrap.ts
    - packages/concord/src/helpers/keys.ts

key-decisions:
  - "Restructured several multi-line comments so the category term (identity memo / carry-forward payload / accumulated state) lands on the physical line immediately preceding the Reflect.set call, satisfying the plan's per-line acceptance check rather than only the comment block as a whole"
  - "Reworded operations/tags.ts:87's comment to avoid the literal substring 'Reflect.set', since the D-10 grep contract greps for that exact text and a comment containing it would inflate the completeness count"
  - "For operations/event.ts's two carry-forward sites, moved the category comment between the if-condition and its single-statement body (valid JS/TS) rather than adding braces, preserving the zero-behavior-change/comment-only diff guarantee"

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "All 14 grep-visible core sweep sites (of 15 total) carry a category comment naming identity memo/carry-forward payload/accumulated state and citing cache.ts"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -rn Reflect.set packages/core/src packages/common/src --include=*.ts | grep -v __tests__ (35 hits: 34 real sweep sites + cache.ts's own literal-text false positive)"
        status: pass
    human_judgment: false
  - id: D2
    description: "operations/tags.ts:87, the non-grep-visible carry-forward worked example, is commented"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep -n carry-forward payload packages/core/src/operations/tags.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "All 20 common sweep sites carry a category comment; operations/gift-wrap.ts:121 (the only common carry-forward site) gets the strongest wording"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test"
        status: pass
    human_judgment: false
  - id: D4
    description: "Combined D-10 grep across core+common shows 34/34 real sweep sites documented, matching the plan's authoritative post-05-01 count"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep -rn Reflect.set packages/core/src packages/common/src --include=*.ts | grep -v __tests__ | grep -v cache.ts:36 | wc -l -> 34"
        status: pass
    human_judgment: false
  - id: D5
    description: "The false CONCORD-H01 reasoning at keys.ts's BaseKeysSymbol comment is corrected: states the safety claim is true only post-05-01 (non-enumerable write), cites CONCORD-H01, names the JSON.stringify/spread asymmetry, retains the persistence-safety half"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test"
        status: pass
      - kind: other
        ref: "grep -c non-enumerable / H01 / JSON.stringify / spread in packages/concord/src/helpers/keys.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "Zero behavior change across all 22 modified files — every changed line is a comment line"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "git diff -U0 <base>..HEAD -- packages/core/src packages/common/src packages/concord/src/helpers/keys.ts | grep '^[+-]' | grep -v comment/blank -> empty"
        status: pass
    human_judgment: false

# Metrics
duration: 55min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 03: Cache sweep classification + CONCORD-H01 comment fix Summary

**Comment-only pass across 22 files: 35 hand-rolled symbol-write sites (15 core, 20 common) each now name their identity-memo/carry-forward-payload/accumulated-state category and cite the cache.ts taxonomy, plus the false pre-05-01 reasoning at concord's keys.ts is corrected to explain why it's now true.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-15T17:34:00Z
- **Completed:** 2026-07-15T18:00:00Z (approx)
- **Tasks:** 3 completed
- **Files modified:** 22

## Accomplishments
- All 15 core sweep sites (relays.ts, hidden-tags.ts x2, encrypted-content.ts, filter.ts, event.ts x2, contacts.ts, casts/cast.ts, event-store.ts x2, async-event-store.ts, operations/event.ts x2, operations/tags.ts) carry a category one-liner citing cache.ts
- All 20 common sweep sites (mute.ts, encrypted-content-cache.ts, lists.ts, bookmark.ts, groups.ts, emoji-pack.ts x2, app-data.ts, trusted-assertions.ts, gift-wrap.ts x6, operations/gift-wrap.ts x5) carry the same convention, with operations/gift-wrap.ts:~131 (the sole common carry-forward site) getting the most detailed warning since it sits amid otherwise-uniform accumulated-state writes
- The D-10 grep contract re-run at completion returns exactly 34 documented hits (matching the plan's authoritative post-05-01 count), plus the one non-grep-visible worked example at operations/tags.ts:87
- The false CONCORD-H01 reasoning in concord/helpers/keys.ts is corrected at both the BaseKeysSymbol block comment and the analogous ChannelPlaneKeysSymbol comment in deriveChannelKeys — both now state the safety claim is true only because of the 05-01 non-enumerable fix, cite CONCORD-H01, and explain the JSON.stringify/spread asymmetry

## Task Commits

Each task was committed atomically:

1. **Task 1: Classify and comment the 15 core sweep sites** - `ca1a75e4` (docs)
2. **Task 2: Classify and comment the 20 common sweep sites** - `542cc3c2` (docs)
3. **Task 3: Correct the false comment at concord keys.ts (BaseKeysSymbol + ChannelPlaneKeysSymbol)** - `47d9f1f1` (docs)

_No plan-metadata commit — orchestrator handles that after wave completion per worktree-mode instructions._

## Files Created/Modified
- `packages/core/src/helpers/relays.ts` - `SeenRelaysSymbol` write commented as accumulated state
- `packages/core/src/helpers/hidden-tags.ts` - two `HiddenTagsSymbol` writes commented as identity memo
- `packages/core/src/helpers/encrypted-content.ts` - `setEncryptedContentCache`'s dual-lifecycle comment (identity memo that must stay enumerable because the symbol is also a carry-forward payload elsewhere)
- `packages/core/src/helpers/filter.ts` - `EventIndexableTagsSymbol` write commented as identity memo
- `packages/core/src/helpers/event.ts` - `EventUIDSymbol` (identity memo) and `FromCacheSymbol` (accumulated state) writes commented
- `packages/core/src/helpers/contacts.ts` - `HiddenContactsSymbol` write commented as identity memo
- `packages/core/src/casts/cast.ts` - `CASTS_SYMBOL` write commented as identity memo
- `packages/core/src/event-store/event-store.ts` - the merge-list loop (canonical accumulated-state example) and the `EventStoreSymbol` write (deliberately excluded from that merge) both commented
- `packages/core/src/event-store/async-event-store.ts` - `EventStoreSymbol` write commented, same exclusion note
- `packages/core/src/operations/event.ts` - `stamp`/`sign`'s two `EncryptedContentSymbol` writes commented as carry-forward payload, citing `PRESERVE_EVENT_SYMBOLS`
- `packages/core/src/operations/tags.ts` - the non-grep object-literal worked example commented as carry-forward payload
- `packages/common/src/helpers/mute.ts` - `MuteHiddenSymbol` write commented as identity memo
- `packages/common/src/helpers/encrypted-content-cache.ts` - `EncryptedContentFromCacheSymbol` write commented as accumulated state
- `packages/common/src/helpers/lists.ts` - the two-level list cache write commented as identity memo
- `packages/common/src/helpers/bookmark.ts` - `BookmarkHiddenSymbol` write commented as identity memo
- `packages/common/src/helpers/groups.ts` - `GroupsHiddenSymbol` write commented as identity memo
- `packages/common/src/helpers/emoji-pack.ts` - two `FavoriteEmojiPacksHidden*Symbol` writes commented as identity memo
- `packages/common/src/helpers/app-data.ts` - `AppDataContentSymbol` write commented as identity memo
- `packages/common/src/helpers/trusted-assertions.ts` - `TrustedProvidersHiddenSymbol` write commented as identity memo
- `packages/common/src/helpers/gift-wrap.ts` - six `Seal`/`Rumor`/`GiftWrap` symbol writes commented as accumulated state, including the negative-result-sentinel note at the parse-fail site
- `packages/common/src/operations/gift-wrap.ts` - four accumulated-state writes and the sole common carry-forward site (`EncryptedContentSymbol` on the gift) commented, the latter with the strongest warning in the sweep
- `packages/concord/src/helpers/keys.ts` - `BaseKeysSymbol` and `ChannelPlaneKeysSymbol` block comments corrected to state the post-05-01 safety claim, cite CONCORD-H01, and name the JSON.stringify/spread asymmetry

## Decisions Made
- Restructured several multi-line comments so the category term lands on the line immediately preceding the write, to satisfy the plan's literal per-site acceptance check (not just "somewhere in the comment block")
- Reworded the `operations/tags.ts:87` comment to avoid the literal substring "Reflect.set" (writing "a symbol write via Reflect's setter" instead), since the D-10 grep is text-based and a comment containing that exact substring would have inflated the completeness count from 34 to 35 real hits
- For `operations/event.ts`'s two carry-forward sites (`stamp`/`sign`), placed the category comment between the `if` condition and its single-statement body rather than adding braces, keeping the diff strictly comment-only

## Deviations from Plan

None - plan executed exactly as written. All comment placements, categories, and specific-handling instructions (the 4 special core sites, the 2 special common sites, the concord correction shape) were followed per the plan's tables and read_first guidance. The restructuring described above under "Decisions Made" is comment-formatting refinement to satisfy the plan's own stated acceptance criteria, not a deviation from its intent.

## Issues Encountered
- Running `pnpm --filter applesauce-common test` and `pnpm --filter applesauce-concord test` initially failed with module-resolution errors (`Cannot find package 'applesauce-core/helpers/event'`, etc.) because this is a fresh worktree with no built `dist/` output for the workspace packages the tests import via package `exports`. Resolved by running `pnpm --filter <pkg> build` for `applesauce-core`, `applesauce-signers`, `applesauce-common`, `applesauce-relay`, and `applesauce-loaders` before re-running the test suites. This is a pre-existing monorepo build-dependency requirement, unrelated to this plan's comment-only changes — the `dist/` outputs are gitignored and were not committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The core+common sweep is complete and the D-10 grep contract is re-runnable at any future review time (34/34 currently documented)
- Phase 6-7 authors working on `rollForward`/`rollForwardChannel` now have correct in-code reasoning at `keys.ts` instead of the reasoning that caused CONCORD-H01
- No blockers for downstream phases

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*

## Self-Check: PASSED
- FOUND: .planning/phases/05-cache-identity-memo-fix/05-03-SUMMARY.md
- FOUND: ca1a75e4 (Task 1 commit)
- FOUND: 542cc3c2 (Task 2 commit)
- FOUND: 47d9f1f1 (Task 3 commit)
