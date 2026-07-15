---
phase: 05-cache-identity-memo-fix
plan: 01
subsystem: core
tags: [cache, event-store, spread-safety, applesauce-core, changeset]

# Dependency graph
requires: []
provides:
  - "cache.ts write mechanism fixed: setCachedValue/getOrComputeCachedValue write non-enumerable memos via Object.defineProperty"
  - "canonical identity-memo/carry-forward-payload/accumulated-state taxonomy prose landed in cache.ts, framed as classifying write sites"
  - "applesauce-core patch changeset disclosing the behavior change"
affects: [05-02, 05-03, 05-04, concord-rotation-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Object.defineProperty with { enumerable: false, writable: true, configurable: true } for identity memos on event objects, instead of Reflect.set"
    - "Symbol-write taxonomy documented as a per-write-site question (\"must this write survive a spread?\"), not a symbol-to-category table"

key-files:
  created:
    - .changeset/cache-identity-memo-non-enumerable.md
  modified:
    - packages/core/src/helpers/cache.ts

key-decisions:
  - "Modified setCachedValue/getOrComputeCachedValue in place (D-01) — no new defineCachedValue function, no deprecation, so all ~149 existing call sites pick up the fix with zero migration"
  - "Used Object.defineProperty, not Reflect.defineProperty (D-02) — throwing on a frozen/sealed object surfaces a real bug instead of silently returning a stale value forever; nothing in the monorepo freezes events today"
  - "Patch bump only (D-03) — defect fix, no documented behavior ever promised memo survival across a spread, and all call sites cache onto immutable signed NostrEvents that are never spread"

requirements-completed: [CACHE-01, CACHE-02]

coverage:
  - id: D1
    description: "Cache writes (setCachedValue, getOrComputeCachedValue) use Object.defineProperty with enumerable:false/writable:true/configurable:true so a spread drops the memo instead of carrying it forward stale"
    requirement: "CACHE-01"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (629 tests, full suite, no regression)"
        status: pass
    human_judgment: false
  - id: D2
    description: "cache.ts documents the three-category write-site taxonomy (identity memo, carry-forward payload, accumulated state) with the EncryptedContentSymbol dual-lifecycle worked example and both executable cross-references (PRESERVE_EVENT_SYMBOLS, event-store.ts merge list)"
    requirement: "CACHE-02"
    verification:
      - kind: unit
        ref: "grep-based acceptance criteria in 05-01-PLAN.md Task 2 (all category names, write-site framing, cross-references, worked example present; no symbol-to-category table)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One applesauce-core patch changeset with a single-sentence body disclosing the behavior change, per CLAUDE.md's binding changeset rules"
    verification:
      - kind: unit
        ref: "node -e verification script embedded in 05-01-PLAN.md Task 3 (frontmatter bump check, single-sentence body check)"
        status: pass
    human_judgment: false

duration: ~12min
completed: 2026-07-15
status: complete
---

# Phase 5 Plan 1: Cache Write-Mechanism Fix + Taxonomy Docs Summary

**Fixed the CONCORD-H01 root cause by making `cache.ts`'s two memo writes non-enumerable via `Object.defineProperty`, documented the identity-memo/carry-forward/accumulated-state write-site taxonomy in the same file, and shipped a patch changeset.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-15
- **Tasks:** 3 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- `setCachedValue` and `getOrComputeCachedValue` in `packages/core/src/helpers/cache.ts` now write memos via `Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true })` instead of `Reflect.set` — an object spread no longer copies the memo, so a spread with changed fields correctly forces recomputation instead of returning a stale derivation.
- Read paths (`getCachedValue`'s `Reflect.get`, `getOrComputeCachedValue`'s `Reflect.has`/`Reflect.get`) are untouched; no exported function was added, renamed, or deprecated — all existing call sites pick up the fix with zero migration.
- Added a block-comment taxonomy to `cache.ts` naming all three symbol-write categories (identity memo, carry-forward payload, accumulated state), framing them as a per-write-site question rather than a symbol lookup table, using `EncryptedContentSymbol`'s two opposite-semantics write sites (`operations/tags.ts:87` carry-forward vs. `helpers/encrypted-content.ts:117` identity memo) as the worked example, and citing both executable cross-references (`PRESERVE_EVENT_SYMBOLS` in `pipeline.ts:5`, the merge list in `event-store.ts:219`).
- Added `.changeset/cache-identity-memo-non-enumerable.md`, a patch-level `applesauce-core` changeset with a single-sentence body.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write cache memos non-enumerable (D-01, D-02)** - `05e68767` (fix)
2. **Task 2: Land the canonical taxonomy prose in cache.ts (D-04, D-05, D-06, D-07)** - `e6368654` (docs)
3. **Task 3: Add the patch changeset (D-03)** - `fbde074b` (chore)

_Note: this is a worktree-mode execution — STATE.md/ROADMAP.md updates are deferred to the orchestrator after all wave agents complete._

## Files Created/Modified
- `packages/core/src/helpers/cache.ts` - `setCachedValue`/`getOrComputeCachedValue` write mechanism changed to `Object.defineProperty`; canonical write-site taxonomy prose added as a block comment above `getCachedValue`
- `.changeset/cache-identity-memo-non-enumerable.md` - patch changeset for `applesauce-core`, single-sentence body

## Decisions Made
- Modified the two existing functions in place rather than adding a new `defineCachedValue` — per D-01, this guarantees zero-migration for ~149 existing call sites.
- Used `Object.defineProperty` (throws on frozen/sealed objects) rather than `Reflect.defineProperty` (fails silently) — per D-02, a thrown error on an edge case that doesn't exist in this monorepo today is strictly better than silently returning a stale memo forever.
- Patch-level changeset, not minor/major — per D-03, this is a defect fix with no promised behavior change for any documented API, and the blast-radius analysis found all call sites cache onto immutable signed events that are never spread.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The root-cause fix and its canonical taxonomy documentation are in place and covered by the green `applesauce-core` suite (629/629 tests).
- Sibling plans in this phase (05-02 test coverage, 05-03 comment sweep, 05-04 concord spec-derived tests) can now build directly on this write mechanism and cite this taxonomy prose rather than restating it.
- No carry-forward write site was touched — `EncryptedContentSymbol`'s two hand-rolled enumerable writes (`operations/tags.ts:87`, `helpers/encrypted-content.ts:117`) remain untouched, consistent with T-05-02's mitigation.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
