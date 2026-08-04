---
phase: 05-cache-identity-memo-fix
plan: 07
subsystem: docs
tags: [applesauce-core, applesauce-common, cache, taxonomy, comments, event-store]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (plan 06)
    provides: the corrected canonical write-site taxonomy in cache.ts that this plan's comments must agree with
provides:
  - Zero false "propagated via the merge list" citations in the four files this plan owns (relays.ts, event-store.ts, async-event-store.ts, encrypted-content-cache.ts)
  - A re-runnable repo-wide sweep (scoped to merge-list mentions, copySymbolsToDuplicateEvent mentions, and event-store.ts line citations) with a recorded per-hit verdict
affects: [05-08]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Cite the merge mechanism by symbol/function name, never file:line (WR-04) — line citations are invalidated by the same commit that writes them"]

key-files:
  created: []
  modified:
    - packages/common/src/helpers/encrypted-content-cache.ts
    - packages/core/src/helpers/relays.ts
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/async-event-store.ts

key-decisions:
  - "Task 3's sweep found a fourth surviving false-format citation (packages/core/src/helpers/event.ts:177-178, markFromCache's bare 'event-store.ts:219' line reference) that is NOT in this plan's files_modified — that file is explicitly owned by sibling plan 05-08 (files_modified lists it directly) and was left untouched to avoid a cross-worktree collision, per the parallel-executor scope boundary. The claim itself is true (FromCacheSymbol genuinely is a merge-list member); only its line-number citation format violates WR-04. Recorded here as an escape for 05-08 rather than fixed, mirroring the plan's own precedent for 'wave-1 escapes' it doesn't own."
  - "Two other .ts:<line> citations surfaced during the sweep (packages/core/src/helpers/encrypted-content.ts:119 and packages/common/src/operations/gift-wrap.ts:127) are out of this plan's Task 3 scope entirely — neither cites the event-store.ts merge list or copySymbolsToDuplicateEvent; both cite operations/tags.ts and operations/event.ts line numbers for an unrelated (CR-02 stale-classification) defect. Both files are explicitly owned by sibling plans (05-08 and 05-11 respectively per their files_modified) and were left untouched."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "encrypted-content-cache.ts's markEncryptedContentFromCache comment states EncryptedContentFromCacheSymbol is NOT propagated across duplicate events at all (not a merge-list member), with the persistEncryptedContent consequence stated"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (505 tests, 63 files)"
        status: pass
      - kind: other
        ref: "grep -B4 'Reflect.set(event, EncryptedContentFromCacheSymbol' packages/common/src/helpers/encrypted-content-cache.ts | grep -cE 'NOT propagated|not propagated' >= 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "relays.ts's addSeenRelay comment cites the real mechanism (the element-wise seen-relays merge in EventStore.copySymbolsToDuplicateEvent) instead of the symbol merge list"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (635 tests, 57 files)"
        status: pass
      - kind: other
        ref: "grep -c copySymbolsToDuplicateEvent packages/core/src/helpers/relays.ts >= 1; grep -c event-store.ts:219 returns 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "event-store.ts's merge loop no longer claims to be the canonical/executable definition of accumulated state, consistent with 05-06's corrected category 3"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -c 'canonical/executable definition' packages/core/src/event-store/event-store.ts returns 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "EventStoreSymbol exclusion comments in event-store.ts and async-event-store.ts state the real source/dest direction of copySymbolsToDuplicateEvent (source = incoming duplicate, discarded; dest = stored event)"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -c 'keeps its own store reference' returns 0 in both files; grep -B4 'Reflect.set(inserted, EventStoreSymbol' event-store.ts | grep -cE 'incoming|stored' >= 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "Repo-wide sweep of core+common (scoped to merge-list mentions, copySymbolsToDuplicateEvent mentions, event-store.ts line citations) with per-hit verdicts recorded"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "git diff HEAD~2 -- packages/core/src packages/common/src ':(exclude)*__tests__*' | grep -E '^\\+' | grep -vE '^\\+\\+\\+' | grep -vE '^\\+\\s*(\\*|/\\*|//)' returns nothing (comment-only diff)"
        status: pass
      - kind: other
        ref: "turbo build --filter='./packages/*' — 14/14 successful"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 07: Correct downstream merge-list citations in core/common Summary

**Corrected two false "propagated via the symbol merge list" citations (CR-04, WR-06) and one canonical-definition overclaim in the four files this plan owns; a full repo-wide sweep found one additional, out-of-scope false-format citation which is documented here as belonging to sibling plan 05-08 rather than fixed, to respect worktree isolation.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-15
- **Tasks:** 3 (2 produced commits; Task 3 is a verification sweep and produced no additional file changes)
- **Files modified:** 4

## Accomplishments

- `packages/common/src/helpers/encrypted-content-cache.ts`'s `markEncryptedContentFromCache` comment no longer likens `EncryptedContentFromCacheSymbol` to `FromCacheSymbol`'s merge-list propagation (false — the symbol appears nowhere in `packages/core/src`). It now states plainly that the symbol is NOT propagated across duplicate events at all, and names the practical consequence: `isEncryptedContentFromCache` gates the `persistEncryptedContent` pipeline, so an author who assumes restore provenance survives event-store dedup won't think to test the path where it doesn't.
- `packages/core/src/helpers/relays.ts`'s `addSeenRelay` comment no longer cites the symbol merge list for `SeenRelaysSymbol` (false — it's not a member of `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`). It now names the real mechanism: the separate element-wise seen-relays merge inside `EventStore.copySymbolsToDuplicateEvent`.
- `packages/core/src/event-store/event-store.ts`'s symbol merge loop comment no longer claims to be "the canonical/executable definition of the category" (false, per 05-06's corrected category 3 — `SeenRelaysSymbol` and common's gift-wrap symbols propagate by different mechanisms). It now states only what's true: these three symbols propagate via this loop rather than object spread, and explicitly disclaims sole-definition status.
- `packages/core/src/event-store/event-store.ts` and `packages/core/src/event-store/async-event-store.ts`'s `EventStoreSymbol` exclusion comments no longer claim "a duplicate event keeps its own store reference" (backwards — both call sites pass the incoming duplicate as `source`, which is discarded, and the stored event as `dest`). Both now state the real direction: exclusion protects the stored event (`dest`) from acquiring the incoming duplicate's (`source`) store reference.
- All four comments cite the merge mechanism by symbol/function name only (`EventStore.copySymbolsToDuplicateEvent`, `getSeenRelays`/`addSeenRelay`) — zero `.ts:<line>` citations remain in any of the four files this plan owns.

## Task Commits

1. **Task 1: Correct the two false merge-list citations (CR-04, relays.ts)** - `f2c880d8` (docs)
2. **Task 2: Correct the merge-loop and EventStoreSymbol comments (CR-01 downstream, WR-06)** - `4d25d215` (docs)
3. **Task 3: Prove no false merge-list citation survives in core or common** - no commit (verification-only task; sweep found one out-of-scope escape, documented below, and produced no in-scope file changes)

_All commits are docs (comment-only); zero behavior change, per D-08._

## Files Created/Modified

- `packages/common/src/helpers/encrypted-content-cache.ts` - `markEncryptedContentFromCache`'s comment corrected to state non-propagation
- `packages/core/src/helpers/relays.ts` - `addSeenRelay`'s comment corrected to cite the real element-wise merge mechanism
- `packages/core/src/event-store/event-store.ts` - merge loop comment and `EventStoreSymbol` exclusion comment both corrected
- `packages/core/src/event-store/async-event-store.ts` - `EventStoreSymbol` exclusion comment corrected

## Task 3: Full Sweep Hit List and Per-Hit Verdicts

Sweep scope (per the plan's Task 3 action text): every mention of the merge list, `copySymbolsToDuplicateEvent`, and any surviving `event-store.ts` line citation, across `packages/core/src` and `packages/common/src`, excluding `__tests__`.

| # | Hit (file:line) | Code read to confirm | Verdict |
|---|---|---|---|
| 1 | `packages/core/src/helpers/relays.ts:16-18` (`addSeenRelay`) | `EventStore.copySymbolsToDuplicateEvent` — the element-wise `for (const relay of relays) addSeenRelay(dest, relay)` branch | **Fixed in Task 1.** Now cites the real mechanism by function name. |
| 2 | `packages/common/src/helpers/encrypted-content-cache.ts:38-41` (`markEncryptedContentFromCache`) | `grep -rn "EncryptedContentFromCacheSymbol" packages/core/src` — zero hits; the symbol is not a merge-list member | **Fixed in Task 1.** Now states non-propagation explicitly. |
| 3 | `packages/core/src/event-store/event-store.ts:222-224` (merge loop) | `copySymbolsToDuplicateEvent` in full; `cache.ts`'s corrected category 3 | **Fixed in Task 2.** No longer claims sole/canonical definition. |
| 4 | `packages/core/src/event-store/event-store.ts:296-299` (`EventStoreSymbol`, sync `add`) | `add`'s three `copySymbolsToDuplicateEvent(event, winner\|existing\|inserted)` call sites — `event` (incoming) is always `source`, the stored event is always `dest` | **Fixed in Task 2.** Direction corrected. |
| 5 | `packages/core/src/event-store/async-event-store.ts:264-266` (`EventStoreSymbol`, async `add`) | `async add`'s three `copySymbolsToDuplicateEvent(event, winner\|existing\|inserted)` call sites — verified independently, same direction as the sync store | **Fixed in Task 2.** Direction corrected. |
| 6 | `packages/core/src/helpers/cache.ts:27-42` (category 3 taxonomy) | Read in full | **Survives — true.** Corrected in 05-06 (wave 1); this plan's four comments are consistent with it. |
| 7 | `packages/core/src/event-store/event-store.ts:199,272,287,307` and `async-event-store.ts:239,254,274` (`copySymbolsToDuplicateEvent` call sites) | Read each call site | **Survives — true.** Plain function calls, not comments; nothing to correct. |
| 8 | `packages/core/src/helpers/event.ts:176-179` (`markFromCache`) | `EventStore.copySymbolsToDuplicateEvent`'s `const symbols = [FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` — `FromCacheSymbol` **is** a literal member | **Survives content-true, format-stale — NOT fixed here.** The claim ("propagated via the merge list") is correct: `FromCacheSymbol` genuinely is a member. Only the citation format (`event-store.ts:219`, a bare line number) violates WR-04. **This file is explicitly listed in sibling plan 05-08's `files_modified`** (`.planning/phases/05-cache-identity-memo-fix/05-08-PLAN.md` frontmatter); fixing it here would edit a file owned by a parallel worktree executor. Left untouched and reported as an escape for 05-08 to close, mirroring the plan's own "wave-1 escape" precedent for hits it doesn't own. |
| 9 | `packages/core/src/helpers/encrypted-content.ts:117-122` (`setEncryptedContentCache`) | Read in full — self-classifies as "identity memo" and cites `operations/tags.ts:87`/`operations/event.ts:134,163` | **Out of Task 3's scope — not a merge-list/copySymbolsToDuplicateEvent citation.** Cites unrelated line numbers for the pre-CR-02 stale classification 05-06's summary explicitly assigns to 05-08 ("Next Phase Readiness" section). File is in 05-08's `files_modified`. Not fixed here. |
| 10 | `packages/common/src/operations/gift-wrap.ts:117-131` (`wrapSeal`'s `GiftWrapSymbol`/`SealSymbol`/`EncryptedContentSymbol` writes) | `getSealGiftWrap`/`getGiftWrapSeal`; `EncryptedContentSymbol`'s two write sites per `cache.ts`'s worked example | **Survives — true, and out of Task 3's scope anyway.** "Propagated by reference... not by spread" for `GiftWrapSymbol`/`SealSymbol` is accurate (shared object reference, no event-store merge involved); the `operations/tags.ts:87` citation on the `EncryptedContentSymbol` write is unrelated to the merge list. File is in sibling plan 05-11's `files_modified`. Not fixed here. |

**Zero `"machine-readable definition"` hits** (`grep -rn "machine-readable definition" packages/core/src packages/common/src` returns nothing) — confirms no wave-1 escape of that specific phrase.

**Behavior gate:** `git diff HEAD~2 -- packages/core/src packages/common/src ':(exclude)*__tests__*' | grep -E '^\+' | grep -vE '^\+\+\+' | grep -vE '^\+\s*(\*|/\*|//)'` returns nothing — every added line across both packages in this plan's commits is a comment.

**Test/build gates:** `pnpm --filter applesauce-core --filter applesauce-common test` — 635 + 505 tests, all pass. `pnpm turbo build --filter='./packages/*'` — 14/14 successful.

## Decisions Made

- Hit #8 (`event.ts`'s `markFromCache`) is content-true but citation-format-stale; left unfixed and reported rather than corrected, because the file is explicitly owned by sibling plan 05-08 running in a parallel worktree. Fixing it here would risk a cross-worktree file collision, which the parallel-executor protocol explicitly forbids ("stay strictly within your plan's declared files_modified scope"). This plan's own acceptance criteria (`grep -rn "event-store.ts:219" packages/core/src packages/common/src` returns no lines) is therefore not fully satisfied at the whole-directory level by this plan alone — it will be satisfied once 05-08 closes this specific hit, which its plan's own scope (encompassing `event.ts`) makes a natural fit for.
- Hits #9 and #10 are outside Task 3's actual scope (merge-list/`copySymbolsToDuplicateEvent`/`event-store.ts`-line-citation mentions only) and are unrelated CR-02-class defects already explicitly assigned to sibling plans 05-08 and 05-11 per 05-06's SUMMARY and those plans' own `files_modified`. Documented for completeness of the sweep; not fixed.

## Deviations from Plan

### Auto-fixed Issues

None — all planned Task 1 and Task 2 edits applied exactly as specified.

### Scope Boundary Notes (not deviations — documented per Task 3's instruction to record every hit)

**1. [Rule 4 pattern — scope conflict, resolved by deferral, not by asking] Task 3's acceptance criterion `grep -rn "event-store.ts:219" packages/core/src packages/common/src` returns no lines cannot be fully satisfied by this plan alone**
- **Found during:** Task 3 (the required completeness sweep)
- **Issue:** The sweep surfaced `packages/core/src/helpers/event.ts:177-178` (`markFromCache`) still citing the bare line number `event-store.ts:219`. The underlying claim is true (`FromCacheSymbol` is genuinely a merge-list member), but the citation format violates WR-04, and the plan's own acceptance criteria check this pattern across the whole of `packages/core/src`/`packages/common/src`, not just this plan's four `files_modified`.
- **Why not auto-fixed:** `packages/core/src/helpers/event.ts` is explicitly listed in sibling plan 05-08's `files_modified` (confirmed by reading `.planning/phases/05-cache-identity-memo-fix/05-08-PLAN.md`'s frontmatter). The parallel-execution protocol for this wave explicitly instructs "Stay strictly within your plan's declared files_modified scope — do not edit files owned by sibling plans," which takes precedence over completing this one acceptance-criteria grep to zero on this plan's own commits.
- **Resolution:** Documented as hit #8 in the sweep table above with full verdict and citation; not modified. 05-08 owns this file and is well-positioned to close it as part of its own pass (its plan targets `encrypted-content.ts`'s closely related pre-CR-02 stale citations in the same file family).
- **Files modified:** None (deliberately left unmodified)
- **Verification:** Confirmed the claim is true by reading `EventStore.copySymbolsToDuplicateEvent`'s `symbols` array; confirmed file ownership by reading 05-08's plan frontmatter.

---

**Total deviations:** 0 auto-fixed; 1 scope-boundary deferral (documented, not a defect in this plan's own delivered files)
**Impact on plan:** This plan's four owned files (`relays.ts`, `encrypted-content-cache.ts`, `event-store.ts`, `async-event-store.ts`) are fully corrected with zero surviving false citations and zero `.ts:<line>` citations. The one surviving repo-wide hit is in a file this plan does not own and cannot safely edit under the wave's worktree-isolation rules.

## Issues Encountered

None — both in-scope tasks' automated verify commands and acceptance-criteria greps passed on first attempt (after one intermediate comment-length adjustment in Task 1 to keep the required phrase within the `-B4` grep window; not a defect, just grep-window tuning). `pnpm --filter applesauce-core --filter applesauce-common test` stayed green (635 + 505 tests) across both commits, and `pnpm turbo build --filter='./packages/*'` reported 14/14 successful.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- This plan's four files are the corrected oracle for any future comment referencing `EventStore.copySymbolsToDuplicateEvent`'s merge semantics from `packages/core` or `packages/common`.
- **Escape for 05-08:** `packages/core/src/helpers/event.ts`'s `markFromCache` (lines 176-179) still cites `event-store.ts:219` as a bare line number. The claim is true; only the citation format is stale. 05-08 already has this file in `files_modified` and should apply the same WR-04 fix pattern used here (cite `EventStore.copySymbolsToDuplicateEvent` by name) while it's in the file for its own CR-02 mirror work.
- Not an escape, but adjacent: `packages/core/src/helpers/encrypted-content.ts`'s `setEncryptedContentCache` (05-08's explicit CR-02 mirror target) and `packages/common/src/operations/gift-wrap.ts`'s `EncryptedContentSymbol` write comment (05-11's file) both still cite `operations/tags.ts:87`/`operations/event.ts:134,163` by line number — outside this plan's scope, already tracked by those plans.

## Self-Check: PASSED

All modified files verified present on disk with expected content (`packages/common/src/helpers/encrypted-content-cache.ts`, `packages/core/src/helpers/relays.ts`, `packages/core/src/event-store/event-store.ts`, `packages/core/src/event-store/async-event-store.ts`). Both commit hashes (`f2c880d8`, `4d25d215`) verified present in `git log --oneline --all`.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
