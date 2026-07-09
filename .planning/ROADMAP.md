# Roadmap: Applesauce — v1.0 event-store-supports-rumors

## Overview

Genericize the applesauce event layer so it can operate over unsigned NIP-59 `Rumor` events without disturbing signed-`NostrEvent` consumers. The migration lands in dependency order: first the generic store foundation and structural helpers, then the reactive models and cast infrastructure, then the `RumorStore` convenience class with rumor-specific verification and tests — which together *prove* the pattern in `applesauce-core`. Only after that gate passes does the final phase carry the same genericization into `applesauce-common`. Every phase keeps `= NostrEvent` defaults and is runtime-light (a type migration), verified by the existing core/common test suites plus builds.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Generic store foundation** - Genericize `EventStore`/`AsyncEventStore`, structural helpers, store interfaces & managers; add rumor types & verifier (completed 2026-07-09)
- [ ] **Phase 2: Generic models & casts** - Genericize core models and cast infrastructure over `E extends StoreEvent`
- [ ] **Phase 3: RumorStore & verification** - Add `RumorStore`, kind-5 delete handling, and rumor/cast test coverage (Part A gate)
- [ ] **Phase 4: Common package rumor support** - Genericize `applesauce-common` helpers and casts (gated on Phase 3)

## Phase Details

### Phase 1: Generic store foundation

**Goal**: Turn the core store and its structural helpers generic (`E extends StoreEvent = NostrEvent`) and introduce the rumor type + verifier, with zero behavior change for default signed stores.
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, RUMOR-01, RUMOR-02
**Success Criteria** (what must be TRUE):

  1. `EventStore<E extends StoreEvent = NostrEvent>` and `AsyncEventStore<E>` are generic; `new EventStore()` still behaves as a signed `NostrEvent` store
  2. `new EventStore({ verifyEvent: undefined })` disables verification (constructor honors explicit `undefined`)
  3. `StoreEvent` and `Rumor` types plus `verifyRumor` are exported from `packages/core/src/helpers/event.ts`, and `verifyRumor` returns true only when `getEventHash(rumor) === rumor.id`
  4. Structural helpers and store interfaces/managers (`DeleteManager`, `ExpirationManager`, `EventMemory`) accept any `E extends StoreEvent`
  5. `pnpm --filter applesauce-core test` and `pnpm --filter applesauce-core build` pass unchanged

**Plans**: 4/4 plans complete

Plans:

- [x] 01-01-PLAN.md — Rumor verifier + genericize CORE-04 structural helpers (wave 1)
- [x] 01-02-PLAN.md — Genericize event-store interfaces over E extends StoreEvent (wave 1)
- [x] 01-03-PLAN.md — Genericize managers (DeleteManager/AsyncDeleteManager/ExpirationManager/EventMemory) (wave 2)
- [x] 01-04-PLAN.md — Genericize EventStore/AsyncEventStore + CORE-03 verifyEvent:undefined fix (wave 3)

### Phase 2: Generic models & casts

**Goal**: Genericize the reactive model framework and cast infrastructure so `EventStore<E>` returns `E`-typed observables and casts compose over any store event.
**Depends on**: Phase 1
**Requirements**: CORE-06, CORE-07
**Success Criteria** (what must be TRUE):

  1. Core models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) are generic and return `E`-typed observables
  2. Cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `castEvent`, `castEventStream`, `castTimelineStream`) is generic with `NostrEvent` defaults
  3. Existing signed-event model and cast tests pass without changes
  4. `pnpm --filter applesauce-core build` type-checks the generic model/cast surface

**Plans**: TBD

Plans:

- [ ] 02-01: TBD

### Phase 3: RumorStore & verification

**Goal**: Deliver the `RumorStore` convenience class with rumor verification and kind-5 delete handling, and prove the whole core migration with rumor-typed tests — the Part A gate for Common work.
**Depends on**: Phase 2
**Requirements**: RUMOR-03, RUMOR-04, RUMOR-05, RUMOR-06
**Success Criteria** (what must be TRUE):

  1. `RumorStore` accepts a rumor with a correct `id` and rejects one with an incorrect `id`
  2. `RumorStore.filters()` streams rumors, `timeline()` returns `Rumor[]`, and `replaceable()` returns the latest replaceable rumor
  3. Kind-5 delete rumors remove matching stored rumors
  4. A custom `EventCast<Rumor>` works with `castEvent` against a rumor store
  5. New rumor tests pass and `pnpm --filter applesauce-core test` + `build` are green (Part A proven)

**Plans**: TBD

Plans:

- [ ] 03-01: TBD

### Phase 4: Common package rumor support

**Goal**: Carry the genericization into `applesauce-common` — helpers and casts (plus their models/factories where needed) — so they operate over rumors while default signed-`NostrEvent` behavior is untouched.
**Depends on**: Phase 3 (GATED — begins only after Part A is proven: `applesauce-core` builds and rumor tests pass)
**Requirements**: COMMON-01, COMMON-02, COMMON-03
**Success Criteria** (what must be TRUE):

  1. Phase 3 gate confirmed: `applesauce-core` builds clean and rumor/cast tests pass before Common work starts
  2. `applesauce-common` helpers using only structural fields accept `E extends StoreEvent`
  3. Targeted `applesauce-common` casts (and their models/factories) operate over rumors while keeping `NostrEvent` defaults
  4. Existing `applesauce-common` tests and export/helper snapshots pass unchanged
  5. `pnpm --filter applesauce-common test` and `pnpm run build` pass

**Plans**: TBD

Plans:

- [ ] 04-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Generic store foundation | 4/4 | Complete   | 2026-07-09 |
| 2. Generic models & casts | 0/TBD | Not started | - |
| 3. RumorStore & verification | 0/TBD | Not started | - |
| 4. Common package rumor support | 0/TBD | Not started | - |
