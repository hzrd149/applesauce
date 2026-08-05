---
phase: 01-generic-store-foundation
plan: 03
subsystem: core
tags: [typescript, generics, event-store, managers, nostr-tools]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation (plan 01)
    provides: "StoreEvent/Rumor types and CORE-04 generic structural helpers (getReplaceableIdentifier, getExpirationTimestamp, getIndexableTags, etc.) in helpers/"
  - phase: 01-generic-store-foundation (plan 02)
    provides: "IDeleteManager<E>, IAsyncDeleteManager<E>, IExpirationManager<E>, IEventMemory<E> generic interfaces"
provides:
  - "DeleteManager<E>, AsyncDeleteManager<E>, ExpirationManager<E>, EventMemory<E> generic over E extends StoreEvent = NostrEvent, implementing their <E> interfaces"
  - "Localized bridge-cast pattern for calling non-CORE-04 helpers (getDeleteEventPointers, getDeleteAddressPointers, insertEventIntoDescendingList) from generic manager code"
affects: [01-04-event-store-classes-generic, phase-3-rumor-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Manager genericization: add <E extends StoreEvent = NostrEvent> to the class, implement I*Manager<E>, replace every NostrEvent param/return with E, and bridge calls into still-NostrEvent-typed helpers with a localized `as unknown as NostrEvent` cast scoped to the call site only — mirrors casts/event.ts's signedView getter"

key-files:
  created:
    - .changeset/genericize-store-managers.md
  modified:
    - packages/core/src/event-store/delete-manager.ts
    - packages/core/src/event-store/async-delete-manager.ts
    - packages/core/src/event-store/expiration-manager.ts
    - packages/core/src/event-store/event-memory.ts

key-decisions:
  - "WeakMap<E, number> for EventMemory's claims map compiles directly without an `E extends object` conditional guard — StoreEvent's structural bound already satisfies WeakMap's key-type constraint, so no extra type gymnastics were needed"

patterns-established:
  - "Non-CORE-04 helper bridge: getDeleteEventPointers/getDeleteAddressPointers (helpers/delete.ts) and insertEventIntoDescendingList (nostr-tools/utils, re-exported from helpers/event.ts) remain NostrEvent-typed this phase; every call site from genericized manager code casts its E-typed argument(s) with `as unknown as NostrEvent` scoped to just that call, with a comment noting the helper is outside the CORE-04 list"

requirements-completed: [CORE-05]

coverage:
  - id: D1
    description: "DeleteManager<E>, AsyncDeleteManager<E>, and ExpirationManager<E> are generic over E extends StoreEvent = NostrEvent, implement IDeleteManager<E>/IAsyncDeleteManager<E>/IExpirationManager<E>, and bridge calls to getDeleteEventPointers/getDeleteAddressPointers with localized casts"
    requirement: "CORE-05"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-checks all three generic manager classes against their Plan 02 interfaces)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core test delete expiration (43 tests, delete-manager + async-delete-manager + expiration-manager suites unchanged behavior)"
        status: pass
    human_judgment: false
  - id: D2
    description: "EventMemory<E> is generic over E extends StoreEvent = NostrEvent, implements IEventMemory<E>, with every internal index (kinds/authors/tags/created_at/kindAuthor/events/replaceable/claims) and CRUD/claim/iterator method threaded over E, bridging insertEventIntoDescendingList calls with localized casts"
    requirement: "CORE-05"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-checks EventMemory<E> against IEventMemory<E>)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core test (full 589-test suite, event-memory.test.ts unchanged behavior)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 1 Plan 3: Generic Event-Store Managers Summary

**Genericized DeleteManager, AsyncDeleteManager, ExpirationManager, and EventMemory over `E extends StoreEvent = NostrEvent`, bridging the three non-CORE-04 helpers they call with localized casts, with zero runtime behavior change.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-09T01:05Z
- **Completed:** 2026-07-09T01:18Z
- **Tasks:** 2 completed
- **Files modified:** 5 (4 modified manager files, 1 new changeset)

## Accomplishments
- `DeleteManager<E extends StoreEvent = NostrEvent> implements IDeleteManager<E>` — `add`/`check`/`filter` all operate on `E`, with `getDeleteEventPointers`/`getDeleteAddressPointers` calls bridged via a localized `deleteEvent as unknown as NostrEvent` cast (those helpers are not in the CORE-04 list and stay `NostrEvent`-typed)
- `AsyncDeleteManager<E extends StoreEvent = NostrEvent> implements IAsyncDeleteManager<E>` delegates to an internal `DeleteManager<E>`; no new bridge casts needed since the bridges live in the internal sync manager
- `ExpirationManager<E extends StoreEvent = NostrEvent> implements IExpirationManager<E>` — `track`/`check` call the now-generic `getExpirationTimestamp(event)` with no bridge needed
- `EventMemory<E extends StoreEvent = NostrEvent> implements IEventMemory<E>` — every index (`kinds`, `authors`, `tags`, `created_at`, `kindAuthor`, `events`, `replaceable`, `claims`) and every CRUD/claim/iterator/filter method threaded over `E`; the three `insertEventIntoDescendingList` call sites (add, getTimeline) bridged with localized `as unknown as NostrEvent[]`/`as unknown as NostrEvent` casts since that helper is re-exported from `nostr-tools/utils` and stays `Event[]`-typed
- `binarySearch` required no bridge — it is already generic (`<T>(arr: T[], compare: (b: T) => number)`) in `nostr-tools/utils`, so `removeFromSortedArray`/`iterateTime` type-check directly against `E[]`
- Full `applesauce-core` build and test suite (589 tests) pass with no behavior change; the still-non-generic `EventStore`/`AsyncEventStore` classes (Plan 04) keep resolving `new DeleteManager()`/`new EventMemory()` etc. to the `NostrEvent` default with zero edits

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize DeleteManager, AsyncDeleteManager, ExpirationManager** - `65ab194b` (refactor)
2. **Task 2: Genericize EventMemory** - `ab0689d5` (refactor)

_No plan-metadata commit yet — created after this summary._

## Files Created/Modified
- `packages/core/src/event-store/delete-manager.ts` - `DeleteManager<E extends StoreEvent = NostrEvent> implements IDeleteManager<E>`; bridged `getDeleteEventPointers`/`getDeleteAddressPointers` calls
- `packages/core/src/event-store/async-delete-manager.ts` - `AsyncDeleteManager<E extends StoreEvent = NostrEvent> implements IAsyncDeleteManager<E>`; internal `DeleteManager<E>`
- `packages/core/src/event-store/expiration-manager.ts` - `ExpirationManager<E extends StoreEvent = NostrEvent> implements IExpirationManager<E>`
- `packages/core/src/event-store/event-memory.ts` - `EventMemory<E extends StoreEvent = NostrEvent> implements IEventMemory<E>`; all indexes/methods threaded over `E`; bridged `insertEventIntoDescendingList` calls
- `.changeset/genericize-store-managers.md` - Changeset for the manager genericization (`applesauce-core: minor`)

## Decisions Made
- `EventMemory`'s `claims` field declares as `WeakMap<E, number>` directly — TypeScript accepted `E extends StoreEvent` (an object-shaped structural bound) as satisfying `WeakMap`'s key-type constraint without needing an `E extends object ? E : never` conditional workaround
- Every bridge cast (`as unknown as NostrEvent`) is scoped to the exact function-call argument, not stored in an intermediate variable, keeping the transitional cast as narrow as possible and easy to find/remove once Phase 2+ genericizes `getDeleteEventPointers`/`getDeleteAddressPointers`/`insertEventIntoDescendingList` (if ever)

## Deviations from Plan
None - plan executed exactly as written. `binarySearch` turned out to already be fully generic in the installed `nostr-tools` version, so it required zero bridge casts (only `insertEventIntoDescendingList` needed bridging) — this matches the plan's guidance to "only use `as NostrEvent`/`as E` bridges if a partial-genericization ordering makes it unavoidable."

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four event-store managers (`DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`) are generic over `E extends StoreEvent = NostrEvent` and implement their Plan 02 `<E>` interfaces
- Plan 04 (`EventStore<E>`/`AsyncEventStore<E>` classes) can now type `database`, `memory`, `deletes`, `expiration` fields with these generic managers and thread `E` all the way through the store
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` (589/589) both green; no edits to the still-non-generic `EventStore`/`AsyncEventStore` classes were needed or made
- No blockers for Plan 04

---
*Phase: 01-generic-store-foundation*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 5 created/modified files (4 manager files + changeset) verified present on disk; both task commit hashes (65ab194b, ab0689d5) verified present in git log.
