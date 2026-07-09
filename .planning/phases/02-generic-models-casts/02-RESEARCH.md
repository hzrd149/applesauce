# Phase 2: Generic models & casts - Research

**Researched:** 2026-07-08
**Domain:** TypeScript generic-type migration of an RxJS-based reactive model/cast framework (`applesauce-core`)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Default `E = NostrEvent` everywhere.** Every generic parameter uses `E extends StoreEvent = NostrEvent` so existing signed-event call sites resolve to `NostrEvent` with no source changes — exactly the Phase 1 pattern.
- **Existing signed-event model and cast tests MUST pass without changes.** No test edits to accommodate the genericization; if a test needs editing, that signals a behavior change and must be reconsidered.
- **Localize bridge casts.** Where a generic value must be passed into a still-non-generic or `NostrEvent`-only API, follow the Phase 1 precedent: a narrow `as unknown as NostrEvent` / `signedView`-style bridge confined to call sites that read only `StoreEvent` structural fields — never broaden a public signature to hide a mismatch.
- **Resolve the D-02 seam (code-review WR-02 from Phase 1).** Phase 1 left `IEventStore<E>`/`IAsyncEventStore<E>` extending the un-parameterized `IEventSubscriptions` and `IEventModelMixin<IEventStore>`, so `E` is currently dropped from subscription return types (`timeline()`, `event()`, `filters()` return `NostrEvent`, not `E`). This phase genericizes the model framework and SHOULD thread `E` through `IEventSubscriptions<E>` / `IEventModelMixin` (and `EventModels`) so the currently-dead type parameter becomes live and `EventStore<E>` truly returns `E`-typed observables. See `.planning/phases/01-generic-store-foundation/deferred-items.md` item #2 (WR-02).

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure type-genericization phase with no user-facing behavior. Use the ROADMAP goal, success criteria, Phase 1's established patterns, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Rumor store wiring → Phase 3; common-package genericization → Phase 4.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-06 | Core models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) return `E`-typed observables | See "Architecture Patterns" — exact current signatures of all 5, target generic shapes, and the `Model<T, E, TStore>` parameter-insertion strategy that keeps ~50 existing downstream `Model<T>` one-arg call sites compiling |
| CORE-07 | Core cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `CastConstructor`, `castEvent`, `castEventStream`, `castTimelineStream`) is generic | See "Cast Infrastructure Map" — `EventCast<E>` is *already* generic from a prior commit; `CastRefEventStore`, `CastConstructor`, `castEvent`, `castEventStream`, `castTimelineStream` are the remaining un-genericized surface |
</phase_requirements>

## Summary

Phase 1 left two explicit seams for this phase to close: (1) the model framework (`EventModels` and its four base models `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel`) is entirely `NostrEvent`-hardcoded and is the reason `IEventStore<E>`/`IAsyncEventStore<E>` currently drop `E` on `timeline()`/`event()`/`replaceable()`/`filters()` (the D-02/WR-02 seam); and (2) the cast infrastructure is half-genericized — `EventCast<T extends StoreEvent = NostrEvent>` was already made generic in a prior commit (`82c8839c`), but `CastRefEventStore`, `CastConstructor`, `castEvent`, `castEventStream`, and `castTimelineStream` are still bare/`NostrEvent`-typed. Both problems have the exact same shape as Phase 1's work and the exact same fix pattern: add `<E extends StoreEvent = NostrEvent>` to each type, replace `NostrEvent` with `E` in signatures, and bridge any still-`NostrEvent`-only helper call (e.g. `insertEventIntoDescendingList`, `getReplaceableAddressForEvent`, `getEventPointerForEvent`, `getAddressPointerForEvent`) with a localized `as unknown as NostrEvent` cast, mirroring `casts/event.ts`'s existing `signedView` getter.

The highest-risk part of this phase is not the 5 model functions themselves (their bodies barely change) but **threading `E` through the type graph that connects them**: `IEventSubscriptions<E>` → `IEventModelMixin` → `ModelEventStore<E, TStore>` → `Model<T, E, TStore>` → `ModelConstructor<T, Args, E, TStore>` → `EventModels<E, TStore>` → `EventStore<E>`/`AsyncEventStore<E>` (which already exist and already implement `IEventStore<E>`/`IAsyncEventStore<E>`) → `CastRefEventStore<E>` (which is built from `IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>`). Every one of these types is consumed *unparameterized* (bare, default-resolving) by roughly 50 files across `applesauce-common`, `applesauce-wallet`, `applesauce-concord`, `applesauce-react`, and `applesauce-actions` — none of which pass a second type argument to `Model<T, ...>` today. That means the new `E` parameter can safely be inserted with a `NostrEvent` default in the second position (`Model<T, E extends StoreEvent = NostrEvent, TStore = ...>`) without touching any downstream file — echoing Phase 1's zero-downstream-edit outcome — **provided** the full workspace build is run afterward (Phase 1's WR-02/deferred-items lesson: bare generic instantiation at a contextually-typed call site can silently infer the class's *constraint* instead of its *default*).

A second notable risk is `EventModels`'s module-augmentation pattern: six files (`packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts` and `packages/actions/src/action-runner.ts`) use `declare module "applesauce-core/event-store" { interface EventModels { ... } }` to add prototype methods with **zero type parameters** in the augmenting interface, even though `EventModels` is already a one-type-param generic class today. This currently compiles (verified: `pnpm --filter applesauce-common build` succeeds). Adding a second type parameter to `EventModels` must not break this cross-module declaration-merging pattern — this must be verified with the full workspace build, not just `applesauce-core`.

Three internal RxJS operators (`claimEvents`, `claimLatest`, `watchEventUpdates` in `packages/core/src/observable/`) are hard-typed to `NostrEvent`/bare `IEventClaims` today and are called directly from `EventModel`/`ReplaceableModel`/`TimelineModel`'s bodies. These are **not named in CORE-06's requirement text** but must be genericized (or bridged) as an implementation *detail* of genericizing the four base models — otherwise the model bodies won't type-check once they operate on `E` instead of `NostrEvent`. This is flagged explicitly so the planner allocates a task/wave for it rather than discovering it mid-execution.

**Primary recommendation:** Follow the exact `E extends StoreEvent = NostrEvent` + localized-bridge-cast pattern established in Phase 1 (canonical reference: `packages/core/src/casts/event.ts`). Genericize in dependency order — leaf helpers/operators first (`claimEvents`, `claimLatest`, `watchEventUpdates`), then the four base models + `EventModels`, then the interface layer (`IEventSubscriptions<E>`, `IEventModelMixin`, `ModelEventStore`, `Model`, `ModelConstructor`), then the cast layer (`CastRefEventStore<E>`, `CastConstructor<E>`, `castEvent<E>`, `castEventStream<E>`, `castTimelineStream<E>`). Run a full `pnpm -r build` (not just `applesauce-core`) before declaring the phase complete.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reactive model framework (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) | API / Backend (in-process store layer, not a network API, but the same "business logic over data" tier) | — | These are RxJS-based read/subscribe abstractions over the in-memory `EventStore`; they own the transformation from raw stored events to typed observables, analogous to a data-access/service layer |
| Store subscription interface (`IEventSubscriptions<E>`) | API / Backend | — | Defines the contract the model layer must satisfy; pure interface, no I/O |
| Cast infrastructure (`EventCast<E>`, `castEvent`, `CastRefEventStore<E>`) | API / Backend | — | Wraps raw store events in typed convenience classes; consumed by both Node and browser contexts (no DOM dependency), so it is a shared-core capability, not client-tier |
| RxJS operators (`claimEvents`, `claimLatest`, `watchEventUpdates`) | API / Backend | — | Internal plumbing for the model layer's claim/lifecycle tracking; not exposed as a separate capability but must be updated in lockstep |
| Downstream consumers (`applesauce-common`/`wallet`/`concord`/`react`/`actions`) | Browser / Client (React hooks) + API / Backend (models/casts) | — | Out of phase scope, but every one of these packages consumes the types touched here bare/unparameterized — this phase must not require edits there |

## Standard Stack

No new libraries. This phase is a type-level refactor of existing `applesauce-core` TypeScript source using the already-installed toolchain:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | (workspace-pinned, `tsc` via `packages/core/package.json` `build` script) | Type-checking/build | Already the project's build tool; verified `pnpm --filter applesauce-core build` runs clean on current `main`/`concord` HEAD |
| rxjs | (workspace-pinned) | Observable primitives underlying `Model`, `EventModels.model()`, cast streams | Already the reactive backbone of every model/cast file touched in this phase |
| vitest | (workspace-pinned) | Test runner (`pnpm --filter applesauce-core test`) | Existing suite (592 tests as of Phase 1 completion) must stay green unmodified |

**Package Legitimacy Audit:** Not applicable — this phase installs no new npm packages. `package-legitimacy check` was not run because there is nothing to check.

## Cast Infrastructure Map

Full current state of every symbol named in CORE-07, with exact file/line context:

| Symbol | File | Current state | Target state |
|--------|------|----------------|---------------|
| `EventCast<T>` | `packages/core/src/casts/event.ts:21` | **Already generic**: `class EventCast<T extends StoreEvent = NostrEvent>`. Uses a `signedView` bridge getter (`this.event as unknown as NostrEvent`) to call still-`NostrEvent`-only helpers (`getEventUID`, `getReplaceableAddressForEvent`, `getAddressPointerForEvent`, `getEventPointerForEvent`, `getSeenRelays`). This is the **canonical reference pattern** for the whole phase. | No change needed to `EventCast` itself — it is done. Its `store: CastRefEventStore` field type is what still needs to widen to `CastRefEventStore<T>` (or a compatible `E`). |
| `CastRefEventStore` | `packages/core/src/casts/cast.ts:6` | `export type CastRefEventStore = IEventSubscriptions & EventModels & IEventStoreStreams;` — bare, no type param | `export type CastRefEventStore<E extends StoreEvent = NostrEvent> = IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>;` |
| `CastConstructor<C>` | `packages/core/src/casts/cast.ts:20` | `type CastConstructor<C extends EventCast<StoreEvent>> = new (event: NostrEvent, store: CastRefEventStore) => C;` — constructor param is intentionally narrow `NostrEvent` (contravariance note already documented in the file's own comment at lines 14-18) | Needs `CastRefEventStore` widened to `CastRefEventStore<E>` (bound to whatever `E` the constructor's `C` uses, or left at the default) — keep the existing "constructor param stays NostrEvent" contravariance trick, only widen the store type |
| `castEvent<C>` | `packages/core/src/casts/cast.ts:23-45` | Input `event: StoreEvent`, `store?: CastRefEventStore` (bare) | `store?: CastRefEventStore<E>` where `E` ties to the event's actual type (likely keep `event: StoreEvent` as the widest bound, matching the existing rumor-cast test's usage against `castEvent(rumor, RumorNote, new EventStore())`) |
| `castEventStream<C>` | `packages/core/src/observable/cast-stream.ts:8-22` | `store?: CastRefEventStore` (bare) | `store?: CastRefEventStore<E>` |
| `castTimelineStream<C>` | `packages/core/src/observable/cast-stream.ts:25-43` | `store?: CastRefEventStore` (bare) | `store?: CastRefEventStore<E>` |
| `castUser` / `User` / `castPubkey` / `PubkeyCast` | `packages/core/src/casts/user.ts`, `pubkey.ts` | Both reference bare `CastRefEventStore` in ~10 call sites | **Out of phase scope per CONTEXT.md** (not named in CORE-07) — but these files import `CastRefEventStore` bare, so once it gains a type param they will continue to resolve to the `NostrEvent` default with zero edits, *provided* the default is preserved. Verify with build, do not proactively genericize `User`/`PubkeyCast`. |

`getParentEventStore<T extends object>(event: T): IEventStore | IAsyncEventStore | undefined` (`packages/core/src/helpers/event.ts:170`) is used in `castEvent` via `getParentEventStore(event) as unknown as CastRefEventStore` — already a bridge cast; update the cast target to `CastRefEventStore<E>` but no signature change to `getParentEventStore` itself is required (out of CORE-04/07 scope, already generic on an unrelated `T`).

**Existing test proving the target end-state already works structurally:** `packages/core/src/casts/__tests__/rumor-cast.test.ts` (added alongside the `EventCast` genericization commit) defines `class RumorNote extends EventCast<Rumor>` and calls `castEvent(rumor, RumorNote, new EventStore())` — this test **currently passes** even though `castEvent`/`CastRefEventStore` are not yet generic, because `EventStore()` (bare, defaults to `NostrEvent`) happens to structurally satisfy the bare `CastRefEventStore` type today. This test is the existing regression guard for CORE-07 and must keep passing unmodified.

## Model Framework Map

Exact current signatures (CORE-06 targets), all in `packages/core/src/`:

| Symbol | File:line | Current signature | Notes |
|--------|-----------|--------------------|-------|
| `EventModels<TStore>` | `event-store/event-models.ts:40-42` | `class EventModels<TStore extends IEventStore \| IAsyncEventStore = IEventStore \| IAsyncEventStore> implements IEventSubscriptions` | Implements `IEventSubscriptions` **bare** (not `<E>`) — this is exactly the D-02 seam. `filters()`, `event()`, `replaceable()`, `addressable()`, `timeline()` all hardcode `NostrEvent` return types (lines 102-140). `model<T, Args>(constructor: ModelConstructor<T, Args, TStore>, ...)` (line 56) is untyped over `E` — only `T`/`Args`/`TStore`. |
| `EventModel(pointer)` | `models/base.ts:92-120` | `function EventModel(pointer): Model<NostrEvent \| undefined, IEventStore \| IAsyncEventStore>` | Calls `getEventFromStores`/`getReplaceableFromStores`/`getByFiltersFromStores` (module-private helpers in `models/base.ts:37-70`, all hardcoded `NostrEvent`), `store.eventLoader`, `store.insert$`/`remove$`, and `claimLatest(store)`. |
| `ReplaceableModel(pointer)` | `models/base.ts:123-173` | `function ReplaceableModel(pointer): Model<NostrEvent \| undefined, IEventStore \| IAsyncEventStore>` | Uses `getReplaceableIdentifier` (already CORE-04 generic) and `claimLatest(store)`. |
| `TimelineModel(filters, includeOldVersion?)` | `models/base.ts:176-269` | `function TimelineModel(...): Model<NostrEvent[], IEventStore \| IAsyncEventStore>` | Uses `getEventUID`, `isReplaceable`, `matchFilters` (all already CORE-04 generic) plus `insertEventIntoDescendingList` (re-exported from `nostr-tools/utils`, **NOT genericized** — needs the same bridge-cast treatment Phase 1 Plan 03 applied in `event-memory.ts`) and `claimEvents(store)`. |
| `FiltersModel(filters, onlyNew?)` | `models/base.ts:272-289` | `function FiltersModel(...): Model<NostrEvent, IEventStore \| IAsyncEventStore>` | Uses `matchFilters` (already generic) and `getByFiltersFromStores`. Simplest of the four — no claim tracking. |
| `Model<T, TStore>` | `event-store/interface.ts:154-156` | `type Model<T, TStore extends IEventStore \| IAsyncEventStore = IEventStore \| IAsyncEventStore> = (events: ModelEventStore<TStore>) => Observable<T>` | **Zero downstream 2-arg usages found** — every one of the ~50 `Model<T>` call sites across `applesauce-common`/`wallet`/`concord`/`react` passes only `T`. Insert `E` as the **second** parameter (`Model<T, E extends StoreEvent = NostrEvent, TStore = IEventStore<E> \| IAsyncEventStore<E>>`) so all existing 1-arg call sites keep resolving to the `NostrEvent` default untouched. |
| `ModelConstructor<T, Args, TStore>` | `event-store/interface.ts:159-165` | `type ModelConstructor<T, Args, TStore = IEventStore> = ((...args: Args) => Model<T, TStore>) & { getKey?: ... }` | Same insertion strategy as `Model` — add `E` before `TStore`, default `NostrEvent`. Internal call sites within `event-models.ts` (`model<T, Args>(constructor: ModelConstructor<T, Args, TStore>, ...)`) are inside the same package and can be updated in the same commit. |
| `ModelEventStore<TStore>` | `event-store/interface.ts:150` | `type ModelEventStore<TStore> = IEventStoreStreams & IEventSubscriptions & IEventModelMixin<TStore> & IMissingEventLoader & TStore` | Every member interface here needs `<E>` threaded: `IEventStoreStreams<E> & IEventSubscriptions<E> & IEventModelMixin<TStore> & IMissingEventLoader<E> & TStore` (where `TStore` itself is now `IEventStore<E> \| IAsyncEventStore<E>`). |
| `IEventSubscriptions` | `event-store/interface.ts:112-131` | `interface IEventSubscriptions<E extends StoreEvent = NostrEvent>` — **already has the type param declared** (added in Phase 1 Plan 02) but every method body still returns `NostrEvent`/hardcoded types (`event()`, `replaceable()` x2 overloads, `addressable()`, `filters()`, `timeline()`) — the type param is *declared but dead* until this phase's `EventModels` implements it properly. This is exactly WR-02. | Replace every `NostrEvent`/`NostrEvent[]` return in this interface's methods with `E`/`E[]` (the `profile`/`contacts`/`mailboxes` methods stay untyped over `E`, they return `ProfileContent`/`ProfilePointer[]`/mailbox shapes unrelated to the store event type). |
| `IEventModelMixin<TStore>` | `event-store/interface.ts:134-140` | `interface IEventModelMixin<TStore extends IEventStore \| IAsyncEventStore> { model<T, Args>(constructor: ModelConstructor<T, Args, TStore>, ...args): Observable<T>; }` | `TStore`'s constraint needs updating to `IEventStore<E> \| IAsyncEventStore<E>` implicitly via wherever it's parameterized — since `IEventModelMixin` is itself parameterized only by `TStore` (not `E` directly), and `TStore` is already `IEventStore<E>`/`IAsyncEventStore<E>` post-Phase-1, this mostly falls out once `ModelConstructor`'s 3rd param gets an `E` slot. |
| `EncryptedContentModel`, `ContactsModel`, `PublicContactsModel`, `HiddenContactsModel`, `MailboxesModel`, `ProfileModel`, `OutboxModel` | `models/{encrypted-content,contacts,mailboxes,profile,outbox}.ts` | **Explicitly OUT of CORE-06 scope** per CONTEXT.md's "In scope" list (only `EventModels`/`EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel` are named). These stay `NostrEvent`-only, using bare `Model<T>` (1-arg), which will keep resolving to the default. Do not touch. | No change — but they are the reason the `Model<T>` 1-arg insertion strategy above is load-bearing: any of these 7 files breaking would be a scope violation. |

**Internal RxJS operators that must be genericized alongside the models (not separately named in CORE-06, but structurally required):**

| Operator | File | Current signature | Called from |
|----------|------|--------------------|--------------|
| `claimEvents` | `observable/claim-events.ts:7-9` | `function claimEvents<T extends NostrEvent[] \| NostrEvent \| undefined>(claims: IEventClaims): MonoTypeOperatorFunction<T>` — `IEventClaims` used bare (defaults to `NostrEvent`) | `TimelineModel` (`models/base.ts:193,199`) |
| `claimLatest` | `observable/claim-latest.ts:7` | `function claimLatest<T extends NostrEvent \| undefined>(claims: IEventClaims): MonoTypeOperatorFunction<T>` | `EventModel` (`models/base.ts:118`), `ReplaceableModel` (`models/base.ts:170`) |
| `watchEventUpdates` / `watchEventsUpdates` | `observable/watch-event-updates.ts` | `NostrEvent`-hardcoded, `eventStore: IEventStoreStreams` bare | Used by the **out-of-scope** `ContactsModel`/`MailboxesModel`/`ProfileModel`/`MuteModel`/`EncryptedContentModel` — **not** called from the 5 in-scope models directly, so it can likely be left untouched this phase (verify during planning: none of `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel` call `watchEventUpdates`). |

`claimEvents`/`claimLatest` **do** need `<E extends StoreEvent = NostrEvent>` added (mirroring the CORE-04 helper pattern) since `TimelineModel`/`EventModel`/`ReplaceableModel` will otherwise fail to type-check once they operate on `E`-typed events and try to pass them to a `NostrEvent`-only claim operator. `watchEventUpdates` can plausibly stay untouched — confirm during plan-writing by re-checking `models/base.ts`'s imports (it currently does **not** import `watchEventUpdates`).

`insertEventIntoDescendingList` (used in `TimelineModel`, `models/base.ts:259`) is re-exported from `nostr-tools/utils` via `helpers/event.ts` and is **not** in the CORE-04 genericized list (same situation Phase 1 Plan 03 hit for `EventMemory`) — bridge with `as unknown as NostrEvent[]`/`as unknown as NostrEvent` at the call site, exactly as `event-memory.ts` did.

## Architecture Patterns

### Recommended Genericization Order (Wave Structure)

The dependency chain is strict — later items in the list require earlier ones to compile first:

```
Wave 1 (leaf, parallelizable):
  observable/claim-events.ts     — claimEvents<E>
  observable/claim-latest.ts     — claimLatest<E>
      (watchEventUpdates left untouched — not called by in-scope models; verify during planning)

Wave 2 (models — depends on Wave 1's operators):
  models/base.ts                — EventModel<E>, ReplaceableModel<E>, TimelineModel<E>, FiltersModel<E>
      + module-private helpers: getEventFromStores<E>, getReplaceableFromStores<E>,
        getByFiltersFromStores<E>, loadEventUsingFallback<E>

Wave 3 (interface + EventModels class — depends on Wave 2's model function signatures):
  event-store/interface.ts      — IEventSubscriptions<E> (fill in dead E), IEventModelMixin,
                                    ModelEventStore<E, TStore>, Model<T, E, TStore>,
                                    ModelConstructor<T, Args, E, TStore>
  event-store/event-models.ts   — EventModels<E, TStore> implements IEventSubscriptions<E>
      (this closes the D-02/WR-02 seam — EventStore<E>/AsyncEventStore<E> extend EventModels<E>
       instead of bare EventModels, so IEventStore<E>/IAsyncEventStore<E> can extend
       IEventSubscriptions<E>/IEventModelMixin<IEventStore<E>> for real)

Wave 4 (cast infrastructure — depends on EventModels<E> from Wave 3, since CastRefEventStore
         composes EventModels):
  casts/cast.ts                 — CastRefEventStore<E>, CastConstructor<E, C>, castEvent<E, C>
  observable/cast-stream.ts     — castEventStream<E, C>, castTimelineStream<E, C>

Wave 5 (integration sweep — every wave's downstream ripple):
  event-store/event-store.ts, async-event-store.ts — update `extends EventModels` to `extends EventModels<E>`
  Full workspace build (pnpm -r build), not just applesauce-core
```

Waves 1-2 and Wave 4's file (`casts/cast.ts`/`cast-stream.ts`) touch disjoint files from Wave 3, but Wave 4 has a hard type dependency on Wave 3 (`CastRefEventStore` composes `EventModels`), so they cannot run fully in parallel — plan Wave 4 as sequential-after-Wave-3, or accept a transient bridge cast if parallel execution is preferred (not recommended given the small size of this phase).

### System Architecture Diagram

```
                          ┌─────────────────────────────┐
                          │   EventStore<E>/AsyncEventStore<E>  │  (Phase 1 — already generic)
                          │   extends EventModels<E>  ◄──┼── Wave 3 closes this gap
                          │   implements IEventStore<E> │
                          └───────────┬──────────────────┘
                                      │ this (as ModelEventStore<E, TStore>)
                                      ▼
                    ┌──────────────────────────────────────┐
                    │  EventModels<E, TStore>.model(ctor)   │  Wave 3
                    │  → calls ModelConstructor<T,Args,E>() │
                    └───────────────┬────────────────────────┘
                                    │ invokes
                                    ▼
        ┌─────────────────────────────────────────────────────────┐
        │  EventModel<E> / ReplaceableModel<E> /                   │  Wave 2
        │  TimelineModel<E> / FiltersModel<E>                      │
        │    - read via store.getEvent/getReplaceable/getTimeline  │
        │    - subscribe via store.insert$/update$/remove$         │
        │    - claim via claimEvents<E>/claimLatest<E>             │  Wave 1
        └───────────────────────┬───────────────────────────────────┘
                                 │ returns Observable<E | E[] | undefined>
                                 ▼
              ┌───────────────────────────────────────────┐
              │  castEvent<E,C>(event, cls, store)         │  Wave 4
              │    store: CastRefEventStore<E>             │
              │      = IEventSubscriptions<E>              │
              │      & EventModels<E>                      │
              │      & IEventStoreStreams<E>                │
              │  → new cls(event, store): EventCast<E>     │  (already generic)
              └───────────────────────┬───────────────────────┘
                                      │ .pipe(castEventStream/castTimelineStream)
                                      ▼
              downstream: applesauce-common/wallet/concord/react
              (out of scope — must keep compiling bare/unparameterized)
```

### Pattern: Generic parameter insertion at a safe position

**What:** When a type already has downstream consumers passing fewer type arguments than the target arity, insert the new `E` parameter directly after the "primary" parameter (`T` for `Model`, the class's own subject for others) rather than at the end — as long as every parameter after `E` still has a default that only depends on parameters already resolved.
**When to use:** `Model<T, TStore>` → `Model<T, E, TStore>`; `ModelConstructor<T, Args, TStore>` → `ModelConstructor<T, Args, E, TStore>`.
**Example:**
```typescript
// Before (event-store/interface.ts)
export type Model<T extends unknown, TStore extends IEventStore | IAsyncEventStore = IEventStore | IAsyncEventStore> =
  (events: ModelEventStore<TStore>) => Observable<T>;

// After — E inserted before TStore, TStore's default now depends on E
export type Model<
  T extends unknown,
  E extends StoreEvent = NostrEvent,
  TStore extends IEventStore<E> | IAsyncEventStore<E> = IEventStore<E> | IAsyncEventStore<E>,
> = (events: ModelEventStore<E, TStore>) => Observable<T>;
```
Every existing `Model<SomeType>` (1-arg) call site across the workspace continues to resolve `E = NostrEvent`, `TStore` to its default — zero downstream edits required (verified: grep found zero 2-arg `Model<T, TStore>` usages anywhere outside `packages/core/src`).

### Pattern: Canonical bridge-cast (from Phase 1 / `casts/event.ts`)
**What:** A private getter or inline `as unknown as NostrEvent` cast scoped to the single call site that needs to pass an `E`-typed value into a helper that is deliberately staying `NostrEvent`-only this phase.
**When to use:** `insertEventIntoDescendingList` in `TimelineModel` (re-exported from `nostr-tools/utils`, not genericized); any pointer helper (`getReplaceableAddressForEvent`, `getEventPointerForEvent`, `getAddressPointerForEvent`) if `EventModel`/`ReplaceableModel`/`TimelineModel` end up needing them (currently they don't — only `EventCast` uses these via `signedView`).
**Example:**
```typescript
// Source: packages/core/src/casts/event.ts:27-29 (existing precedent)
private get signedView(): NostrEvent {
  return this.event as unknown as NostrEvent;
}
```

### Pattern: Module augmentation compatibility check (new risk surface for this phase)
**What:** `EventModels` is extended via `declare module "applesauce-core/event-store" { interface EventModels { ... } }` in 6 downstream files, with the augmenting interface declaring **zero** type parameters even though the class already has one (`TStore`). This currently compiles.
**When to use:** Before finalizing `EventModels<E, TStore>`'s new signature, run `pnpm -r build` and specifically check these 6 files compile: `packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts`, `packages/actions/src/action-runner.ts`.
**Why it matters:** If TypeScript's cross-module declaration-merging arity rules turn out to be stricter for a 2-param class than a 1-param class (untested — Phase 1 never added a param to a class with existing external augmenters), this is the single highest-risk regression in the phase and must be caught before the phase is marked done, not discovered downstream in Phase 4.

### Anti-Patterns to Avoid
- **Widening `CastConstructor`'s event-parameter type to accommodate a mismatch:** the existing code has a deliberate, documented contravariance trick (constructor param stays `NostrEvent`, only the constraint widens to `StoreEvent`) — do not "fix" this by broadening the constructor param; that would break the type safety the comment at `cast.ts:14-18` explains.
- **Editing the 7 out-of-scope models** (`ContactsModel`, `PublicContactsModel`, `HiddenContactsModel`, `MailboxesModel`, `ProfileModel`, `OutboxModel`, `EncryptedContentModel`) to "make them consistent" — CONTEXT.md explicitly scopes only the 5 named symbols; touching these is scope creep into Phase 4 territory.
- **Skipping the full-workspace build** and declaring success on `pnpm --filter applesauce-core build` alone — Phase 1's deferred-items.md documents a real regression (`applesauce-relay`'s `group.ts`) caught only by the broader build; this phase touches types with even wider fan-out (`EventModels`, `Model`, `CastRefEventStore` are used in ~50+ downstream files vs. Phase 1's narrower `EventMemory`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Threading a generic event type through a class hierarchy while keeping backward compatibility | A parallel `RumorEventModels`/`GenericModel` class or duplicate model functions | The existing `E extends StoreEvent = NostrEvent` default-parameter pattern already proven in Phase 1 (11 helpers, 18 interfaces, 4 managers, 2 store classes) | Duplicating the model/cast layer would double the maintenance surface and contradict the migration doc's explicit goal ("reusing the existing EventStore, model, timeline, filter, claim, and cast infrastructure") |
| Bridging a generic value into a still-`NostrEvent`-only third-party helper (`nostr-tools/utils`) | A custom reimplementation of `insertEventIntoDescendingList` typed over `E` | A localized `as unknown as NostrEvent[]` bridge cast at the single call site, exactly as `event-memory.ts` did in Phase 1 Plan 03 | The helper's internal logic only reads `created_at`/comparison fields already present on `StoreEvent`; reimplementing it duplicates logic already correctly bridged elsewhere in the same codebase |

**Key insight:** Every problem this phase encounters was already solved once in Phase 1 for a structurally identical situation (generic-parameter insertion, bridge casts for non-genericized third-party helpers, downstream-build verification). The correct approach is pattern-matching against Phase 1's Plans 02/03/04 and `01-PATTERNS.md`, not inventing new conventions.

## Common Pitfalls

### Pitfall 1: `Model<T, TStore>` argument-position break
**What goes wrong:** Inserting `E` at the wrong position (e.g., appending it after `TStore` instead of before) would still technically work for 1-arg callers due to defaults, but inserting it *before* a parameter whose default expression references the *old* position of `TStore` incorrectly can produce circular-default errors or force existing single-arg calls to suddenly need 2 args if TypeScript can't resolve intermediate defaults.
**Why it happens:** TypeScript generic defaults must be resolvable left-to-right; a later default can reference an earlier parameter, not vice versa.
**How to avoid:** Insert `E` immediately after the "primary content" parameter (`T` for `Model`, `T, Args` for `ModelConstructor`) and before any parameter whose default type expression needs to reference `E` (`TStore`). This is exactly the order shown in the Architecture Patterns section above.
**Warning signs:** `pnpm --filter applesauce-core build` failing with "Type argument list cannot be empty" or defaults-related TS2707/TS2314 errors on `Model<...>` call sites that used to compile.

### Pitfall 2: `EventModels`'s cross-module declaration merging breaking under 2 type params
**What goes wrong:** The 6 downstream `declare module "applesauce-core/event-store" { interface EventModels { ... } }` augmentations (0 type params declared) may fail to merge once `EventModels` itself has 2 type params instead of 1, if TS's arity-matching rules are stricter than currently assumed.
**Why it happens:** Untested territory — Phase 1 never added a parameter to a class with existing cross-module augmenters; TS declaration-merging arity rules for classes vs. interfaces across module boundaries are subtle and under-documented.
**How to avoid:** Run `pnpm -r build` immediately after `EventModels<E, TStore>` is defined (Wave 3), before proceeding to Wave 4, so a hypothetical break is caught early and isolated to a single, well-understood commit rather than discovered at the end of the phase.
**Warning signs:** TS2717 "Subsequent property declarations must have the same type" or "All declarations of X must have identical type parameters" errors in `packages/common/src/models/*.ts` or `packages/actions/src/action-runner.ts` builds.

### Pitfall 3: Bare generic instantiation inferring the constraint instead of the default (Phase 1's WR-02/deferred-items lesson)
**What goes wrong:** A bare `new EventMemory()` (or analogously, a bare reference to `CastRefEventStore`/`Model<T>` at certain contextually-typed call sites) can have TypeScript infer the class's generic *constraint* (`StoreEvent`) rather than its *default* (`NostrEvent`), silently breaking type compatibility in a way that only shows up in a specific package's build, not `applesauce-core`'s own build.
**Why it happens:** Documented in `.planning/phases/01-generic-store-foundation/deferred-items.md` item #1 — contextual typing at certain call-site shapes resolves generics differently than a direct type annotation would.
**How to avoid:** Run the FULL workspace build (`pnpm -r build`), not just `applesauce-core`, as the final phase-gate check — per CONTEXT.md's explicit instruction under `<specifics>`.
**Warning signs:** A downstream package (`applesauce-common`, `applesauce-relay`, `applesauce-react`, `applesauce-wallet`, `applesauce-concord`, `applesauce-actions`) failing to build with "types are incompatible" errors mentioning `StoreEvent` where `NostrEvent` was expected, even though `applesauce-core` itself builds clean.

### Pitfall 4: `IEventSubscriptions<E>`'s type parameter is already declared but dead — easy to assume it's a no-op change
**What goes wrong:** Because `IEventSubscriptions<E extends StoreEvent = NostrEvent>` already exists syntactically (added in Phase 1 Plan 02), it's tempting to assume the interface is "already generic" and skip auditing its method bodies. In reality every method signature inside it still hardcodes `NostrEvent`/`ProfileContent`/etc. rather than using `E`.
**Why it happens:** Phase 1 deliberately added the type parameter to the interface declaration but left the body untouched (per the D-02 seam note in `01-02-SUMMARY.md`: "IEventModelMixin, ModelEventStore, Model, ModelConstructor left completely untouched, deferred to Phase 2").
**How to avoid:** Read `event-store/interface.ts:112-131` in full during planning and replace every `NostrEvent`/`NostrEvent[]` occurrence inside `IEventSubscriptions`'s method signatures with `E`/`E[]` — this is the literal definition of "resolving WR-02."
**Warning signs:** After the phase, `store.event(id)` on an `EventStore<Rumor>` still typed as returning `Observable<NostrEvent | undefined>` instead of `Observable<Rumor | undefined>` — the exact symptom WR-02 describes.

## Code Examples

### The already-working end state proof (existing test, do not modify)
```typescript
// Source: packages/core/src/casts/__tests__/rumor-cast.test.ts (pre-existing, must keep passing)
class RumorNote extends EventCast<Rumor> {
  get text() {
    return this.event.content;
  }
}
const cast = castEvent(rumor, RumorNote, new EventStore());
expect(cast.text).toBe("hello rumor");
```
This test already demonstrates `EventCast<E>` working over a `Rumor`. This phase's job is to make `castEvent`'s `store` parameter (`CastRefEventStore`) properly generic so the *type* of `cast.store` (and anything derived from it, like future `RumorStore`-backed casts in Phase 3) is `E`-aware, not just structurally-compatible-by-accident as it is today.

### Canonical generic-parameter + bridge-cast shape (from Phase 1, reuse verbatim)
```typescript
// Source: packages/core/src/casts/event.ts:1-29 (existing code, the pattern to replicate)
import { getEventUID, isAddressableKind, isReplaceableKind, NostrEvent, StoreEvent } from "../helpers/event.js";

export class EventCast<T extends StoreEvent = NostrEvent> {
  private get signedView(): NostrEvent {
    return this.event as unknown as NostrEvent;
  }
  get uid() {
    return getEventUID(this.signedView);
  }
  constructor(
    readonly event: T,
    public readonly store: CastRefEventStore, // <- this field is what Wave 4 must widen to CastRefEventStore<T>
  ) {}
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `EventStore` hardcoded to `NostrEvent` throughout | `EventStore<E extends StoreEvent = NostrEvent>` generic, default-preserving | Phase 1 (2026-07-09, commits through `937e4d30`) | This phase continues that same migration one layer up (models/casts) — no new pattern, just wider application |
| `EventCast` hardcoded to `NostrEvent` | `EventCast<T extends StoreEvent = NostrEvent>` (already generic) | Prior commit `82c8839c` ("Genericize EventCast subsystem to support casting rumors") — predates even Phase 1's plans | This phase's `CastRefEventStore`/`castEvent`/`castEventStream`/`castTimelineStream` genericization is the missing "other half" of that already-completed `EventCast` work |

**Deprecated/outdated:** None — no APIs are being removed or deprecated in this phase, only widened with defaults.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `watchEventUpdates`/`watchEventsUpdates` do not need genericizing this phase because none of the 5 in-scope models call them | Model Framework Map | If a planner discovers `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel` indirectly need `watchEventUpdates` (e.g. via a future refactor), an extra small task must be added — low risk, easily caught by `tsc` failing loudly during Wave 2 |
| A2 | TypeScript's cross-module declaration-merging will continue to accept the 6 zero-type-param `declare module { interface EventModels {...} }` augmentations once `EventModels` gains a second type parameter | Common Pitfalls #2 | If wrong, `applesauce-common`/`applesauce-actions` fail to build and either (a) the augmenting interfaces need an explicit `<E = NostrEvent>` added (a small, mechanical fix, technically Phase 4 territory but may need doing now to unblock this phase's build gate), or (b) `EventModels`'s second parameter needs a different insertion strategy — recommend surfacing this as an explicit checkpoint in the plan rather than assuming success |
| A3 | Inserting `E` as the 2nd parameter of `Model<T, E, TStore>` and `ModelConstructor<T, Args, E, TStore>` is safe for 100% of downstream 1-arg call sites, based on an exhaustive grep across `packages/*/src` finding zero 2-arg usages | Architecture Patterns | If a 2-arg usage exists somewhere not covered by the grep (e.g. a `.d.ts`-only reference, or a package outside `packages/*` like `apps/*`), that call site would break and need a 1-line fix (add explicit `E` arg) — low risk, would surface immediately as a `tsc` error naming the exact file |

**If this table is empty:** N/A — see entries above; all three are LOW-to-MEDIUM risk mechanical/verification concerns, not open design questions.

## Open Questions

1. **Does `IEventModelMixin` need its own explicit `<E>` parameter, or does threading `E` through `TStore` (which is already `IEventStore<E> | IAsyncEventStore<E>`) suffice?**
   - What we know: `IEventModelMixin<TStore extends IEventStore | IAsyncEventStore>`'s only method (`model<T, Args>(constructor: ModelConstructor<T, Args, TStore>, ...)`) doesn't reference a bare event type directly — its generic surface is entirely mediated through `TStore` and `ModelConstructor`.
   - What's unclear: Whether TypeScript's inference will correctly propagate `E` from `TStore`'s type argument through to callers of `.model()` without `IEventModelMixin` itself declaring `<E>`.
   - Recommendation: Attempt the simpler approach first (no new `<E>` param on `IEventModelMixin`, rely on `TStore` carrying it) since Phase 1 Plan 02's summary reports this exact composition ("IEventStore<E>/IAsyncEventStore<E> compose the EventModels-backed subscription/model portion at the NostrEvent default") worked without incident. Only add an explicit `<E>` param if `tsc` reports an inference gap during Wave 3.

2. **Should `castEvent`/`CastConstructor`/`castEventStream`/`castTimelineStream` take `E` as an explicit type parameter, or infer it structurally from `C extends EventCast<infer E>`?**
   - What we know: `EventCast<T>`'s existing `CastConstructor` is defined as `new (event: NostrEvent, store: CastRefEventStore) => C` where `C extends EventCast<StoreEvent>` — the event type is bounded structurally through `C`, not passed as a sibling type parameter.
   - What's unclear: Whether `CastRefEventStore` should take the same `E` that `C`'s underlying `EventCast<E>` uses (requiring an `infer`/conditional type to extract it from `C`), or whether it's simpler to keep `CastRefEventStore` defaulting to `NostrEvent` everywhere except when a caller explicitly widens it (e.g., `castEvent<Rumor, RumorNote>(rumor, RumorNote, rumorStore)`).
   - Recommendation: Prefer the simpler explicit-type-parameter approach (`castEvent<C extends EventCast<StoreEvent>>(event: StoreEvent, cls: CastConstructor<C>, store?: CastRefEventStore<InferredE>)` using a helper conditional type `EventOf<C>` if needed) — this keeps the change mechanical and consistent with how `EventCast<T>` itself was already done, and the existing `rumor-cast.test.ts` gives a concrete usage to type-check against during implementation.

## Environment Availability

Skipped in detail — this phase has no new external dependencies. Confirmed present and working during research:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `tsc`/`vitest` execution | ✓ | v26.4.0 | — |
| pnpm | Workspace build/test orchestration | ✓ | 11.10.0 | — |
| `pnpm --filter applesauce-core build` | Verification | ✓ (currently green on `concord` branch HEAD) | — | — |
| `pnpm --filter applesauce-core test` | Verification | ✓ (592 tests passing per Phase 1 summaries) | — | — |
| `pnpm -r build` (full workspace) | Phase-gate verification (per CONTEXT.md) | Not yet re-run post-Phase-1-completion; must be run as part of this phase's final verification | — | — |

**Missing dependencies with no fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-pinned), invoked via `pnpm --filter applesauce-core test` (`vitest run --passWithNoTests`) |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `pnpm --filter applesauce-core test` |
| Full suite command | `pnpm -r build && pnpm test` (root `test` script: `turbo build --filter='./packages/*' && vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-06 | `EventModels`/`EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel` return `E`-typed observables, existing signed-event behavior unchanged | unit + type-check | `pnpm --filter applesauce-core test event-store` (exercises `.event()/.replaceable()/.timeline()/.filters()` — 33 assertions in `event-store.test.ts`, 2 in `async-event-store.test.ts`) + `pnpm --filter applesauce-core build` (tsc) | ✅ `packages/core/src/event-store/__tests__/event-store.test.ts`, `async-event-store.test.ts` |
| CORE-06 | `models/__tests__/exports.test.ts` snapshot of exported model names stays unchanged (no new/renamed exports) | unit (snapshot) | `pnpm --filter applesauce-core test models` | ✅ `packages/core/src/models/__tests__/exports.test.ts` |
| CORE-07 | `castEvent` works against a rumor (unsigned `StoreEvent`) via a custom `EventCast<Rumor>` | unit + type-check | `pnpm --filter applesauce-core test rumor-cast` | ✅ `packages/core/src/casts/__tests__/rumor-cast.test.ts` |
| CORE-07 | `castUser`/`User`/timeline-casting still work against the (now-generic) `CastRefEventStore` default | unit | `pnpm --filter applesauce-core test user` | ✅ `packages/core/src/casts/__tests__/user.test.ts` |
| CORE-06 + CORE-07 | No downstream package regresses (the WR-02-adjacent Phase 1 lesson) | build | `pnpm -r build` (full workspace) | ✅ — no new file needed, this is an existing script |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-core test <relevant-suite>` + `pnpm --filter applesauce-core build`
- **Per wave merge:** `pnpm --filter applesauce-core test` (full 592-test suite) + `pnpm --filter applesauce-core build`
- **Phase gate:** `pnpm -r build` (full workspace, all packages) green before `/gsd-verify-work` — this is the CONTEXT.md-mandated check, not optional

### Wave 0 Gaps
None — existing test infrastructure (`event-store.test.ts`, `async-event-store.test.ts`, `models/__tests__/exports.test.ts`, `casts/__tests__/rumor-cast.test.ts`, `casts/__tests__/user.test.ts`) already covers every phase requirement's observable behavior. No new test files are structurally required for this phase to be verifiable, though the planner may choose to add a focused type-level assertion (e.g. a `tsd`/`expectType`-style check, or a small runtime test proving `EventStore<Rumor>().timeline(...)` yields `Observable<Rumor[]>`) as an extra confidence signal — optional, not blocking.

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json` (absent = enabled), so this section is included per policy — but this phase is a pure compile-time type-genericization of an existing in-memory reactive store with **no new runtime logic, no new I/O, no new user input parsing, and no new cryptographic operations**. It does not touch event verification (that logic — `verifyEvent`/`verifyRumor` — was finalized in Phase 1 and is explicitly out of this phase's scope; Phase 3 owns wiring `verifyRumor` as `RumorStore`'s default per WR-01).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched — no auth logic in models/casts |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Marginal | TypeScript's structural typing (`E extends StoreEvent`) is itself the "input validation" for this phase — ensuring `E` is bounded by `StoreEvent` (not `any`) at every generic surface prevents a caller from passing a non-event-shaped value through the model/cast pipeline. No new runtime validation is added or required. |
| V6 Cryptography | No | Not touched — no signature/hash verification logic lives in the model or cast layer; that is Phase 1 (`EventStore.verifyEvent`) and Phase 3 (`RumorStore`/`verifyRumor`) territory |

### Known Threat Patterns for this stack
None applicable — this phase has no network-facing surface, no user-supplied data parsing beyond what Phase 1 already typed, and no change to what gets accepted into the store (that gate is `verifyEvent`, untouched here).

## Sources

### Primary (HIGH confidence)
- `packages/core/src/event-store/interface.ts` (read in full) — exact current state of every CORE-05/CORE-06-adjacent interface
- `packages/core/src/event-store/event-models.ts` (read in full) — exact current `EventModels` class body
- `packages/core/src/models/base.ts` (read in full) — exact current `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel` bodies
- `packages/core/src/casts/cast.ts`, `casts/event.ts`, `observable/cast-stream.ts`, `casts/pubkey.ts` (read in full) — exact current cast-infrastructure state, including the already-generic `EventCast<T>`
- `.planning/rumor-store-migration.md` — the project's own master migration design doc, explicitly names every symbol in CORE-06/CORE-07 and their target shape
- `.planning/phases/01-generic-store-foundation/{01-01,01-02,01-03,01-04}-SUMMARY.md`, `01-PATTERNS.md`, `deferred-items.md` — Phase 1's proven patterns, decisions, and the exact WR-02/D-02 seam this phase must close
- `pnpm --filter applesauce-core build` — run directly, confirmed green on current `concord` HEAD (baseline before this phase's changes)
- `pnpm --filter applesauce-common build` — run directly, confirmed green, proving the 0-type-param `EventModels` module augmentation currently compiles (the exact pattern flagged as Pitfall 2)
- Exhaustive `grep -rn "Model<"` across `packages/{common,wallet,concord,react,actions}/src` — confirmed zero 2-arg `Model<T, TStore>` usages, informing the safe-insertion-position recommendation

### Secondary (MEDIUM confidence)
- `apps/docs/core/casting.md` — VitePress documentation describing the intended public casting API surface (`castEvent`, `castEventStream`, `castTimelineStream`, `EventCast`); useful for confirming public-API expectations but not authoritative on internal type signatures

### Tertiary (LOW confidence)
- None — all findings in this report were verified directly against the current source tree, not inferred from training data or external search.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, existing toolchain confirmed working
- Architecture: HIGH — every symbol named in CORE-06/CORE-07 was read in full at its current state; the genericization pattern is a direct, low-ambiguity extension of Phase 1's already-merged, tested work
- Pitfalls: HIGH — Pitfalls 1 and 3 are drawn directly from Phase 1's own documented deferred-items/lessons-learned; Pitfall 2 (module-augmentation arity) is a genuinely new, untested risk for this phase and is flagged as MEDIUM-confidence risk (see Assumptions Log A2) with a concrete mitigation (build immediately after Wave 3, before Wave 4)

**Research date:** 2026-07-08
**Valid until:** No fixed expiry — this is an internal-codebase research artifact tied to the current state of `packages/core/src` on the `concord` branch; valid until Phase 2 begins execution (re-verify signatures if significant time passes or other branches merge first)
