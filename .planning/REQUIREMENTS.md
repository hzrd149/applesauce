# Requirements: Applesauce — v1.0 event-store-supports-rumors

**Defined:** 2026-07-08
**Core Value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase. Part A (CORE + RUMOR) must be proven before Part B (COMMON) begins.

### Core Store

- [x] **CORE-01**: `EventStore<E extends StoreEvent = NostrEvent>` is generic while `new EventStore()` still defaults to a signed `NostrEvent` store with unchanged behavior
- [x] **CORE-02**: `AsyncEventStore<E extends StoreEvent = NostrEvent>` is generic with the same `NostrEvent` default
- [x] **CORE-03**: The store constructor honors an explicit `verifyEvent: undefined` to disable verification
- [x] **CORE-04**: Structural core helpers (`getEventUID`, `getReplaceableAddress`, `getReplaceableIdentifier`, `getIndexableTags`, `matchFilter`/`matchFilters`, `getExpirationTimestamp`, `eventMatchesPointer`, `addSeenRelay`/`getSeenRelays`/`isFromRelay`) accept any `E extends StoreEvent`
- [x] **CORE-05**: Store interfaces and managers (`DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`, and the `IEventStore*`/`IEventDatabase*`/`IDeleteManager`/`IExpirationManager` interfaces) are generic over `E extends StoreEvent`
- [x] **CORE-06**: Core models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) return `E`-typed observables
- [x] **CORE-07**: Core cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `CastConstructor`, `castEvent`, `castEventStream`, `castTimelineStream`) is generic

### Rumor Store

- [x] **RUMOR-01**: `StoreEvent` and `Rumor` types are exported from `packages/core/src/helpers/event.ts`
- [x] **RUMOR-02**: `verifyRumor` recomputes the event hash and validates it equals `rumor.id`
- [ ] **RUMOR-03**: `RumorStore` accepts a rumor with a correct `id` and rejects a rumor with an incorrect `id`
- [ ] **RUMOR-04**: `RumorStore` streams rumors via `filters()`, returns `Rumor[]` from `timeline()`, and the latest replaceable rumor from `replaceable()`
- [ ] **RUMOR-05**: `RumorStore` processes kind-5 delete rumors, removing matching stored rumors
- [ ] **RUMOR-06**: A custom `EventCast<Rumor>` works with `castEvent` against a rumor store

### Common Package

<!-- Gated: begins only after Core Store + Rumor Store are proven (tests green, applesauce-core builds clean). -->

- [ ] **COMMON-01**: `applesauce-common` helpers that use only structural fields accept `E extends StoreEvent`
- [ ] **COMMON-02**: `applesauce-common` casts (plus their models/factories where needed) operate over rumors while keeping `NostrEvent` defaults
- [ ] **COMMON-03**: Default signed-`NostrEvent` behavior in `applesauce-common` is unchanged (existing tests and snapshots pass)

## Future Requirements

Deferred beyond this milestone.

### Common Coverage

- **COMMON-F1**: Genericize the remaining `applesauce-common` casts/helpers/models that have no current rumor use case, one-by-one as concrete needs arise
- **COMMON-F2**: Audit and genericize helpers that semantically require signed events (signature-dependent helpers)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Converting all of `applesauce-common` to generic event types in the first pass | High churn, low value without concrete rumor use cases — migrate only what's needed |
| Overload-heavy compatibility wrappers | Prefer generic defaults (`= NostrEvent`) to keep the API surface clean |
| Changing public runtime behavior for default `EventStore` users | Migration is type-level and runtime-light by design |
| Broadening signature-dependent helpers | Semantically require signed events; audited separately later |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 1 | Complete |
| CORE-04 | Phase 1 | Complete |
| CORE-05 | Phase 1 | Complete |
| CORE-06 | Phase 2 | Complete |
| CORE-07 | Phase 2 | Complete |
| RUMOR-01 | Phase 1 | Complete |
| RUMOR-02 | Phase 1 | Complete |
| RUMOR-03 | Phase 3 | Pending |
| RUMOR-04 | Phase 3 | Pending |
| RUMOR-05 | Phase 3 | Pending |
| RUMOR-06 | Phase 3 | Pending |
| COMMON-01 | Phase 4 | Pending |
| COMMON-02 | Phase 4 | Pending |
| COMMON-03 | Phase 4 | Pending |

**Coverage:**

- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-08*
*Last updated: 2026-07-08 after initial definition*
