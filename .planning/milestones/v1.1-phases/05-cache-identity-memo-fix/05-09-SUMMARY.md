---
phase: 05-cache-identity-memo-fix
plan: 09
subsystem: docs
tags: [applesauce-common, cache, taxonomy, comments]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (plan 06)
    provides: the repaired canonical write-site taxonomy in applesauce-core's cache.ts that this plan's comments cite and must agree with
provides:
  - Eight corrected write-site comments in packages/common/src/helpers (app-data.ts, bookmark.ts, lists.ts, mute.ts, emoji-pack.ts x2, trusted-assertions.ts) that state their real enumerable-write spread-survival behavior instead of a false non-survival claim
  - A groups.ts comment correctly describing its one outlier site (final write is non-enumerable, so it genuinely does not survive a spread — the template does NOT apply there)
  - A full D-10 sweep of packages/common/src's Reflect.set write sites with per-hit verdicts and owners, surfacing one unowned escape (encrypted-content-cache.ts) for orchestrator routing
affects: [05-10, 05-11]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Cite by symbol/function name, never file:line (WR-04)", "Confirm a site's actual write mechanism against its code before reusing a shared comment template — do not force a template onto a site whose real shape differs (groups.ts)"]

key-files:
  created: []
  modified:
    - packages/common/src/helpers/app-data.ts
    - packages/common/src/helpers/bookmark.ts
    - packages/common/src/helpers/lists.ts
    - packages/common/src/helpers/mute.ts
    - packages/common/src/helpers/emoji-pack.ts
    - packages/common/src/helpers/groups.ts
    - packages/common/src/helpers/trusted-assertions.ts

key-decisions:
  - "groups.ts's getHiddenGroups site does NOT match the shared template: its explicit Reflect.set is immediately superseded by the enclosing getOrComputeCachedValue's own non-enumerable Object.defineProperty of the same value, so the final descriptor is non-enumerable and the value genuinely does not survive a spread. Commented accurately as the one exception among the eight sites instead of forcing the enumerable-write template onto it (plan's explicit escape hatch: 'If a site does not match that shape, do not force it into the template')."
  - "lists.ts's getOrComputeListCache comment additionally cites 05-CONTEXT.md's Deferred Ideas (where its migration is recorded as deferred, not rejected) since that citation is specific to this site and was flagged by the plan's decision_context."
  - "packages/common/src/helpers/encrypted-content-cache.ts:40 (EncryptedContentFromCacheSymbol) is a genuine escape from the full D-10 sweep: it falsely claims membership in applesauce-core's copySymbolsToDuplicateEvent merge list (which cannot contain a common-defined symbol, since applesauce-core does not import applesauce-common) and cites a bare line number (event-store.ts:219), violating WR-04. It is outside this plan's files_modified and not on the plan's known-owners list (only gift-wrap.ts helpers/operations are pre-assigned to 05-11) — recorded here, not fixed, for the orchestrator to route."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "Eight common write-site comments (app-data.ts, bookmark.ts, emoji-pack.ts x2, groups.ts, lists.ts, mute.ts, trusted-assertions.ts) no longer assert non-survival of a spread where the code does not deliver it; seven confirmed enumerable (DOES survive), one (groups.ts) confirmed non-enumerable (does NOT survive) and commented as the outlier"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (505 tests, 63 files)"
        status: pass
      - kind: other
        ref: "grep -rn 'must not survive a spread' packages/common/src returns nothing"
        status: pass
      - kind: other
        ref: "git diff HEAD -- <7 files> | grep -E '^[+-]' | grep -vE '^(\\+\\+\\+|---)' | grep -vE '^[+-]\\s*(\\*|/\\*|//)' returns nothing (comment-only diff)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Full D-10 sweep of packages/common/src's symbol-keyed Reflect.set write sites (20 hits across helpers/ and operations/), each with a classification verdict and an owner, recorded below for re-run by the verifier"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep -rn 'Reflect\\.set(' packages/common/src --include=*.ts | grep -v __tests__ enumerated and classified per hit (see Task 3 Sweep Results below)"
        status: pass
      - kind: unit
        ref: "turbo build --filter='./packages/*' (14/14 successful)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 09: Reword the eight common write-site comments (D-10 sweep) Summary

**Corrected all eight `packages/common/src/helpers` write-site comments that falsely asserted "must not survive a spread" above enumerable `Reflect.set` calls — seven now state they DO survive today via `pipeFromAsyncArray`'s delete-loop mask, and one (`groups.ts`) is documented as a genuine non-survival outlier whose write is overwritten non-enumerable by the enclosing `getOrComputeCachedValue` call — closing the last of the 14 monorepo-wide false claims (combined with sibling plan 05-08's six core sites).**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-15T17:23:00 (approx)
- **Completed:** 2026-07-15T17:33:00 (approx)
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- `app-data.ts`, `bookmark.ts`, `lists.ts`, `mute.ts` (Task 1) and `emoji-pack.ts` (both sites) and `trusted-assertions.ts` (Task 2) — six files, seven sites — reworded to state their write is a plain enumerable `Reflect.set`, so the value DOES survive a spread today, riding onto a copy whose (hidden) tags/content differ. Each names `pipeFromAsyncArray`'s delete loop (`applesauce-core`'s `helpers/pipeline.ts`) as the per-call-path mask, frames the gap as known and deliberately deferred, and retains its identity-memo classification plus the `cache.ts` taxonomy pointer.
- `groups.ts`'s `getHiddenGroups` site was read carefully and found to NOT match that template: its explicit `Reflect.set(bookmark, GroupsHiddenSymbol, groups)` runs inside `getOrComputeCachedValue`'s `compute` callback, and the value it writes there (enumerable) is immediately superseded — same symbol, same value — by `getOrComputeCachedValue`'s own `Object.defineProperty(event, symbol, { ..., enumerable: false, ... })` once `compute()` returns. The final descriptor is non-enumerable, so this specific site genuinely does not survive a spread, unlike its seven siblings. Reworded to state this accurately instead of forcing the shared template onto a site whose real shape differs — the plan's own escape hatch for exactly this case.
- Task 3 re-ran D-10's sweep contract at its full declared scope (`packages/common/src`, excluding `__tests__` — no `helpers/`-only carve-out), enumerating all 20 symbol-keyed `Reflect.set` call sites across `helpers/` and `operations/`. Fourteen are within this plan or a known sibling owner; one (`encrypted-content-cache.ts:40`) is a genuine escape with no assigned owner, recorded below for the orchestrator.
- `grep -rn "must not survive a spread" packages/common/src` now returns nothing. Combined with sibling plan `05-08`'s six `applesauce-core` sites, the monorepo-wide count of this false claim is zero.

## Task Commits

1. **Task 1: Reword the four list-shaped sites (app-data, bookmark, lists, mute)** - `5cc5acf5` (docs)
2. **Task 2: Reword the four remaining common sites (emoji-pack x2, groups, trusted-assertions)** - `2c1deaf6` (docs)
3. **Task 3: Prove no common site asserts a property its write mechanism lacks** - no code changes (verification-only task; findings recorded below, folded into this SUMMARY commit)

_All tasks are comment-only / doc changes; no separate feat/fix commits were required since zero behavior change was the explicit constraint._

## Files Created/Modified

- `packages/common/src/helpers/app-data.ts` — `getAppDataContent`'s memo-write comment reworded; `Reflect.set` call itself untouched
- `packages/common/src/helpers/bookmark.ts` — `getHiddenBookmarks`'s memo-write comment reworded
- `packages/common/src/helpers/lists.ts` — `getOrComputeListCache`'s two-level-cache comment reworded, with an added pointer to 05-CONTEXT.md's Deferred Ideas for the site's already-recorded deferred migration
- `packages/common/src/helpers/mute.ts` — `getHiddenMutedThings`'s memo-write comment reworded
- `packages/common/src/helpers/emoji-pack.ts` — both `getHiddenFavoriteEmojis` and `getHiddenFavoriteEmojiPackPointers` memo-write comments reworded
- `packages/common/src/helpers/groups.ts` — `getHiddenGroups`'s comment reworded to describe its actual non-enumerable final write, not the shared template
- `packages/common/src/helpers/trusted-assertions.ts` — `getHiddenProviders`'s memo-write comment reworded

## Task 3 Sweep Results — Full D-10 Scope

Ran `grep -rn "Reflect\.set(" packages/common/src --include="*.ts" | grep -v "__tests__"` (excluding comment-only matches) at the full declared D-10 scope. 20 hits, all classified below. Re-running the identical grep should reproduce this exact hit list.

| # | Site (symbol) | Classification / write mechanism | Comment accurate? | Owner |
|---|---|---|---|---|
| 1 | `helpers/app-data.ts` `getAppDataContent` (`AppDataContentSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 1) | 05-09 (this plan) |
| 2 | `helpers/bookmark.ts` `getHiddenBookmarks` (`BookmarkHiddenSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 1) | 05-09 (this plan) |
| 3 | `helpers/lists.ts` `getOrComputeListCache` (dynamic `symbol` param) | identity memo (two-level cache); plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 1) | 05-09 (this plan) |
| 4 | `helpers/mute.ts` `getHiddenMutedThings` (`MuteHiddenSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 1) | 05-09 (this plan) |
| 5 | `helpers/emoji-pack.ts` `getHiddenFavoriteEmojis` (`FavoriteEmojiPacksHiddenSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 2) | 05-09 (this plan) |
| 6 | `helpers/emoji-pack.ts` `getHiddenFavoriteEmojiPackPointers` (`FavoriteEmojiPacksHiddenPointersSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 2) | 05-09 (this plan) |
| 7 | `helpers/groups.ts` `getHiddenGroups` (`GroupsHiddenSymbol`) | identity memo; write is superseded by the enclosing `getOrComputeCachedValue`'s non-enumerable `Object.defineProperty` of the same value — final descriptor is non-enumerable, does NOT survive a spread (the outlier) | Yes (fixed Task 2, documented as the exception) | 05-09 (this plan) |
| 8 | `helpers/trusted-assertions.ts` `getHiddenProviders` (`TrustedProvidersHiddenSymbol`) | identity memo; plain enumerable `Reflect.set` — DOES survive a spread | Yes (fixed Task 2) | 05-09 (this plan) |
| 9 | `helpers/encrypted-content-cache.ts:40` `markEncryptedContentFromCache` (`EncryptedContentFromCacheSymbol`) | claims accumulated-state propagation "the same way `FromCacheSymbol` is (`applesauce-core`'s `event-store.ts:219` merge list)" — **FALSE**: `event-store.ts`'s `copySymbolsToDuplicateEvent` merge list is `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` only (verified by reading the source); it cannot contain a common-defined symbol since `applesauce-core` does not import `applesauce-common`. Also cites a bare line number (`event-store.ts:219`), violating WR-04. | **No — genuine escape, not fixed** | **UNOWNED — outside this plan's `files_modified` and not on the plan's known-owners list. Flagged prominently for the orchestrator to route (05-10, 05-11, or a follow-up gap-closure plan).** |
| 10 | `operations/gift-wrap.ts:84` `sealRumor` (`RumorSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 (per plan's known-owners list) |
| 11 | `operations/gift-wrap.ts:91` `sealRumor` (`SealSymbol`) | accumulated state; mutable `Set` initialization — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 12 | `operations/gift-wrap.ts:119` `wrapSeal` (`GiftWrapSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 13 | `operations/gift-wrap.ts:123` `wrapSeal` (`SealSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 14 | `operations/gift-wrap.ts:131` `wrapSeal` (`EncryptedContentSymbol`) | carry-forward payload — comment cites `operations/tags.ts:87` (a bare line number, WR-04 violation) | Not this plan's call (its stale line-number citation is explicitly named as "05-11 Task 1 Part B's scope" in this plan's decision_context) | 05-11 |
| 15 | `helpers/gift-wrap.ts:55` `addParentSealReference` (`SealSymbol`) | accumulated state; mutable `Set`, grown in place — comment already matches corrected taxonomy | Not this plan's call | 05-11 (per plan's known-owners list) |
| 16 | `helpers/gift-wrap.ts:95` `getRumorSeals` (`SealSymbol`) | accumulated state; lazy `Set` init — comment cites `(line ~53)`, a soft line reference | Not this plan's call | 05-11 |
| 17 | `helpers/gift-wrap.ts:157` `getSealRumor` (`RumorSymbol`, `undefined` sentinel) | accumulated state; negative-result sentinel — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 18 | `helpers/gift-wrap.ts:178` `getSealRumor` (`RumorSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 19 | `helpers/gift-wrap.ts:212` `getGiftWrapSeal` (`GiftWrapSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 |
| 20 | `helpers/gift-wrap.ts:217` `getGiftWrapSeal` (`SealSymbol`) | accumulated state; propagated by reference — comment already matches corrected taxonomy | Not this plan's call | 05-11 |

**Escape requiring orchestrator routing:** hit #9 (`encrypted-content-cache.ts:40`) is the only hit in this sweep with no assigned owner. It sits outside this plan's `files_modified` (only `helpers/{app-data,bookmark,emoji-pack,groups,lists,mute,trusted-assertions}.ts` are in scope here) and is not on the plan's pre-assigned known-owners list (which covers only `helpers/gift-wrap.ts` and `operations/gift-wrap.ts`, both 05-11). Its comment makes a verifiably false merge-list-membership claim and carries a bare line-number citation. Recommend a follow-up gap-closure task.

## Reworded Comment Text (final)

Each of the eight sites now reads (paraphrased per-site derivation clause, shared shape):

> Derived from the [event/list]'s own [hidden tags / content] — identity memo (see applesauce-core's cache.ts taxonomy). Written here with a plain enumerable `Reflect.set`, so it DOES survive a spread today, riding onto a copy whose [hidden tags / content / tags] differ. Only `pipeFromAsyncArray`'s delete loop (applesauce-core's `helpers/pipeline.ts`) scrubs it, and only on the call path that runs it — a coincidence of one code path, not an invariant. Known, deliberately-deferred gap; not migrated to `setCachedValue` here.

`groups.ts`'s `getHiddenGroups` site instead reads:

> Derived from the event's own hidden tags — identity memo (see applesauce-core's cache.ts taxonomy). Unlike this plan's other seven common sites, this explicit `Reflect.set` is NOT the property's final write: it creates an enumerable descriptor, but the enclosing `getOrComputeCachedValue` call immediately redefines the same symbol non-enumerable via `Object.defineProperty` once this compute callback returns, so `GroupsHiddenSymbol`'s descriptor here is non-enumerable today and correctly does not survive a spread — no `pipeFromAsyncArray` delete-loop mask is needed for this site, unlike the sibling sites where that delete loop is the only thing scrubbing the value. This explicit `Reflect.set` is redundant, not load-bearing.

## Decisions Made

- `groups.ts`'s `getHiddenGroups` site was confirmed, by tracing `getOrComputeCachedValue`'s implementation, to NOT match the shared enumerable-write template — its final descriptor is non-enumerable because `getOrComputeCachedValue` redefines the same symbol after `compute()` returns. Commented accurately as the one exception rather than forced into the template, per the plan's explicit instruction to record and comment such discrepancies rather than paper over them.
- `lists.ts`'s comment additionally cites `05-CONTEXT.md`'s Deferred Ideas, since that document specifically names `lists.ts`'s migration as deferred (not rejected) — a targeted addition, not applied to the other seven sites which have no equivalent pre-existing citation.
- `encrypted-content-cache.ts:40` was left untouched (out of `files_modified` scope) despite carrying a verifiably false claim, per this plan's explicit boundary: only fix hits inside this plan's `files_modified`; record unowned out-of-scope hits for the orchestrator instead of self-assigning new scope.

## Deviations from Plan

None — plan executed exactly as written, including its built-in escape hatches (Task 2's "do not force a template onto a site that doesn't match it" and Task 3's "record out-of-scope hits with an owner, or flag as an escape if unowned") being exercised as designed, not as failures.

## Issues Encountered

- Local test environment initially failed `pnpm --filter applesauce-common test` with `Cannot find package 'applesauce-core/helpers'` because `packages/core/dist` did not exist in this fresh worktree (workspace `applesauce-core` link resolves to `package.json`'s `exports` pointing at `./dist/index.js`). Resolved by running `pnpm --filter applesauce-core build` once before the first test run; not a plan deviation since it is standard monorepo setup, not a code change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `grep -rn "must not survive a spread" packages/core/src packages/common/src` returns nothing — combined with sibling plan `05-08`, all 14 originally-flagged sites are closed.
- One unowned escape surfaced by the full-scope sweep (`encrypted-content-cache.ts:40`) needs routing — see Task 3 Sweep Results row #9 above. It is not blocking this plan's own acceptance criteria (which are scoped to `files_modified`), but the orchestrator should decide whether 05-10, 05-11, or a new gap-closure plan picks it up before the phase closes.
- `pnpm --filter applesauce-common test` (505/505) and `turbo build --filter='./packages/*'` (14/14) both green after this plan's changes.
- Zero behavior change confirmed: non-comment-diff gate returned empty for every task; all seven `Reflect.set` call sites and their surrounding code are byte-identical to `HEAD~2`.

## Self-Check: PASSED

All seven modified files verified present on disk (packages/common/src/helpers/{app-data,bookmark,lists,mute,emoji-pack,groups,trusted-assertions}.ts). Both commit hashes (5cc5acf5, 2c1deaf6) verified present in `git log --oneline --all`.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
