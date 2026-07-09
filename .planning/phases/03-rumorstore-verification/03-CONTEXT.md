# Phase 3: RumorStore & verification - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Auto-generated (design is fully specified by the maintainer's migration doc — no user grey-areas; discuss skipped)

<domain>
## Phase Boundary

Deliver the `RumorStore` convenience class in `applesauce-core` with rumor verification and kind-5 delete handling, and prove the whole core generic migration (Phases 1–2) end-to-end with rumor-typed tests. This is the **Part A gate** — `applesauce-common` work (Phase 4) begins only after `applesauce-core` builds and the rumor tests pass.

In scope: `RumorStore` (+ possibly `AsyncRumorStore` if warranted), wiring `verifyRumor` as the rumor store's default verifier, confirming kind-5 delete rumors remove matching stored rumors, and a focused rumor test suite (store add accept/reject, `getEvent`/`filters`/`timeline`/`replaceable`, delete, and a custom `EventCast<Rumor>` used via `castEvent`).

Out of scope: genericizing `applesauce-common` helpers/casts (Phase 4).
</domain>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/rumor-store-migration.md` — the maintainer's authoritative design spec for the whole milestone. Phase 3 implements its "Store Shape", "Deletion Policy", "Verification Policy", "Genericize Core Casts" (example usage), and "Testing Checklist" sections. Treat it as LOCKED design.
- `.planning/phases/01-generic-store-foundation/deferred-items.md` — item #2 **WR-01 (owned by THIS phase)**: `EventStore`'s default verifier rejects unsigned rumors; `RumorStore` resolves it by passing `verifyRumor` as its default verifier.
- `.planning/phases/02-generic-models-casts/deferred-items.md` — item #1 **WR-01 (owned by THIS phase)**: `castEvent`'s input type does not currently exclude a rumor from a signed-only cast. This phase exercises `castEvent(rumor, RumorNote, rumorStore)` for the first time (success criterion 4) and MUST settle the input typing so a custom `EventCast<Rumor>` works AND a signed-only cast rejects a rumor at compile time.
</canonical_refs>

<decisions>
## Implementation Decisions

### RumorStore shape (LOCKED by migration doc)
- `RumorStore extends EventStore<Rumor>`; constructor takes `Omit<EventStoreOptions<Rumor>, "verifyEvent">` and calls `super({ ...options, verifyEvent: verifyRumor })` so a rumor store always verifies via hash-recompute and callers cannot accidentally override it.
- Mirror for async only if needed: prefer `AsyncEventStore<Rumor>` directly; add `AsyncRumorStore` only if a concrete need appears.

### Verification policy (LOCKED)
- Default signed `EventStore` keeps `nostr-tools/pure.verifyEvent`. `RumorStore` uses `verifyRumor` by default. The Phase 1 CORE-03 fix (`"verifyEvent" in options` honoring explicit `undefined`) is already shipped.
- Acceptance: `RumorStore.add()` accepts a rumor whose `id` matches its serialized contents and rejects one with an incorrect `id`.

### Deletion policy (LOCKED)
- Rumor stores process kind-5 delete rumors exactly as signed event stores do. `DeleteManager` is already generic (Phase 1), so this should require little/no new logic — verify with a test that a kind-5 delete rumor removes matching stored rumors.

### Casts (this phase settles Phase 2 WR-01)
- A custom `EventCast<Rumor>` (e.g. `class RumorNote extends EventCast<Rumor>`) must work with `castEvent(rumor, RumorNote, rumorStore)`. Decide `castEvent`'s input typing here with real usage in hand: tie the input to the cast's declared `EventCast<T>` so a rumor is accepted by a rumor cast and rejected by a signed-only cast at compile time — while keeping the runtime-guarded stream operators (`castEventStream`/`castTimelineStream`) loose. Do NOT regress existing signed-cast call sites; verify with the full `pnpm -r build`.

### Claude's Discretion
Exact test file organization, whether to add `AsyncRumorStore`, and the precise `castEvent` type mechanism are at Claude's discretion, guided by the migration doc, the two carry-forwards, and Phase 1–2 patterns.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 1–2)
- `EventStore<E extends StoreEvent = NostrEvent>`, `AsyncEventStore<E>`, all event-store interfaces, the 4 managers (incl. generic `DeleteManager`), and the 11 structural helpers are generic with `NostrEvent` defaults.
- `StoreEvent`, `Rumor`, `verifyRumor` are exported from `packages/core/src/helpers/event.ts`.
- The model framework (`EventModels<E>`, `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel`) and cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `castEvent`, `castEventStream`, `castTimelineStream`) are generic — so `EventStore<Rumor>` already returns `Rumor`-typed observables (verified by the Phase 2 type probe).

### Integration Points
- `RumorStore` lives alongside `EventStore` in `packages/core/src/event-store/`. Rumor tests go in `packages/core/src/event-store/__tests__/`.
- Phase gate: `pnpm --filter applesauce-core test` + `build` green (Part A proven), plus a full `pnpm -r build` since this phase may touch `castEvent`'s public signature (the Phase 1/2 downstream-inference lesson).
</code_context>

<specifics>
## Specific Ideas

- Follow the migration doc's Testing Checklist verbatim as the success-criteria test set; add type-level coverage where practical so `tsc` catches regressions.
- Per-change single-sentence changesets per CLAUDE.md; `RumorStore` is a new public export → `minor` bump on `applesauce-core`.
</specifics>

<deferred>
## Deferred Ideas

None — `applesauce-common` genericization is Phase 4. Any signed-cast/common-cast rumor support beyond the one demonstrating `EventCast<Rumor>` test stays out of scope.
</deferred>
