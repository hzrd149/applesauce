---
phase: 05-cache-identity-memo-fix
plan: 11
subsystem: docs
tags: [applesauce-common, applesauce-concord, gift-wrap, cache, taxonomy, comments]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (plan 06)
    provides: the repaired canonical write-site taxonomy in cache.ts (categories 1-3, "hand-rolled" as a term of art, function-name citation style) that this plan's corrections must agree with
provides:
  - Two corrected comments outside the taxonomy/sweep clusters (WR-07 in common/helpers/gift-wrap.ts, WR-09 in concord/helpers/keys.ts), both false about the code beneath them
  - A repaired mechanism claim + citation in common/operations/gift-wrap.ts (the second, previously-unowned D-10 site: PR-01's duplicate-event propagation claim and the stale operations/tags.ts:87 citation)
  - The phase's Deferral Register — every one of the sixteen 05-REVIEW.md findings plus PR-01, accounted for as closed-by-plan or deferred-with-rationale-and-routing
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["Cite by symbol/function name, never file:line (WR-04) — enforced repo-wide by this phase's grep gates in every plan 05-06 through 05-11"]

key-files:
  created: []
  modified:
    - packages/common/src/helpers/gift-wrap.ts
    - packages/common/src/operations/gift-wrap.ts
    - packages/concord/src/helpers/keys.ts

key-decisions:
  - "D-11's narrow comment-only exception for keys.ts closed exactly the CONCORD-H01 reasoning error this phase itself introduced (WR-09) — not a reopening of concord scope; everything else in concord (including WR-08's decodeWrapCached) stays deferred to Phases 6-7 per D-09."
  - "PR-01's duplicate-event propagation claim, found at its source in 05-06 (cache.ts, operations/event.ts), had a second unowned restatement in common/operations/gift-wrap.ts across three Reflect.set sites — closed here in Task 1 Part B. Recorded in the Deferral Register as the recurring shape of this whole gap-closure round: catching a defect at its source and missing its downstream copy."
  - "WR-03's Object.isExtensible guard (silent degradation on frozen/non-extensible objects) stays deferred/rejected per D-02, which explicitly accepts the Object.defineProperty throw as correct; only its documentation half (closed by 05-06) was in scope."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "common/helpers/gift-wrap.ts's RumorSymbol sentinel comment no longer declares the undefined-as-Rumor pattern sound design; it states the real isSealUnlocked/unlockSeal consequence as a known, deferred gap"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test (505 tests, 63 files)"
        status: pass
      - kind: other
        ref: "grep -c 'which is why callers check presence' packages/common/src/helpers/gift-wrap.ts returns 0; grep -cE 'isSealUnlocked|known gap|never parsed' returns >=1; grep -cE '\\.ts:[0-9]+' returns 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "common/operations/gift-wrap.ts's GiftWrapSymbol/SealSymbol/RumorSymbol comments state the true mechanism (object-reference link + PRESERVE_EVENT_SYMBOLS delete-loop survival) instead of a false duplicate-event merge claim; the EncryptedContentSymbol comment cites modifyHiddenTags by name instead of a stale tags.ts:87 line number"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-common test"
        status: pass
      - kind: other
        ref: "grep -c 'across duplicate' returns 0; grep -c 'operations/tags.ts:87' returns 0; grep -cE '\\.ts:[0-9]+' returns 0; grep -c 'PRESERVE_EVENT_SYMBOLS.add' returns 3 (unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "concord/helpers/keys.ts's CONCORD-H01 comment no longer claims baseKeysFor hand-rolled a write it never hand-rolled — getOrComputeCachedValue itself wrote enumerable; hand-rolled keeps cache.ts's single reserved meaning; both stale line-range citations (rollForward, rollForwardChannel) replaced with function names"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (191 tests, 42 files, including keys.test.ts and channel-rekey.test.ts)"
        status: pass
      - kind: other
        ref: "grep -c 'hand-rolled a plain enumerable' returns 0; grep -c 'getOrComputeCachedValue' >=1 in the baseKeysFor comment block; grep -c CONCORD-H01 and JSON.stringify each >=1; grep -cE '\\(:[0-9]+' and grep -cE '`:[0-9]+-[0-9]+`' both return 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Deferral Register in this SUMMARY accounts for all sixteen 05-REVIEW.md findings plus PR-01 as closed-by-plan or deferred-with-rationale-and-routing"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "## Deferral Register table below, 17 rows"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 11: Gap closure — gift-wrap comments, keys.ts CONCORD-H01 reasoning, and the deferral register Summary

**Corrected the two remaining false comments this phase wrote outside the taxonomy/sweep clusters (WR-07's ratified-bypass sentinel, WR-09's misapplied "hand-rolled"), closed the second unowned D-10/PR-01 site in common/operations/gift-wrap.ts, and recorded a 17-row deferral register accounting for every 05-REVIEW.md finding — zero behavior change, comment-only diff.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-15T22:17:00Z (approx, per prior task's commit timestamp)
- **Completed:** 2026-07-15
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `common/helpers/gift-wrap.ts`'s `RumorSymbol` sentinel comment (WR-07) no longer defends the `undefined`-as-negative-result design via "callers check presence rather than truthiness" — that defense is what breaks it. The comment now states the real, traced consequence as a known deferred gap: `isSealUnlocked` returns `true` for a seal whose content never parsed (presence-only check), and `unlockSeal` then returns that `undefined` typed as a `Rumor`, bypassing its own `if (!rumor) throw` guard. The fix (narrow `isSealUnlocked` to check the sentinel's value, or use a distinguishable sentinel) is named and deliberately deferred — comment-only scope, per D-08.
- `common/operations/gift-wrap.ts`'s three `PRESERVE_EVENT_SYMBOLS`-registered writes (`RumorSymbol` on the seal, `GiftWrapSymbol` on the seal, `SealSymbol` on the gift) no longer claim the value is "propagated by reference across duplicate events" — verified false against `EventStore.copySymbolsToDuplicateEvent`'s merge list (`[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`, no gift-wrap symbols). Rewritten to state the mechanism that is actually true: an object-reference link between seal and gift, and `PRESERVE_EVENT_SYMBOLS` registration buying survival of `eventPipe`'s delete loop — nothing more. This closes PR-01's second, previously-unowned restatement (05-06 fixed the source in `cache.ts` and its `operations/event.ts` restatement; this plan closes the `common/operations/gift-wrap.ts` copy).
- The same file's `EncryptedContentSymbol` comment cited `applesauce-core`'s `operations/tags.ts:87` — confirmed (via 05-06's WR-04 fix) that line now contains a comment, not the write. Replaced with `modifyHiddenTags`'s return, by name. Its substantive claims (only carry-forward site in `applesauce-common`; migrating it onto the memo helper would break gift-wrap plaintext) were checked against `tags.ts` and kept as true.
- `concord/helpers/keys.ts`'s `CONCORD-H01` reasoning comment (WR-09) claimed `baseKeysFor` "hand-rolled a plain enumerable `Reflect.set`" before the `cache.ts` fix. False: `baseKeysFor` has always called `getOrComputeCachedValue`; the enumerable write lived inside that shared helper. This matters beyond pedantry — `cache.ts`'s taxonomy reserves "hand-rolled" for the opposite thing (a site that bypasses the helper), and misusing it three files from the definition collapses the only term the taxonomy has for locating unmigrated sites. Rewritten to state `getOrComputeCachedValue` ITSELF wrote enumerable, and that `baseKeysFor` never hand-rolled anything. Two stale line-range citations in the same file (`rollForward`'s spread, `rollForwardChannel`) replaced with function names, per WR-04's citation-style rule.
- Recorded the phase's Deferral Register (below): all sixteen `05-REVIEW.md` findings plus PR-01, each disposed as closed-by-plan or deferred-with-rationale-and-routing. No finding is silently dropped.

## Task Commits

1. **Task 1: Correct applesauce-common's gift-wrap comments (WR-07 sentinel + the unowned operations site)** - `a60d7d88` (docs)
2. **Task 2: Restore the single meaning of "hand-rolled" in concord's CONCORD-H01 comment (WR-09)** - `cd89fa27` (docs)
3. **Task 3: Record the deferral register for every unclosed review finding** - captured in this SUMMARY.md (no source edit; documentation-only task per its own scope)

_All tasks are comment-only / doc changes; no separate feat/fix commits were required since zero behavior change was the explicit constraint (D-08)._

## Files Created/Modified

- `packages/common/src/helpers/gift-wrap.ts` - `getSealRumor`'s `RumorSymbol` sentinel comment rewritten (WR-07); `getSealRumor`, `isSealUnlocked`, `unlockSeal` bodies byte-identical
- `packages/common/src/operations/gift-wrap.ts` - `sealRumor`'s and `wrapSeal`'s `RumorSymbol`/`GiftWrapSymbol`/`SealSymbol` comments rewritten (false duplicate-event claim removed); `wrapSeal`'s `EncryptedContentSymbol` comment's stale line citation replaced with `modifyHiddenTags`; all three `PRESERVE_EVENT_SYMBOLS.add(...)` registrations and every `Reflect.set` untouched
- `packages/concord/src/helpers/keys.ts` - the `BaseKeysSymbol`/`ChannelPlaneKeysSymbol` doc comment block above `baseKeysFor` rewritten (WR-09); two stale line-range citations replaced with function names; `baseKeysFor`, `channelKeyMemo`, `rollForward`, `rollForwardChannel` bodies byte-identical

## Retained Citations — Read and Confirmed True

Per the plan's `<read_first>` instructions, every claim corrected or retained was verified against the cited code before being written:

| Citation | File+symbol read to confirm | Confirmed claim |
|---|---|---|
| `isSealUnlocked` / `unlockSeal` consequence | `packages/common/src/helpers/gift-wrap.ts` — `getSealRumor` (the `Reflect.set(seal, RumorSymbol, undefined)` sentinel), `isSealUnlocked` (`RumorSymbol in seal \|\| ...`), `unlockSeal` (`if (isSealUnlocked(seal)) return seal[RumorSymbol];` then `if (!rumor) throw`) | Traced end to end: sentinel write on parse failure → presence check reports unlocked → `unlockSeal` returns `undefined` typed `Rumor`, bypassing its own guard. Real bug, pre-existing, correctly stated as a known gap rather than sound design. |
| `EventStore.copySymbolsToDuplicateEvent`'s merge list | `packages/core/src/event-store/event-store.ts:199-229` | The merge list is `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` — no `GiftWrapSymbol`/`SealSymbol`/`RumorSymbol`. Confirms the "propagated ... across duplicate events" claim in `common/operations/gift-wrap.ts` was false; those symbols are not carried onto a redelivered duplicate by this merge. |
| `PRESERVE_EVENT_SYMBOLS` / `pipeFromAsyncArray`'s delete loop | `packages/core/src/helpers/pipeline.ts:5,51-65` | `PRESERVE_EVENT_SYMBOLS = new Set([EncryptedContentSymbol])` at module scope in `helpers/pipeline.ts`; `common/operations/gift-wrap.ts` adds `GiftWrapSymbol`/`SealSymbol`/`RumorSymbol` to that same Set at its own module top. `pipeFromAsyncArray`'s loop only deletes symbols NOT in `preserve` from `result` — membership stops deletion mid-pipe; it performs no copy onto a duplicate event. Confirms what the registration does and does not buy. |
| `modifyHiddenTags`'s return (`operations/tags.ts`) | `packages/core/src/operations/tags.ts:40-91` | The write is `return { ...draft, content, [EncryptedContentSymbol]: plaintext };` at (current) line 90 — an object literal, enumerable write. Line 87 (the old citation target) is now a comment line, confirming WR-04's finding that the old `:87` citation was stale. Replacing with the function name `modifyHiddenTags` survives future edits. |
| `getOrComputeCachedValue` as the actual pre-fix enumerable writer | `packages/concord/src/helpers/keys.ts:128-140` (`baseKeysFor`) | `baseKeysFor` returns `getOrComputeCachedValue(material, BaseKeysSymbol, () => {...})` — a direct call to the shared helper, with no separate `Reflect.set` anywhere in the function body. Confirms `baseKeysFor` never hand-rolled a write; the enumerable write (pre the `cache.ts` fix) lived inside `getOrComputeCachedValue` itself. |
| `cache.ts`'s reserved meaning of "hand-rolled" | `packages/core/src/helpers/cache.ts` (05-06's corrected taxonomy) | Per 05-06's SUMMARY, "hand-rolled" is used there for `setEncryptedContentCache`, which bypasses the helper and writes its own `Reflect.set` directly. `baseKeysFor` — which always calls the helper — is the opposite case; using the same term for both collapses the taxonomy's only site-locating distinction. Corrected accordingly. |
| `decodeWrapCached` / `DecodedWrapSymbol` (WR-08, deferral rationale) | `packages/concord/src/helpers/gift-wrap.ts:107-121` | `decodeWrapCached` reads `Reflect.get(wrap, DecodedWrapSymbol)`, and on a miss computes `decodeWrap` and writes it back via a bare `Reflect.set(wrap, DecodedWrapSymbol, decoded)` — an unclassified, enumerable, hand-rolled identity-memo write, exactly as WR-08 describes. Confirmed present and unmodified; correctly left untouched per D-09/D-10 scope (concord excluded from this phase's sweep). |

## Deferral Register

Every `05-REVIEW.md` finding (CR-01…CR-05, WR-01…WR-09, IN-01, IN-02), plus PR-01 (found during gap planning, not in the original review), accounted for below. No finding is silently dropped — each row is either closed by a specific plan or deferred with a decision-ID-backed rationale and a routing destination.

| Finding | Disposition | Closing plan / Deferral rationale |
|---|---|---|
| CR-01 | 05-06 | Category 3's false "machine-readable definition" (event-store.ts's merge list) rewritten to name the real per-symbol propagation mechanism. |
| CR-02 | 05-06 + 05-08 | `setEncryptedContentCache` reclassified carry-forward payload in `cache.ts` (05-06); mirrored in `encrypted-content.ts`'s own comment (05-08). |
| CR-03 | 05-10 | `cache.test.ts`'s false "enforcement contract" claim corrected/repaired. |
| CR-04 | 05-07 | `encrypted-content-cache.ts`'s false merge-list citation for `EncryptedContentFromCacheSymbol` corrected. |
| CR-05 | 05-08 + 05-09 | The fourteen "must not survive a spread" comments over enumerable `Reflect.set` writes reworded across the core (05-08) and common (05-09) sweep sites. |
| WR-01 | 05-06 | `writable: true` rationale corrected (redefinition via `configurable: true`, not an overwrite requirement). |
| WR-02 | 05-06 | `configurable: true` rationale corrected (`Reflect.deleteProperty` returns `false` silently; does not throw). |
| WR-03 | **deferred** (documentation half closed by 05-06) | The frozen/non-extensible `Object.defineProperty` throw is now documented in-source and disclosed via a changeset (05-06, `.changeset/cache-frozen-event-throws.md`) — that half is closed. The proposed `Object.isExtensible` guard restoring silent degradation is deferred/rejected per **D-02**, which explicitly accepts the throw as correct ("it surfaces a real programming error rather than silently returning a stale value forever"); nothing in the monorepo freezes events, so it is reachable only by an external consumer. Reversing it would require reopening a locked decision. Routing: revisit only if a downstream consumer reports the throw as a real-world regression. |
| WR-04 | closed as a citation-style rule (05-06 through 05-11) | Every plan in this phase bans line-number citations and carries its own `grep -cE '\.ts:[0-9]+'` (or equivalent backtick/paren-range) gate; enforced repo-wide rather than as a single patch. This plan's Task 1 and Task 2 both carry the same gate. |
| WR-05 | 05-06 | Added the mutability-vs-validity-binding discriminator to `cache.ts`'s category 3 definition (concord's `ChannelKeysSymbol` Map named as the worked example). |
| WR-06 | 05-07 | `EventStoreSymbol` exclusion comment's inverted source/dest framing corrected. |
| WR-07 | **05-11** (this plan, Task 1 Part A) | See Accomplishments above — sentinel comment now states the real `isSealUnlocked`/`unlockSeal` consequence as a known gap. |
| WR-08 | **deferred** | `decodeWrapCached`'s unclassified enumerable memo in `packages/concord/src/helpers/gift-wrap.ts` (confirmed present, see Retained Citations table above). Deferred per **D-09** (concord excluded from the sweep — its memo sites are rewritten in Phases 6-7 and comments written now would churn immediately) and **D-10** (the sweep's grep contract is scoped to `packages/{core,common}/src`, so this site is outside the completeness claim the phase actually makes, not a hole in it). **D-08** independently forbids the migration the reviewer proposed (classify-and-comment only, no behavior change). Routing: Phases 6-7, when `decodeWrapCached` itself is rewritten. Note (out of this phase's scope, carried forward for that work): the reviewer also observed the memo is keyed on `wrap` alone and ignores `convKey`, so a second decode of the same wrap under a different plane key returns the first result — worth checking when the site is next touched. |
| WR-09 | **05-11** (this plan, Task 2) | See Accomplishments above — `keys.ts` no longer claims `baseKeysFor` hand-rolled a write it never hand-rolled. |
| IN-01 | **deferred** | `getOrComputeCachedValue`'s `Reflect.has` walks the prototype chain while `Object.defineProperty` writes an own property. The fix is a behavior change, this phase is comment-only outside 05-10's test additions, and the asymmetry is unreachable today (`Symbol.for()` keys on plain object literals have no meaningful prototype chain). Pre-existing — `Reflect.set` walked the chain too, so this is not a regression this phase introduced. Routing: backlog; revisit only if a consumer's prototype-chain usage makes the asymmetry reachable. |
| IN-02 | **deferred** | `copySymbolsToDuplicateEvent` reports `changed = true` for no-op relay merges, emitting a spurious `update$` on every duplicate delivery of an already-seen event. Behavior change, pre-existing, out of this phase's comment-only scope. Note: 05-07 removed the "canonical/executable definition" framing that invited readers to treat this function as exemplary — that framing was the reviewer's stated reason for flagging this here, and it is gone. Routing: backlog; a candidate for whichever future phase next touches `EventStore.add`'s duplicate-handling path. |
| PR-01 | 05-06 + **05-11** (this plan, Task 1 Part B) | Category 2's claim that `PRESERVE_EVENT_SYMBOLS` membership keeps a symbol across `eventPipe`'s spreads was false — closed at its source (`cache.ts`) and its downstream restatement (`operations/event.ts`'s `stamp`/`sign`) by 05-06 in one pass. A second, previously-unowned restatement of the same false claim existed in `common/operations/gift-wrap.ts`'s three `Reflect.set` comments — closed here in Task 1 Part B. Recorded because "found the defect at its source and missed its copy" was initially the actual sequence here too (the gap plan set did not originally assign this file to any plan until this one), and it is the recurring shape of this entire gap-closure round — worth leaving in the record for whoever authors Phases 6-12's own comments. |

## Decisions Made

- WR-07's fix (narrowing `isSealUnlocked` or using a distinguishable sentinel) is a behavior change and stays out of this comment-only phase's scope per D-08; the comment now states the gap honestly instead of declaring it sound, so the next author who touches this code fixes it rather than trusting a comment that defends it.
- WR-09's correction stayed inside D-11's existing narrow exception for `keys.ts` — it corrects a comment this phase itself wrote incorrectly, not a reopening of concord scope. WR-08 (also in `keys.ts`'s sibling file, `gift-wrap.ts`) stays deferred per D-09/D-10, confirming the exception is scoped to the one comment D-11 named, not the whole file or package.
- WR-03's `Object.isExtensible` guard proposal was evaluated and explicitly rejected (not merely left undone) — D-02 already made this call; reversing it here would be relitigating a locked decision without new information.

## Deviations from Plan

None — plan executed exactly as written. Task 1 and Task 2's comment rewrites required minor iteration to avoid the literal substring "across duplicate" surviving inside a negated sentence (the acceptance-criteria grep is a plain substring match, not phrase-aware), and to get the case-sensitive `accumulated state` count above its `>= 2` gate — both resolved by rewording within the same task/commit before verification, not a scope or behavior change.

## Issues Encountered

- `pnpm --filter applesauce-common test` and `pnpm --filter applesauce-concord test` initially failed with module-resolution errors (`Cannot find package 'applesauce-core/helpers'`, `applesauce-signers`, `applesauce-relay`, `applesauce-loaders`) because this worktree had no `dist/` output for those workspace packages yet. Not a defect introduced by this plan — built `applesauce-core`, `applesauce-common`, `applesauce-signers`, `applesauce-relay`, and `applesauce-loaders` (`pnpm --filter <pkg> build`) before re-running tests; both suites then passed clean (505/505 common, 191/191 concord, including `keys.test.ts` and `channel-rekey.test.ts`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- This gap-closure wave (05-06 through 05-11) is the last plan in Phase 5. The Deferral Register above is the authoritative record of what remains open for Phases 6-12: WR-08 (`decodeWrapCached` classification, Phases 6-7), IN-01/IN-02 (backlog), WR-03's rejected `isExtensible` guard (closed as rejected, not open).
- `keys.ts`'s corrected CONCORD-H01 reasoning is now the accurate context for Phases 6-7 authors who touch `rollForward`/`rollForwardChannel` — they will read a comment that correctly attributes the pre-fix bug to `getOrComputeCachedValue`, not to `baseKeysFor` itself, which matters for anyone deciding whether to keep or remove the shared-helper call pattern.
- `common/operations/gift-wrap.ts`'s corrected `PRESERVE_EVENT_SYMBOLS` mechanism description is now consistent with `cache.ts`'s taxonomy and with `operations/event.ts`'s (05-06-corrected) restatement — a repo-wide grep for the false "propagated ... across duplicate events" claim on gift-wrap symbols now returns zero everywhere it was ever written.
- Zero behavior change confirmed across all three files: every task's behavior gate (`git diff` filtered to non-comment lines) returned empty; `applesauce-common` (505 tests) and `applesauce-concord` (191 tests, including the spec-derived `keys.test.ts`/`channel-rekey.test.ts`) both green.

## Self-Check: PASSED

All modified files verified present on disk (`packages/common/src/helpers/gift-wrap.ts`, `packages/common/src/operations/gift-wrap.ts`, `packages/concord/src/helpers/keys.ts`, this SUMMARY.md). Both commit hashes (`a60d7d88`, `cd89fa27`) verified present in `git log --oneline --all`.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
