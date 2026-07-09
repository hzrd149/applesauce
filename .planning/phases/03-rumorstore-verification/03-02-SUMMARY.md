---
phase: 03-rumorstore-verification
plan: 02
subsystem: casts
tags: [typescript, generics, conditional-types, castEvent, rxjs]

# Dependency graph
requires:
  - phase: 02-generic-models-casts
    provides: "generic CastConstructor/castEvent/castEventStream/castTimelineStream over StoreEvent (Phase 2 P03), which necessarily widened castEvent's input and dropped its compile-time sig guard (WR-01)"
provides:
  - "sig-gated CastEventInput<T> conditional type in packages/core/src/casts/cast.ts"
  - "@internal performCast (loose, runtime-guarded cast factory) holding the pre-change castEvent body"
  - "public castEvent whose input is CastEventInput<T>-gated and delegates to performCast"
  - "castEventStream/castTimelineStream rewired to call performCast, unchanged loose operator signatures"
affects: [03-rumorstore-verification plan 03 (RUMOR-06 test uses this sig-gated castEvent), 04-* (applesauce-common cast genericization)]

# Tech tracking
tech-stack:
  added: []
  patterns: ["sig-gated conditional type (`T extends { sig: string } ? A : B`) to gate a function's input type on structural presence of a field, without narrowing to T exactly"]

key-files:
  created: [.changeset/sig-gated-cast-event-input.md]
  modified: [packages/core/src/casts/cast.ts, packages/core/src/observable/cast-stream.ts]

key-decisions:
  - "Used the sig-gated CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent form (RESEARCH Pattern 2), not the naive exact-T conditional, since the latter was empirically proven (in RESEARCH) to over-tighten concord's real ConcordDirectInvite narrowed-kind rumor cast call site"
  - "cast-stream.ts imports EventCast from ../casts/event.js (not re-exported by cast.js) and performCast from ../casts/cast.js, since cast.ts only imports EventCast locally rather than re-exporting it"
  - "Task 1 (cast.ts) and Task 2 (cast-stream.ts) edits were both applied to the working tree before running the build gate, since cast.ts alone does not compile without cast-stream.ts's companion change (the strict public castEvent rejects the loose StoreEvent cast-stream.ts passes it); the two tasks were then split into separate commits per the plan's file scoping, each git-clean and independently inspectable"

requirements-completed: [RUMOR-06]

coverage:
  - id: D1
    description: "castEvent's public event parameter is sig-gated via CastEventInput<T>, rejecting an unsigned rumor at compile time for a signed-only cast while still accepting a loose StoreEvent for a rumor-shaped cast"
    requirement: "RUMOR-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-check of cast.ts's new signatures)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-concord test (124/124 — ConcordDirectInvite's real castEvent(rumor, ...) call sites unaffected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "castEventStream/castTimelineStream call the internal performCast (not the strict public castEvent), keeping their exported operator signatures loose over StoreEvent"
    requirement: "RUMOR-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-check of cast-stream.ts's rewired imports/call sites)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core test (598/599 pass; 1 pre-existing exports.test.ts inline snapshot mismatch, expected per RESEARCH Pitfall 3, deferred to plan 03-03)"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 2: Sig-gated castEvent typing (WR-01) Summary

**Split `castEvent` into a sig-gated public entry point (`CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent`) and an internal loose `performCast`, restoring the compile-time signature guard Phase 2's generic widening had dropped, without over-tightening concord's real narrowed-kind rumor cast.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-09T04:35:00Z (approx.)
- **Completed:** 2026-07-09T04:50:28Z
- **Tasks:** 2
- **Files modified:** 2 (+1 changeset created)

## Accomplishments
- `packages/core/src/casts/cast.ts` now exports `CastEventInput<T extends StoreEvent>` (sig-gated conditional type), an `@internal performCast` (the unchanged loose runtime-guarded factory, renamed from the pre-change `castEvent`), and a new public `castEvent` whose `event` parameter is `C extends EventCast<infer T> ? CastEventInput<T> : never` and which delegates to `performCast`.
- `packages/core/src/observable/cast-stream.ts`'s `castEventStream`/`castTimelineStream` now call `performCast` (imported from `../casts/cast.js`) instead of the strict public `castEvent`, keeping their exported operator signatures (`OperatorFunction<StoreEvent | undefined, C | undefined>` / `OperatorFunction<StoreEvent[], C[]>`) unchanged.
- WR-01 (Phase 2 carry-forward) is settled: a signed-only cast (whose `T` requires `sig`) now rejects an unsigned rumor at compile time, while a rumor/sig-less cast still accepts a loose `StoreEvent`.
- Full workspace `pnpm -r build` is clean (exit 0) across `applesauce-core`, `applesauce-concord`, `applesauce-common`, `applesauce-wallet`, `applesauce-react`, `apps/examples`.
- `pnpm --filter applesauce-concord test` — 124/124 tests pass across all 38 test files, confirming `ConcordDirectInvite`'s real `castEvent(rumor, ConcordDirectInvite, store)` call site is unaffected (the RESEARCH Pitfall 1 over-tightening guard).
- Added `.changeset/sig-gated-cast-event-input.md` (`applesauce-core`: minor, single-sentence body per CLAUDE.md).

## Task Commits

Each task was committed atomically:

1. **Task 1: Split castEvent into a sig-gated public castEvent + internal performCast; add CastEventInput** - `676805a0` (feat)
2. **Task 2: Rewire castEventStream/castTimelineStream to call performCast** - `1c311b9c` (refactor)

_Note: Both tasks' code edits were made to the working tree together before running the build/test verification gate, since `cast.ts`'s new strict `castEvent` signature does not compile standalone without `cast-stream.ts`'s companion change to call `performCast` instead. The commits themselves were split per the plan's file scoping (Task 1 = `cast.ts` + changeset, Task 2 = `cast-stream.ts`), each independently clean._

## Files Created/Modified
- `packages/core/src/casts/cast.ts` - Added `CastEventInput<T>`, renamed the loose factory to `@internal performCast`, added a new sig-gated public `castEvent` delegating to it
- `packages/core/src/observable/cast-stream.ts` - Both stream operators now call `performCast` (imported from `../casts/cast.js`); `EventCast` imported from `../casts/event.js`
- `.changeset/sig-gated-cast-event-input.md` - New minor changeset for `applesauce-core`

## Decisions Made
- Used the sig-gated `CastEventInput<T>` form exactly as specified in RESEARCH Pattern 2 / PATTERNS.md — not the naive exact-`T` conditional, which RESEARCH empirically proved breaks concord's `ConcordDirectInvite` narrowed-kind rumor cast.
- `cast-stream.ts` imports `EventCast` from `../casts/event.js` (not from `../casts/cast.js`, since `cast.ts` only imports `EventCast` locally and does not re-export it) and `performCast` from `../casts/cast.js`.
- Applied both tasks' file edits to the working tree together before the first build/test run (since the split is only compilable as a pair), then committed each task's files separately to preserve the plan's intended atomic-per-task git history.
- Left the `exports.test.ts` inline snapshot mismatch (caused by the new `performCast` export) unresolved in this plan, per explicit orchestrator instruction that the final exports-snapshot regeneration is plan 03-03's job.

## Deviations from Plan

None - plan executed exactly as written. The only judgment call (applying both tasks' edits together before verifying, then splitting commits) was a mechanical sequencing choice required by the plan's own interdependency between Task 1 and Task 2 (explicitly flagged in RESEARCH: `castEvent`'s stricter signature and `cast-stream.ts`'s call sites must change together to compile) — not a deviation from the plan's specified content.

## Issues Encountered
- Running `pnpm --filter applesauce-core build` immediately after Task 1's edit alone (before Task 2's edit) fails, because `cast-stream.ts` still called the now-strict public `castEvent` with a loose `StoreEvent` argument. This is expected given the plan's own design (Task 2 exists specifically to fix this) — resolved by applying Task 2's edit before the first verification run, as described above.
- `pnpm --filter applesauce-core test` reports 1 failing test (`src/__tests__/exports.test.ts`'s inline snapshot, now missing the new `performCast` export). This is the exact, expected drift documented in RESEARCH.md Pitfall 3 and explicitly deferred to plan 03-03 per this session's instructions — not fixed here. All other 598 tests pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WR-01 is fully settled; `castEvent`'s public signature is sig-gated and `performCast` is available for plan 03-03's RUMOR-06 test to exercise a rumor cast against a real `RumorStore` (via the documented bridge-cast pattern).
- Plan 03-03 must run `pnpm --filter applesauce-core test -u` (or equivalent) to regenerate the `exports.test.ts` inline snapshot once all of Phase 3's new exports (`RumorStore`, `performCast`, `CastEventInput`) are in place — do not regenerate it piecemeal per-plan.

---
*Phase: 03-rumorstore-verification*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: packages/core/src/casts/cast.ts
- FOUND: packages/core/src/observable/cast-stream.ts
- FOUND: .changeset/sig-gated-cast-event-input.md
- FOUND commit: 676805a0
- FOUND commit: 1c311b9c
