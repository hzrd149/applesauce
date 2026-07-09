# Phase 1: Generic store foundation - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 12 (1 net-new addition, 11 in-place genericization edits)
**Analogs found:** 12 / 12 (one canonical analog — `casts/event.ts` — reused across all files)

## Canonical Reference Pattern

**`packages/core/src/casts/event.ts`** (lines 1-21) already establishes the target convention from the prior "Genericize EventCast subsystem" commit. Every file in this phase should mirror this shape exactly, substituting `StoreEvent` for the bound.

```typescript
// Import (line 2)
import { getEventUID, isAddressableKind, isReplaceableKind, NostrEvent, StoreEvent } from "../helpers/event.js";

// Generic parameter declaration with `= NostrEvent` default (line 21)
export class EventCast<T extends StoreEvent = NostrEvent> {
  // ...
  constructor(
    readonly event: T,
    public readonly store: CastRefEventStore,
  ) {}
}
```

Key traits to replicate everywhere in Phase 1:
- Bound is `StoreEvent` (structural type from `helpers/event.ts`), default is `NostrEvent` — never change the default.
- The type parameter name may vary per file (`E`, `T`) — the migration doc and CONTEXT.md use `E`; keep `E extends StoreEvent = NostrEvent` for store/interface/manager files to match CORE-01/02/05 wording exactly.
- Where a helper function in this file is still typed `NostrEvent` (not yet genericized) and touches only structural fields, `casts/event.ts` bridges via a local `as NostrEvent` cast (see `signedView` getter, lines 27-29) — the **inverse** bridge pattern (calling a genericized helper from a still-`NostrEvent`-typed caller, or vice versa) may be needed transiently while genericizing helpers/interfaces/managers in sequence. Prefer finishing full call chains before introducing casts; only use `as NostrEvent`/`as E` bridges if a partial-genericization ordering makes it unavoidable.

`StoreEvent` itself (`packages/core/src/helpers/event.ts` lines 46-53) and `Rumor` (lines 38-39) already exist — no changes needed to their definitions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/helpers/event.ts` (add `verifyRumor`) | helper | transform | `casts/event.ts` (generic convention) + spec (exact function body) | exact (spec-fixed) |
| `packages/core/src/helpers/event.ts` (`getEventUID`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/event.ts` (`getReplaceableAddress`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/event.ts` (`getReplaceableIdentifier`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/filter.ts` (`getIndexableTags`, `matchFilter`, `matchFilters`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/expiration.ts` (`getExpirationTimestamp`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/pointers.ts` (`eventMatchesPointer`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/helpers/relays.ts` (`addSeenRelay`, `getSeenRelays`, `isFromRelay`) | helper | transform | `casts/event.ts` | role-match |
| `packages/core/src/event-store/interface.ts` | interface | request-response / event-driven | `casts/event.ts` (generic convention only — interfaces have no prior direct analog) | role-match |
| `packages/core/src/event-store/delete-manager.ts` (`DeleteManager`, `IDeleteManager`) | manager | event-driven | `casts/event.ts` + itself (structure unchanged, only types) | role-match |
| `packages/core/src/event-store/async-delete-manager.ts` (`AsyncDeleteManager`, `IAsyncDeleteManager`) | manager | event-driven | `delete-manager.ts` (sync sibling) | exact |
| `packages/core/src/event-store/expiration-manager.ts` (`ExpirationManager`, `IExpirationManager`) | manager | event-driven | `delete-manager.ts` (sibling manager, same genericization shape) | role-match |
| `packages/core/src/event-store/event-memory.ts` (`EventMemory`, `IEventMemory`) | manager (in-memory store) | CRUD | `casts/event.ts` (generic convention) + own current structure | role-match |
| `packages/core/src/event-store/event-store.ts` (`EventStore`, `EventStoreOptions`) | store class | CRUD + event-driven | `casts/event.ts` (generic convention) + migration spec (constructor fix, verifyEvent shape) | exact (spec-fixed) |
| `packages/core/src/event-store/async-event-store.ts` (`AsyncEventStore`) | store class | CRUD + event-driven | `event-store.ts` (sync sibling) | exact |
| `packages/core/src/helpers/__tests__/*.test.ts` (new `verifyRumor` test) | test | transform | existing helper test files in `helpers/__tests__/` (e.g. `expiration.test.ts`, `event-tags.test.ts`) | role-match |

## Pattern Assignments

### `packages/core/src/helpers/event.ts` — add `verifyRumor`

**Analog:** migration spec (exact body), `getEventHash` already re-exported here (line 12).

Add directly below the existing `Rumor`/`StoreEvent` type block (after line 53):
```typescript
/** Verifies a NIP-59 rumor by recomputing its event hash and comparing it to `rumor.id` */
export function verifyRumor(rumor: Rumor): boolean {
  return getEventHash(rumor) === rumor.id;
}
```
No import changes needed — `getEventHash` is already re-exported at line 12 from `nostr-tools/pure`.

---

### `packages/core/src/helpers/event.ts` — genericize structural helpers

**Analog:** `casts/event.ts` generic convention.

**Current signatures** (lines 95, 108, 170):
```typescript
export function getEventUID(event: NostrEvent) { ... }
export function getReplaceableAddress(event: NostrEvent): string | null { ... }
export function getReplaceableIdentifier(event: NostrEvent): string { ... }
```

**Target** (mirror `EventCast<T extends StoreEvent = NostrEvent>` pattern):
```typescript
export function getEventUID<E extends StoreEvent = NostrEvent>(event: E) { ... }
export function getReplaceableAddress<E extends StoreEvent = NostrEvent>(event: E): string | null { ... }
export function getReplaceableIdentifier<E extends StoreEvent = NostrEvent>(event: E): string { ... }
```
`StoreEvent` is already defined in this same file (lines 46-53) — no new import needed. Internal calls (`getReplaceableAddress(event)` inside `getEventUID`, `createReplaceableAddress` etc.) stay as-is since `E` flows through.

Also genericize `getParentEventStore<T extends object>` is out of scope (already generic, unrelated) — leave untouched. `isEvent`, `notifyEventUpdate`, `isProtectedEvent` stay `NostrEvent`-typed per the migration doc (semantically signed-event-specific / uses `sig`-adjacent checks) — do not broaden.

---

### `packages/core/src/helpers/filter.ts` — `getIndexableTags`, `matchFilter`, `matchFilters`

**Analog:** `casts/event.ts` generic convention.

**Current** (lines 11, 44, 96):
```typescript
export function getIndexableTags(event: NostrEvent): Set<string> { ... }
export function matchFilter(filter: Filter, event: NostrEvent): boolean { ... }
export function matchFilters(filters: Filter[], event: NostrEvent): boolean { ... }
```

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "./event.js";
// ...
export function getIndexableTags<E extends StoreEvent = NostrEvent>(event: E): Set<string> { ... }
export function matchFilter<E extends StoreEvent = NostrEvent>(filter: Filter, event: E): boolean { ... }
export function matchFilters<E extends StoreEvent = NostrEvent>(filters: Filter[], event: E): boolean { ... }
```
`matchFilter` calls `getIndexableTags(event)` internally (lines 58, 86) — both generic over the same `E`, so this continues to type-check once `getIndexableTags` is genericized. Import `StoreEvent` alongside existing `NostrEvent` import (line 3).

---

### `packages/core/src/helpers/expiration.ts` — `getExpirationTimestamp`

**Analog:** `casts/event.ts` generic convention.

**Current** (line 8):
```typescript
import { NostrEvent } from "./event.js";
export function getExpirationTimestamp(event: NostrEvent): number | undefined { ... }
```

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "./event.js";
export function getExpirationTimestamp<E extends StoreEvent = NostrEvent>(event: E): number | undefined { ... }
```
`isExpired` (line 16) calls `getExpirationTimestamp(event)` but stays `NostrEvent`-typed per the fixed helper list (not in CORE-04's named list) — leave `isExpired` untouched, it will still compile since `NostrEvent extends StoreEvent`.

---

### `packages/core/src/helpers/pointers.ts` — `eventMatchesPointer`

**Analog:** `casts/event.ts` generic convention. Function found at line 434 (not read in full — large file; only signature relevant).

**Action:** Change signature from `(event: NostrEvent, ...)` to `<E extends StoreEvent = NostrEvent>(event: E, ...)`. Add `StoreEvent` to the existing `event.js` import (line 35: `import { getReplaceableIdentifier, isAddressableKind, isReplaceableKind, kinds, NostrEvent } from "./event.js";` → append `StoreEvent`). Use `Grep`/targeted `Read` with offset around line 434 during implementation to get the exact current signature and body before editing (not re-read here to avoid redundant context).

---

### `packages/core/src/helpers/relays.ts` — `addSeenRelay`, `getSeenRelays`, `isFromRelay`

**Analog:** `casts/event.ts` generic convention.

**Current** (lines 12, 25, 30):
```typescript
import { NostrEvent } from "./event.js";
export function addSeenRelay(event: NostrEvent, relay: string): Set<string> { ... }
export function getSeenRelays(event: NostrEvent): Set<string> | undefined { ... }
export function isFromRelay(event: NostrEvent, relay: string): boolean { ... }
```

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "./event.js";
export function addSeenRelay<E extends StoreEvent = NostrEvent>(event: E, relay: string): Set<string> { ... }
export function getSeenRelays<E extends StoreEvent = NostrEvent>(event: E): Set<string> | undefined { ... }
export function isFromRelay<E extends StoreEvent = NostrEvent>(event: E, relay: string): boolean { ... }
```
`isFromRelay` calls `getSeenRelays(event)` internally (line 31) — both generic over same `E`, continues to type-check.

---

### `packages/core/src/event-store/interface.ts` — genericize the interface set

**Analog:** `casts/event.ts` generic convention (no prior interface analog exists in the codebase; this file is the reference point itself for the interface layer).

**Current** (line 2 import, then every interface uses `NostrEvent` directly, e.g. lines 8-25, 64-130, 177-263):
```typescript
import { NostrEvent } from "../helpers/event.js";

export interface IEventStoreRead {
  hasEvent(id: string): boolean;
  getEvent(id: string): NostrEvent | undefined;
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined;
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined;
  getByFilters(filters: Filter | Filter[]): NostrEvent[];
  getTimeline(filters: Filter | Filter[]): NostrEvent[];
}
```

**Target shape** (per migration doc's exact named list — CORE-05):
```typescript
import { NostrEvent, StoreEvent } from "../helpers/event.js";

export interface IEventStoreRead<E extends StoreEvent = NostrEvent> {
  hasEvent(id: string): boolean;
  getEvent(id: string): E | undefined;
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  getReplaceable(kind: number, pubkey: string, identifier?: string): E | undefined;
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): E[] | undefined;
  getByFilters(filters: Filter | Filter[]): E[];
  getTimeline(filters: Filter | Filter[]): E[];
}
```

Apply the same `<E extends StoreEvent = NostrEvent>` parameterization + replace every bare `NostrEvent` return/param type with `E` for these interfaces (all present in this file):
`IEventStoreRead`, `IAsyncEventStoreRead`, `IEventStoreReadAdvanced`, `IAsyncEventStoreReadAdvanced`, `IEventStoreStreams`, `IEventStoreActions`, `IAsyncEventStoreActions`, `IEventClaims`, `IEventSubscriptions`, `IDeleteManager`, `IAsyncDeleteManager`, `IExpirationManager`, `IEventDatabase`, `IAsyncEventDatabase`, `IEventMemory`, `IMissingEventLoader`, `IEventStore`, `IAsyncEventStore`.

Interfaces extending others must thread `<E>` through, e.g.:
```typescript
export interface IEventStoreReadAdvanced<E extends StoreEvent = NostrEvent>
  extends Omit<IEventStoreRead<E>, "hasEvent" | "getEvent"> {
  hasEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): boolean;
  getEvent(id: string | EventPointer | AddressPointer | AddressPointerWithoutD): E | undefined;
}
```
```typescript
export interface IEventStore<E extends StoreEvent = NostrEvent>
  extends
    IEventStoreReadAdvanced<E>,
    IEventStoreStreams<E>,
    IEventSubscriptions<E>,
    IEventStoreActions<E>,
    IEventModelMixin<IEventStore<E>>,
    IEventClaims<E>,
    IMissingEventLoader<E> {}
```

**EXPLICITLY DEFERRED (per D-02 / CONTEXT.md):** Do NOT genericize `Model`, `ModelConstructor`, `ModelEventStore`, `IEventModelMixin` in this phase beyond what's structurally required to keep `IEventStore`/`IAsyncEventStore` compiling — these move to Phase 2 with the model framework. If `IEventModelMixin<TStore>` needs a type param passthrough to keep `IEventStore<E>` compiling, keep it minimal and do not touch `Model`/`ModelConstructor`/`ModelEventStore` bodies themselves.

`DeleteEventNotification` (lines 162-174) is pointer-based, not event-typed — leave untouched.

---

### `packages/core/src/event-store/delete-manager.ts` — `DeleteManager`

**Analog:** itself (structure unchanged) + `casts/event.ts` convention for the type param.

**Current** (lines 1-7, class decl, and every method NostrEvent-typed: lines 29, 86, 111):
```typescript
import { NostrEvent } from "../helpers/event.js";
import { DeleteEventNotification, IDeleteManager } from "./interface.js";

export class DeleteManager implements IDeleteManager {
  add(deleteEvent: NostrEvent): DeleteEventNotification[] { ... }
  check(event: NostrEvent): boolean { ... }
  filter(events: NostrEvent[]): NostrEvent[] { ... }
}
```

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "../helpers/event.js";
import { DeleteEventNotification, IDeleteManager } from "./interface.js";

export class DeleteManager<E extends StoreEvent = NostrEvent> implements IDeleteManager<E> {
  add(deleteEvent: E): DeleteEventNotification[] { ... }
  check(event: E): boolean { ... }
  filter(events: E[]): E[] { ... }
}
```
Internals use `deleteEvent.kind`, `.pubkey`, `.created_at` (all `StoreEvent` fields) plus `getDeleteEventPointers`/`getDeleteAddressPointers` from `helpers/delete.ts` — check those helpers' current signatures during implementation; they are not in CORE-04's list so they likely stay `NostrEvent`-typed, meaning a bridge (`deleteEvent as NostrEvent`) may be needed when calling them, matching the `signedView` bridge pattern in `casts/event.ts` lines 27-29.

---

### `packages/core/src/event-store/async-delete-manager.ts` — `AsyncDeleteManager`

**Analog:** `delete-manager.ts` (sync sibling — same shape, `Promise`-wrapped returns per `IAsyncDeleteManager` in `interface.ts` lines 189-198).

**Action:** Apply the identical `<E extends StoreEvent = NostrEvent>` parameterization as `DeleteManager`, with async method signatures matching `IAsyncDeleteManager<E>`. File not read in this pass (small, mirrors delete-manager.ts structure) — read directly during planning/implementation for the exact current body.

---

### `packages/core/src/event-store/expiration-manager.ts` — `ExpirationManager`

**Analog:** `delete-manager.ts` (sibling manager, same genericization shape).

**Current** (lines 1-8, class decl, methods at lines 33+ and beyond what was read — `track`, `forget`, `check`):
```typescript
import { NostrEvent } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { IExpirationManager } from "./interface.js";

export class ExpirationManager implements IExpirationManager {
  track(event: NostrEvent): void { ... }
  // forget(eventId: string): void — unaffected (string param)
  // check(event: NostrEvent): boolean — expected further in file
}
```

**Target:**
```typescript
import { NostrEvent, StoreEvent } from "../helpers/event.js";
import { getExpirationTimestamp } from "../helpers/expiration.js";
import { IExpirationManager } from "./interface.js";

export class ExpirationManager<E extends StoreEvent = NostrEvent> implements IExpirationManager<E> {
  track(event: E): void { ... }
  forget(eventId: string): void { ... }
  check(event: E): boolean { ... }
}
```
`track` calls the now-generic `getExpirationTimestamp(event)` (helpers/expiration.ts) — types flow through once that helper is genericized first. Read remaining lines (40+) during implementation for `forget`/`check`/`dispose` bodies — not re-read here.

---

### `packages/core/src/event-store/event-memory.ts` — `EventMemory`

**Analog:** `casts/event.ts` generic convention; internal structure (Maps/Sets keyed by `NostrEvent`) stays structurally the same, just parameterized.

**Current** (lines 1-14, indexes at 18-30):
```typescript
import {
  binarySearch,
  createReplaceableAddress,
  insertEventIntoDescendingList,
  isReplaceable,
  NostrEvent,
} from "../helpers/event.js";
import { Filter, getIndexableTags, INDEXABLE_TAGS } from "../helpers/filter.js";
import { IEventMemory } from "./interface.js";

export class EventMemory implements IEventMemory {
  protected kinds = new Map<number, Set<NostrEvent>>();
  protected authors = new Map<string, Set<NostrEvent>>();
  protected tags = new LRU<Set<NostrEvent>>();
  protected created_at: NostrEvent[] = [];
  protected kindAuthor = new Map<string, Set<NostrEvent>>();
  events = new LRU<NostrEvent>();
  protected replaceable = new Map<string, NostrEvent[]>();
}
```

**Target:**
```typescript
import {
  binarySearch,
  createReplaceableAddress,
  insertEventIntoDescendingList,
  isReplaceable,
  NostrEvent,
  StoreEvent,
} from "../helpers/event.js";
import { Filter, getIndexableTags, INDEXABLE_TAGS } from "../helpers/filter.js";
import { IEventMemory } from "./interface.js";

export class EventMemory<E extends StoreEvent = NostrEvent> implements IEventMemory<E> {
  protected kinds = new Map<number, Set<E>>();
  protected authors = new Map<string, Set<E>>();
  protected tags = new LRU<Set<E>>();
  protected created_at: E[] = [];
  protected kindAuthor = new Map<string, Set<E>>();
  events = new LRU<E>();
  protected replaceable = new Map<string, E[]>();
}
```
Rest of the file (methods beyond line 40, e.g. `getEvent`, `add`, `remove`, `hasReplaceable`) not read in this pass — read directly during implementation; every `NostrEvent` param/return in method bodies becomes `E`. `binarySearch`/`insertEventIntoDescendingList` from `helpers/event.ts` are NOT in the CORE-04 list — check their current generic-ness during implementation; if still `NostrEvent`-typed, a bridge cast may be needed (same pattern as `casts/event.ts`'s `signedView`).

---

### `packages/core/src/event-store/event-store.ts` — `EventStore`, `EventStoreOptions`

**Analog:** `casts/event.ts` generic convention (type param shape) + migration spec / CONTEXT.md (constructor fix and `verifyEvent` semantics — these are spec-fixed, not inferred from an analog).

**Current** (lines 1-90):
```typescript
import { verifyEvent as coreVerifyEvent, verifiedSymbol } from "nostr-tools/pure";
import { EventStoreSymbol, FromCacheSymbol, getReplaceableIdentifier, isRegularKind, isReplaceable, kinds, NostrEvent } from "../helpers/event.js";
// ...
export type EventStoreOptions = {
  keepDeleted?: boolean;
  keepExpired?: boolean;
  keepOldVersions?: boolean;
  database?: IEventDatabase;
  deleteManager?: IDeleteManager;
  expirationManager?: IExpirationManager;
  verifyEvent?: (event: NostrEvent) => boolean;
};

export class EventStore extends EventModels implements IEventStore {
  database: IEventDatabase;
  memory: EventMemory;
  private deletes: IDeleteManager;
  private expiration: IExpirationManager;
  private _verifyEventMethod?: (event: NostrEvent) => boolean = coreVerifyEvent;

  get verifyEvent(): undefined | ((event: NostrEvent) => boolean) {
    return this._verifyEventMethod;
  }
  set verifyEvent(method: undefined | ((event: NostrEvent) => boolean)) {
    this._verifyEventMethod = method;
    if (method === undefined)
      console.warn("[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.");
  }

  insert$ = new Subject<NostrEvent>();
  update$ = new Subject<NostrEvent>();
  remove$ = new Subject<NostrEvent>();

  eventLoader?: (pointer: ...) => Observable<NostrEvent> | Promise<NostrEvent | undefined>;

  constructor(options?: EventStoreOptions) {
    super();
    if (options?.database) { ... } else { this.database = this.memory = new EventMemory(); }
    if (options?.keepDeleted !== undefined) this.keepDeleted = options.keepDeleted;
    // ... (verifyEvent assignment further down — currently `if (options?.verifyEvent)`)
  }
}
```

**Target (per migration doc + D-01/D-04):**
```typescript
import { verifyEvent as coreVerifyEvent, verifiedSymbol } from "nostr-tools/pure";
import { EventStoreSymbol, FromCacheSymbol, getReplaceableIdentifier, isRegularKind, isReplaceable, kinds, NostrEvent, StoreEvent } from "../helpers/event.js";
// ...
export type EventStoreOptions<E extends StoreEvent = NostrEvent> = {
  keepDeleted?: boolean;
  keepExpired?: boolean;
  keepOldVersions?: boolean;
  database?: IEventDatabase<E>;
  deleteManager?: IDeleteManager<E>;
  expirationManager?: IExpirationManager<E>;
  verifyEvent?: (event: E) => boolean;
};

export class EventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IEventStore<E> {
  database: IEventDatabase<E>;
  memory: EventMemory<E>;
  private deletes: IDeleteManager<E>;
  private expiration: IExpirationManager<E>;
  private _verifyEventMethod?: (event: E) => boolean = coreVerifyEvent as unknown as (event: E) => boolean;

  get verifyEvent(): undefined | ((event: E) => boolean) {
    return this._verifyEventMethod;
  }
  set verifyEvent(method: undefined | ((event: E) => boolean)) {
    this._verifyEventMethod = method;
    if (method === undefined)
      console.warn("[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.");
  }

  insert$ = new Subject<E>();
  update$ = new Subject<E>();
  remove$ = new Subject<E>();

  eventLoader?: (pointer: ...) => Observable<E> | Promise<E | undefined>;

  constructor(options?: EventStoreOptions<E>) {
    super();
    if (options?.database) { ... } else { this.database = this.memory = new EventMemory<E>(); }
    if (options?.keepDeleted !== undefined) this.keepDeleted = options.keepDeleted;

    // CORE-03 fix — the one intentional runtime change in this phase:
    if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;
  }
}
```
**D-01 note:** the `console.warn` in the setter is unchanged/kept exactly as-is — fires on any `undefined` assignment, intentional or not. **D-04 note:** the `coreVerifyEvent` default at `_verifyEventMethod` init needs a type bridge (`as unknown as (event: E) => boolean`) since `nostr-tools`'s `verifyEvent` is hard-typed to `NostrEvent` — this is the expected/acceptable bridge point flagged in the migration doc's "Migration Notes" section (watch `NostrEvent` references in observable/verification helpers). Read the full constructor body (lines 120+, not shown in this pass) during implementation to locate the exact current `verifyEvent` assignment line to replace with the `"verifyEvent" in options` check.

`EventModels` (superclass, `event-models.ts`) is explicitly out of scope for Phase 1 per CONTEXT.md D-02 — do not genericize it; `EventStore<E>` extending non-generic `EventModels` is expected to produce a type gap that Phase 2 closes. Do not attempt to fix this in Phase 1.

---

### `packages/core/src/event-store/async-event-store.ts` — `AsyncEventStore`

**Analog:** `event-store.ts` (sync sibling — apply the identical transformation with `Promise`-wrapped method returns per `IAsyncEventStore`/`IAsyncEventStoreActions` in `interface.ts`).

**Action:** Mirror every change made to `EventStore`/`EventStoreOptions` above, parameterizing `AsyncEventStore<E extends StoreEvent = NostrEvent>` and threading `E` through its async database/manager fields. File not read in this pass — read directly during implementation immediately after `event-store.ts` is done, so the diff is applied consistently.

---

### `packages/core/src/helpers/__tests__/*.test.ts` — `verifyRumor` unit test (D-03)

**Analog:** existing helper test files in `helpers/__tests__/` (e.g. `expiration.test.ts`, `event-tags.test.ts`) — same directory, same Vitest structure (not read in detail; standard `describe`/`it` Vitest pattern used throughout `helpers/__tests__/`).

**Action:** Add a focused test (new file `helpers/__tests__/rumor.test.ts` or appended to an existing structurally-related file — planner's discretion) covering:
- Correct `id` → `verifyRumor` returns `true`.
- Tampered/incorrect `id` → `verifyRumor` returns `false`.

## Shared Patterns

### Generic parameter convention
**Source:** `packages/core/src/casts/event.ts` lines 1-21
**Apply to:** every file in this phase.
```typescript
import { NostrEvent, StoreEvent } from "../helpers/event.js"; // or "./event.js" within helpers/
// ...
export class/interface/function Foo<E extends StoreEvent = NostrEvent> { ... }
```
Always add `StoreEvent` to the existing `event.js` import rather than introducing a new import line — every touched file already imports `NostrEvent` from `helpers/event.ts` (or `./event.js` internally within `helpers/`).

### `NostrEvent`-typed helper bridge (transitional)
**Source:** `packages/core/src/casts/event.ts` lines 27-29 (`signedView` getter)
**Apply to:** any genericized file that must call a helper NOT in the CORE-04 list (e.g. `binarySearch`, `insertEventIntoDescendingList`, `getDeleteEventPointers`, `getDeleteAddressPointers`) — these remain `NostrEvent`-typed in Phase 1. Bridge with a local `as unknown as NostrEvent` (or `as NostrEvent` if TS allows without `unknown`) cast, scoped as tightly as possible, exactly as `casts/event.ts` does for `getEventUID`/`getReplaceableAddressForEvent`/etc.

### Constructor `"in" options` check (CORE-03, runtime-affecting)
**Source:** migration spec + CONTEXT.md `<specifics>`
**Apply to:** `event-store.ts` and `async-event-store.ts` constructors only.
```typescript
if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;
```
This is the only intentional runtime behavior change in Phase 1 — every other edit in this phase must be type-level only.

## No Analog Found

None — every file has at least a role-match analog (`casts/event.ts` for the generic-parameter convention itself, plus sibling files for structural/manager patterns). The interface file (`interface.ts`) has no prior *interface-layer* analog in the codebase since it's the first interface set to be genericized, but its target shape is fully specified by the migration doc's named list (CORE-05) and mirrors the `casts/event.ts` parameter convention directly.

## Metadata

**Analog search scope:** `packages/core/src/casts/`, `packages/core/src/helpers/`, `packages/core/src/event-store/`
**Files scanned:** `casts/event.ts`, `helpers/event.ts`, `helpers/filter.ts`, `helpers/expiration.ts`, `helpers/relays.ts`, `helpers/pointers.ts` (partial), `event-store/interface.ts`, `event-store/event-store.ts` (partial), `event-store/delete-manager.ts`, `event-store/expiration-manager.ts` (partial), `event-store/event-memory.ts` (partial)
**Pattern extraction date:** 2026-07-08
</content>
