---
phase: 05-cache-identity-memo-fix
plan: 13
subsystem: documentation
tags: [applesauce-common, cache, comments, groups, encrypted-content-cache, D-08]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (prior rounds)
    provides: identity-memo/carry-forward/accumulated-state taxonomy in applesauce-core's cache.ts, verified descriptor mechanics for groups.ts's Reflect.set
provides:
  - groups.ts's getHiddenGroups comment discloses the undefined-memoization defect as a known, deliberately-deferred bug with its traced consequence chain, instead of ratifying the site as sound
  - encrypted-content-cache.ts's markEncryptedContentFromCache comment states one legible, honestly-scoped warning about the provenance flag's instance-locality
affects: [05-14 (deferral register — must record the groups.ts defect this plan's comment points at), 05.1-symbol-propagation-redesign (destination phase for the eventual fix)]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - packages/common/src/helpers/groups.ts
    - packages/common/src/helpers/encrypted-content-cache.ts

key-decisions:
  - "groups.ts's comment now discloses the undefined-memoization chain rather than framing the explicit Reflect.set as merely redundant; the descriptor mechanics claim was retained verbatim (verified true in a prior round) and only the closing framing was replaced"
  - "encrypted-content-cache.ts's fail-open reachability is stated as explicitly unverified rather than asserted, after tracing EventMemory.add and confirming it discards same-id duplicate objects and keeps the originally-tracked instance — which argues against reachability via the ordinary EventStore.add path but was not exhaustively proven across replaceable-history/cross-store paths"

patterns-established: []

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "groups.ts's getHiddenGroups comment discloses the undefined-memoization defect (poisoned GroupsHiddenSymbol on a locked-read) as a known, deliberately-deferred bug with its traced consequence chain through isHiddenGroupsUnlocked and unlockHiddenGroups, while retaining the true descriptor mechanics and changing zero executable lines"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (505/505 passing, no regression, no new test added per plan's lock)"
        status: pass
      - kind: other
        ref: "grep-based acceptance gates: banned phrases absent, defect-disclosure markers present, unlockHiddenGroups/isHiddenGroupsUnlocked/getOrComputeCachedValue named >=2x, no file:line citations, non-comment diff empty"
        status: pass
    human_judgment: true
    rationale: "Whether the rewritten comment actually reads as an honest disclosure (vs. a technically-passing-grep but still-misleading rewrite) requires human judgment of prose quality, which grep gates cannot fully capture."
  - id: D2
    description: "encrypted-content-cache.ts's markEncryptedContentFromCache comment replaces the unparseable closing fragment with one legible warning about the provenance flag's instance-locality and its effect on persistEncryptedContent's dedup filter, explicitly marking fail-open reachability as unverified rather than asserting or hedging illegibly"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (505/505 passing, no regression)"
        status: pass
      - kind: other
        ref: "grep-based acceptance gates: 'goes untested' fragment absent, persistEncryptedContent named >=2x, no file:line citations, non-comment diff empty"
        status: pass
    human_judgment: true
    rationale: "Legibility ('a reader can actually extract the warning') is inherently a human-judgment criterion; grep can only confirm the banned fragment is gone and the retained claim is present, not that the replacement reads clearly."

duration: ~15min
completed: 2026-07-16
status: complete
---

# Phase 05 Plan 13: Fix two defective applesauce-common comments (GAP 5a, GAP 6) Summary

**Rewrote groups.ts's getHiddenGroups comment to disclose (not ratify) a real undefined-memoization defect, and replaced encrypted-content-cache.ts's unparseable provenance-warning fragment with one legible, honestly-scoped sentence — zero runtime behavior changed in either file.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-16T04:46:53Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- `groups.ts`'s `getHiddenGroups` comment no longer ends with a soundness endorsement ("this explicit Reflect.set is redundant, not load-bearing" / "correctly does not survive a spread"); it now names the traced consequence chain and marks the defect known and deliberately deferred, pointing at `.planning/STATE.md`'s Deferred Items table.
- `encrypted-content-cache.ts`'s `markEncryptedContentFromCache` comment no longer ends in an unparseable welded fragment ("...gates persistEncryptedContent below — assuming provenance survives dedup goes untested"); it now states one complete, legible warning and explicitly marks the fail-open's practical reachability as unverified.
- `pnpm --filter applesauce-common test` passes at the expected 505-test baseline in both commits.
- Non-comment diff is empty for both files — `getHiddenGroups`, `isHiddenGroupsUnlocked`, `unlockHiddenGroups`, `markEncryptedContentFromCache`, `isEncryptedContentFromCache`, and `persistEncryptedContent` are byte-identical to HEAD.

## Traced Consequence Chain (groups.ts, `getHiddenGroups`)

Verified directly against `getOrComputeCachedValue` (`packages/core/src/helpers/cache.ts`) and `getHiddenTags`/`isHiddenTagsUnlocked` (`packages/core/src/helpers/hidden-tags.ts`) before writing the comment:

1. `getOrComputeCachedValue` gates only on `Reflect.has` and then unconditionally `Object.defineProperty`s whatever `compute()` returns — including `undefined` — with `enumerable: false, writable: true, configurable: true`.
2. `getHiddenGroups`'s callback returns `undefined` whenever `getHiddenTags(bookmark)` returns `undefined` (the hidden-tags-locked case). When this happens, `getOrComputeCachedValue` permanently memoizes `undefined` on `GroupsHiddenSymbol` for that event object.
3. `getHiddenGroups`'s own early-return branch (`if (GroupsHiddenSymbol in bookmark) return bookmark[GroupsHiddenSymbol] as GroupPointer[];`) then hands that poisoned `undefined` back — cast as `GroupPointer[]` — on every future call to `getHiddenGroups` for that object, even after the hidden tags are later genuinely unlocked by some other path.
4. **Precondition established by reading `isHiddenGroupsUnlocked` and `isHiddenTagsUnlocked`:** `isHiddenGroupsUnlocked` short-circuits on `isHiddenTagsUnlocked(bookmark) &&` before it ever reaches its own `GroupsHiddenSymbol in bookmark` check. Since `isHiddenTagsUnlocked` only returns `true` once the hidden tags are genuinely unlocked (its own cache write in `getHiddenTags`/`setHiddenTagsCache` never fires on the locked path — no analogous poisoning there), a caller who has not yet unlocked the tags never observes the `getHiddenGroups` poisoning through `isHiddenGroupsUnlocked`. **The poisoned memo only becomes observable through `isHiddenGroupsUnlocked`/`unlockHiddenGroups` once the hidden tags are subsequently unlocked by some path other than `unlockHiddenGroups` itself** (e.g., a separate direct call to `unlockHiddenTags` on the same bookmark).
5. Once that precondition is met, `isHiddenGroupsUnlocked`'s `GroupsHiddenSymbol in bookmark` check is satisfied by the poisoned symbol (its mere presence, regardless of value) — so `isHiddenGroupsUnlocked` returns `true` against a bookmark that does not actually hold unlocked groups, and its type guard lies.
6. `unlockHiddenGroups`'s `if (isHiddenGroupsUnlocked(bookmark)) return bookmark[GroupsHiddenSymbol];` short-circuit then hands back that poisoned `undefined` directly — bypassing `unlockHiddenGroups`'s own `if (!groups) throw new Error("Failed to unlock hidden groups")` guard further down, and violating its `Promise<GroupPointer[]>` return-type signature.
7. **Confirmed this is the ONLY reachable bypass:** a direct call to `unlockHiddenGroups` on an already-poisoned-but-still-locked bookmark does NOT hit the bug — its `isHiddenGroupsUnlocked` short-circuit is `false` (tags not yet unlocked), so it falls through to `unlockHiddenTags` then `getHiddenGroups`, whose own poisoned early return IS caught by the explicit `if (!groups) throw` guard.

**getHiddenGroups's runtime logic was NOT changed.** No regression test or changeset was added for this defect, per the plan's locked decision context (Phase 5 is comment-only in `applesauce-common`; the fix is deferred to the symbol-propagation-redesign phase, 05.1).

## Task 2 (encrypted-content-cache.ts) — Fail-Open Reachability Investigation

**Branch taken: explicitly marked unverified.** Investigation before writing the comment:

- `EncryptedContentFromCacheSymbol` is confirmed NOT a member of `EventStore.copySymbolsToDuplicateEvent`'s merge list (`const symbols = [FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol];` in `packages/core/src/event-store/event-store.ts`) — the retained claim is true.
- Traced `EventMemory.add` (`packages/core/src/event-store/event-memory.ts`): `const current = this.events.get(id); if (current) return current;` — for a same-id duplicate, the newly-arrived object is discarded entirely and the ORIGINALLY-TRACKED object instance is what flows through `insert$`/`update$`. Since `EncryptedContentFromCacheSymbol` is never copied at all (not in the merge list), and the tracked instance's own identity never changes on an ordinary duplicate delivery, this specific path does not appear to hand `persistEncryptedContent`'s filter a "fresh object lacking the flag."
- This evidence argues AGAINST reachability via the ordinary `EventStore.add` duplicate-delivery path, but replaceable-event tie-break paths (`database.getReplaceableHistory`, which may or may not return the same object references as `this.memory`) and any cross-store/external-cloning paths were not traced — those are out of scope for a comment-only fix and would require deeper investigation than this plan's remit.
- The comment therefore states what is known (instance-local, not merged, filter purpose) and marks the fail-open's practical reachability as explicitly unverified, per the plan's escape hatch, rather than fabricating certainty or preserving the original garbled hedge.

## Task Commits

Each task was committed atomically:

1. **Task 1: Stop groups.ts's comment from ratifying a site with an undisclosed defect (GAP 5a)** - `7d4ca5b1` (docs)
2. **Task 2: Make encrypted-content-cache.ts's provenance warning legible (GAP 6)** - `c73a3fa6` (docs)

_Note: comment-only fixes per plan scope; no test/feat commits were created since no executable behavior changed._

## Files Created/Modified

- `packages/common/src/helpers/groups.ts` - `getHiddenGroups`'s comment rewritten to disclose the undefined-memoization defect with its traced chain; descriptor mechanics retained; zero executable lines changed.
- `packages/common/src/helpers/encrypted-content-cache.ts` - `markEncryptedContentFromCache`'s comment rewritten to one legible warning about instance-locality and the `persistEncryptedContent` filter, with fail-open reachability marked unverified; zero executable lines changed.

## Decisions Made

- Kept the groups.ts descriptor-mechanics claim ("Reflect.set here is not the final write; the enclosing getOrComputeCachedValue redefines the symbol non-enumerable") verbatim in substance since it was independently verified true against `getOrComputeCachedValue`'s source in this round.
- Chose to state the encrypted-content-cache.ts fail-open reachability as explicitly unverified after a partial trace (EventMemory.add) suggested non-reachability via the primary path but did not rule out replaceable-history/cross-store edge cases — honest incompleteness over false confidence, per the plan's explicit permission.

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed within their locked scope: comment-only changes, no behavior fix for `getHiddenGroups`, no regression test, no changeset, no file:line citations, no banned phrases.

## Issues Encountered

`pnpm --filter applesauce-common test` initially failed workspace-wide with `Cannot find package 'applesauce-core/helpers'` because `packages/core/dist` did not exist in this freshly-created worktree (a pre-existing environment gap, not caused by this plan's comment-only edits). Resolved by running `pnpm --filter applesauce-core build` before re-running the common package's test suite, which then passed at the expected 505/505 baseline. This did not touch any tracked files (`dist/` is gitignored) and required no commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `groups.ts`'s comment now points at `.planning/STATE.md`'s Deferred Items table as the routing record for the `getHiddenGroups` undefined-memoization defect. Plan 05-14 (or whichever plan owns the deferral register) must land a matching row so the comment's pointer resolves to an actual recorded item — this plan intentionally did NOT add that row itself (out of this plan's scope per the plan's `artifacts_this_phase_produces` note).
- No blockers for downstream work. Both files pass their full test suites and the workspace's `applesauce-common` build target is unaffected (no executable change).

---

*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-16*
