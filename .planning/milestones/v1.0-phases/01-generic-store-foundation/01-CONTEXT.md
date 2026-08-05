# Phase 1: Generic store foundation - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the core store and its structural helpers generic (`E extends StoreEvent = NostrEvent`) and introduce the rumor type + verifier, with **zero behavior change for default signed `NostrEvent` stores**.

**In scope:**
- Genericize `EventStore<E>` and `AsyncEventStore<E>` (CORE-01, CORE-02).
- Constructor honors explicit `verifyEvent: undefined` via `"verifyEvent" in options` (CORE-03).
- Genericize structural helpers over `E extends StoreEvent` (CORE-04): `getEventUID`, `getReplaceableAddress`, `getReplaceableIdentifier`, `getIndexableTags`, `matchFilter`/`matchFilters`, `getExpirationTimestamp`, `eventMatchesPointer`, `addSeenRelay`/`getSeenRelays`/`isFromRelay`.
- Genericize store/database/manager interfaces & managers (CORE-05): `DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`, and the `IEventStore*`/`IAsyncEventStore*`/`IEventDatabase*`/`IEventMemory`/`IDeleteManager`/`IAsyncDeleteManager`/`IExpirationManager`/`IEventClaims`/`IEventSubscriptions`/`IMissingEventLoader` interfaces.
- Export `StoreEvent`, `Rumor`, and `verifyRumor` from `packages/core/src/helpers/event.ts` (RUMOR-01, RUMOR-02). *(Types already exist; `verifyRumor` is new.)*
- Add a focused unit test for `verifyRumor`.

**Out of scope (this phase):**
- Model framework & base models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) — Phase 2.
- Model-layer interfaces `Model`, `ModelConstructor`, `ModelEventStore` — **deferred to Phase 2** (see D-02).
- Cast infrastructure genericization — Phase 2 (note: `packages/core/src/casts/event.ts` already uses `StoreEvent` from prior work).
- `RumorStore` class, kind-5 delete rumor tests, `EventCast<Rumor>` tests — Phase 3.
- Any `applesauce-common` changes — Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Verification behavior
- **D-01:** The `console.warn` in the `verifyEvent` setter **stays** — it fires whenever `verifyEvent` ends up `undefined`, including intentional `verifyEvent: undefined`. Rationale: rumor consumers use `RumorStore` (Phase 3), which supplies its own `verifyRumor`; a default `EventStore` running with no verifier is the unusual case worth surfacing. The CORE-03 fix (`if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;`) still makes explicit `undefined` actually disable verification — it just keeps warning.

### Phase boundary / interface split
- **D-02:** `Model`, `ModelConstructor`, and `ModelEventStore` are **deferred to Phase 2**, genericized alongside the models. Phase 1's interface work is limited to store, database, manager, memory, claims, subscriptions, and missing-loader interfaces (the non-model set from the migration doc). This matches CORE-05's named surface and keeps the model layer as one coherent Phase 2 change.

### Testing
- **D-03:** Add a focused unit test for `verifyRumor` in Phase 1 (correct `id` → `true`, tampered/incorrect `id` → `false`) so success criterion #3 is proven where the verifier is introduced. All `RumorStore` accept/reject and behavioral tests remain in Phase 3.

### Verifier / options typing (locked by migration doc)
- **D-04:** Keep `= NostrEvent` defaults on every generic parameter so `new EventStore()` and all downstream code compile unchanged. The store's `verifyEvent` option/property becomes generic over the store's `E` (so `RumorStore`'s `verifyRumor` type-checks), per the migration doc's store shape. Prefer generic defaults over overload-heavy compatibility wrappers.

### Claude's Discretion
- Exact ordering of the type migration (helpers → interfaces → managers → store) and how generic parameters thread through internal method signatures are left to the planner/executor, provided defaults stay `NostrEvent` and behavior is unchanged.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative migration spec
- `.planning/rumor-store-migration.md` — the authoritative spec for the whole milestone. Defines `StoreEvent`/`Rumor` types, `verifyRumor`, the generic store shape, the `"verifyEvent" in options` constructor fix, the exact helper list, and the interface/manager genericization list. **Read this first.**

### Milestone planning
- `.planning/PROJECT.md` §Key Decisions — genericize-not-fork, `RumorStore` convenience class, hash-only rumor verification, `= NostrEvent` defaults, Part A → Part B sequencing.
- `.planning/REQUIREMENTS.md` §Core Store / §Rumor Store — CORE-01…05, RUMOR-01, RUMOR-02 acceptance wording.
- `.planning/ROADMAP.md` §"Phase 1: Generic store foundation" — goal + 5 success criteria.

### Existing code (Phase 1 touch points)
- `packages/core/src/helpers/event.ts` — `StoreEvent` & `Rumor` already defined here; add `verifyRumor` here. Uses `getEventHash` (re-exported from `nostr-tools/pure`).
- `packages/core/src/event-store/event-store.ts` — `EventStore` class, `EventStoreOptions`, the `verifyEvent` getter/setter + warning, constructor (`if (options?.verifyEvent)` → change to `"verifyEvent" in options`).
- `packages/core/src/event-store/interface.ts` — the `IEventStore*` interface set to genericize.
- `packages/core/src/casts/event.ts` — already generic over `StoreEvent` (prior commit); reference for the `E extends StoreEvent = NostrEvent` pattern to mirror.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StoreEvent` and `Rumor` structural types already exist and are exported from `helpers/event.ts` — RUMOR-01 is essentially already satisfied; only `verifyRumor` (RUMOR-02) is net-new.
- `getEventHash` is already re-exported from `helpers/event.ts` — `verifyRumor` is a one-liner: `getEventHash(rumor) === rumor.id`.
- `packages/core/src/casts/event.ts` already establishes the `E extends StoreEvent = NostrEvent` generic convention (from the recent "Genericize EventCast subsystem" commit) — copy that pattern for the store/interfaces.

### Established Patterns
- Every generic parameter defaults to `NostrEvent` (`E extends StoreEvent = NostrEvent`) so existing call sites and `new EventStore()` are untouched — this is the migration's core compatibility mechanism.
- `verifyEvent` is currently typed `(event: NostrEvent) => boolean`; genericizing the store means it becomes `(event: E) => boolean` on the options/property.

### Integration Points
- Store constructor `verifyEvent` handling is the one intentional **runtime** change (`"verifyEvent" in options`); everything else is a type-level migration and must not alter runtime behavior.
- Watch `NostrEvent` references in observable helpers (`claimEvents`, `claimLatest`, `mapEventsToStore`, `mapEventsToTimeline`) — flagged by the migration doc as places the generic type must thread through cleanly (some may surface in Phase 2).

</code_context>

<specifics>
## Specific Ideas

- `verifyRumor` shape is fixed by the spec:
  ```ts
  export function verifyRumor(rumor: Rumor): boolean {
    return getEventHash(rumor) === rumor.id;
  }
  ```
- Constructor fix is fixed by the spec:
  ```ts
  if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;
  ```

</specifics>

<deferred>
## Deferred Ideas

- **Model framework + `Model`/`ModelConstructor`/`ModelEventStore` interfaces** → Phase 2 (per D-02).
- **Cast infrastructure genericization** → Phase 2 (CORE-07). Partial work already landed for `casts/event.ts`.
- **`RumorStore` class, kind-5 delete rumor handling, `EventCast<Rumor>` behavioral tests** → Phase 3 (RUMOR-03…06, Part A gate).
- **`applesauce-common` helpers/casts** → Phase 4 (gated on Phase 3).

None of these were scope creep — they are explicit later-phase requirements surfaced during discussion.

</deferred>

---

*Phase: 1-Generic store foundation*
*Context gathered: 2026-07-08*
