# Phase 3: RumorStore & verification - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 6 (2 net-new, 4 modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/event-store/rumor-store.ts` (NEW) | store class (subclass) | CRUD + event-driven | `packages/core/src/event-store/event-store.ts` (`EventStore<E>` + `EventStoreOptions<E>`) | exact (spec-fixed shape) |
| `packages/core/src/event-store/index.ts` (MODIFY: add export) | barrel/export | — | itself (existing `export * from "./event-store.js"` line list) | exact |
| `packages/core/src/event-store/__tests__/rumor-store.test.ts` (NEW) | test | CRUD + event-driven | `packages/core/src/event-store/__tests__/verify-event-option.test.ts` (accept/reject verifier pattern) + `delete-manager.test.ts` (delete-rumor pattern) | exact |
| `packages/core/src/casts/cast.ts` (MODIFY: split `castEvent`/`performCast`, add `CastEventInput<T>`) | utility (cast factory) | transform | itself (current `castEvent` implementation) | exact |
| `packages/core/src/observable/cast-stream.ts` (MODIFY: call `performCast` not `castEvent`) | utility (rxjs operator) | streaming | itself (current `castEventStream`/`castTimelineStream`) | exact |
| `packages/core/src/casts/__tests__/rumor-cast.test.ts` (MODIFY: extend with `RumorStore` + bridge cast) | test | transform | itself (existing file, currently uses bare `new EventStore()`) | exact |
| `packages/core/src/__tests__/exports.test.ts` (MODIFY: snapshot update) | test (snapshot) | — | itself (existing inline snapshot array) | exact |

## Pattern Assignments

### `packages/core/src/event-store/rumor-store.ts` (NEW)

**Analog:** `packages/core/src/event-store/event-store.ts` lines 1-52 (`EventStoreOptions<E>` shape, already generic from Phase 1) + `.planning/rumor-store-migration.md` "Store Shape" (exact, locked class body).

**Imports pattern** (mirrors `event-store.ts`'s relative import style):
```typescript
import { EventStore, EventStoreOptions } from "./event-store.js";
import { Rumor, verifyRumor } from "../helpers/event.js";
```

**Core pattern** (verbatim from RESEARCH.md Pattern 1 / migration doc, cross-checked against the real `EventStoreOptions<E extends StoreEvent = NostrEvent>` shape at `event-store.ts` lines 36-51):
```typescript
export class RumorStore extends EventStore<Rumor> {
  constructor(options?: Omit<EventStoreOptions<Rumor>, "verifyEvent">) {
    super({ ...options, verifyEvent: verifyRumor });
  }
}
```

**Why this shape is safe:** `EventStore`'s constructor already contains the CORE-03 fix (`event-store.ts`, shipped Phase 1): `if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;` — so `RumorStore`'s explicit `verifyEvent: verifyRumor` in the spread always wins; no caller can override it since the type omits the key entirely.

**Do NOT** add validation beyond hash-recompute (`verifyRumor` = `getEventHash(rumor) === rumor.id`, already exported from `helpers/event.ts`). Do NOT add `AsyncRumorStore` unless a concrete need appears — `new AsyncEventStore<Rumor>({ verifyEvent: verifyRumor })` already covers it.

---

### `packages/core/src/event-store/index.ts` (MODIFY)

**Analog:** itself — current file is a flat list of `export *` lines:
```typescript
export * from "./async-event-store.js";
export * from "./event-memory.js";
export * from "./event-store.js";
export * from "./interface.js";
export * from "./event-models.js";
export * from "./delete-manager.js";
export * from "./async-delete-manager.js";
export * from "./expiration-manager.js";
```
**Action:** append `export * from "./rumor-store.js";` as one more line (any position; alphabetical-ish grouping not enforced by existing file, so appending at the end is safe and matches the file's own style of appending new sibling modules).

---

### `packages/core/src/event-store/__tests__/rumor-store.test.ts` (NEW)

**Analog 1 (accept/reject verifier pattern):** `packages/core/src/event-store/__tests__/verify-event-option.test.ts` (full file read) — `describe("EventStore verifyEvent option (CORE-03)", ...)` with `it("default store rejects...")` / `it("... undefined disables verification and accepts...")`. Structure to mirror for RUMOR-03:
```typescript
import { describe, expect, it } from "vitest";
import { RumorStore } from "../rumor-store.js";
import { getEventHash } from "../../helpers/event.js";

describe("RumorStore verification (RUMOR-03)", () => {
  it("accepts a rumor with a correct id", () => {
    const store = new RumorStore();
    const rumor = { kind: 1, pubkey: "a".repeat(64), created_at: 0, content: "hi", tags: [], id: "" };
    rumor.id = getEventHash(rumor);
    expect(store.add(rumor)).not.toBeNull();
  });

  it("rejects a rumor with an incorrect id", () => {
    const store = new RumorStore();
    const rumor = { kind: 1, pubkey: "a".repeat(64), created_at: 0, content: "hi", tags: [], id: "0".repeat(64) };
    expect(store.add(rumor)).toBeNull();
  });
});
```

**Analog 2 (kind-5 delete pattern):** `packages/core/src/event-store/__tests__/delete-manager.test.ts` lines 1-34 (real file, read in full) — uses `FakeUser` fixture, `beforeEach` setup, constructs a raw delete-event object with `kind: kinds.EventDeletion`, `tags: [["e", note.id]]`, then asserts `deleteManager.check(note)`. For `RumorStore`, adapt via `store.add()`/`store.getEvent()` (through the full store, not bare `DeleteManager`), per RESEARCH.md's Code Examples "Kind-5 delete rumor" section — construct rumor + delete-rumor with `getEventHash`-computed `id`s, `store.add(rumor)`, `store.add(deleteRumor)`, then `expect(store.getEvent(rumor.id)).toBeUndefined()`.

**Analog 3 (RUMOR-04, filters/timeline/replaceable):** No dedicated existing test file needed as reference beyond the generic `EventModels<E>` behavior already exercised in Phase 2 tests (not re-read here — behavior is already proven generic; test is additive assertions using `store.filters([...])`, `store.timeline([...])`, `store.replaceable(...)` exactly as the migration doc's own usage example shows: `const timeline$: Observable<Rumor[]> = store.timeline([{ kinds: [1] }]);`).

**Fixture convention:** Use `FakeUser` from `packages/core/src/__tests__/fixtures.js` (same relative import depth as `rumor-cast.test.ts`: `"../../__tests__/fixtures.js"` from `casts/__tests__/`, so from `event-store/__tests__/` it is also `"../../__tests__/fixtures.js"`) if signed-then-stripped rumors are convenient (mirrors `rumor-cast.test.ts`'s `makeRumor()` helper — see below), otherwise construct plain rumor objects directly with `getEventHash`.

---

### `packages/core/src/casts/cast.ts` (MODIFY)

**Analog:** itself — current full file content (read in full):
```typescript
import { EventModels, IEventStoreStreams, IEventSubscriptions } from "../event-store/index.js";
import { getParentEventStore, NostrEvent, StoreEvent } from "../helpers/event.js";
import { EventCast } from "./event.js";

export type CastRefEventStore<E extends StoreEvent = NostrEvent> = IEventSubscriptions<E> &
  EventModels<E> &
  IEventStoreStreams<E>;

export const CAST_REF_SYMBOL = Symbol.for("cast-ref");
export const CASTS_SYMBOL = Symbol.for("casts");

export type CastConstructor<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent> = new (
  event: NostrEvent,
  store: CastRefEventStore<E>,
) => C;

export function castEvent<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: StoreEvent,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  const casts: Map<CastConstructor<C, E>, C> = Reflect.get(event, CASTS_SYMBOL);
  const existing = casts?.get(cls);
  if (existing) return existing;
  if (!store) {
    store = getParentEventStore(event) as unknown as CastRefEventStore<E>;
    if (!store) throw new Error("Event is not attached to an event store, an event store must be provided");
  }
  const cast = new cls(event as NostrEvent, store);
  if (!casts) Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]));
  else casts.set(cls, cast);
  return cast;
}
```

**Target (WR-01 fix — RESEARCH.md Pattern 2, empirically verified in research session via `pnpm -r build` + `pnpm --filter applesauce-concord test`):** Rename the body above to `performCast` (mark `@internal` in JSDoc), add `CastEventInput<T>`, and add a new sig-gated `castEvent` wrapper that delegates to it:
```typescript
export type CastEventInput<T extends StoreEvent> = T extends { sig: string } ? NostrEvent : StoreEvent;

/** @internal loose, runtime-guarded — used only by castEventStream/castTimelineStream */
export function performCast<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: StoreEvent,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  // ...identical body to the current castEvent implementation, unchanged...
}

/** Cast a Nostr event (or an unsigned StoreEvent/rumor) to a specific class */
export function castEvent<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: C extends EventCast<infer T> ? CastEventInput<T> : never,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  return performCast(event as StoreEvent, cls, store);
}
```
**Do not** use the naive exact-`T` conditional (`event: C extends EventCast<infer T> ? T : never`) — RESEARCH.md Pitfall 1 confirms this over-tightens and breaks `packages/concord/src/casts/direct-invite.ts`'s real `castEvent(rumor, ConcordDirectInvite, store)` call site (narrowed-kind rumor cast). Use the sig-gated form only.

---

### `packages/core/src/observable/cast-stream.ts` (MODIFY)

**Analog:** itself — current full file (read in full, shown above under Step 4 gathering). Both `castEventStream` and `castTimelineStream` currently import and call `castEvent` from `"../casts/index.js"`.

**Action:** Change the import to `performCast` from `"../casts/cast.js"` and replace both call sites (`castEvent(event, cls, store)` → `performCast(event, cls, store)`), keeping the exported operator signatures (`OperatorFunction<StoreEvent | undefined, C | undefined>` / `OperatorFunction<StoreEvent[], C[]>`) unchanged — per CONTEXT.md's explicit instruction to keep the stream operators loose.
```typescript
import type { CastConstructor, CastRefEventStore } from "../casts/cast.js";
import { performCast, EventCast } from "../casts/cast.js"; // was: castEvent from "../casts/index.js"
```

---

### `packages/core/src/casts/__tests__/rumor-cast.test.ts` (MODIFY — extend, don't replace)

**Analog:** itself — current full file (read in full):
```typescript
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import type { Rumor } from "../../helpers/event.js";
import { castEvent } from "../cast.js";
import { EventCast } from "../event.js";

class RumorNote extends EventCast<Rumor> {
  get text() {
    return this.event.content;
  }
}

function makeRumor(overrides?: { kind?: number; content?: string }): { rumor: Rumor; pubkey: string; id: string } {
  const user = new FakeUser();
  const signed = user.event({ kind: overrides?.kind ?? 1, content: overrides?.content ?? "" });
  const rumor = { ...signed } as Rumor & { sig?: string };
  delete rumor.sig;
  return { rumor, pubkey: user.pubkey, id: signed.id };
}

describe("EventCast over a rumor", () => {
  it("casts an unsigned rumor via castEvent and reads its fields", () => {
    const { rumor, pubkey, id } = makeRumor({ content: "hello rumor" });
    const cast = castEvent(rumor, RumorNote, new EventStore()); // bare EventStore — sidesteps the real gap
    // ...
  });
});
```

**Gap this test currently masks (RESEARCH.md Pitfall 2):** it passes a bare `new EventStore()` (defaults to `NostrEvent`), which type-checks trivially. A genuine `RumorStore`/`EventStore<Rumor>` does **not** type-check as `castEvent`'s third argument because `CastRefEventStore<E>` is invariant in `E` and `EventCast`'s inherited constructor's `store` param is hardcoded to bare `CastRefEventStore`.

**Action:** Add a new test (do not remove existing ones) that exercises RUMOR-06 against a real `RumorStore`, using the documented bridge-cast pattern (RESEARCH.md Pattern 3, matching the `signedView`/`as unknown as NostrEvent` convention already used in `casts/event.ts` lines 27-29):
```typescript
import { RumorStore } from "../../event-store/rumor-store.js";
import type { CastRefEventStore } from "../cast.js";

it("casts an unsigned rumor via castEvent against a real RumorStore", () => {
  const { rumor } = makeRumor({ content: "hello rumor store" });
  const rumorStore = new RumorStore();
  rumorStore.add(rumor);
  // Bridge cast: RumorNote's inherited EventCast constructor's `store` param is hardcoded to
  // bare CastRefEventStore (invariant in E); RumorStore is a genuine EventStore<Rumor> and is
  // not structurally assignable. This mirrors the `signedView` bridge already used in
  // casts/event.ts (lines 27-29) and event-store/delete-manager.ts.
  const cast = castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore);
  expect(cast).toBeInstanceOf(RumorNote);
  expect(cast.text).toBe("hello rumor store");
});
```
Also add a compile-time-only negative check (per CONTEXT.md "add type-level coverage where practical") demonstrating a signed-only cast rejects a rumor, e.g. a `@ts-expect-error` probe against a cast class reading `event.sig` — see RESEARCH.md's empirical probe description under Pattern 2.

---

### `packages/core/src/__tests__/exports.test.ts` (MODIFY — snapshot only)

**Analog:** itself — existing inline snapshot array includes alphabetically-sorted export names, e.g. lines 15 (`"EventCast"`) and 34 (`"castEvent"`).

**Action:** After adding `RumorStore` (from `rumor-store.ts`, surfaced via `event-store/index.ts` → top-level `index.ts`), `performCast`, and `CastEventInput` (both surfaced via `casts/index.ts`'s `export * from "./cast.js"` → top-level `index.ts`) as new public exports, run `pnpm --filter applesauce-core test -- exports -u` (or the equivalent vitest snapshot-update flag) to regenerate the inline snapshot rather than hand-editing it — per RESEARCH.md Pitfall 3, this is expected drift, not a regression. Include the updated snapshot in the same commit as the `cast.ts`/`rumor-store.ts` changes.

## Shared Patterns

### Bridge-cast convention (invariance workaround)
**Source:** `packages/core/src/casts/event.ts` lines 27-29 (`signedView` getter) and `packages/core/src/casts/cast.ts`'s existing `getParentEventStore(event) as unknown as CastRefEventStore<E>` line.
**Apply to:** `rumor-cast.test.ts`'s new RUMOR-06 test (`rumorStore as unknown as CastRefEventStore`). Do NOT attempt to parameterize `EventCast`'s own `store` field to fix this properly in this phase — RESEARCH.md confirms it ripples into `casts/user.ts`'s unrelated `User.timeline$<T extends EventCast>(...)` generic; out of scope.

### CORE-03 `"verifyEvent" in options` check (already shipped, reused not reimplemented)
**Source:** `packages/core/src/event-store/event-store.ts` constructor (Phase 1).
**Apply to:** `RumorStore`'s constructor relies on this fix already existing in the `EventStore` superclass — no new logic needed, just the `super({ ...options, verifyEvent: verifyRumor })` spread.

### Sig-gated type conditional
**Source:** `packages/core/src/casts/cast.ts` (new `CastEventInput<T>`).
**Apply to:** Only `castEvent`'s public signature. `performCast` (internal) and the two stream operators in `cast-stream.ts` stay loose (`StoreEvent`), unaffected by this conditional.

## No Analog Found

None — every file has an exact self-analog (modify-in-place) or a strong cross-file analog (`RumorStore` from `EventStore`/`EventStoreOptions`; `rumor-store.test.ts` from `verify-event-option.test.ts` + `delete-manager.test.ts`).

## Metadata

**Analog search scope:** `packages/core/src/event-store/`, `packages/core/src/casts/`, `packages/core/src/observable/`, `packages/core/src/__tests__/`
**Files scanned:** `event-store/event-store.ts` (partial, lines 1-52), `event-store/index.ts` (full), `event-store/__tests__/verify-event-option.test.ts` (full), `event-store/__tests__/delete-manager.test.ts` (partial, lines 1-50), `casts/cast.ts` (full), `casts/event.ts` (full), `casts/__tests__/rumor-cast.test.ts` (full), `observable/cast-stream.ts` (full), `__tests__/exports.test.ts` (grep only)
**Pattern extraction date:** 2026-07-08
