---
phase: 02-generic-models-casts
plan: 01
subsystem: core
tags: [typescript, generics, rxjs, event-store, nostr]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation
    provides: "EventStore<E>/AsyncEventStore<E>, all event-store interfaces/managers/helpers already generic over E extends StoreEvent = NostrEvent"
provides:
  - "claimEvents<E>/claimLatest<E> RxJS operators generic over E extends StoreEvent = NostrEvent"
  - "EventModel<E>/ReplaceableModel<E>/TimelineModel<E>/FiltersModel<E> generic over E, plus their four generic private helpers"
  - "Localized bridge-cast pattern for a Model function's runtime store (`store as unknown as IEventStore<E> | IAsyncEventStore<E>`), to be replaced once Model/ModelEventStore thread E properly in Wave 2"
affects: [02-generic-models-casts (Plan 02 — interface.ts D-02 seam, EventModels<E,TStore>), 02-generic-models-casts (Plan 03 — cast infrastructure)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic RxJS operator over E extends StoreEvent = NostrEvent (claimEvents/claimLatest), mirroring casts/event.ts's established convention"
    - "Model-function bridge cast: `const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>` at the top of a model's returned function body, used in place of the untyped `store` param throughout, since Model's TStore stays bare/NostrEvent-typed until Wave 2"
    - "Explicit type argument at generic-function-reference call sites (`this.model(FiltersModel<NostrEvent>, ...)`) to pin inference to the NostrEvent default instead of the StoreEvent constraint"

key-files:
  created:
    - .changeset/genericize-base-models.md
  modified:
    - packages/core/src/observable/claim-events.ts
    - packages/core/src/observable/claim-latest.ts
    - packages/core/src/models/base.ts
    - packages/core/src/event-store/event-models.ts

key-decisions:
  - "claimEvents' non-array tap branch needed an explicit `as E` cast (message as E) because TypeScript cannot narrow a naked type parameter T against a generic-parameterized constraint (E[] | E | undefined) via Array.isArray the way it can against a concrete union"
  - "Model's TStore parameter is still the bare two-argument form this plan (Model<T> only, dropping the TStore argument entirely) rather than Model<T, IEventStore<E> | IAsyncEventStore<E>> as the plan's Task 2 literally specified, because IEventStore<E> does not satisfy Model's current TStore constraint (`extends IEventStore | IAsyncEventStore`, which resolves those bare interfaces to their NostrEvent default) for an abstract E — this is deferred to Plan 02's ModelEventStore<E,TStore>/Model<T,E,TStore> redesign"
  - "Bridged each model's store parameter with a localized `as unknown as IEventStore<E> | IAsyncEventStore<E>` cast at the top of the returned function body (a no-op at the NostrEvent default) instead of trying to widen Model's TStore constraint now, keeping this plan's scope to models/base.ts only"
  - "event-models.ts (not in this plan's declared files_modified) required a one-line fix per call site: passing a bare generic function reference (e.g. FiltersModel) into EventModels.model() without an explicit type argument caused TypeScript to infer E from its constraint (StoreEvent) instead of its default (NostrEvent) — exactly Phase 1's documented WR-02/deferred-items Pitfall 3 — fixed with explicit `<NostrEvent>` type arguments at all four call sites"

patterns-established:
  - "When a model function's runtime store must be treated as E-typed but the public Model type hasn't threaded E through yet, bridge-cast the store once at the top of the function body and use the bridged binding throughout, rather than scattering casts at each call site"
  - "Passing a still-generic function (not yet called) into another generic API that expects a concrete instantiation requires an explicit type argument at the call site, or TypeScript infers the function's constraint rather than its default"

requirements-completed: [CORE-06]

coverage:
  - id: D1
    description: "claimEvents and claimLatest are generic over E extends StoreEvent = NostrEvent, accepting IEventClaims<E> with E-typed internal Set/latest state"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (full 592-test suite, exercises claimEvents/claimLatest indirectly via EventModel/ReplaceableModel/TimelineModel)"
        status: pass
    human_judgment: false
  - id: D2
    description: "EventModel/ReplaceableModel/TimelineModel/FiltersModel and their four module-private helpers are generic over E extends StoreEvent = NostrEvent"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "packages/core/src/models/__tests__/exports.test.ts, packages/core/src/event-store/__tests__/event-store.test.ts, async-event-store.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "insertEventIntoDescendingList bridged locally in TimelineModel with as unknown as NostrEvent[]/NostrEvent; its own signature and watchEventUpdates untouched"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (timeline ordering assertions in event-store.test.ts)"
        status: pass
    human_judgment: false
  - id: D4
    description: "pnpm --filter applesauce-core build/test green, and full workspace pnpm -r build green (no downstream package regresses)"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build && pnpm --filter applesauce-core test"
        status: pass
      - kind: integration
        ref: "pnpm -r build (full workspace, all packages including common/wallet/concord/react/actions/examples)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-09
status: complete
---

# Phase 2 Plan 1: Generic base models & claim operators Summary

**`claimEvents`/`claimLatest` and the four base models (`EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) genericized over `E extends StoreEvent = NostrEvent`, with a localized store bridge-cast standing in for the not-yet-threaded `Model` interface layer.**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-07-09T02:58:34Z
- **Tasks:** 2
- **Files modified:** 5 (4 source + 1 changeset)

## Accomplishments
- `claimEvents<E extends StoreEvent = NostrEvent, T>` and `claimLatest<E extends StoreEvent = NostrEvent, T>` accept `IEventClaims<E>` with `E`-typed internal `Set`/`latest` state
- `EventModel<E>`, `ReplaceableModel<E>`, `TimelineModel<E>`, `FiltersModel<E>` and their four module-private helpers (`getEventFromStores`, `getReplaceableFromStores`, `getByFiltersFromStores`, `loadEventUsingFallback`) are generic over `E`
- `insertEventIntoDescendingList` bridged at its single `TimelineModel` call site, matching Phase 1's `event-memory.ts` precedent exactly
- `pnpm --filter applesauce-core build` + `test` green (592/592 tests unchanged), and the full workspace `pnpm -r build` (every package: common, wallet, concord, react, actions, examples, etc.) also green

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize claimEvents and claimLatest over E extends StoreEvent = NostrEvent** - `42b820d8` (feat)
2. **Task 2: Genericize the four base models + private helpers, bridge insertEventIntoDescendingList, add changeset** - `7e206a70` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `packages/core/src/observable/claim-events.ts` - `claimEvents<E, T>` generic over `E`, `Set<E>` internal state, localized `as E` narrowing casts in the non-array tap branch
- `packages/core/src/observable/claim-latest.ts` - `claimLatest<E, T>` generic over `E`, `E | undefined` internal `latest` state
- `packages/core/src/models/base.ts` - Four base models + four private helpers generic over `E`; each model bridges its runtime store to an `E`-typed view; `insertEventIntoDescendingList` bridged at its single call site
- `packages/core/src/event-store/event-models.ts` - Pinned the four `this.model(...)` call sites (`filters`, `event`, `replaceable`, `timeline`) to an explicit `<NostrEvent>` type argument on the now-generic model function references
- `.changeset/genericize-base-models.md` - `applesauce-core: minor` changeset (single sentence)

## Decisions Made
- `claimEvents`' non-array branch needed a localized `as E` cast (`message as E`) — TypeScript cannot narrow a naked type parameter `T` against a generic-parameterized constraint (`E[] | E | undefined`) via `Array.isArray` the way it narrows against a concrete union. The array branch (`for (const event of message)`) needed no such cast; only the scalar branch did.
- Kept `Model`'s return-type annotation on all four base models as the single-argument `Model<T>` form (letting `TStore` default, unchanged) rather than the plan's literally-specified `Model<E | undefined, IEventStore<E> | IAsyncEventStore<E>>` two-argument form — the latter fails to type-check because `Model`'s `TStore extends IEventStore | IAsyncEventStore` constraint resolves those bare interfaces to their `NostrEvent` default, and an abstract `E` (bounded only by `StoreEvent`) is not provably assignable to `IEventStore<NostrEvent>`. Instead, each model bridges its runtime `store` parameter to an `E`-typed view via `store as unknown as IEventStore<E> | IAsyncEventStore<E>` at the top of the function body (a no-op for the default `NostrEvent` case) and uses that binding throughout. This is deferred to Plan 02, which threads `E` properly through `Model<T, E, TStore>`/`ModelEventStore<E, TStore>`.
- `event-store/event-models.ts` (not declared in this plan's `files_modified`) required one-line fixes at its four `this.model(...)` call sites: passing a bare generic function reference (e.g. `FiltersModel`) without an explicit type argument caused TypeScript to infer `E` from its constraint (`StoreEvent`) rather than its default (`NostrEvent`) — the exact Pitfall 3 documented in `02-RESEARCH.md` (traced to Phase 1's WR-02/deferred-items lesson). Fixed with explicit `<NostrEvent>` type arguments (`FiltersModel<NostrEvent>`, `EventModel<NostrEvent>`, `ReplaceableModel<NostrEvent>`, `TimelineModel<NostrEvent>`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `claimEvents`' non-array branch failed to type-check against a generic-parameterized union constraint**
- **Found during:** Task 1
- **Issue:** `T extends E[] | E | undefined` narrowed via `Array.isArray(message)` left the `else` branch typed as `T & {}` (not narrowed to `E`), since TypeScript cannot narrow a naked type parameter against a constraint containing another unresolved generic (`E`) the way it can against a concrete union.
- **Fix:** Added a localized `as E` cast at the three use sites in the non-array branch (`seen.has`, `seen.add`, `claims.claim`).
- **Files modified:** `packages/core/src/observable/claim-events.ts`
- **Committed in:** `42b820d8` (Task 1 commit)

**2. [Rule 3 - Blocking] `Model<E | undefined, IEventStore<E> | IAsyncEventStore<E>>` (as literally specified by the plan's Task 2 action) does not satisfy `Model`'s current `TStore` constraint**
- **Found during:** Task 2
- **Issue:** `Model<T, TStore extends IEventStore | IAsyncEventStore = ...>`'s bare `IEventStore`/`IAsyncEventStore` constraint resolves to their `NostrEvent` default; an abstract `E extends StoreEvent` is not provably assignable, producing `TS2344` on all four model return types, plus cascading `TS2769`/`TS2322`/`TS18048` errors inside the model bodies (the `store` parameter's streams stayed `NostrEvent`-typed via `ModelEventStore`'s still-bare `IEventStoreStreams`/`IEventSubscriptions` composition).
- **Fix:** Kept `Model<T>` (1-arg, `TStore` at its existing default) on all four models; bridged each model's `store` parameter to an `E`-typed view at the top of the function body (`const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>`) and used that binding for every store access in the body. This is the correct minimal fix within this plan's scope — full `TStore`/`ModelEventStore` threading is Plan 02's job.
- **Files modified:** `packages/core/src/models/base.ts`
- **Committed in:** `7e206a70` (Task 2 commit)

**3. [Rule 3 - Blocking] `event-store/event-models.ts` failed to build after the four base models became generic**
- **Found during:** Task 2 (full-package build)
- **Issue:** `EventModels`'s `filters()`/`event()`/`replaceable()`/`timeline()` methods pass the (now generic) model functions bare into `this.model(...)` without an explicit type argument; TypeScript inferred `E` from the constraint (`StoreEvent`) rather than the default (`NostrEvent`), producing `Observable<StoreEvent>` vs. the declared `Observable<NostrEvent>` return type mismatches.
- **Fix:** Added explicit `<NostrEvent>` type arguments at all four call sites (`FiltersModel<NostrEvent>`, `EventModel<NostrEvent>`, `ReplaceableModel<NostrEvent>`, `TimelineModel<NostrEvent>`).
- **Files modified:** `packages/core/src/event-store/event-models.ts` (not in this plan's declared `files_modified`, but required to keep `applesauce-core` building — the plan's own verification gate)
- **Committed in:** `7e206a70` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were required to make the genericization actually type-check and to keep `applesauce-core` (and the full workspace) building. No scope creep beyond what was necessary — the interface.ts `Model`/`ModelEventStore` redesign explicitly stays deferred to Plan 02, as planned.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `claimEvents`/`claimLatest` and the four base models are generic over `E`, ready for Plan 02 to thread `E` through `Model<T, E, TStore>`/`ModelEventStore<E, TStore>`/`IEventSubscriptions<E>`/`EventModels<E, TStore>` (closing the D-02/WR-02 seam) and replace this plan's temporary store bridge-casts with a properly `E`-typed `store` parameter.
- Full workspace `pnpm -r build` confirmed green before handoff — no downstream package (`applesauce-common`, `wallet`, `concord`, `react`, `actions`, `examples`) regressed.
- No blockers for Plan 02.

---
*Phase: 02-generic-models-casts*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files and all three task/summary commit hashes (`42b820d8`, `7e206a70`, `ea3fc6ed`) were verified present on disk and in git history.
