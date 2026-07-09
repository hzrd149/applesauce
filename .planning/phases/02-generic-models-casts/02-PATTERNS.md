# Phase 2: Generic models & casts - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 9 (all in-place genericization edits, no net-new files)
**Analogs found:** 9 / 9 (canonical analog: Phase 1's `casts/event.ts` bridge pattern + Phase 1's own `interface.ts`/`event-store.ts` genericization, both already completed in this repo)

## Canonical Reference Pattern

Phase 1 already solved this exact problem one layer down. Two canonical analogs apply here:

1. **`packages/core/src/casts/event.ts`** (lines 1-29, unchanged from Phase 1) — the generic-parameter + localized bridge-cast convention.
2. **Phase 1's own diff to `event-store/interface.ts` and `event-store/event-store.ts`** — the exact "insert `E extends StoreEvent = NostrEvent`, thread through `extends`/`implements` clauses, default-preserving" pattern, proven at the interface + class-hierarchy level (which is what this phase repeats one layer up, for models/casts).

```typescript
// Source: packages/core/src/casts/event.ts:1-29 (existing, unchanged)
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
    public readonly store: CastRefEventStore, // Wave 4 of this phase widens this to CastRefEventStore<T>
  ) {}
}
```

Key traits to replicate everywhere in this phase:
- Bound is `StoreEvent`, default is `NostrEvent` — never change the default.
- Insert `E` **immediately after the "primary content" parameter**, before any parameter whose default expression must reference `E` (see Pitfall 1 in RESEARCH.md — this is the `Model<T, E, TStore>` / `ModelConstructor<T, Args, E, TStore>` insertion order).
- Where a helper is not yet genericized and only structural fields are read, bridge with a local `as unknown as NostrEvent` cast scoped to the single call site — exactly the `signedView` getter above. Do not widen public signatures to accommodate a mismatch (explicit anti-pattern for `CastConstructor`'s contravariant constructor param — see RESEARCH.md Anti-Patterns).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/observable/claim-events.ts` (`claimEvents`) | utility (RxJS operator) | event-driven/streaming | `casts/event.ts` (generic convention) | role-match |
| `packages/core/src/observable/claim-latest.ts` (`claimLatest`) | utility (RxJS operator) | event-driven/streaming | `claim-events.ts` (sibling operator) | exact |
| `packages/core/src/models/base.ts` (`EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel` + module-private helpers) | model (reactive read/subscribe layer) | streaming/CRUD | `casts/event.ts` (generic convention) + Phase 1's `event-memory.ts` bridge-cast precedent | role-match |
| `packages/core/src/event-store/interface.ts` (`IEventSubscriptions<E>`, `IEventModelMixin`, `ModelEventStore<E,TStore>`, `Model<T,E,TStore>`, `ModelConstructor<T,Args,E,TStore>`) | interface | request-response/event-driven | Phase 1's own genericization of this same file (`IEventStoreRead<E>` et al., already merged) | exact (self-precedent) |
| `packages/core/src/event-store/event-models.ts` (`EventModels<E,TStore>`) | manager/mixin class | event-driven | Phase 1's `event-store.ts`/`async-event-store.ts` (store-class genericization + `extends`/`implements` threading) | role-match |
| `packages/core/src/event-store/event-store.ts`, `async-event-store.ts` (update `extends EventModels` → `extends EventModels<E>`) | store class | CRUD + event-driven | itself, Phase 1 version (this phase only closes the D-02 gap, no other change) | exact |
| `packages/core/src/casts/cast.ts` (`CastRefEventStore<E>`, `CastConstructor<E,C>`, `castEvent<E,C>`) | utility (cast infrastructure) | event-driven/transform | `casts/event.ts` (already-generic `EventCast<T>`, same file's contravariance comment at lines 14-18) | exact |
| `packages/core/src/observable/cast-stream.ts` (`castEventStream<E,C>`, `castTimelineStream<E,C>`) | utility (RxJS operator) | streaming | `casts/cast.ts` (sibling, same `CastRefEventStore<E>` widening) | exact |
| `packages/core/src/casts/__tests__/rumor-cast.test.ts` (verification only, no edits expected) | test | transform | itself — pre-existing regression guard, must keep passing unmodified | exact |

## Pattern Assignments

### `packages/core/src/observable/claim-events.ts` — `claimEvents<E>`

**Analog:** `casts/event.ts` generic convention.

**Current** (per RESEARCH.md Model Framework Map, line 7-9):
```typescript
function claimEvents<T extends NostrEvent[] | NostrEvent | undefined>(claims: IEventClaims): MonoTypeOperatorFunction<T>
```
`IEventClaims` used bare here (already declared as `IEventClaims<E extends StoreEvent = NostrEvent>` per Phase 1's `interface.ts` work) — resolves to `NostrEvent` default today.

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "../helpers/event.js";

export function claimEvents<E extends StoreEvent = NostrEvent, T extends E[] | E | undefined = E[] | E | undefined>(
  claims: IEventClaims<E>,
): MonoTypeOperatorFunction<T> { ... }
```
Called from `TimelineModel` (`models/base.ts:193,199`) — must be genericized in Wave 1 before `models/base.ts` (Wave 2) can compile against `E`-typed timelines.

---

### `packages/core/src/observable/claim-latest.ts` — `claimLatest<E>`

**Analog:** `claim-events.ts` (sibling operator, identical transformation).

**Current:**
```typescript
function claimLatest<T extends NostrEvent | undefined>(claims: IEventClaims): MonoTypeOperatorFunction<T>
```

**Target:**
```typescript
export function claimLatest<E extends StoreEvent = NostrEvent, T extends E | undefined = E | undefined>(
  claims: IEventClaims<E>,
): MonoTypeOperatorFunction<T> { ... }
```
Called from `EventModel` (`models/base.ts:118`) and `ReplaceableModel` (`models/base.ts:170`).

`watchEventUpdates`/`watchEventsUpdates` (`observable/watch-event-updates.ts`) — per RESEARCH.md Assumption A1, leave untouched this phase; not called by the 4 in-scope models. Verify with a grep of `models/base.ts` imports before finalizing (research already confirms it is not currently imported there).

---

### `packages/core/src/models/base.ts` — `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`

**Analog:** `casts/event.ts` generic convention (parameterization shape) + Phase 1's `event-memory.ts` bridge-cast precedent (for `insertEventIntoDescendingList`, which is not in the CORE-04 genericized list).

**Current signatures** (per RESEARCH.md Model Framework Map, `models/base.ts:92-289`):
```typescript
function EventModel(pointer): Model<NostrEvent | undefined, IEventStore | IAsyncEventStore>
function ReplaceableModel(pointer): Model<NostrEvent | undefined, IEventStore | IAsyncEventStore>
function TimelineModel(filters, includeOldVersion?): Model<NostrEvent[], IEventStore | IAsyncEventStore>
function FiltersModel(filters, onlyNew?): Model<NostrEvent, IEventStore | IAsyncEventStore>
```

**Target shape** (insert `E` per the safe-position pattern):
```typescript
export function EventModel<E extends StoreEvent = NostrEvent>(
  pointer,
): Model<E | undefined, E, IEventStore<E> | IAsyncEventStore<E>> { ... }

export function ReplaceableModel<E extends StoreEvent = NostrEvent>(
  pointer,
): Model<E | undefined, E, IEventStore<E> | IAsyncEventStore<E>> { ... }

export function TimelineModel<E extends StoreEvent = NostrEvent>(
  filters, includeOldVersion?,
): Model<E[], E, IEventStore<E> | IAsyncEventStore<E>> { ... }

export function FiltersModel<E extends StoreEvent = NostrEvent>(
  filters, onlyNew?,
): Model<E, E, IEventStore<E> | IAsyncEventStore<E>> { ... }
```

**Bridge-cast pattern (`TimelineModel`'s `insertEventIntoDescendingList` call, `models/base.ts:259`)** — mirror the exact shape of Phase 1's `event-memory.ts` bridge for the same helper:
```typescript
// Pattern to replicate (Phase 1 precedent, packages/core/src/event-store/event-memory.ts,
// applied when calling nostr-tools/utils helpers not in the CORE-04 genericized list):
insertEventIntoDescendingList(list as unknown as NostrEvent[], event as unknown as NostrEvent);
// then treat/cast the mutated `list` back as E[] at the call site boundary
```
Same localized-bridge treatment as `casts/event.ts`'s `signedView` getter (lines 27-29) — scope the cast to the single call, never change `insertEventIntoDescendingList`'s own signature.

Module-private helpers in this file (`getEventFromStores`, `getReplaceableFromStores`, `getByFiltersFromStores`, `loadEventUsingFallback`, `models/base.ts:37-70`) must also gain `<E extends StoreEvent = NostrEvent>` in lockstep since the four public model functions call them directly.

---

### `packages/core/src/event-store/interface.ts` — close the D-02/WR-02 seam

**Analog:** Phase 1's own prior genericization of this same file (self-precedent) — `IEventStoreRead<E>` et al. already show the exact `<E extends StoreEvent = NostrEvent>` + return-type replacement pattern to apply to `IEventSubscriptions`.

**Current** (`event-store/interface.ts:112-131`, per RESEARCH.md) — type param already declared but dead:
```typescript
export interface IEventSubscriptions<E extends StoreEvent = NostrEvent> {
  event(id: string): Observable<NostrEvent | undefined>; // should be Observable<E | undefined>
  replaceable(...): Observable<NostrEvent | undefined>;   // x2 overloads
  addressable(...): Observable<NostrEvent | undefined>;
  filters(filters: Filter | Filter[]): Observable<NostrEvent[]>;
  timeline(filters: Filter | Filter[]): Observable<NostrEvent[]>;
  // profile()/contacts()/mailboxes() stay untyped over E — unrelated shapes, leave as-is
}
```

**Target** — replace every `NostrEvent`/`NostrEvent[]` in the method bodies above with `E`/`E[]` (this is the literal fix for WR-02):
```typescript
export interface IEventSubscriptions<E extends StoreEvent = NostrEvent> {
  event(id: string): Observable<E | undefined>;
  replaceable(...): Observable<E | undefined>;
  addressable(...): Observable<E | undefined>;
  filters(filters: Filter | Filter[]): Observable<E[]>;
  timeline(filters: Filter | Filter[]): Observable<E[]>;
}
```

**`Model<T, TStore>` → `Model<T, E, TStore>`** (`event-store/interface.ts:154-156`) — insert `E` in the *second* position, mirroring the safe-insertion pattern already used across Phase 1's interface work:
```typescript
// Before
export type Model<T extends unknown, TStore extends IEventStore | IAsyncEventStore = IEventStore | IAsyncEventStore> =
  (events: ModelEventStore<TStore>) => Observable<T>;

// After
export type Model<
  T extends unknown,
  E extends StoreEvent = NostrEvent,
  TStore extends IEventStore<E> | IAsyncEventStore<E> = IEventStore<E> | IAsyncEventStore<E>,
> = (events: ModelEventStore<E, TStore>) => Observable<T>;
```
Zero downstream 1-arg `Model<T>` call sites need edits (confirmed by exhaustive grep in RESEARCH.md — Assumption A3).

**`ModelConstructor<T, Args, TStore>` → `ModelConstructor<T, Args, E, TStore>`** (`event-store/interface.ts:159-165`) — same insertion strategy, `E` before `TStore`.

**`ModelEventStore<TStore>`** (`event-store/interface.ts:150`) — thread `<E>` through every member:
```typescript
export type ModelEventStore<E extends StoreEvent = NostrEvent, TStore = IEventStore<E> | IAsyncEventStore<E>> =
  IEventStoreStreams<E> & IEventSubscriptions<E> & IEventModelMixin<TStore> & IMissingEventLoader<E> & TStore;
```

**`IEventModelMixin<TStore>`** — per RESEARCH.md Open Question 1, attempt the simpler approach first: no new explicit `<E>` param, rely on `TStore` (already `IEventStore<E> | IAsyncEventStore<E>`) to carry `E` through `ModelConstructor<T, Args, E, TStore>`. Only add an explicit `<E>` param if `tsc` reports an inference gap during Wave 3 (this mirrors Phase 1 Plan 02's successful "IEventStore<E> composes EventModels-backed subscription/model portion at the default" outcome).

---

### `packages/core/src/event-store/event-models.ts` — `EventModels<E, TStore>`

**Analog:** Phase 1's `event-store.ts`/`async-event-store.ts` genericization (store-class → `extends`/`implements` threading pattern).

**Current** (`event-store/event-models.ts:40-42`, per RESEARCH.md):
```typescript
class EventModels<TStore extends IEventStore | IAsyncEventStore = IEventStore | IAsyncEventStore> implements IEventSubscriptions {
  model<T, Args>(constructor: ModelConstructor<T, Args, TStore>, ...args): Observable<T> { ... }
  // filters(), event(), replaceable(), addressable(), timeline() all hardcode NostrEvent (lines 102-140)
}
```

**Target** (mirrors how Phase 1's `EventStore<E>` widened its `implements`/`extends` clause):
```typescript
export class EventModels<
  E extends StoreEvent = NostrEvent,
  TStore extends IEventStore<E> | IAsyncEventStore<E> = IEventStore<E> | IAsyncEventStore<E>,
> implements IEventSubscriptions<E> {
  model<T, Args>(constructor: ModelConstructor<T, Args, E, TStore>, ...args): Observable<T> { ... }
  event(id: string): Observable<E | undefined> { ... }
  replaceable(...): Observable<E | undefined> { ... }
  addressable(...): Observable<E | undefined> { ... }
  filters(filters: Filter | Filter[]): Observable<E[]> { ... }
  timeline(filters: Filter | Filter[]): Observable<E[]> { ... }
}
```

**Critical risk (Pitfall 2 in RESEARCH.md) — module augmentation compatibility:** 6 downstream files use `declare module "applesauce-core/event-store" { interface EventModels { ... } }` with **zero** type params declared, even though `EventModels` already had one param (`TStore`) and will now have two (`E`, `TStore`). Run `pnpm -r build` immediately after this file compiles, checking specifically:
- `packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts`
- `packages/actions/src/action-runner.ts`

If these fail with TS2717/"identical type parameters" errors, this is the single highest-risk regression point in the phase — do not proceed to Wave 4 until resolved.

---

### `packages/core/src/event-store/event-store.ts`, `async-event-store.ts` — close the seam

**Analog:** itself, Phase 1 version — this phase's only change here is updating the superclass reference now that `EventModels<E>` exists.

**Current:**
```typescript
export class EventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IEventStore<E> { ... }
```

**Target:**
```typescript
export class EventStore<E extends StoreEvent = NostrEvent> extends EventModels<E, IEventStore<E>> implements IEventStore<E> { ... }
```
Same transformation for `AsyncEventStore<E>` → `extends EventModels<E, IAsyncEventStore<E>>`. This is the literal closure of the D-02 seam left open by Phase 1 (`EventStore<E>`/`AsyncEventStore<E>` extending non-generic `EventModels`).

---

### `packages/core/src/casts/cast.ts` — `CastRefEventStore<E>`, `CastConstructor<E,C>`, `castEvent<E,C>`

**Analog:** `casts/event.ts`'s already-generic `EventCast<T extends StoreEvent = NostrEvent>` and its own documented contravariance comment (`cast.ts:14-18`) — do not disturb that trick, only widen the store type.

**Current** (`packages/core/src/casts/cast.ts:6,20,23-45`, per RESEARCH.md Cast Infrastructure Map):
```typescript
export type CastRefEventStore = IEventSubscriptions & EventModels & IEventStoreStreams;

type CastConstructor<C extends EventCast<StoreEvent>> = new (event: NostrEvent, store: CastRefEventStore) => C;

function castEvent<C extends EventCast<StoreEvent>>(
  event: StoreEvent,
  cls: CastConstructor<C>,
  store?: CastRefEventStore,
): C { ... }
```

**Target:**
```typescript
export type CastRefEventStore<E extends StoreEvent = NostrEvent> =
  IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>;

// Constructor param stays NostrEvent (contravariance trick preserved, cast.ts:14-18 comment unchanged)
type CastConstructor<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent> =
  new (event: NostrEvent, store: CastRefEventStore<E>) => C;

export function castEvent<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: StoreEvent,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  // getParentEventStore(event) as unknown as CastRefEventStore<E> — bridge target updated,
  // getParentEventStore itself untouched (already generic on an unrelated T)
}
```
**Regression guard — do not modify:** `packages/core/src/casts/__tests__/rumor-cast.test.ts` must keep passing unmodified:
```typescript
// Source: packages/core/src/casts/__tests__/rumor-cast.test.ts (pre-existing)
class RumorNote extends EventCast<Rumor> {
  get text() { return this.event.content; }
}
const cast = castEvent(rumor, RumorNote, new EventStore());
expect(cast.text).toBe("hello rumor");
```

`castUser`/`User`/`castPubkey`/`PubkeyCast` (`casts/user.ts`, `casts/pubkey.ts`) reference bare `CastRefEventStore` in ~10 call sites — **out of phase scope**, must continue compiling untouched against the `NostrEvent` default. Verify with build, do not proactively genericize.

---

### `packages/core/src/observable/cast-stream.ts` — `castEventStream<E,C>`, `castTimelineStream<E,C>`

**Analog:** `casts/cast.ts` (sibling file, same `CastRefEventStore<E>` widening, same phase/wave).

**Current** (`packages/core/src/observable/cast-stream.ts:8-22, 25-43`):
```typescript
function castEventStream<C extends EventCast<StoreEvent>>(..., store?: CastRefEventStore): Observable<C> { ... }
function castTimelineStream<C extends EventCast<StoreEvent>>(..., store?: CastRefEventStore): Observable<C[]> { ... }
```

**Target:**
```typescript
export function castEventStream<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  ..., store?: CastRefEventStore<E>,
): Observable<C> { ... }

export function castTimelineStream<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  ..., store?: CastRefEventStore<E>,
): Observable<C[]> { ... }
```
Depends on Wave 3 (`EventModels<E>`) and Wave 4's own `casts/cast.ts` change (`CastRefEventStore<E>`) — sequential-after, not parallel, per RESEARCH.md's wave-dependency note.

## Shared Patterns

### Generic parameter insertion at a safe position
**Source:** RESEARCH.md "Architecture Patterns" (Phase 1's own established convention, `casts/event.ts` origin)
**Apply to:** `Model<T, E, TStore>`, `ModelConstructor<T, Args, E, TStore>` — insert `E` immediately after the "primary content" parameter(s), before any parameter whose default expression must reference `E`. Never append `E` at the end if an earlier default depends on the later position (Pitfall 1).

### Localized bridge-cast (transitional, non-genericized helper)
**Source:** `packages/core/src/casts/event.ts:27-29` (`signedView` getter)
**Apply to:** `insertEventIntoDescendingList` call in `TimelineModel` (`models/base.ts:259`) — `as unknown as NostrEvent[]`/`as unknown as NostrEvent`, scoped to the single call site, mirroring Phase 1's `event-memory.ts` precedent for the same `nostr-tools/utils` helper.

### Preserve documented contravariance trick
**Source:** `packages/core/src/casts/cast.ts:14-18` (existing comment)
**Apply to:** `CastConstructor` — the constructor's `event` param stays `NostrEvent` even as the class's own generic bound widens to `StoreEvent`/`E`; only the `store: CastRefEventStore<E>` field widens. Do not broaden the constructor's event param type to "fix" a mismatch — that is the explicit anti-pattern documented in RESEARCH.md.

### Full-workspace build gate (phase-wide, not per-file)
**Source:** `.planning/phases/01-generic-store-foundation/deferred-items.md` item #1 (WR-02 lesson)
**Apply to:** every wave in this phase. Run `pnpm --filter applesauce-core build && pnpm --filter applesauce-core test` per task/wave, and `pnpm -r build` (full workspace) as the final phase gate — not optional, per CONTEXT.md's explicit instruction. Watch specifically for the 6 module-augmentation files (`packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts`, `packages/actions/src/action-runner.ts`) failing after `EventModels` gains its second type parameter.

## No Analog Found

None. Every file in this phase has a strong analog: either Phase 1's own prior genericization of the identical file (`interface.ts`, `event-store.ts`/`async-event-store.ts` — self-precedent) or the canonical `casts/event.ts` bridge-cast + generic-default convention (all other files). No new pattern needs to be invented; RESEARCH.md's "Don't Hand-Roll" section confirms every problem here was already solved once in Phase 1 for a structurally identical situation.

## Metadata

**Analog search scope:** `packages/core/src/casts/`, `packages/core/src/models/`, `packages/core/src/event-store/`, `packages/core/src/observable/` (cross-referenced against Phase 1's `01-PATTERNS.md` and `01-*-SUMMARY.md` for the proven genericization precedent)
**Files scanned:** `casts/event.ts` (full, unchanged reference), `01-PATTERNS.md` (Phase 1's full pattern map, reused as the primary analog source), RESEARCH.md's exact current-state excerpts for `models/base.ts`, `event-store/interface.ts`, `event-store/event-models.ts`, `casts/cast.ts`, `observable/cast-stream.ts`, `observable/claim-events.ts`, `observable/claim-latest.ts`, `casts/__tests__/rumor-cast.test.ts`
**Pattern extraction date:** 2026-07-08
