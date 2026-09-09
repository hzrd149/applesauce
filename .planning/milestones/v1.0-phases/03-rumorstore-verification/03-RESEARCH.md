# Phase 3: RumorStore & verification - Research

**Researched:** 2026-07-08
**Domain:** TypeScript generic-store convenience class + cast-subsystem compile-time typing (applesauce-core)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**RumorStore shape (LOCKED by migration doc)**
- `RumorStore extends EventStore<Rumor>`; constructor takes `Omit<EventStoreOptions<Rumor>, "verifyEvent">` and calls `super({ ...options, verifyEvent: verifyRumor })` so a rumor store always verifies via hash-recompute and callers cannot accidentally override it.
- Mirror for async only if needed: prefer `AsyncEventStore<Rumor>` directly; add `AsyncRumorStore` only if a concrete need appears.

**Verification policy (LOCKED)**
- Default signed `EventStore` keeps `nostr-tools/pure.verifyEvent`. `RumorStore` uses `verifyRumor` by default. The Phase 1 CORE-03 fix (`"verifyEvent" in options` honoring explicit `undefined`) is already shipped.
- Acceptance: `RumorStore.add()` accepts a rumor whose `id` matches its serialized contents and rejects one with an incorrect `id`.

**Deletion policy (LOCKED)**
- Rumor stores process kind-5 delete rumors exactly as signed event stores do. `DeleteManager` is already generic (Phase 1), so this should require little/no new logic — verify with a test that a kind-5 delete rumor removes matching stored rumors.

**Casts (this phase settles Phase 2 WR-01)**
- A custom `EventCast<Rumor>` (e.g. `class RumorNote extends EventCast<Rumor>`) must work with `castEvent(rumor, RumorNote, rumorStore)`. Decide `castEvent`'s input typing here with real usage in hand: tie the input to the cast's declared `EventCast<T>` so a rumor is accepted by a rumor cast and rejected by a signed-only cast at compile time — while keeping the runtime-guarded stream operators (`castEventStream`/`castTimelineStream`) loose. Do NOT regress existing signed-cast call sites; verify with the full `pnpm -r build`.

### Claude's Discretion
Exact test file organization, whether to add `AsyncRumorStore`, and the precise `castEvent` type mechanism are at Claude's discretion, guided by the migration doc, the two carry-forwards, and Phase 1–2 patterns.

### Deferred Ideas (OUT OF SCOPE)
None — `applesauce-common` genericization is Phase 4. Any signed-cast/common-cast rumor support beyond the one demonstrating `EventCast<Rumor>` test stays out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| RUMOR-03 | `RumorStore` accepts a rumor with a correct `id` and rejects a rumor with an incorrect `id` | Pattern 1 (`RumorStore` shape, verified against real `EventStoreOptions<E>`) + Code Examples "RumorStore.add() accept/reject" |
| RUMOR-04 | `RumorStore` streams rumors via `filters()`, returns `Rumor[]` from `timeline()`, and the latest replaceable rumor from `replaceable()` | Don't Hand-Roll table — confirmed `EventModels<E>`'s `filters()`/`timeline()`/`replaceable()` are already `E`-typed (Phase 2), no new code needed beyond the test |
| RUMOR-05 | `RumorStore` processes kind-5 delete rumors, removing matching stored rumors | Don't Hand-Roll table — confirmed `DeleteManager<E>` is already generic with no `sig` dependency; Code Examples "Kind-5 delete rumor" |
| RUMOR-06 | A custom `EventCast<Rumor>` works with `castEvent` against a rumor store | Pattern 2 (WR-01 fix) + Pattern 3 (store-bridging finding) + Common Pitfalls 1 & 2 — both empirically verified via compiled probes and a full `pnpm -r build` |
</phase_requirements>

## Summary

Phases 1–2 already genericized `EventStore`/`AsyncEventStore`, the model framework, and the cast subsystem over `StoreEvent`/`Rumor`. Phase 3's job is narrow and concrete: add a `RumorStore` convenience wrapper, prove the whole chain (verification, delete handling, models, casts) with rumor-typed tests, and settle the one open design question carried forward from Phase 2 — `castEvent`'s input typing (WR-01).


Separately, this research discovered a **second, previously undocumented gap** not caught by Phase 1/2 review: `castEvent(rumor, RumorNote, rumorStore)` — the literal call CONTEXT.md quotes as the target usage — does **not** type-check today when `rumorStore` is genuinely typed `EventStore<Rumor>` (i.e., `RumorStore`'s real shape), because `EventCast`'s inherited constructor's `store` parameter is hardcoded to bare `CastRefEventStore` (= `CastRefEventStore<NostrEvent>`), and `CastRefEventStore<E>` is invariant in `E` (a `Map` field inside `EventModels` makes it so). Parameterizing `EventCast`'s own `store` field over `T` to fix this was tried and empirically breaks `user.ts`'s `User.timeline$<T extends EventCast>(...)` generic (unrelated to rumors) — a real, verified ripple, not a hypothetical one. The low-risk resolution (already proven to compile) is a documented, localized bridge cast at the call site — `castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore)` — matching the exact "signedView"/`as unknown as NostrEvent` bridging convention already used throughout `casts/event.ts` and `event-store/delete-manager.ts`.

**Primary recommendation:** Fix WR-01 by splitting `castEvent` (public, sig-gated strict typing) from an internal `performCast` (loose, used only by `castEventStream`/`castTimelineStream`); accept the store-bridge-cast pattern for constructing rumor casts against a literal `RumorStore` instance and document it inline. Both fixes are proven zero-regression via an actual `pnpm -r build` + full test run in this research session (then reverted, leaving the tree clean for the planner/executor).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `RumorStore` convenience class | Core Store (in-process) | — | Thin subclass of `EventStore<Rumor>`; no I/O, no network |
| Rumor hash verification (`verifyRumor`) | Core Store | — | Pure function, already shipped (Phase 1, RUMOR-02) |
| Kind-5 delete handling for rumors | Core Store (`DeleteManager<E>`) | — | Already generic; no new logic needed |
| `castEvent` input typing (WR-01) | Core Store (cast subsystem) | — | Compile-time-only change; no runtime tier crosses |
| Rumor-typed cast test suite | Core Store (`__tests__/`) | — | In-process, no external dependency |

This phase is entirely within the "Core Store" tier (in-memory, synchronous, no relay/network/DB I/O) — there is no browser/SSR/API tier split to reason about here.

## Standard Stack

No new external dependencies. This phase is pure internal genericization work in `applesauce-core` (already on the workspace). No package installs, so the Package Legitimacy Audit section is not applicable.

### Core (existing, reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `nostr-tools` | (workspace-pinned) | `getEventHash`, `verifyEvent`, `UnsignedEvent` | Already the core's event-hashing/verification dependency (Phase 1) |
| `vitest` | (workspace-pinned) | Test runner | Already used for all `applesauce-core` tests |
| `rxjs` | (workspace-pinned) | Observable streams (`filters()`, `timeline()`) | Already the store's reactive substrate |

**Installation:** none required — this phase only edits existing `applesauce-core` source and tests.

## Package Legitimacy Audit

Not applicable — no new packages are installed in this phase.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────┐
                    │   RumorStore (new, Phase 3) │
                    │  extends EventStore<Rumor>  │
                    └──────────────┬──────────────┘
                                   │ super({ ...options, verifyEvent: verifyRumor })
                                   ▼
   caller.add(rumor) ──────► EventStore<Rumor>.add(event)
                                   │
                    ┌──────────────┼───────────────────────┐
                    ▼              ▼                        ▼
            verifyEvent()   kind===5? ─► DeleteManager<Rumor>   EventMemory<Rumor>
            (= verifyRumor)   .add(deleteRumor)                  .add(rumor)
              hash check         │  emits deleted$                    │
              reject on          ▼                                    ▼
              mismatch     handleDeleteNotification            database.add(rumor)
                             .remove(matching rumors)                 │
                                                                       ▼
                                                          insert$ / update$ / remove$
                                                                       │
                                                                       ▼
                                                    EventModels<Rumor> (filters/timeline/replaceable)
                                                                       │
                                                                       ▼
                                             caller.filters()/.timeline()/.replaceable() → Observable<Rumor[]>

   caller ──► castEvent(rumor, RumorNote, rumorStore) ──► CastEventInput<T> compile-time gate
                                   │                        (rumor rejected for signed-only casts,
                                   │                         accepted for EventCast<Rumor> subclasses)
                                   ▼
                         new RumorNote(rumor, bridgedStore) → cached on rumor via CASTS_SYMBOL
```

### Recommended Project Structure
```
packages/core/src/event-store/
├── event-store.ts          # existing EventStore<E> (unchanged)
├── rumor-store.ts          # NEW: RumorStore class
├── index.ts                # add `export * from "./rumor-store.js"`
└── __tests__/
    └── rumor-store.test.ts # NEW: RUMOR-03..06 test suite (per migration doc's Testing Checklist)

packages/core/src/casts/
├── cast.ts                 # MODIFY: split castEvent (strict) / performCast (loose, @internal)
└── __tests__/
    └── rumor-cast.test.ts   # EXISTS already (pre-dates this phase) — extend to use RumorStore

packages/core/src/observable/
└── cast-stream.ts          # MODIFY: castEventStream/castTimelineStream call performCast, not castEvent
```

### Pattern 1: `RumorStore` as a thin, verification-locking subclass

**What:** `RumorStore extends EventStore<Rumor>`, whose constructor always injects `verifyEvent: verifyRumor` and forbids the caller from overriding it (via `Omit<EventStoreOptions<Rumor>, "verifyEvent">`).
**When to use:** Any time a store needs to hold unsigned NIP-59 rumors (e.g., after unwrapping a gift wrap) while reusing every existing model/timeline/filter/cast/delete code path.
**Example (exact shape, confirmed against the current `EventStoreOptions<E>`/`EventStore<E>` signatures in `packages/core/src/event-store/event-store.ts`):**
```ts
// Source: .planning/rumor-store-migration.md "Store Shape", cross-checked against the
// current EventStoreOptions<E>/EventStore<E> constructor signature (verified in this session).
import { EventStore, EventStoreOptions } from "./event-store.js";
import { Rumor, verifyRumor } from "../helpers/event.js";

export class RumorStore extends EventStore<Rumor> {
  constructor(options?: Omit<EventStoreOptions<Rumor>, "verifyEvent">) {
    super({ ...options, verifyEvent: verifyRumor });
  }
}
```
[VERIFIED: packages/core/src/event-store/event-store.ts — `EventStoreOptions<E extends StoreEvent = NostrEvent>` and `EventStore`'s constructor both exist exactly as the migration doc assumes; the CORE-03 `"verifyEvent" in options` fix is already shipped (line 141), so `RumorStore`'s explicit `verifyEvent: verifyRumor` in the spread will always win over an omitted/undefined caller value.]

Export it from `packages/core/src/event-store/index.ts` alongside the other `export * from "./event-store.js"` lines — the file currently does `export * from` for every sibling module, so add one more line for `rumor-store.js`. It will then also surface from the top-level `packages/core/src/index.ts` (`export * from "./event-store/index.js"`), matching how `EventStore`/`AsyncEventStore` are already publicly exported.

**`AsyncRumorStore`:** Per CONTEXT.md's discretion note, do **not** add one unless a concrete need appears — `new AsyncEventStore<Rumor>({ database, verifyEvent: verifyRumor })` already covers the async case with no new class, and `AsyncEventStoreOptions<E>` (in `async-event-store.ts`) has the identical shape (`database` required, `verifyEvent?: (event: E) => boolean`).

### Pattern 2: Sig-gated `castEvent` input typing (resolves WR-01)

**What:** Tie `castEvent`'s accepted event type to whether the cast's own declared event type `T` requires a signature, not to `T` exactly.
**When to use:** This is the fix for the Phase 2 carry-forward — apply once, in `packages/core/src/casts/cast.ts`.

```ts
// Source: verified in this research session via compiled tsc probes (see Common Pitfalls below).
/**
 * If a cast's own declared event type requires a signature (NostrEvent-shaped), the input is
 * pinned to `NostrEvent` (rejects a rumor at compile time — fixes WR-01). Otherwise (a rumor-
 * shaped/sig-less T) the input stays a loose `StoreEvent` — deliberately not narrowed to the
 * cast's exact T (e.g. a literal `kind`), so a generic `Rumor` still satisfies a narrowed-kind
 * rumor cast; the cast's own constructor validates the narrower shape at runtime.
 */
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

And in `packages/core/src/observable/cast-stream.ts`, change both internal call sites from `castEvent(event, cls, store)` to `performCast(event, cls, store)` (import `performCast` from `../casts/cast.js` instead of importing `castEvent` from `../casts/index.js`). No other change to `castEventStream`/`castTimelineStream`'s own exported signatures is needed — they keep accepting a loose `StoreEvent`/`StoreEvent[]` stream, exactly per CONTEXT.md's instruction to keep the stream operators loose.

**Empirical verification performed in this session** (all reverted afterward, tree left clean):
- Applied this exact patch to `cast.ts` + `cast-stream.ts`.
- `pnpm --filter applesauce-core build` — clean.
- `pnpm --filter applesauce-core test` — 591/592 pass; the one failure is the `exports.test.ts` inline snapshot picking up the new `performCast` export (expected — the plan must run `vitest -u` or manually update that snapshot; this is not a defect).
- A compiled `@ts-expect-error` probe confirmed `castEvent(rumor, SignedOnlyCast, store)` (a cast reading `event.sig`) now correctly fails to compile — WR-01 is fixed.

`performCast` will appear in `applesauce-core`'s public export surface (via `casts/index.ts`'s `export * from "./cast.js"` → top-level `index.ts`) since there is no narrower re-export mechanism currently in use in that file (other internal-ish symbols like `CAST_REF_SYMBOL`/`CASTS_SYMBOL` already leak the same way). Document `performCast` as `@internal` in its JSDoc; this is a pre-existing, accepted convention in this codebase, not a new pattern.

### Pattern 3: Bridging a rumor store into `EventCast`'s constructor (NEW finding — not in Phase 1/2 review)

**What:** `EventCast<T>`'s inherited constructor is `constructor(event: T, store: CastRefEventStore)` — the `store` parameter is **hardcoded to bare `CastRefEventStore`** (= `CastRefEventStore<NostrEvent>`), independent of `T`. `CastRefEventStore<E>` is invariant in `E` (a `Map` field inside `EventModels` makes both directions of assignability fail), so a genuine `RumorStore`/`EventStore<Rumor>` instance is **not** structurally assignable to that parameter.

**Empirically confirmed in this session:**
```ts
class RumorNote extends EventCast<Rumor> { get text() { return this.event.content; } }
const rumorStore = new EventStore<Rumor>();
declare const rumor: Rumor;
castEvent(rumor, RumorNote, rumorStore); // ✗ does NOT compile today (probe6 in this session)
```
Error: `Argument of type 'typeof RumorNote' is not assignable to parameter of type 'CastConstructor<RumorNote, Rumor>'` — because `RumorNote`'s (inherited, unmodified) constructor's second param is bare `CastRefEventStore`, not `CastRefEventStore<Rumor>`.

**Why the "obvious" fix is a trap:** Parameterizing `EventCast`'s own `store` field to `CastRefEventStore<T>` was tried in this session. It requires bridging `this.store` to a `signedView`-style cast inside `author`/`$$ref` (fine, isolated), **but it also breaks** `packages/core/src/casts/user.ts`'s `User.timeline$<T extends EventCast>(...)` — a completely unrelated, NostrEvent-only generic method — because the generic bound `C extends EventCast<StoreEvent>` used throughout `CastConstructor`/`castEvent`/`castEventStream` implicitly assumes `EventCast<AnyE>` is a subtype of `EventCast<StoreEvent>`, which silently relied on `store`'s type being **constant** (not T-dependent) in the current code. Making `store` depend on `T` breaks that assumption for **every** existing cast (not just rumor casts), and even re-narrowing `user.ts`'s bound to `EventCast<NostrEvent>` did not resolve it (verified — the failure persisted identically). Fully fixing this requires restructuring `EventModels`'s internal `Map<ModelConstructor<...>>` field to not be invariant in `E` — a materially larger change than this phase's scope.

**Recommended resolution (proven, zero-ripple):** Use a documented, localized bridge cast at the call site, exactly matching the `signedView`/`as unknown as NostrEvent` convention already used in `casts/event.ts` and `event-store/delete-manager.ts`:
```ts
// Source: verified in this session (probe8) against the UNMODIFIED castEvent/CastConstructor.
import type { CastRefEventStore } from "applesauce-core/casts";

const rumorStore = new RumorStore();
const cast = castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore);
```
This compiles cleanly today (verified) because the bridge-cast makes `E` infer as `NostrEvent` (bare), matching `RumorNote`'s actual inherited constructor exactly — no changes to `EventCast`, `CastConstructor`, or `user.ts` are needed.

**Recommendation for the plan:** Write the RUMOR-06 test (`RumorStore` + custom `EventCast<Rumor>` + `castEvent`) using this bridge-cast pattern, with a one-line comment explaining why (mirroring this research's finding). Do **not** attempt to parameterize `EventCast`'s base `store` field in this phase — it is out of scope and would require touching `user.ts`'s unrelated generic and, likely, `EventModels`'s internal `Map` typing to do soundly. Flag this as a **new deferred item** for a future phase if fully generic `this.store`/`this.author` support inside a rumor cast becomes a real need (the migration doc's own literal example, `class RumorNote extends EventCast<Rumor> { get text() {...} }`, never calls `this.author`/`this.store`, so this gap does not block the migration doc's stated goal — only a stricter reading of CONTEXT.md's exact call-site wording).

### Anti-Patterns to Avoid
- **Don't re-litigate the input-typing fix per-cast:** apply the `CastEventInput<T>`/`performCast` split once, centrally, in `cast.ts` — not as ad-hoc casts scattered at call sites.
- **Don't try to make `RumorStore.add()` "smarter" about validation beyond hash-recompute:** per the migration doc's Deletion/Verification Policy, `RumorStore` only checks `id === getEventHash(rumor)`; authorization/decryption is a different layer's job (already handled upstream by gift-wrap unwrapping before the rumor ever reaches the store).
- **Don't add `AsyncRumorStore`** without a concrete consumer — `AsyncEventStore<Rumor>` already covers it (Claude's Discretion, migration doc explicitly allows deferring this).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rumor hash verification | A custom `getEventHash`/comparison routine | `verifyRumor` (already shipped, `packages/core/src/helpers/event.ts`) | Already implemented, tested indirectly via `getEventHash` from `nostr-tools/pure`; re-deriving it risks a subtly different serialization |
| Kind-5 delete handling for rumors | A parallel `RumorDeleteManager` | The existing generic `DeleteManager<E extends StoreEvent>` | Already generic (Phase 1); confirmed by code inspection it uses only `StoreEvent` fields (`pubkey`, `kind`, `created_at`, tag helpers) — no `sig` dependency anywhere in `delete-manager.ts` |
| Filtering/timeline/replaceable logic for rumors | A parallel `RumorModels`/`RumorTimelineModel` | The existing generic `EventModels<E>`/`TimelineModel<E>`/`ReplaceableModel<E>`/`FiltersModel<E>` | Already generic (Phase 2); confirmed by code inspection `event-models.ts`'s `filters()`/`timeline()`/`replaceable()` methods are declared `Observable<E>`/`Observable<E[]>`/`Observable<E \| undefined>` with no `NostrEvent`-specific casts |

**Key insight:** Every piece of infrastructure `RumorStore` needs already exists and is already generic — this phase is almost entirely additive (one new class, a few tests) plus one focused compile-time-typing fix. Resist the temptation to add rumor-specific logic anywhere outside `rumor-store.ts` and `cast.ts`.

## Runtime State Inventory

Not applicable — this is not a rename/refactor/migration phase. `RumorStore` is a new, additive class; no existing runtime state (databases, service configs, OS registrations, secrets, build artifacts) references anything being renamed.

## Common Pitfalls

### Pitfall 1: The "obvious" `castEvent` fix over-tightens real narrowed-kind rumor casts
**Why it happens:** `T` for these casts is narrower than what real call sites naturally produce (kind is only checked/narrowed inside the constructor at runtime, e.g. `isValidDirectInviteRumor`, not at the type level at the call site).
**How to avoid:** Use the sig-gated `CastEventInput<T>` (Pattern 2 above) instead of the exact-`T` conditional — it only restricts on the presence of `sig`, leaving `kind`/other fields loose, matching how the constructor already re-validates the narrower shape at runtime.

### Pitfall 2: Assuming `castEvent(rumor, RumorNote, rumorStore)` "just works" against a real `RumorStore`
**What goes wrong:** The existing `rumor-cast.test.ts` (pre-dating this phase) passes `new EventStore()` (bare, NostrEvent-default) as the store, which silently sidesteps the real gap — a genuine `RumorStore`/`EventStore<Rumor>` does not type-check as the `store` argument, because `CastRefEventStore<E>` is invariant in `E`.
**Why it happens:** `EventCast`'s constructor hardcodes its `store` param to bare `CastRefEventStore`, and this is load-bearing for the rest of the cast machinery's generic bounds (see Pattern 3) — it cannot simply be parameterized by `T` without rippling into `user.ts`.
**How to avoid:** Use the documented bridge cast (`rumorStore as unknown as CastRefEventStore`) at the point a rumor cast is constructed against a literal `RumorStore`. Write the RUMOR-06 test this way from the start rather than discovering the compile error mid-implementation.
**Warning signs:** `tsc` error `Argument of type 'typeof <YourCast>' is not assignable to parameter of type 'CastConstructor<<YourCast>, Rumor>'` whenever a `RumorStore`-typed variable (not a bare/default `EventStore()`) is passed as `castEvent`'s third argument.

### Pitfall 3: `NostrEvent | undefined` unused-import / snapshot drift after touching `casts/cast.ts`
**What goes wrong:** Adding `performCast` as a new export shifts `packages/core/src/__tests__/exports.test.ts`'s inline snapshot (it enumerates every export alphabetically) — this is expected, not a regression.
**Why it happens:** `casts/index.ts` does `export * from "./cast.js"`, so any new top-level export in `cast.ts` surfaces in the package's public API list.
**How to avoid:** Run `pnpm --filter applesauce-core test -u` (or the vitest snapshot-update flag) once after adding `performCast`, and include the updated snapshot in the same commit as the `cast.ts` change.

## Code Examples

### `RumorStore.add()` accept/reject (RUMOR-03)
```ts
// Source: pattern mirrors packages/core/src/event-store/__tests__/verify-event-option.test.ts
import { describe, expect, it } from "vitest";
import { RumorStore } from "../rumor-store.js";
import { getEventHash } from "../../helpers/event.js";

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
```

### Kind-5 delete rumor removes matching stored rumor (RUMOR-05)
```ts
// Source: pattern mirrors packages/core/src/event-store/__tests__/delete-manager.test.ts,
// applied through RumorStore instead of a bare DeleteManager.
const store = new RumorStore();
store.add(rumor); // stored
const deleteRumor = { kind: 5, pubkey: rumor.pubkey, created_at: rumor.created_at + 1,
  content: "", tags: [["e", rumor.id]], id: "" };
deleteRumor.id = getEventHash(deleteRumor);
store.add(deleteRumor);
expect(store.getEvent(rumor.id)).toBeUndefined();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Signed-only `EventStore` (bare `NostrEvent`) | Generic `EventStore<E extends StoreEvent = NostrEvent>` | Phase 1 (this milestone) | `RumorStore` is now possible as a thin subclass rather than a parallel reimplementation |
| `castEvent(event: NostrEvent, ...)` | `castEvent(event: StoreEvent, ...)` (Phase 2), now sig-gated `CastEventInput<T>` (Phase 3, this research) | Phase 2 → Phase 3 | Restores a compile-time guardrail that Phase 2's necessary widening had dropped |

**Deprecated/outdated:** none — this phase does not remove any public API; it only adds `RumorStore` and tightens `castEvent`'s input type (a strictly safer change: rejects more, accepts everything it did before for the cases that matter).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No other package outside this monorepo (i.e., a downstream consumer of the published `applesauce-core` npm package) calls `castEvent` directly with a rumor-typed cast in a way this session's `pnpm -r build` couldn't observe | Package Legitimacy / Common Pitfalls | An external consumer's build could break on the stricter `castEvent` signature; mitigated by the change being additive-restrictive only (rejects previously-unsafe calls, doesn't change accepted-call shapes for existing signed-cast users) — flagged in CONTEXT.md's requirement to run `pnpm -r build` as the safety net for *this* repo |
| A2 | `performCast` being publicly exported (via `casts/index.ts`'s `export *`) is acceptable, matching the existing `CAST_REF_SYMBOL`/`CASTS_SYMBOL` precedent, rather than requiring a narrower re-export scheme | Pattern 2 | Low — cosmetic API-surface concern only; no functional risk. If the team wants tighter control, `casts/index.ts` would need to switch from `export *` to named re-exports, a larger, out-of-scope change |

**If this table is empty:** N/A — see above; both entries are low-risk and don't gate planning.

## Open Questions

None blocking. One discretionary item for the planner to explicitly decide (already framed in CONTEXT.md as Claude's Discretion): whether the RUMOR-06 test should ALSO add a documented `asCastStore()`/similar tiny helper (to avoid repeating the `as unknown as CastRefEventStore` bridge at every call site) or just inline the bridge cast once in the test with a comment. Given there is currently exactly one call site that needs it (the new test), inlining with a comment is the recommended default — add a helper only if a second real call site appears (e.g. in Phase 4's `applesauce-common` rumor casts).

## Environment Availability


## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-pinned; `applesauce-core`'s `package.json` `test` script: `vitest run --passWithNoTests`) |
| Config file | none dedicated — uses the workspace root Vitest config/defaults (existing 53 test files in `applesauce-core` already run this way) |
| Quick run command | `pnpm --filter applesauce-core test -- rumor-store` (or `-- rumor-cast` for the cast test) |
| Full suite command | `pnpm --filter applesauce-core test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RUMOR-03 | `RumorStore.add()` accepts a correct-id rumor, rejects an incorrect-id rumor | unit | `pnpm --filter applesauce-core test -- rumor-store` | ❌ Wave 0 — `event-store/__tests__/rumor-store.test.ts` new |
| RUMOR-04 | `filters()` streams rumors, `timeline()` returns `Rumor[]`, `replaceable()` returns latest replaceable rumor | unit | `pnpm --filter applesauce-core test -- rumor-store` | ❌ Wave 0 — same new file |
| RUMOR-05 | Kind-5 delete rumor removes matching stored rumor | unit | `pnpm --filter applesauce-core test -- rumor-store` | ❌ Wave 0 — same new file |
| RUMOR-06 | Custom `EventCast<Rumor>` works with `castEvent` against a `RumorStore` | unit + type-level | `pnpm --filter applesauce-core test -- rumor-cast` | ⚠️ Partial — `casts/__tests__/rumor-cast.test.ts` already exists (pre-dates this phase) but uses a bare `new EventStore()`, not `RumorStore`; extend it, don't replace |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-core test -- <touched-area>`
- **Per wave merge:** `pnpm --filter applesauce-core test` (full suite) + `pnpm --filter applesauce-core build`
- **Phase gate:** `pnpm --filter applesauce-core test` + `build` green, **plus** a full `pnpm -r build`, since `castEvent`'s public signature changes (per CONTEXT.md's explicit instruction and this research's confirmed downstream-ripple risk). This research already ran that exact gate successfully once (then reverted) — the planner/executor should expect it to pass again when the same fix is reapplied.

### Wave 0 Gaps
- [ ] `packages/core/src/event-store/rumor-store.ts` — the `RumorStore` class itself
- [ ] `packages/core/src/event-store/__tests__/rumor-store.test.ts` — covers RUMOR-03, RUMOR-04, RUMOR-05
- [ ] Extend `packages/core/src/casts/__tests__/rumor-cast.test.ts` — covers RUMOR-06 against a real `RumorStore` (not just bare `EventStore()`), using the bridge-cast pattern
- [ ] `packages/core/src/__tests__/exports.test.ts` snapshot update (after adding `performCast`/`RumorStore`/`CastEventInput` exports)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Not applicable — `RumorStore` has no authentication surface |
| V3 Session Management | No | Not applicable |
| V4 Access Control | No | Not applicable — no authorization decisions made in this phase |
| V5 Input Validation | Yes | `verifyRumor` (hash recompute) is the store's only integrity check; this phase does not add new input parsing |
| V6 Cryptography | Yes (pre-existing, reused) | `getEventHash` from `nostr-tools/pure` — never hand-roll event-hash serialization; already the case pre-Phase-3 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A rumor with a forged/mismatched `id` being accepted into a `RumorStore` | Tampering | `verifyRumor`'s `getEventHash(rumor) === rumor.id` check, wired as `RumorStore`'s non-overridable default verifier (this is precisely RUMOR-03's acceptance criterion) |
| A signed-only cast reading `.sig` on an unsigned rumor at runtime (`TypeError`) | Tampering / Denial of Service (crash) | The `CastEventInput<T>` sig-gated `castEvent` typing fixed in this phase — catches this at compile time instead of runtime |
| Silently disabling verification via `new RumorStore({ verifyEvent: undefined })` | Tampering | Not exploitable for `RumorStore` specifically — `Omit<EventStoreOptions<Rumor>, "verifyEvent">` in its constructor type statically forbids callers from passing `verifyEvent` at all, so the CORE-03 "explicit undefined disables verification" edge case (already accepted for base `EventStore`, per Phase 1/2 security notes) cannot occur through `RumorStore`'s own constructor |

## Sources

### Primary (HIGH confidence)
- `packages/core/src/event-store/event-store.ts`, `async-event-store.ts` — read in full this session; confirmed `EventStoreOptions<E>`/`AsyncEventStoreOptions<E>` shapes and the CORE-03 fix are exactly as the migration doc assumes.
- `packages/core/src/casts/cast.ts`, `event.ts`, `user.ts`, `packages/core/src/observable/cast-stream.ts` — read and empirically modified/reverted in this session to validate the WR-01 fix and the store-bridging finding.
- `packages/core/src/event-store/delete-manager.ts`, `interface.ts` — confirmed `DeleteManager<E>` is already fully generic with no `NostrEvent`/`sig` dependency.

### Secondary (MEDIUM confidence)
- `.planning/rumor-store-migration.md` — the maintainer's authoritative design spec (treated as locked design per CONTEXT.md, cross-checked against the actual code where the doc makes verifiable claims).

### Tertiary (LOW confidence)
- None — every non-trivial claim in this research was verified against the actual codebase or a compiled probe in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all reused pieces read directly from source.
- Architecture: HIGH — `RumorStore`'s shape and the `castEvent` fix were both compiled and tested against the real workspace, not just reasoned about.
- Pitfalls: HIGH — both pitfalls (over-tightening WR-01's naive fix, and the store-invariance gap) were discovered and confirmed via actual compile errors in this session, not inferred from documentation.

**Research date:** 2026-07-08
**Valid until:** Until Phase 3 is implemented (this research directly targets its exact scope; no external drift expected within normal implementation timelines — internal-only TypeScript changes, no third-party version dependencies).
