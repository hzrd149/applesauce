---
phase: 03-rumorstore-verification
plan: 01
subsystem: database
tags: [nostr, event-store, rumor, nip-59, typescript, vitest]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation
    provides: "Generic EventStore<E extends StoreEvent>, generic DeleteManager<E>, verifyRumor helper"
  - phase: 02-generic-models-casts
    provides: "Generic EventModels<E> (filters/timeline/replaceable/getEvent all E-typed)"
provides:
  - "RumorStore convenience class (extends EventStore<Rumor>, verifyRumor-locked)"
  - "rumor-store.test.ts proving RUMOR-03/04/05 against a real RumorStore"
affects: [04-applesauce-common-genericization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Verification-locking subclass: Omit<Options, 'verifyEvent'> + super({ ...options, verifyEvent: fixedVerifier }) statically forbids callers from overriding a store's default verifier"

key-files:
  created:
    - packages/core/src/event-store/rumor-store.ts
    - packages/core/src/event-store/__tests__/rumor-store.test.ts
    - .changeset/add-rumor-store.md
  modified:
    - packages/core/src/event-store/index.ts
    - packages/core/src/__tests__/exports.test.ts

key-decisions:
  - "RumorStore has zero members beyond the constructor — no AsyncRumorStore added, per CONTEXT.md discretion (AsyncEventStore<Rumor> already covers the async case)"
  - "Test rumors built as plain object literals with getEventHash-computed ids rather than via FakeUser, since FakeUser always produces a signed NostrEvent — plain construction better demonstrates rumor-shaped (sig-less) input"

patterns-established:
  - "Verification-locking subclass: Omit<EventStoreOptions<E>, 'verifyEvent'> constructor param + super({ ...options, verifyEvent: X }) spread"

requirements-completed: [RUMOR-03, RUMOR-04, RUMOR-05]

coverage:
  - id: D1
    description: "RumorStore accepts a rumor with a correct id and rejects one with a mismatched id"
    requirement: "RUMOR-03"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/rumor-store.test.ts#RumorStore verification (RUMOR-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "getEvent/filters/timeline/replaceable all return Rumor-typed results from a RumorStore"
    requirement: "RUMOR-04"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/rumor-store.test.ts#RumorStore streams (RUMOR-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A kind-5 delete rumor removes the matching stored rumor via the already-generic DeleteManager"
    requirement: "RUMOR-05"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/rumor-store.test.ts#RumorStore kind-5 delete (RUMOR-05)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 1: RumorStore Class + Verification Summary

**Added `RumorStore` (a thin `EventStore<Rumor>` subclass with `verifyRumor` locked as its non-overridable default verifier) and proved the whole Phase 1-2 generic store stack end-to-end over unsigned rumors with a new 7-case test suite.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-09T04:41:19Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `RumorStore extends EventStore<Rumor>` with a constructor typed `Omit<EventStoreOptions<Rumor>, "verifyEvent">` that always injects `verifyRumor` via `super({ ...options, verifyEvent: verifyRumor })` — callers cannot pass `verifyEvent` at all (compile-time enforced)
- Re-exported from `packages/core/src/event-store/index.ts`, surfacing from the top-level package index
- New `rumor-store.test.ts` proves, against a real `RumorStore` (not a bare `EventStore()`):
  - RUMOR-03: `add()` accepts a correct-id rumor, rejects an incorrect-id rumor
  - RUMOR-04: `getEvent()`, `filters()`, `timeline()`, `replaceable()` all return `Rumor`-typed results with no new production code
  - RUMOR-05: a kind-5 delete rumor removes the matching stored rumor via the existing generic `DeleteManager<Rumor>`
- `applesauce-core` full test suite green: 599/599 (592 pre-existing + 7 new)
- `applesauce-core` build type-checks clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RumorStore class, export it, add changeset** - `90f5e6e4` (feat)
2. **Task 2: RumorStore test suite — accept/reject, filters/timeline/replaceable/getEvent, kind-5 delete** - `081aaec6` (test)

## Files Created/Modified
- `packages/core/src/event-store/rumor-store.ts` - New `RumorStore` class, verifyRumor-locked constructor
- `packages/core/src/event-store/index.ts` - Added `export * from "./rumor-store.js"`
- `.changeset/add-rumor-store.md` - Minor changeset for the new public export
- `packages/core/src/event-store/__tests__/rumor-store.test.ts` - RUMOR-03/04/05 test suite (7 cases)
- `packages/core/src/__tests__/exports.test.ts` - Updated inline snapshot to include the new `RumorStore` export

## Decisions Made
- No `AsyncRumorStore` added — per CONTEXT.md's explicit discretion note, `new AsyncEventStore<Rumor>({ verifyEvent: verifyRumor })` already covers the async case with no new class needed, and there is no concrete consumer requiring one yet.
- Test rumors constructed as plain object literals with `getEventHash`-computed `id`s rather than via `FakeUser` (which always produces a fully signed `NostrEvent`) — plain construction is a more direct demonstration of unsigned rumor-shaped input and matches the RESEARCH.md "Code Examples" pattern verbatim.
- Replaceable-kind coverage (RUMOR-04) used `kinds.Metadata` (kind 0, a standard replaceable kind) with two versions at different `created_at` to prove `replaceable()` returns the latest.

## Deviations from Plan

None - plan executed exactly as written. The `exports.test.ts` snapshot update was already anticipated as part of Task 1/2's normal barrel-export flow (adding a new public export shifts the alphabetically-sorted inline snapshot) and is not a deviation from the plan's scope.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `RumorStore` is a proven, working convenience class ready for Phase 4 (`applesauce-common` genericization) to build casts and helpers against.
- This plan intentionally did not touch `castEvent`'s input typing (WR-01) or add a rumor-cast test — per the phase's plan structure, that is scoped to plan 03-02/03-03 (RUMOR-06), not this plan.
- No blockers.

---
*Phase: 03-rumorstore-verification*
*Completed: 2026-07-09*

## Self-Check: PASSED

- FOUND: packages/core/src/event-store/rumor-store.ts
- FOUND: packages/core/src/event-store/__tests__/rumor-store.test.ts
- FOUND: .changeset/add-rumor-store.md
- FOUND: commit 90f5e6e4
- FOUND: commit 081aaec6
