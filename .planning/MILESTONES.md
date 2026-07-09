# Milestones

## v1.0 event-store-supports-rumors (Shipped: 2026-07-09)

**Phases completed:** 4 phases, 11 plans, 23 tasks

**Key accomplishments:**

- Genericized all eleven CORE-04 structural helpers over `E extends StoreEvent = NostrEvent` and added a hash-based `verifyRumor` NIP-59 verifier, with zero behavior change for signed-event callers.
- Genericized all 18 CORE-05 event-store interfaces (read, streams, actions, claims, subscriptions, delete/expiration managers, database, memory, missing-loader, and the composite IEventStore/IAsyncEventStore) over `E extends StoreEvent = NostrEvent`, with zero downstream edits.
- Genericized DeleteManager, AsyncDeleteManager, ExpirationManager, and EventMemory over `E extends StoreEvent = NostrEvent`, bridging the three non-CORE-04 helpers they call with localized casts, with zero runtime behavior change.
- Genericized `EventStore` and `AsyncEventStore` over `E extends StoreEvent = NostrEvent` and landed the phase's one intentional runtime change — the constructor now honors an explicit `verifyEvent: undefined` to disable verification while the D-01 `console.warn` still fires — proven by a new focused test, with zero behavior change for default signed stores.
- `claimEvents`/`claimLatest` and the four base models (`EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) genericized over `E extends StoreEvent = NostrEvent`, with a localized store bridge-cast standing in for the not-yet-threaded `Model` interface layer.
- `IEventSubscriptions<E>`'s type parameter made live end-to-end through `Model`/`ModelConstructor`/`ModelEventStore`/`EventModels<E,TStore>`, so `EventStore<E>`/`AsyncEventStore<E>` truly return `E`-typed observables from `event()`/`replaceable()`/`filters()`/`timeline()`, verified clean across the full 18-package workspace build.
- `CastRefEventStore<E>`/`CastConstructor<C,E>`/`castEvent<C,E>`/`castEventStream<C,E>`/`castTimelineStream<C,E>` now generic over `StoreEvent` with `NostrEvent` defaults, the documented contravariance trick intact, and a green full-workspace `pnpm -r build` closing out CORE-06/CORE-07.
- Added `RumorStore` (a thin `EventStore<Rumor>` subclass with `verifyRumor` locked as its non-overridable default verifier) and proved the whole Phase 1-2 generic store stack end-to-end over unsigned rumors with a new 7-case test suite.
- Split `castEvent` into a sig-gated public entry point (`CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent`) and an internal loose `performCast`, restoring the compile-time signature guard Phase 2's generic widening had dropped, without over-tightening concord's real narrowed-kind rumor cast.
- Proved a custom `EventCast<Rumor>` casts an unsigned rumor via `castEvent` against a genuine `RumorStore` (not a bare `EventStore()`), added a `@ts-expect-error` compile-time probe locking WR-01's sig-gate in place, regenerated the export snapshot, and cleared the whole-phase Part A gate (`applesauce-core` test + build green, full `pnpm -r build` exit 0).
- Genericized four structural-only `applesauce-common` helpers (`getNip10References`, `getReactionEmoji`, `getHashtagTag`, `getContentWarning`) over a defaulted `NostrEvent` type parameter, and audited the COMMON-02 targeted-cast set as empty with zero cast/model/factory changes.

---
