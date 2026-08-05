---
phase: 01-generic-store-foundation
plan: 02
subsystem: core
tags: [typescript, generics, event-store, interfaces, nostr-tools]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation (plan 01)
    provides: "StoreEvent/Rumor types and CORE-04 generic structural helpers in helpers/event.ts"
provides:
  - "All 18 CORE-05 event-store interfaces genericized over E extends StoreEvent = NostrEvent"
  - "IEventStore<E>/IAsyncEventStore<E> compose the still-non-generic EventModels-backed subscription/model portion at the NostrEvent default (D-02 seam)"
affects: [01-03-managers-generic, 01-04-event-store-classes-generic, phase-2-model-framework, phase-3-rumor-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Composite interfaces (IEventStore<E>/IAsyncEventStore<E>) thread <E> into store-owned component interfaces (read-advanced, streams, actions, claims, missing-loader) but extend IEventSubscriptions and IEventModelMixin<IEventStore> bare (NostrEvent default) — the seam that keeps `EventStore<E> extends EventModels implements IEventStore<E>` compiling while EventModels stays non-generic until Phase 2"

key-files:
  created:
    - .changeset/genericize-store-interfaces.md
  modified:
    - packages/core/src/event-store/interface.ts

key-decisions:
  - "IEventStore<E>/IAsyncEventStore<E> extend IEventSubscriptions and IEventModelMixin<IEventStore>/<IAsyncEventStore> without a type argument (resolving to the NostrEvent default) rather than threading E through them, because those methods are provided by the non-generic EventModels superclass deferred to Phase 2 (D-02) — threading E there would break EventStore's implements clause"

patterns-established:
  - "Interface-layer genericization: add <E extends StoreEvent = NostrEvent> to a leaf interface, replace bare NostrEvent event params/returns with E, then thread <E> through every `extends`/`Omit<>` clause of interfaces that compose it — verified end-to-end by `pnpm --filter applesauce-core build` with zero downstream edits due to the NostrEvent default"

requirements-completed: [CORE-05]

coverage:
  - id: D1
    description: "All 16 leaf/component event-store interfaces (IEventStoreRead, IAsyncEventStoreRead, IEventStoreReadAdvanced, IAsyncEventStoreReadAdvanced, IEventStoreStreams, IEventStoreActions, IAsyncEventStoreActions, IEventClaims, IEventSubscriptions, IDeleteManager, IAsyncDeleteManager, IExpirationManager, IEventDatabase, IAsyncEventDatabase, IEventMemory, IMissingEventLoader) carry <E extends StoreEvent = NostrEvent> and return/accept E for event members"
    requirement: "CORE-05"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-checks all 16 genericized leaf interfaces against existing bare-reference call sites)"
        status: pass
    human_judgment: false
  - id: D2
    description: "IEventStore<E> and IAsyncEventStore<E> are generic and compose the EventModels-backed subscription/model portion at the NostrEvent default, so EventStore extends EventModels implements IEventStore<E> still compiles with zero downstream edits"
    requirement: "CORE-05"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc) and pnpm --filter applesauce-core test (589/589 passing)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-09
status: complete
---

# Phase 1 Plan 2: Generic Event-Store Interfaces Summary

**Genericized all 18 CORE-05 event-store interfaces (read, streams, actions, claims, subscriptions, delete/expiration managers, database, memory, missing-loader, and the composite IEventStore/IAsyncEventStore) over `E extends StoreEvent = NostrEvent`, with zero downstream edits.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-09T01:00Z
- **Completed:** 2026-07-09T01:08Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 modified interface file, 1 new changeset)

## Accomplishments
- All 16 leaf/component interfaces (`IEventStoreRead`, `IAsyncEventStoreRead`, `IEventStoreReadAdvanced`, `IAsyncEventStoreReadAdvanced`, `IEventStoreStreams`, `IEventStoreActions`, `IAsyncEventStoreActions`, `IEventClaims`, `IEventSubscriptions`, `IDeleteManager`, `IAsyncDeleteManager`, `IExpirationManager`, `IEventDatabase`, `IAsyncEventDatabase`, `IEventMemory`, `IMissingEventLoader`) now carry `<E extends StoreEvent = NostrEvent>` with bare `NostrEvent` event params/returns replaced by `E`
- `IEventStore<E>` and `IAsyncEventStore<E>` are generic, threading `E` through their store-owned component interfaces while composing the `EventModels`-backed `IEventSubscriptions`/`IEventModelMixin` portion at the `NostrEvent` default — the D-02 seam that keeps `EventStore extends EventModels implements IEventStore<E>` compiling in Phase 1
- `IEventModelMixin`, `ModelEventStore`, `Model`, `ModelConstructor` left completely untouched, deferred to Phase 2 per D-02
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` (589/589) both green with zero edits to any downstream consumer (managers, store classes, `applesauce-common`, `applesauce-react`, `applesauce-relay`, `applesauce-concord` all still build clean against the bare/default interfaces)

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize the component (leaf) interfaces** - `f4ed9ad0` (refactor)
2. **Task 2: Compose IEventStore<E> and IAsyncEventStore<E> across the EventModels seam** - `05b08384` (refactor)

_No plan-metadata commit yet — created after this summary._

## Files Created/Modified
- `packages/core/src/event-store/interface.ts` - All 18 CORE-05 interfaces genericized over `E extends StoreEvent = NostrEvent`; `IEventModelMixin`/`Model`/`ModelConstructor`/`ModelEventStore`/`DeleteEventNotification` untouched
- `.changeset/genericize-store-interfaces.md` - New changeset, `applesauce-core: minor`, single-sentence body

## Decisions Made
- Extended `IEventSubscriptions` and `IEventModelMixin<IEventStore>`/`<IAsyncEventStore>` bare (no type argument) in the composite interfaces rather than threading `E` through them — those methods are supplied by the non-generic `EventModels` superclass (Phase 2 work per D-02), so composing them at the `NostrEvent` default is what keeps `EventStore<E> extends EventModels implements IEventStore<E>` type-checking today

## Deviations from Plan
None - plan executed exactly as written. The D-02 seam behaved exactly as the plan predicted: extending `IEventSubscriptions`/`IEventModelMixin` bare (rather than with `<E>`) was sufficient and no "not assignable" errors surfaced, so no bridge casts or additional adjustments were needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All CORE-05 interfaces are generic and ready for Plan 03 (managers: `DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`) to implement `I*Manager<E>`/`IEventMemory<E>` with concrete `E`-typed classes
- Plan 04 (`EventStore<E>`/`AsyncEventStore<E>` classes) can now implement `IEventStore<E>`/`IAsyncEventStore<E>` directly
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` are both green; downstream packages (`applesauce-common`, `applesauce-react`, `applesauce-relay`, `applesauce-concord`) verified to still build clean with zero edits
- No blockers for Plan 03

---
*Phase: 01-generic-store-foundation*
*Completed: 2026-07-09*

## Self-Check: PASSED

Both modified/created files verified present on disk; both task commit hashes (f4ed9ad0, 05b08384) verified present in git log.
