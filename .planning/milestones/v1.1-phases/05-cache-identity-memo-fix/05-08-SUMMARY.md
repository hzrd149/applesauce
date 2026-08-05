---
phase: 05-cache-identity-memo-fix
plan: 08
subsystem: docs
tags: [applesauce-core, cache, taxonomy, comments, write-sites]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (plan 06)
    provides: the repaired canonical write-site taxonomy in cache.ts (the oracle every reworded comment in this plan cites and agrees with)
provides:
  - Six core write-site comments (cast.ts, filter.ts, event.ts, hidden-tags.ts x2, contacts.ts) that no longer assert non-survival of a spread over an enumerable Reflect.set
  - encrypted-content.ts's setEncryptedContentCache reclassified as carry-forward payload, matching cache.ts's worked example (CR-02 mirror)
  - A re-runnable D-10 sweep over the full packages/core/src (excluding __tests__) proving no remaining comment asserts a property its write mechanism lacks
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Comment-only defect correction: reword false invariant claims to match actual write-mechanism behavior, without touching the write mechanism itself"]

key-files:
  created: []
  modified:
    - packages/core/src/helpers/encrypted-content.ts
    - packages/core/src/casts/cast.ts
    - packages/core/src/helpers/filter.ts
    - packages/core/src/helpers/event.ts
    - packages/core/src/helpers/hidden-tags.ts
    - packages/core/src/helpers/contacts.ts

key-decisions:
  - "Followed the user's authoritative ruling verbatim (05-VERIFICATION.md): comment-only rewording, no migration to setCachedValue/getOrComputeCachedValue, no enumerability change anywhere."
  - "encrypted-content.ts's new comment avoids the literal substring \"identity memo\" entirely (used \"a memoized value scoped to derivation from the event's own fields\" instead) so the CR-02 mirror reads unambiguously as carry-forward payload, matching this task's own acceptance gate and cache.ts's corrected worked example."
  - "markFromCache's pre-existing comment (event.ts) cited a stale line number (event-store.ts:219); this task's own acceptance criteria require zero .ts:<line> citations file-wide in event.ts, so the citation was switched to a function-name citation (EventStore.copySymbolsToDuplicateEvent) without touching the comment's substantive claim, which was already correct (accumulated state, no false spread-survival assertion). See Deviations."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "encrypted-content.ts's setEncryptedContentCache reclassified from identity memo to carry-forward payload, naming operations/tags.ts's modifyPublicTags as the spread that forces the enumerable write; agrees with cache.ts's corrected worked example"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (635 tests, 57 files)"
        status: pass
      - kind: other
        ref: "grep -B8 'Reflect.set(event, EncryptedContentSymbol, plaintext)' packages/core/src/helpers/encrypted-content.ts | grep -c 'identity memo' returns 0; same window grep -c 'modifyPublicTags' returns 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "cast.ts's performCast comment states the proven consequence: a spread copy inherits the same Map by reference (aliased mutable state), not merely a stale value; names pipeFromAsyncArray's delete loop as the only mask"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -c 'must not inherit a stale cast' packages/core/src/casts/cast.ts returns 0; grep -B4 'Reflect.set(event, CASTS_SYMBOL' | grep -cE 'by reference|aliased|same Map' returns 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "filter.ts's getIndexableTags comment states the memo does survive a tag-changing spread today, so filter matching on the copy evaluates the source's tags; names the mask"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -c 'must not survive a spread' packages/core/src/helpers/filter.ts returns 0; grep -B5 'Reflect.set(event, EventIndexableTagsSymbol' | grep -cE 'does survive|survives|today' returns 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four remaining core sites (event.ts's getEventUID, hidden-tags.ts's getHiddenTags and setHiddenTagsCache, contacts.ts's getHiddenContacts) reworded to the same shape: identity-memo classification retained, present-tense spread survival stated, mask named, framed as a known deliberately-deferred gap, pointing at cache.ts"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -rn 'must not survive a spread' packages/core/src returns no lines; hidden-tags.ts 'identity memo' count = 2, 'must not survive' count = 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-10 sweep re-run at full packages/core/src scope (excluding __tests__) proving zero comments assert a property their write mechanism lacks; hit list with per-hit verdicts and owners recorded below"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test; turbo build --filter='./packages/*' 14/14"
        status: pass
      - kind: other
        ref: "git diff HEAD~2 -- packages/core/src ':(exclude)*__tests__*' | grep non-comment lines returns nothing"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 08: Correct six core write-site comments + CR-02 mirror Summary

**Reworded six core write-site comments (cast.ts, filter.ts, event.ts, hidden-tags.ts x2, contacts.ts) that falsely asserted non-survival of a spread over a plain enumerable `Reflect.set`, and reclassified `setEncryptedContentCache` as carry-forward payload (CR-02 mirror) — zero behavior change, comment-only diff, full D-10 sweep re-run and recorded.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-15
- **Tasks:** 3 (2 produced commits; Task 3 was verification-only, no file changes)
- **Files modified:** 6

## Accomplishments

- `encrypted-content.ts`'s `setEncryptedContentCache` (the CR-02 mirror) no longer self-contradicts — it is now classified carry-forward payload, matching `cache.ts`'s corrected worked example from 05-06, and names `operations/tags.ts`'s `modifyPublicTags` (`{ ...draft, tags }`) as the reason the write must stay enumerable.
- `casts/cast.ts`'s `performCast` comment states the real, proven consequence: a spread copy today inherits the same `Map` by reference (aliased mutable state), not merely a stale value — `performCast(copy, cls)` would return the cast built against the original event and mutate a shared `Map`.
- `helpers/filter.ts`'s `getIndexableTags` comment states the memo does survive a tag-changing spread today, so filter matching on the copy evaluates the source's tags and the `if (!indexable)` guard never recomputes.
- `helpers/event.ts`'s `getEventUID`, `helpers/hidden-tags.ts`'s `getHiddenTags` and `setHiddenTagsCache` (both sites, including the "…onto a" variant wording), and `helpers/contacts.ts`'s `getHiddenContacts` are all reworded to the identical shape: identity-memo classification retained (it was always correct), present-tense survival stated, `pipeFromAsyncArray`'s delete loop named as the only mask (and only on the one call path that runs it), framed as a known, deliberately-deferred gap, pointing at `cache.ts`.
- Full D-10 sweep re-run at its complete declared scope (`packages/core/src`, excluding `__tests__`) — 14 symbol-keyed `Reflect.set` hits enumerated and verdicted (table below); zero remaining false comments anywhere in core.

## Task Commits

1. **Task 1: Correct the CR-02 mirror and the two sites with proven consequences** - `e88b7dc4` (docs)
2. **Task 2: Reword the four remaining core sites** - `5d5c91e2` (docs)
3. **Task 3: Prove no core site asserts a property its write mechanism lacks** - no commit (verification-only; sweep recorded below, zero escapes found inside this plan's `files_modified`)

## Files Created/Modified

- `packages/core/src/helpers/encrypted-content.ts` - `setEncryptedContentCache` comment reclassified carry-forward payload
- `packages/core/src/casts/cast.ts` - `performCast` comment states aliased-`Map`-by-reference consequence
- `packages/core/src/helpers/filter.ts` - `getIndexableTags` comment states present-tense survival
- `packages/core/src/helpers/event.ts` - `getEventUID` comment reworded; `markFromCache` comment's stale line-number citation replaced with a function-name citation (see Deviations)
- `packages/core/src/helpers/hidden-tags.ts` - `getHiddenTags` and `setHiddenTagsCache` comments reworded (both sites)
- `packages/core/src/helpers/contacts.ts` - `getHiddenContacts` comment reworded

## D-10 Sweep — Full `packages/core/src` Scope (excluding `__tests__`)

Every symbol-keyed `Reflect.set` under `packages/core/src`, enumerated per D-10's grep contract (`grep -rn "Reflect.set(" packages/core/src --include="*.ts" | grep -v __tests__`), with a per-hit verdict and owner:

| # | Site | Classification | Write mechanism | Comment verdict | Owner |
|---|------|-----------------|------------------|------------------|-------|
| 1 | `event-store/event-store.ts:225` (`copySymbolsToDuplicateEvent`'s symbol merge loop) | accumulated state | `Reflect.set(dest, symbol, ...)` in a merge loop, not a spread | Accurate — states the merge loop IS the propagation mechanism, no spread-survival claim | 05-07 (running in parallel; not this plan's to edit) |
| 2 | `event-store/event-store.ts:300` (`EventStoreSymbol` on insert) | accumulated state | plain `Reflect.set`, deliberately excluded from the merge list | Accurate — states the exclusion is deliberate, no false claim | 05-07 |
| 3 | `event-store/async-event-store.ts:267` (`EventStoreSymbol` on insert) | accumulated state | same as #2, async variant | Accurate — same wording, no false claim | 05-07 |
| 4 | `helpers/encrypted-content.ts:123` (`setEncryptedContentCache`) | carry-forward payload | plain enumerable `Reflect.set` | **Fixed this plan (Task 1)** — was self-contradictory (claimed "identity memo" while requiring spread survival); now carry-forward payload, names `modifyPublicTags` | **This plan** |
| 5 | `helpers/hidden-tags.ts:106` (`getHiddenTags`) | identity memo | plain enumerable `Reflect.set` | **Fixed this plan (Task 2)** — was "must not survive a spread"; now states present-tense survival + mask | **This plan** |
| 6 | `helpers/hidden-tags.ts:151` (`setHiddenTagsCache`) | identity memo | plain enumerable `Reflect.set` | **Fixed this plan (Task 2)** — variant wording ("…onto a differently-keyed draft") was easy to miss; now fixed | **This plan** |
| 7 | `helpers/contacts.ts:96` (`getHiddenContacts`) | identity memo | plain enumerable `Reflect.set` | **Fixed this plan (Task 2)** — was "must not survive a spread"; now states present-tense survival + mask | **This plan** |
| 8 | `helpers/event.ts:130` (`getEventUID`) | identity memo | plain enumerable `Reflect.set` | **Fixed this plan (Task 2)** — was "must not survive a spread"; now states present-tense survival + mask | **This plan** |
| 9 | `helpers/event.ts:179` (`markFromCache`) | accumulated state | plain `Reflect.set`, propagated via event-store merge, not spread | Already accurate (no false spread-survival claim); only its line-number citation was stale — switched to a function-name citation this plan (see Deviations) | **This plan** (citation-only touch, Rule 3) |
| 10 | `helpers/filter.ts:25` (`getIndexableTags`) | identity memo | plain enumerable `Reflect.set` | **Fixed this plan (Task 1)** — was "must not survive a spread"; now states the memo does survive today + names the tag-changing-spread consequence | **This plan** |
| 11 | `helpers/relays.ts:18` (`addSeenRelay`) | accumulated state | plain `Reflect.set`, propagated via the event store's separate `SeenRelaysSymbol` merge, not spread | Accurate — no false spread-survival claim. Note: still cites a stale line number (`event-store.ts:219`) but is outside this plan's `files_modified`; not a false-comment escape, just a stale citation left for a future cleanup pass | Not owned by this plan or any listed wave-2 plan — flagged below as a minor, non-blocking finding |
| 12 | `casts/cast.ts:58` (`performCast`) | identity memo (memo-shaped write) | plain enumerable `Reflect.set` | **Fixed this plan (Task 1)** — was "must not inherit a stale cast"; now names the aliased-`Map`-by-reference consequence | **This plan** |
| 13 | `operations/event.ts:143` (`stamp`) | carry-forward payload | explicit `Reflect.has`/`get`/`set` copy (enumerability-blind) | Already corrected by 05-06 (wave 1, landed at HEAD before this plan ran) — no false claim; verified accurate | 05-06 (already landed) |
| 14 | `operations/event.ts:180` (`sign`) | carry-forward payload | explicit `Reflect.has`/`get`/`set` copy (enumerability-blind) | Already corrected by 05-06 (wave 1) — no false claim; verified accurate | 05-06 (already landed) |

**Verdict:** All 6 in-scope sites (4, 5, 6, 7, 8, 10, 12 — 7 write-site edits across the six `files_modified`) now describe their real enumerable behavior. Zero remaining hits anywhere in `packages/core/src` (excluding `__tests__`) assert non-survival of a spread over a write mechanism that actually delivers it. No genuine escapes found outside this plan's `files_modified` or the two named wave-2/wave-1 owners — hit #11 (`relays.ts`) is a pre-existing, accurate comment with only a stale line-number citation, flagged below as a non-blocking future cleanup, not a false-comment defect this plan's acceptance criteria require fixing.

## Final Text of Each Reworded Comment

**`encrypted-content.ts` — `setEncryptedContentCache`:**
> Avoids a repeat signer round-trip on an already-signed, immutable event. This write stays enumerable (unlike setCachedValue) because it is carry-forward payload (see cache.ts taxonomy's worked example), not a memoized value scoped to derivation from the event's own fields — purpose does not decide the category, the spread-survival requirement at the write site does. An unlocked event re-entering the factory pipe hits operations/tags.ts's modifyPublicTags (`{ ...draft, tags }`), which copies only enumerable own properties — a non-enumerable write here would be dropped there, forcing a repeat signer round-trip to re-decrypt.

**`casts/cast.ts` — `performCast`:**
> The cast instance is derived from and bound to this specific event instance — identity-memo shaped per cache.ts's taxonomy. But performCast(copy, cls) would return the cast built against the ORIGINAL event, and casts.set(cls, cast) would mutate a Map shared by both objects — a plain enumerable Reflect.set means a spread copy today inherits the same Map by reference (aliased mutable state, not merely a stale value). Known, deliberately-deferred gap (D-08 — migration out of scope); only pipeFromAsyncArray's delete loop masks it, on the one call path that runs it.

**`helpers/filter.ts` — `getIndexableTags`:**
> Derived from the event's own tags — identity memo per cache.ts's taxonomy. A copy built from `{ ...event, tags: newTags }` inherits the SAME Set (this write is a plain enumerable Reflect.set, so the value does survive a spread today), so filter matching on the copy evaluates the ORIGINAL's tags and the `if (!indexable)` guard above never recomputes. Known, deliberately-deferred gap; only pipeFromAsyncArray's delete loop masks it, on the one call path that runs it.

**`helpers/event.ts` — `getEventUID`:**
> Derived from the event's own kind/pubkey/tags — identity memo per cache.ts's taxonomy. But this write is a plain enumerable Reflect.set, so the value does survive a spread today: a copy with different fields inherits the stale UID instead of recomputing it. Known, deliberately-deferred gap; only pipeFromAsyncArray's delete loop (helpers/pipeline.ts) masks it, on the one call path that runs it.

**`helpers/hidden-tags.ts` — `getHiddenTags`:**
> Derived from the event's own decrypted hidden content — identity memo per cache.ts's taxonomy. But this write is a plain enumerable Reflect.set, so the value does survive a spread today: a copy with different content inherits the stale parsed tags instead of re-parsing. Known, deliberately-deferred gap; only pipeFromAsyncArray's delete loop (helpers/pipeline.ts) masks it, on the one call path that runs it.

**`helpers/hidden-tags.ts` — `setHiddenTagsCache`:**
> Re-derived from the newly unlocked hidden content — identity memo per cache.ts's taxonomy. But this write is a plain enumerable Reflect.set, so the value does survive a spread today: a copy spread onto a differently-keyed draft inherits the stale tags instead of re-deriving them. Known, deliberately-deferred gap; only pipeFromAsyncArray's delete loop (helpers/pipeline.ts) masks it, on the one call path that runs it.

**`helpers/contacts.ts` — `getHiddenContacts`:**
> Set cache and notify event store. Derived from the event's own hidden tags — identity memo per cache.ts's taxonomy. But this write is a plain enumerable Reflect.set, so the value does survive a spread today: a copy with different tags inherits the stale parsed contacts instead of re-parsing. Known, deliberately-deferred gap; only pipeFromAsyncArray's delete loop (helpers/pipeline.ts) masks it, on the one call path that runs it.

## Decisions Made

- Followed the user's authoritative ruling verbatim: comment-only, no `Reflect.set` → `Object.defineProperty` conversion, no migration onto `setCachedValue`/`getOrComputeCachedValue`, no enumerability flag/guard/descriptor added anywhere.
- `encrypted-content.ts`'s new comment deliberately avoids the literal substring "identity memo" so the CR-02 mirror is unambiguous — it reads as carry-forward payload with no residual self-contradiction, matching cache.ts's own worked example.
- D-10's sweep was re-run at its full declared scope (`packages/core/src` in its entirety, excluding `__tests__`), not narrowed to this plan's `files_modified` — per the plan's explicit instruction that a narrower sweep would repeat the exact "claimed completeness without a re-runnable check" defect that caused the original 14-site miss.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `markFromCache`'s pre-existing comment (event.ts) cited a stale line number, failing this task's own zero-line-citation acceptance gate**
- **Found during:** Task 2 (acceptance-criteria verification, after the four planned reworks)
- **Issue:** Task 2's acceptance criteria require `grep -cE '\.ts:[0-9]+' packages/core/src/helpers/event.ts` to return `0` for the whole file. `markFromCache`'s comment (not one of the four sites this task reworks — its content was already accurate, no false spread-survival claim) still cited `event-store.ts:219`, a line number invalidated by 05-06's rewrite of that file. This is the same class of ordering conflict 05-06 hit and resolved the same way.
- **Fix:** Replaced the bare line-number citation with a function-name citation (`EventStore.copySymbolsToDuplicateEvent`), per WR-04's cite-by-symbol convention. The comment's substantive claim (accumulated state, propagated via merge not spread) was left completely untouched — only the citation format changed.
- **Files modified:** `packages/core/src/helpers/event.ts` (same file/commit as Task 2's planned edits)
- **Verification:** `grep -cE '\.ts:[0-9]+' packages/core/src/helpers/event.ts` returned `0` after the fix; `pnpm --filter applesauce-core test` stayed green (635/635); behavior gate (`git diff` non-comment lines) stayed clean.
- **Committed in:** `5d5c91e2` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — a citation-format-only fix required by this task's own acceptance gate, not a rewording of substantive content)
**Impact on plan:** No scope creep — `markFromCache` was never claimed to be one of the six sites this plan reworks, and its comment's meaning is unchanged; only its citation format was normalized to match the plan's own line-number ban.

## Non-Blocking Finding (Recorded, Not Fixed)

`packages/core/src/helpers/relays.ts:18` (`addSeenRelay`'s `Reflect.set(event, SeenRelaysSymbol, seen)`) has an accurate comment (accumulated state, no false spread-survival claim) but still cites a stale line number (`event-store.ts:219`, same staleness class as the `markFromCache` fix above). This file is outside this plan's `files_modified` and is not owned by either of the two wave-2/wave-1 plans this task is instructed to defer to (05-06, 05-07) — it is a genuine minor escape from the line-citation cleanup, but NOT a false-comment defect (the taxonomy claim itself is correct), so it does not fail this plan's `must not survive a spread` / `must not inherit` acceptance gates. Recorded here for the orchestrator to route to a future cleanup pass.

## Issues Encountered

None — all task-level automated verify commands and acceptance-criteria greps passed after the one citation-format fix documented above. `pnpm --filter applesauce-core test` stayed green (635 tests, 57 files) across both commits. `turbo build --filter='./packages/*'` reported 14/14 successful.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All six core write-site comments in this plan's scope now agree with `cache.ts`'s taxonomy (repaired by 05-06) and with each other's wording, so a reader greps a consistent story across all sites.
- The D-10 sweep is fully re-runnable: `grep -rn "Reflect.set(" packages/core/src --include="*.ts" | grep -v __tests__` reproduces the same 14 hits enumerated above.
- Two sites remain intentionally unmigrated per the user's explicit ruling and D-08 (`cast.ts`'s `CASTS_SYMBOL` write, `filter.ts`'s `EventIndexableTagsSymbol` write) — both now carry an honest comment stating the real gap instead of a false invariant, and both are recorded in `05-CONTEXT.md`'s Deferred Ideas for a future migration.
- `relays.ts`'s stale line-number citation (non-blocking finding above) is available for whichever future plan next touches that file's comments.

## Self-Check: PASSED

All modified files verified present on disk (`packages/core/src/helpers/encrypted-content.ts`, `packages/core/src/casts/cast.ts`, `packages/core/src/helpers/filter.ts`, `packages/core/src/helpers/event.ts`, `packages/core/src/helpers/hidden-tags.ts`, `packages/core/src/helpers/contacts.ts`, this SUMMARY.md). Both commit hashes (`e88b7dc4`, `5d5c91e2`) verified present in `git log --oneline --all`.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
