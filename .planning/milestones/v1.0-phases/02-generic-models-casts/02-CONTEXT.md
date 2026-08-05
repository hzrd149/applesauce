# Phase 2: Generic models & casts - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss detected pure type-genericization, no user-facing decisions)

<domain>
## Phase Boundary

Genericize the reactive model framework and cast infrastructure in `applesauce-core` so `EventStore<E>` returns `E`-typed observables and casts compose over any store event, while default signed-`NostrEvent` behavior is byte-for-byte unchanged.

In scope:
- Core models: `EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel` — made generic, returning `E`-typed observables.
- Cast infrastructure: `CastRefEventStore<E>`, `EventCast<E>`, `castEvent`, `castEventStream`, `castTimelineStream` — made generic with `NostrEvent` defaults.

Out of scope: the `RumorStore` convenience class and rumor verification wiring (Phase 3); `applesauce-common` helpers/casts (Phase 4).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — this is a pure type-genericization phase with no user-facing behavior. Use the ROADMAP goal, success criteria, Phase 1's established patterns, and codebase conventions to guide decisions.

### Locked constraints (carried from Phase 1, and from the milestone's zero-behavior-change contract)
- **Default `E = NostrEvent` everywhere.** Every generic parameter uses `E extends StoreEvent = NostrEvent` so existing signed-event call sites resolve to `NostrEvent` with no source changes — exactly the Phase 1 pattern.
- **Existing signed-event model and cast tests MUST pass without changes.** No test edits to accommodate the genericization; if a test needs editing, that signals a behavior change and must be reconsidered.
- **Localize bridge casts.** Where a generic value must be passed into a still-non-generic or `NostrEvent`-only API, follow the Phase 1 precedent: a narrow `as unknown as NostrEvent` / `signedView`-style bridge confined to call sites that read only `StoreEvent` structural fields — never broaden a public signature to hide a mismatch.
- **Resolve the D-02 seam (code-review WR-02 from Phase 1).** Phase 1 left `IEventStore<E>`/`IAsyncEventStore<E>` extending the un-parameterized `IEventSubscriptions` and `IEventModelMixin<IEventStore>`, so `E` is currently dropped from subscription return types (`timeline()`, `event()`, `filters()` return `NostrEvent`, not `E`). This phase genericizes the model framework and SHOULD thread `E` through `IEventSubscriptions<E>` / `IEventModelMixin` (and `EventModels`) so the currently-dead type parameter becomes live and `EventStore<E>` truly returns `E`-typed observables. See `.planning/phases/01-generic-store-foundation/deferred-items.md` item #2 (WR-02).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Established Patterns (from Phase 1)
- Phase 1 genericized `EventStore<E extends StoreEvent = NostrEvent>`, `AsyncEventStore<E>`, all event-store interfaces (`interface.ts`), the four managers, and the 11 structural helpers — all with `NostrEvent` defaults and the `signedView` bridge-cast pattern (`casts/event.ts`).
- `StoreEvent`, `Rumor`, and `verifyRumor` are exported from `packages/core/src/helpers/event.ts`.
- The model framework lives under `packages/core/src/models/` (and `event-store/interface.ts` declares `IEventSubscriptions`, `IEventModelMixin`, `Model`, `ModelConstructor`, `ModelEventStore`, which Phase 1 intentionally left un-parameterized as the D-02 seam).
- Cast infrastructure lives under `packages/core/src/casts/`.

### Integration Points
- `EventStore`/`AsyncEventStore` already carry `E`; this phase makes their `EventModels` superclass and the subscription/model mixin interfaces generic so `E` flows out through the observable-returning methods.
- Verification bar: `pnpm --filter applesauce-core build` (type-checks generic model/cast surface) + `pnpm --filter applesauce-core test` (existing suite green), plus a full `pnpm build` to confirm no downstream package (loaders/relay/react/common) regresses — the Phase 1 post-merge lesson (bare generic instantiation at contextually-typed call sites can silently infer the constraint instead of the default).
</code_context>

<specifics>
## Specific Ideas

- Add per-change changesets under `.changeset/` following the repo's one-sentence rule (see CLAUDE.md); pick the smallest applicable bump (`minor` for the new generic surface, `patch` for internal fixes).
- Watch for the Phase 1 downstream-inference trap: after genericizing, run the FULL workspace build (`pnpm -r build`), not just `applesauce-core`, before declaring the phase done.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Rumor store wiring → Phase 3; common-package genericization → Phase 4.)
</deferred>
