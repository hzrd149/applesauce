---
phase: 01-generic-store-foundation
plan: 04
subsystem: core
tags: [typescript, generics, event-store, nostr-tools, verify-event]

# Dependency graph
requires:
  - phase: 01-generic-store-foundation (plan 01)
    provides: "StoreEvent/Rumor types and CORE-04 generic structural helpers in helpers/"
  - phase: 01-generic-store-foundation (plan 02)
    provides: "IEventStore<E>/IAsyncEventStore<E> and all CORE-05 store/database/manager interfaces genericized over E extends StoreEvent = NostrEvent"
  - phase: 01-generic-store-foundation (plan 03)
    provides: "DeleteManager<E>, AsyncDeleteManager<E>, ExpirationManager<E>, EventMemory<E> generic managers"
provides:
  - "EventStore<E extends StoreEvent = NostrEvent> and AsyncEventStore<E extends StoreEvent = NostrEvent> — the capstone generic store classes (CORE-01, CORE-02)"
  - "CORE-03 runtime fix: constructor honors an explicit `verifyEvent: undefined` via `\"verifyEvent\" in options`, disabling verification while the D-01 console.warn still fires"
  - "verifyEvent option/property generic over E with a documented `coreVerifyEvent as unknown as (event: E) => boolean` default bridge (D-04)"
affects: [phase-2-model-framework, phase-3-rumor-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Store-class genericization: parameterize the class/options type over `E extends StoreEvent = NostrEvent`, thread `E` through every store-owned field/method, retype the verifyEvent property/setter/getter to `(event: E) => boolean`, and bridge the nostr-tools default verifier with `coreVerifyEvent as unknown as (event: E) => boolean` — mirrors the manager/interface genericization pattern from Plans 02-03"
    - "D-02 seam: EventStore<E>/AsyncEventStore<E> extend the still-non-generic EventModels and implement IEventStore<E>/IAsyncEventStore<E> without redeclaring the inherited subscription/model methods — those stay NostrEvent-typed until Phase 2 genericizes EventModels"

key-files:
  created:
    - packages/core/src/event-store/__tests__/verify-event-option.test.ts
    - .changeset/genericize-event-stores.md
    - .changeset/verify-event-undefined-fix.md
    - .planning/phases/01-generic-store-foundation/deferred-items.md
  modified:
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/async-event-store.ts

key-decisions:
  - "Deferred (not fixed) a pre-existing applesauce-relay build break in group.ts (new EventMemory() resolving to EventMemory<StoreEvent> instead of the NostrEvent default in a specific contextual-typing position) — this was introduced by Plan 03's EventMemory genericization, not by this plan's changes, and applesauce-relay is outside this plan's files_modified/verification scope. Logged to deferred-items.md per the Scope Boundary rule instead of auto-fixing an unrelated package."

requirements-completed: [CORE-01, CORE-02, CORE-03]

coverage:
  - id: D1
    description: "EventStore<E extends StoreEvent = NostrEvent> and AsyncEventStore<E extends StoreEvent = NostrEvent> are generic, implement IEventStore<E>/IAsyncEventStore<E>, and new EventStore()/new AsyncEventStore(db) behave as unchanged signed NostrEvent stores"
    requirement: "CORE-01"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-checks EventStore<E>/AsyncEventStore<E> against Plan 02 interfaces, Plan 03 managers, and the non-generic EventModels)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core test (592/592 passing, including all pre-existing event-store/async-event-store/model/cast/helper tests unchanged)"
        status: pass
    human_judgment: false
  - id: D2
    description: "new EventStore({ verifyEvent: undefined }) disables verification via the \"verifyEvent\" in options presence check while the setter's console.warn still fires (CORE-03, D-01)"
    requirement: "CORE-03"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/verify-event-option.test.ts#default store rejects an event that fails signature verification"
        status: pass
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/verify-event-option.test.ts#verifyEvent: undefined disables verification and accepts the invalid event"
        status: pass
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/verify-event-option.test.ts#warns when constructed with verifyEvent: undefined (D-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The verifyEvent option/property is generic over E (event: E) => boolean with a documented coreVerifyEvent bridge default (D-04), and EventStore<E>/AsyncEventStore<E> extending the still-non-generic EventModels is the accepted D-02 type gap"
    requirement: "CORE-02"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc: bridge cast compiles, EventStore<E> extends EventModels implements IEventStore<E> compiles)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-09
status: complete
---

# Phase 1 Plan 4: Generic Event-Store Classes Summary

**Genericized `EventStore` and `AsyncEventStore` over `E extends StoreEvent = NostrEvent` and landed the phase's one intentional runtime change — the constructor now honors an explicit `verifyEvent: undefined` to disable verification while the D-01 `console.warn` still fires — proven by a new focused test, with zero behavior change for default signed stores.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-09T01:17Z
- **Completed:** 2026-07-09T01:32Z
- **Tasks:** 2 completed
- **Files modified:** 6 (2 store classes, 1 new test, 2 new changesets, 1 new deferred-items log)

## Accomplishments
- `EventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IEventStore<E>` — every store-owned field (`database`, `memory`, `deletes`, `expiration`, `insert$`/`update$`/`remove$`, `eventLoader`) and method (`add`, `remove`, `removeByFilters`, `update`, `hasEvent`, `getEvent`, `hasReplaceable`, `getReplaceable`, `getReplaceableHistory`, `getByFilters`, `getTimeline`, `touch`/`claim`/`isClaimed`/`removeClaim`/`clearClaim`/`unclaimed`, `mapToMemory` overloads) threaded over `E`; the static `copySymbolsToDuplicateEvent` made generic (`<E extends StoreEvent = NostrEvent>`) so `AsyncEventStore` can call it with `E`-typed args
- `AsyncEventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IAsyncEventStore<E>` mirrors the same transformation for the async/Promise-wrapped surface
- CORE-03 fix landed in both constructors: `EventStore`'s `if (options?.verifyEvent)` became `if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;`; `AsyncEventStore`'s (options required, not optional) became `if ("verifyEvent" in options) this.verifyEvent = options.verifyEvent;`
- `verifyEvent` property (getter/setter/`_verifyEventMethod`) retyped to `(event: E) => boolean` in both classes, with the default initialized via a documented bridge: `coreVerifyEvent as unknown as (event: E) => boolean` (D-04) — the setter's `console.warn` line kept byte-for-byte unchanged (D-01)
- New test `verify-event-option.test.ts` proves the CORE-03 behavior: a default `EventStore` rejects an invalidly-signed event (`add` returns `null`, `hasEvent` is `false`); `new EventStore({ verifyEvent: undefined })` accepts the same event (`add`/`getEvent` return it); and constructing with `verifyEvent: undefined` triggers the `console.warn` (D-01) — verified via a `vi.spyOn(console, "warn")` spy
- Two changesets added: `genericize-event-stores.md` (`applesauce-core: minor`) and `verify-event-undefined-fix.md` (`applesauce-core: patch`), each a single sentence per CLAUDE.md's changeset convention
- Full `applesauce-core` build and test suite (592 tests, 589 pre-existing + 3 new) pass with zero edits to any other file — `new EventStore()`/`new AsyncEventStore(db)` behave identically to before this plan

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize EventStore + EventStoreOptions + CORE-03 constructor fix** - `c4a90c8e` (refactor)
2. **Task 2: Genericize AsyncEventStore + CORE-03 fix, and add the verifyEvent-option test** - `937e4d30` (refactor)

_Plan-metadata commit created after this summary._

## Files Created/Modified
- `packages/core/src/event-store/event-store.ts` - `EventStore<E extends StoreEvent = NostrEvent>` + `EventStoreOptions<E>` + generic static `copySymbolsToDuplicateEvent<E>` + CORE-03 constructor fix
- `packages/core/src/event-store/async-event-store.ts` - `AsyncEventStore<E extends StoreEvent = NostrEvent>` + `AsyncEventStoreOptions<E>` + CORE-03 constructor fix
- `packages/core/src/event-store/__tests__/verify-event-option.test.ts` - New test proving `verifyEvent: undefined` disables verification and still warns (CORE-03, D-01)
- `.changeset/genericize-event-stores.md` - New changeset, `applesauce-core: minor`
- `.changeset/verify-event-undefined-fix.md` - New changeset, `applesauce-core: patch`
- `.planning/phases/01-generic-store-foundation/deferred-items.md` - New log of an out-of-scope `applesauce-relay` build break discovered during downstream sanity checks (see Deviations)

## Decisions Made
- Kept the `console.warn` in both setters byte-for-byte unchanged per D-01 — it fires on any `undefined` assignment, intentional or not
- Built the CORE-03 test's invalid event by flipping a bit in a validly-signed event's `sig` field and explicitly stripping the cached `verifiedSymbol` (set by `finalizeEvent`) rather than mutating `content` post-signing — object-spreading a signed event copies its `verifiedSymbol` own-property too, so `verifyEvent`'s internal memoization would otherwise short-circuit and return the cached `true` regardless of the tampering, masking the CORE-03 behavior the test needs to prove

## Deviations from Plan

### Auto-fixed Issues
None - both tasks executed exactly as written; the CORE-03 constructor fix and generic threading matched the plan's specified shapes precisely.

### Out-of-Scope Discovery (logged, not fixed)

**1. [Scope Boundary] Pre-existing `applesauce-relay` build break unrelated to this plan's changes**
- **Found during:** Post-Task-2 downstream sanity build (`pnpm --filter applesauce-common --filter applesauce-react --filter applesauce-relay --filter applesauce-concord build`), run as an extra check beyond this plan's required verification (which only covers `applesauce-core`).
- **Issue:** `packages/relay/src/group.ts:260`/`:277` fails to type-check: `new EventMemory()` (bare, no explicit type argument) resolves to `EventMemory<StoreEvent>` instead of the `NostrEvent` default in this specific contextual-typing position (`filterDuplicateEvents(opts?.eventStore ?? new EventMemory())`), making it incompatible with `IEventStoreActions<NostrEvent>`.
- **Root cause:** Introduced when `EventMemory` was genericized in Plan 01-03 (`EventMemory<E extends StoreEvent = NostrEvent>`) — not by anything changed in this plan (`event-store.ts`/`async-event-store.ts`). `applesauce-relay` is a separate package, outside Plan 04's `files_modified` and verification scope (which is limited to `applesauce-core` build/test).
- **Action:** Logged to `.planning/phases/01-generic-store-foundation/deferred-items.md` with root-cause analysis and a suggested fix (explicit `new EventMemory<NostrEvent>()` at both call sites, or a generic-bound fix in `filterDuplicateEvents`/`mapEventsToStore`). Not fixed here per the Scope Boundary rule — out-of-scope files are logged, not auto-fixed.
- **Verified unaffected:** `applesauce-core` (this plan's scope) build+test are green; `applesauce-common` and `applesauce-react` both build clean in isolation. Only `applesauce-relay` is affected.

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope discovery logged.
**Impact on plan:** None on this plan's scope or acceptance criteria — `applesauce-core` build and full test suite (592/592) are green, matching the plan's success criteria exactly. The deferred `applesauce-relay` item should be picked up by whichever future plan next touches that package (likely when Phase 2/3 need `RumorStore`-aware relay handling, or as a standalone fix).

## Issues Encountered
None beyond the out-of-scope discovery documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four Phase 1 plans complete: generic helpers (Plan 01), generic interfaces (Plan 02), generic managers (Plan 03), and now generic store classes (Plan 04) with the CORE-03 runtime fix proven by test
- `EventStore<Rumor>` is now expressible, unblocking Phase 3's `RumorStore` (which supplies its own `verifyRumor` per D-01's rationale)
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` (592/592) both green; `applesauce-common` and `applesauce-react` verified to still build clean
- One deferred item for a future plan to pick up: the `applesauce-relay` `group.ts` `EventMemory` inference break documented in `deferred-items.md` (does not block Phase 1 completion or Phase 2 planning, but should be fixed before/alongside whichever plan next touches `applesauce-relay`)
- No blockers for Phase 2 (model framework)

---
*Phase: 01-generic-store-foundation*
*Completed: 2026-07-09*
