---
phase: 05-cache-identity-memo-fix
plan: 12
subsystem: cache
tags: [changeset, documentation, event-store, symbol-cache]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix
    provides: setCachedValue non-enumerable memo write (plan 05-01) and the frozen-event throw disclosure this plan corrects
provides:
  - Corrected reachability disclosure for the frozen-event Object.defineProperty throw in cache.ts, naming getExpirationTimestamp (not getReplaceableIdentifier) as the unconditional pre-branching call reached from both EventStore.add and AsyncEventStore.add
  - cache-frozen-event-throws.md changeset re-bumped patch -> minor
  - Neutralized worked example (no exhaustive write-site count) plus a supersession note pointing the taxonomy at the upcoming symbol-propagation redesign phase (05.1)
affects: [05.1-symbol-propagation-redesign]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - packages/core/src/helpers/cache.ts
    - .changeset/cache-frozen-event-throws.md

key-decisions:
  - "D-03 superseded for cache-frozen-event-throws.md only: bumped patch -> minor because the throw is reachable from an unconditional pre-branching call, not limited to replaceable events as originally documented. cache-identity-memo-non-enumerable.md stayed at patch untouched — D-03's no-documented-behavior-ever-promised-spread-survival rationale genuinely applies to the memo-drop half; only the frozen-throw half is a new runtime break."
  - "Task 2 scope intentionally reduced from the cancelled full worked-example/category-3 reconciliation to a minimal two-part edit (neutralize the false count, add a supersession note) per the user's 2026-07-15 decision to eliminate the identity-memo vs carry-forward distinction at the source in phase 05.1 rather than perfect prose about machinery scheduled for deletion."

requirements-completed: [CACHE-02]

coverage:
  - id: D1
    description: "cache.ts's frozen-throw disclosure names getExpirationTimestamp (called unconditionally by both EventStore.add and AsyncEventStore.add before kind/replaceable branching) as the reachability path, replacing the prior replaceable-only claim"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (57 files / 635 tests)"
        status: pass
      - kind: other
        ref: "grep -c 'getExpirationTimestamp' packages/core/src/helpers/cache.ts >= 1; grep -c 'AsyncEventStore' packages/core/src/helpers/cache.ts >= 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "cache-frozen-event-throws.md bumped patch -> minor with an unchanged one-sentence body; sibling cache-identity-memo-non-enumerable.md left untouched at patch"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep '\"applesauce-core\": minor' .changeset/cache-frozen-event-throws.md; git diff --stat .changeset/cache-identity-memo-non-enumerable.md (empty)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worked example no longer asserts an exhaustive write-site/single-category count for EncryptedContentSymbol; adds copySymbolsToDuplicateEvent's merge-loop write as a third, accumulated-state counterexample on the same symbol"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (57 files / 635 tests)"
        status: pass
      - kind: other
        ref: "grep -cE 'has TWO|BOTH carry-forward' == 0; grep -ciE 'has (two|three|...) write sites' == 0; grep -ciE 'non-exhaustive|not exhaustive' >= 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "Taxonomy docblock opens with a supersession note pointing at the symbol-propagation redesign phase and the PRESERVE_EVENT_SYMBOLS whitelist"
    requirement: "CACHE-02"
    verification:
      - kind: other
        ref: "grep -ciE 'scheduled for replacement|superseded' packages/core/src/helpers/cache.ts >= 1; grep -c 'PRESERVE_EVENT_SYMBOLS' == 2 (before: 1)"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-16
status: complete
---

# Phase 05 Plan 12: Cache Disclosure Corrections Summary

**Corrected the frozen-event throw's reachability disclosure to name `getExpirationTimestamp`'s unconditional call (not `getReplaceableIdentifier`'s replaceable-only path), re-bumped its changeset to `minor`, and neutralized `cache.ts`'s one shipped-false worked-example claim with a supersession note pointing at the upcoming symbol-propagation redesign — zero runtime behavior change.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-15T23:39Z (worktree base)
- **Completed:** 2026-07-16T04:44Z
- **Tasks:** 2/2
- **Files modified:** 2

## Accomplishments

- `cache.ts`'s throw disclosure now correctly names `getExpirationTimestamp` — called unconditionally by both `EventStore.add` and `AsyncEventStore.add` before any kind/replaceable branching — as the reachability path, so an ordinary kind-1 note (not only replaceable events) hits the throw on a normal insert. Also documents the verified `kinds.EventDeletion` early-return carve-out.
- `.changeset/cache-frozen-event-throws.md` re-bumped `patch` -> `minor`; its sibling `.changeset/cache-identity-memo-non-enumerable.md` left byte-identical at `patch`.
- The worked example no longer claims an exhaustive two-write-site, single-category count for `EncryptedContentSymbol`; it now names a third write site (`EventStore.copySymbolsToDuplicateEvent`'s merge loop) as an accumulated-state counterexample on the same symbol, sourced from that function's own comment.
- The taxonomy docblock opens with a 6-line supersession note directing future maintainers to the symbol-propagation redesign phase (05.1) instead of inviting further investment in the category system.

## Task Commits

Each task was committed atomically:

1. **Task 1: Correct the frozen-event throw's reachability disclosure and re-bump its changeset (GAP 3 + GAP 4)** - `293a8849` (docs)
2. **Task 2: Neutralize the worked example's false count and mark the taxonomy superseded (GAP 1/GAP 2, reduced scope)** - `c47eddbb` (docs)

**Plan metadata:** (this commit, worktree mode — orchestrator merges and records)

## Files Created/Modified

- `packages/core/src/helpers/cache.ts` — corrected throw disclosure (Task 1); neutralized worked example + supersession note (Task 2). Comment-only; zero non-comment lines changed in either task.
- `.changeset/cache-frozen-event-throws.md` — frontmatter bump `patch` -> `minor`; body unchanged.

## Decisions Made

- **Traced deletion-path question (required by plan `<output>`):** confirmed by reading both `EventStore.add` (event-store.ts) and `AsyncEventStore.add` (async-event-store.ts) top-to-bottom. In both stores, the `event.kind === kinds.EventDeletion` early return (and the subsequent `this.deletes.check(event)` early return for already-deleted events) precede the `getExpirationTimestamp(event)` call. That call is itself unconditional with respect to kind/replaceable branching — it runs before the `isReplaceable(event.kind)` check that determines the replaceable identifier. So the accurate framing (written into cache.ts) is: the throw is reached by regular and replaceable kinds alike on a normal insert, EXCLUDING kind-5 deletion events and already-deleted events, which return before reaching that call. No claim of "every event of any kind" was made — the deletion carve-out is stated explicitly, matching what was actually traced.
- **D-03 supersession scope (required by plan `<output>`):** `cache-frozen-event-throws.md` bumped to `minor` because the corrected reachability facts (unconditional pre-branching call) disprove D-03's original patch-justifying premise for this half only. `cache-identity-memo-non-enumerable.md` stayed at `patch` — D-03's "no documented behavior ever promised memos survive a spread" rationale genuinely holds for the memo-drop change; only the frozen-throw half introduces a new runtime break (silent failure -> throw) that consumers freezing events could hit. `git diff --stat` confirms the sibling changeset has zero entries (untouched).
- **`PRESERVE_EVENT_SYMBOLS` grep counts (required by plan `<output>`):** before Task 2 (at HEAD, i.e., after Task 1's unrelated commit which didn't touch this section): 1 occurrence (in category 2's description of the allowlist). After Task 2: 2 occurrences (the original plus one new mention in the supersession note naming `PRESERVE_EVENT_SYMBOLS` as the redesign's explicit carry-forward mechanism).
- **Task 2 verified counterexample:** confirmed via `EventStore.copySymbolsToDuplicateEvent`'s source (event-store.ts) that its `symbols` array literal includes `EncryptedContentSymbol` alongside `FromCacheSymbol`/`verifiedSymbol`, and the adjacent comment explicitly states "These three symbols propagate across duplicate events via this loop rather than via object spread — accumulated state (see cache.ts taxonomy)." This directly supports classifying that write site as accumulated state, distinct from the two carry-forward payload sites already documented.
- **Non-exhaustive write-site count verified:** a repo-wide grep for `EncryptedContentSymbol` (excluding tests) across `packages/core/src` and `packages/common/src` found at least 7 non-test write/mutation sites (`encrypted-content.ts`, `operations/encrypted-content.ts`, `operations/event.ts` x2 for `stamp`/`sign`, `operations/tags.ts`, `event-store.ts`'s merge loop, and `common/src/operations/gift-wrap.ts`), confirming "TWO write sites" was false and that no exhaustive count belongs in the prose.

## Deviations from Plan

None — plan executed exactly as written, including the scope reductions the plan itself specifies (Task 2's minimal two-part edit rather than the cancelled full reconciliation).

**One process note (not a deviation from scope, but worth recording):** the plan's Task 1 automated verify command includes `grep -cE '^\s*[-*]|^\s*```' $F -eq 0` run against the WHOLE changeset file (not just the body after frontmatter). This is a false positive: the YAML frontmatter's own `---` delimiter lines match `^\s*[-*]` (a bare `-` matches the `[-*]` character class), so this check reports 2 even on the byte-identical file at `HEAD` before this plan's edit (verified via `git show HEAD:.changeset/cache-frozen-event-throws.md | grep -cE '^\s*[-*]|^\s*```'` = 2). The semantic requirement it's meant to enforce — the body is one non-blank line, no bullets, no code fences — is independently confirmed true by the adjacent `sed -n '4,$p' $F | grep -vE '^\s*$' | wc -l` check (returns 1) and manual inspection of the body line. No file was changed to work around this; it is a pre-existing quirk in the plan's own verify script, not a defect in the shipped changeset.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `cache.ts` now ships no known-false claim and is production-ready as the interim state.
- The supersession note is the entry pointer phase 05.1 (symbol-propagation redesign) consumes, per PROJECT.md's roadmap-evolution log.
- Zero runtime behavior change; `applesauce-core` suite green at 57 files / 635 tests after both tasks.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-16*
