---
phase: 05-cache-identity-memo-fix
plan: 06
subsystem: docs
tags: [applesauce-core, cache, taxonomy, comments, changeset]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix (plans 01-05)
    provides: the Object.defineProperty write mechanism at setCachedValue/getOrComputeCachedValue (verified correct in an earlier plan; untouched here)
provides:
  - A repaired canonical write-site taxonomy in cache.ts with zero false citations, verified against the cited code
  - operations/event.ts's stamp/sign restatement corrected in lockstep with cache.ts (same wording, same defect fixed once)
  - A changeset disclosing the frozen-object TypeError precondition on setCachedValue/getOrComputeCachedValue
affects: [05-07, 05-08, 05-09, 05-10, 05-11]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Cite by symbol/function name, never file:line (WR-04) — line citations are invalidated by the same commit that writes them"]

key-files:
  created:
    - .changeset/cache-frozen-event-throws.md
  modified:
    - packages/core/src/helpers/cache.ts
    - packages/core/src/operations/event.ts

key-decisions:
  - "PR-01 (found during gap planning, not in 05-REVIEW.md): category 2's claim that PRESERVE_EVENT_SYMBOLS membership means a symbol 'is explicitly kept across eventPipe's intermediate spreads' was false — pipeFromAsyncArray's delete loop only deletes non-listed symbols, it never copies listed ones from prev onto result. Fixed at both its source (cache.ts) and its downstream restatement (operations/event.ts's stamp/sign), in one pass, so the wording cannot diverge."
  - "D-07 partially superseded: dropped the framing that event-store.ts's merge list is category 3's single definition (per VERIFICATION.md's authoritative missing: item) while keeping the cross-reference, described accurately as the propagation mechanism for the two symbols it actually carries."
  - "D-02 followed as locked: the Object.defineProperty frozen-object throw is documented, not guarded — no Object.isExtensible check added."
  - "Task 1's own acceptance criteria require zero .ts:<line> citations anywhere in cache.ts, which is stricter than Task 1's stated file scope (categories 2/3 + event.ts only). Resolved by stripping the line-number citations from the Worked Example and Scope paragraphs during Task 1 (format-only, no prose rewrite), leaving their substantive content for Tasks 2 and 3 as planned. See Deviations."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "cache.ts categories 2 and 3 no longer claim a single machine-readable definition they don't have; category 2 states PRESERVE_EVENT_SYMBOLS is necessary-but-not-sufficient allowlist semantics; category 3 names the real per-symbol propagation mechanism and adds the ChannelKeysSymbol mutability discriminator (WR-05)"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (635 tests, 57 files)"
        status: pass
      - kind: other
        ref: "grep -rn 'machine-readable definition' packages/core/src packages/common/src returns nothing"
        status: pass
      - kind: other
        ref: "grep -cE '\\.ts:[0-9]+' packages/core/src/helpers/cache.ts packages/core/src/operations/event.ts both return 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "operations/event.ts's stamp/sign restatement of the PRESERVE_EVENT_SYMBOLS claim corrected with the same wording as cache.ts, in the same commit, so a repo-wide grep for the false phrase returns zero"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -B6 'Reflect.set(newDraft, EncryptedContentSymbol' packages/core/src/operations/event.ts | grep -cE 'not sufficient|necessary' >=1; same block grep -cE 'enumerability-blind' >=1"
        status: pass
    human_judgment: false
  - id: D3
    description: "setEncryptedContentCache reclassified from identity memo to carry-forward payload (CR-02), with the modifyPublicTags spread named as the reason the unlock-path write must stay enumerable"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: "grep -A6 'setEncryptedContentCache' packages/core/src/helpers/cache.ts | grep -c 'identity memo' returns 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Descriptor rationale corrected to real JS semantics (Reflect.deleteProperty returns false silently, not throws; configurable alone permits redefinition) and the frozen/non-extensible Object.defineProperty throw documented in-source and disclosed via a single-sentence patch changeset"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test"
        status: pass
      - kind: other
        ref: ".changeset/cache-frozen-event-throws.md exists, patch bump, single-sentence body verified via sed/grep"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 06: Repair cache.ts's canonical write-site taxonomy Summary

**Corrected every false citation in cache.ts's three-category write-site taxonomy (PR-01, CR-01, CR-02, WR-01 through WR-05), fixed its downstream restatement in operations/event.ts in the same pass, and disclosed the frozen-object TypeError via a new changeset — zero behavior change, comment-only diff.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-15T21:56:24Z (approx, per prior session start)
- **Completed:** 2026-07-15
- **Tasks:** 3
- **Files modified:** 2 modified, 1 created

## Accomplishments

- Category 2 (carry-forward payload) now states `PRESERVE_EVENT_SYMBOLS` (`helpers/pipeline.ts`) is the allowlist `pipeFromAsyncArray`'s delete loop consults — necessary but NOT sufficient for spread survival — instead of falsely claiming it "explicitly keeps" a symbol across spreads.
- Category 3 (accumulated state) no longer claims the `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]` merge list is a single defining list for the category; it now names the real per-symbol mechanism (`EventStore.copySymbolsToDuplicateEvent`'s merge loop for two symbols, the separate `getSeenRelays`/`addSeenRelay` merge for `SeenRelaysSymbol`, shared object reference for common's gift-wrap symbols) and adds the WR-05 discriminator: mutability of the cached value is not the test — `ChannelKeysSymbol` (a `Map` grown in place by `channelKeyMemo`) is still an identity memo because its validity is bound to the host's own fields.
- `operations/event.ts`'s `stamp` and `sign` comments corrected in the same pass with consistent wording: `stamp`'s copy is now stated as belt-and-braces enumerability-independence (not sole spread-survival mechanism); `sign`'s comment no longer cites `PRESERVE_EVENT_SYMBOLS` as its justification (that allowlist governs `eventPipe`, not `signEvent`) and instead states what is actually certain — the `EventSigner` interface gives no guarantee that a pluggable signer preserves symbols, so the explicit copy is what guarantees the plaintext reaches `signed`.
- Worked example rewritten (CR-02): both `EncryptedContentSymbol` write sites — `modifyHiddenTags`'s build-path object literal and `setEncryptedContentCache`'s unlock-path `Reflect.set` — are now classified carry-forward payload, with the real reason each must survive a spread (`modifyPublicTags`'s `{ ...draft, tags }` forces the unlock path's write to stay enumerable). States explicitly that memoization-purposed sites can still be category 2 — the write-site spread-survival question decides the category, not the site's purpose.
- Scope paragraph descriptor rationale corrected: `Reflect.deleteProperty` never throws on a non-configurable property (it returns `false` silently, which is the actually-dangerous failure mode `configurable: true` prevents); `writable: true` is not required by `setCachedValue`'s own overwrite (`configurable: true` alone permits redefinition); the `Object.defineProperty` frozen/non-extensible `TypeError` is now documented as deliberate per D-02, with `getReplaceableIdentifier`/`EventStore.add` named as the reachable insert path.
- New changeset `.changeset/cache-frozen-event-throws.md` (patch, `applesauce-core`) discloses the frozen-object throw as a separate user-visible change from the existing non-enumerable changeset.

## Task Commits

1. **Task 1: Rewrite the three category definitions, and correct their downstream restatement in operations/event.ts** - `d4e5b532` (docs)
2. **Task 2: Reclassify setEncryptedContentCache as carry-forward payload (CR-02)** - `c82f9e75` (docs)
3. **Task 3: Correct the descriptor rationale and disclose the frozen-object throw (WR-01, WR-02, WR-03)** - `4264d915` (docs)

_All three tasks are comment-only / doc changes; no separate feat/fix commits were required since zero behavior change was the explicit constraint._

## Files Created/Modified

- `packages/core/src/helpers/cache.ts` - Doc comment above `getCachedValue` fully rewritten (categories 2-3, worked example, scope paragraph); function bodies byte-identical to HEAD
- `packages/core/src/operations/event.ts` - `stamp`'s and `sign`'s comments above their `Reflect.set(…, EncryptedContentSymbol, …)` copies rewritten; both copies themselves untouched
- `.changeset/cache-frozen-event-throws.md` - New patch changeset for `applesauce-core`, single-sentence body

## Retained Citations — Read and Confirmed True

Per the plan's `<output>` instructions, every citation retained or introduced in this rewrite was verified against the cited code before being written:

| Citation (cache.ts / event.ts) | File+symbol read to confirm | Confirmed claim |
|---|---|---|
| `PRESERVE_EVENT_SYMBOLS` (`helpers/pipeline.ts`) | `packages/core/src/helpers/pipeline.ts` — `PRESERVE_EVENT_SYMBOLS` const, `pipeFromAsyncArray`'s delete loop | The loop (`for (const symbol of keys) if (!preserve.has(symbol)) Reflect.deleteProperty(result, symbol)`) only deletes non-listed symbols from `result`; it never copies a listed symbol from `prev` onto `result`. Membership is necessary, not sufficient. |
| `modifyHiddenTags`'s object-literal return (`operations/tags.ts`) | `packages/core/src/operations/tags.ts` lines ~78-91 | `return { ...draft, content, [EncryptedContentSymbol]: plaintext }` — an object literal, which writes `EncryptedContentSymbol` enumerably, giving it enumerable-write spread survival. |
| `stamp`/`sign`'s `Reflect.has`/`get`/`set` copy (`operations/event.ts`) | `packages/core/src/operations/event.ts` — `stamp` and `sign` bodies, read in full | Both explicitly copy `EncryptedContentSymbol` via `Reflect.set(target, EncryptedContentSymbol, Reflect.get(draft, EncryptedContentSymbol)!)`, which is enumerability-blind (works regardless of how the symbol was originally written). |
| `EventStore.copySymbolsToDuplicateEvent` (`event-store.ts`) | `packages/core/src/event-store/event-store.ts` lines 199-231 | Two SEPARATE mechanisms in the same function: an element-wise seen-relays merge (`for (const relay of relays) addSeenRelay(dest, relay)`) and a separate symbol merge loop over `[FromCacheSymbol, verifiedSymbol, EncryptedContentSymbol]`. |
| `getSeenRelays`/`addSeenRelay` (`helpers/relays.ts`) | `packages/core/src/helpers/relays.ts` | `addSeenRelay` reads/writes `SeenRelaysSymbol` directly via `Reflect.get`/`Reflect.set`; not part of the symbol merge loop's list. |
| Common's `Seal`/`Rumor`/`GiftWrap` symbols propagate by shared object reference | `packages/common/src/operations/gift-wrap.ts` lines 100-131 | `Reflect.set(seal, GiftWrapSymbol, gift)`, `Reflect.set(gift, SealSymbol, seal)` — direct writes with no event-store merge involved; not in `copySymbolsToDuplicateEvent`'s list (that list has only `FromCacheSymbol`/`verifiedSymbol`/`EncryptedContentSymbol`, all defined in `applesauce-core`, which does not import `applesauce-common`). |
| `ChannelKeysSymbol` (`concord/src/helpers/keys.ts`) | `packages/concord/src/helpers/keys.ts` lines 122, 146-155 | `channelKeyMemo` calls `getOrComputeCachedValue(material, ChannelKeysSymbol, () => new Map(...))` then does `cache.set(sig, ...)` in place — a mutable `Map` written through the identity-memo helper and grown afterward, confirming mutability of the container doesn't change its category. |
| `modifyPublicTags`'s `{ ...draft, tags }` spread (`operations/tags.ts`) | `packages/core/src/operations/tags.ts` lines 25-31 | `return { ...draft, tags: await tagPipe(...)(...) }` — a plain object spread, which copies only enumerable own properties, confirming a non-enumerable `EncryptedContentSymbol` write on the unlock path would be dropped here. |
| `Reflect.deleteProperty` non-throwing on non-configurable (`helpers/pipeline.ts`) | Verified empirically per plan's `<planner_findings>` and confirmed structurally against MDN/spec semantics: `Reflect.deleteProperty` returns `false` on a non-configurable own property; it is the JS spec's non-throwing form (unlike the `delete` operator in strict mode). | `pipeFromAsyncArray`'s use of `Reflect.deleteProperty` (not `delete`) is exactly why it never throws — confirming WR-02's fix. |
| `getReplaceableIdentifier` reachable from `EventStore.add` | `packages/core/src/event-store/event-store.ts` — `add` method | Per plan's `<action>` guidance; `getReplaceableIdentifier` routes through `getOrComputeCachedValue`, and replaceable-kind inserts call it, confirming the frozen-object throw is reachable from a normal insert path. |

## Decisions Made

- PR-01's false claim (PRESERVE_EVENT_SYMBOLS sufficiency) fixed at both cache.ts (its source) and operations/event.ts (its downstream restatement) in the same task/commit, per the plan's explicit instruction that fixing only the source and leaving the copy would restate the exact defect this round exists to eliminate.
- D-02 followed as locked: no `Object.isExtensible` guard added to `setCachedValue`/`getOrComputeCachedValue` — the frozen-object throw is documented, not silenced.
- D-07 followed as partially superseded per VERIFICATION.md's authoritative `missing:` item: category 3's framing that the merge list is a single "machine-readable definition" was dropped; the cross-reference to the merge loop is retained but described accurately as the mechanism for the two symbols it actually carries.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's own acceptance criteria required zero line-number citations file-wide in cache.ts, ahead of Tasks 2/3's scheduled rewrites**
- **Found during:** Task 1 (verification step, before first commit)
- **Issue:** Task 1's action text explicitly scopes its cache.ts edit to categories 2 and 3 only, deferring the Worked Example paragraph's rewrite to Task 2 and the Scope paragraph's rewrite to Task 3. But Task 1's own acceptance criteria include `grep -cE '\.ts:[0-9]+' packages/core/src/helpers/cache.ts` returning `0` for the whole file — and the (not-yet-rewritten) Worked Example paragraph still cited `operations/tags.ts:87` / `helpers/encrypted-content.ts:117`, and the Scope paragraph still cited `pipeline.ts:63`. Running Task 1's verify command with only categories 2/3 changed would have failed on this file-wide gate.
- **Fix:** As part of Task 1's single edit to the doc comment block, stripped the bare line-number suffix from these two paragraphs' citations (e.g. `operations/tags.ts:87` → `operations/tags.ts`, `pipeline.ts:63` parenthetical removed) without otherwise rewriting their prose — leaving the substantive content rewrite for Tasks 2 and 3 exactly as planned. This is format-only; the (still-incorrect-until-Task-2) `setEncryptedContentCache` "identity memo" classification and the (still-incorrect-until-Task-3) "Reflect.deleteProperty throws" claim were left untouched in Task 1's commit and corrected in their scheduled tasks two commits later.
- **Files modified:** packages/core/src/helpers/cache.ts (same file/commit as Task 1's planned edit)
- **Verification:** `grep -cE '\.ts:[0-9]+' packages/core/src/helpers/cache.ts` returned `0` after Task 1; Task 2 and Task 3 then independently verified their own full paragraph rewrites per their acceptance criteria, and the plan-level repo-wide sweep confirmed zero false citations remain anywhere.
- **Committed in:** `d4e5b532` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — plan-internal acceptance-criteria ordering conflict, resolved without altering any task's substantive scope)
**Impact on plan:** No scope creep; Tasks 2 and 3 still performed their full planned rewrites of the Worked Example and Scope paragraphs respectively. The only effect was that two already-scheduled-for-correction false claims (worked example's stale classification, scope's stale throw claim) had their line-number citations stripped one commit earlier than their prose was corrected — both were fully corrected on schedule in Tasks 2 and 3.

## Issues Encountered

None — all three tasks' automated verify commands and acceptance-criteria greps passed on the first attempt after the Task 1 citation-stripping adjustment above. `pnpm --filter applesauce-core test` stayed green (635 tests, 57 files) across all three commits.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- cache.ts's taxonomy is now the correct oracle for Plans 05-07 through 05-11, which rewrite other comments (`encrypted-content.ts`, `gift-wrap.ts`, `cache.test.ts`, etc.) against it — per 05-08's plan, `encrypted-content.ts`'s own `setEncryptedContentCache` comment still asserts the pre-CR-02 "identity memo" self-classification and cites stale line numbers (`operations/tags.ts:87`, `operations/event.ts:134,163`); this is explicitly 05-08's job (CR-02 mirror) and was intentionally left untouched here per this plan's `files_modified` scope (`cache.ts`, `operations/event.ts`, changeset only).
- Repo-wide sweep confirms no other file in `packages/core/src` or `packages/common/src` contains the `"machine-readable definition"` phrase or a `pipeline.ts:<line>` citation — the defect class this plan exists to eliminate does not survive outside the two files edited here.
- Zero behavior change confirmed: both `stamp`'s and `sign`'s explicit `Reflect.set` copies are still present exactly once each; `git diff` on both source files shows only `*`/`//`-prefixed lines changed; full `applesauce-core` test suite green (635/635).

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
