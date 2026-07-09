---
phase: 03-rumorstore-verification
plan: 03
subsystem: testing
tags: [typescript, vitest, casts, rumor, nip-59, snapshot-testing]

# Dependency graph
requires:
  - phase: 03-rumorstore-verification plan 01
    provides: "RumorStore (a real EventStore<Rumor> subclass) to cast a rumor against instead of a bare EventStore()"
  - phase: 03-rumorstore-verification plan 02
    provides: "sig-gated public castEvent + CastEventInput<T> + internal performCast, restoring the WR-01 compile-time guard"
provides:
  - "RUMOR-06 proof: a custom EventCast<Rumor> works with castEvent against a genuine RumorStore via the documented `as unknown as CastRefEventStore` bridge cast"
  - "a compile-time @ts-expect-error probe confirming a signed-only cast rejects a rumor at the type level (WR-01 permanently regression-guarded)"
  - "regenerated exports.test.ts inline snapshot including performCast (RumorStore was already present from plan 01)"
  - "Part A gate cleared: applesauce-core test + build green, full pnpm -r build exits 0"
affects: [04-applesauce-common-genericization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bridge-cast convention reused a third time: `rumorStore as unknown as CastRefEventStore` at a real call site, mirroring `casts/event.ts`'s `signedView` bridge, to work around EventCast's store parameter being invariant in E"

key-files:
  created: []
  modified:
    - packages/core/src/casts/__tests__/rumor-cast.test.ts
    - packages/core/src/__tests__/exports.test.ts

key-decisions:
  - "Used a minimal local SignedOnlyCast class (reads this.event.sig) as the WR-01 regression-guard target, rather than reusing an existing production cast, to keep the probe self-contained and its intent explicit"
  - "Left CastEventInput out of the exports snapshot deliberately -- it is a type-only export, erased at runtime, so it never appears in Object.keys(exports); only RumorStore and performCast are asserted as required runtime keys, per the plan's own note"

patterns-established: []

requirements-completed: [RUMOR-06]

coverage:
  - id: D1
    description: "A custom EventCast<Rumor> (RumorNote) casts an unsigned rumor via castEvent against a real RumorStore using the documented bridge cast, reading cast.text/cast.id correctly"
    requirement: "RUMOR-06"
    verification:
      - kind: unit
        ref: "packages/core/src/casts/__tests__/rumor-cast.test.ts#casts an unsigned rumor via castEvent against a real RumorStore (RUMOR-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A @ts-expect-error compile-time probe proves a signed-only cast (reading event.sig) rejects a rumor argument to castEvent, settling WR-01 as a permanent regression guard"
    requirement: "RUMOR-06"
    verification:
      - kind: unit
        ref: "packages/core/src/casts/__tests__/rumor-cast.test.ts#rejects a rumor for a signed-only cast at compile time (WR-01 regression guard)"
        status: pass
    human_judgment: false
  - id: D3
    description: "exports.test.ts inline snapshot regenerated via vitest -u (not hand-edited) to include performCast; RumorStore was already present from plan 01"
    verification:
      - kind: unit
        ref: "packages/core/src/__tests__/exports.test.ts#should export the expected functions"
        status: pass
    human_judgment: false
  - id: D4
    description: "Part A gate: applesauce-core full test suite (601/601) and build green, plus the full workspace pnpm -r build exits 0 with no downstream fixes required"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test && pnpm --filter applesauce-core build && pnpm -r build"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 3: RUMOR-06 Proof + Part A Gate Summary

**Proved a custom `EventCast<Rumor>` casts an unsigned rumor via `castEvent` against a genuine `RumorStore` (not a bare `EventStore()`), added a `@ts-expect-error` compile-time probe locking WR-01's sig-gate in place, regenerated the export snapshot, and cleared the whole-phase Part A gate (`applesauce-core` test + build green, full `pnpm -r build` exit 0).**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-07-09T23:56:12Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Extended (not replaced) `rumor-cast.test.ts` with a new RUMOR-06 positive case: `castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore)` against a real `new RumorStore()` with `rumorStore.add(rumor)` — asserts `cast instanceof RumorNote`, `cast.text`, and `cast.id`
- Added a compile-time-only `@ts-expect-error` negative probe: a minimal `SignedOnlyCast extends EventCast<NostrEvent>` reading `this.event.sig`, used as `castEvent(rumor, SignedOnlyCast, store)` — the line only compiles-as-expected because it genuinely fails to type-check; if the sig-gate regresses, `@ts-expect-error` becomes unused and the build fails
- The two original bare-`EventStore()` cases remain untouched — 4 total tests in `rumor-cast.test.ts` now (2 original + 2 new), all passing
- Regenerated `exports.test.ts`'s inline snapshot via `pnpm --filter applesauce-core exec vitest run -u src/__tests__/exports.test.ts` — the only diff was the addition of `performCast` (`RumorStore` was already present from plan 03-01's snapshot update)
- Part A gate cleared: `pnpm --filter applesauce-core test` (54 test files, 601/601 tests pass), `pnpm --filter applesauce-core build` (clean tsc), and full `pnpm -r build` (exit 0 across `applesauce-core`, `applesauce-concord`, `applesauce-common`, `applesauce-wallet`, `applesauce-react`, `apps/examples`) — no downstream fixes were required

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend rumor-cast.test.ts — real RumorStore cast + signed-only-cast @ts-expect-error probe** - `21254e1e` (test)
2. **Task 2: Regenerate exports snapshot + clear the Part A phase gate** - `4e6ef7c6` (test)

## Files Created/Modified
- `packages/core/src/casts/__tests__/rumor-cast.test.ts` - Added the RUMOR-06 real-`RumorStore` bridge-cast case and the `@ts-expect-error` WR-01 regression probe; original bare-`EventStore` cases unchanged
- `packages/core/src/__tests__/exports.test.ts` - Inline snapshot regenerated via `vitest -u` to include `performCast`

## Decisions Made
- Used a minimal local `SignedOnlyCast` class as the WR-01 probe target (reads `this.event.sig`) rather than reusing an existing production signed-cast, to keep the regression guard self-contained and its intent unambiguous in the test file itself.
- Confirmed `CastEventInput` (a type-only export) correctly does not appear in the runtime `exports.test.ts` snapshot — type exports are erased at compile time and never show up in `Object.keys(exports)`; only `RumorStore` and `performCast` were required and both are present.

## Deviations from Plan

None - plan executed exactly as written. `RumorStore` was already present in the exports snapshot from plan 03-01 (that plan's own snapshot update anticipated it), so this plan's regeneration only needed to absorb `performCast` — consistent with RESEARCH.md's Pitfall 3 expectation.

## Issues Encountered
None. The full `pnpm -r build` gate passed cleanly on the first run, matching RESEARCH.md's prediction that this exact gate had already been verified once in the research session (then reverted).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RUMOR-06 is fully proven end-to-end: `RumorStore` (plan 01) + sig-gated `castEvent`/`performCast` (plan 02) + a real bridge-cast test with a compile-time WR-01 regression guard (this plan).
- The Part A gate (the whole-phase completion gate: core test + build green, full workspace build green) is cleared — Phase 4 (`applesauce-common` genericization) is unblocked.
- No blockers.

---
*Phase: 03-rumorstore-verification*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: packages/core/src/casts/__tests__/rumor-cast.test.ts
- FOUND: packages/core/src/__tests__/exports.test.ts
- FOUND: commit 21254e1e
- FOUND: commit 4e6ef7c6
