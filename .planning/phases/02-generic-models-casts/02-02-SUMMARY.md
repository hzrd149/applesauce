---
phase: 02-generic-models-casts
plan: 02
subsystem: core
tags: [typescript, generics, rxjs, event-store, nostr]

# Dependency graph
requires:
  - phase: 02-generic-models-casts
    provides: "Plan 01: claimEvents<E>/claimLatest<E>, and EventModel<E>/ReplaceableModel<E>/TimelineModel<E>/FiltersModel<E> generic over E extends StoreEvent = NostrEvent, with a localized store bridge-cast standing in for Model/ModelEventStore"
provides:
  - "IEventModelMixin<E, TStore>/ModelEventStore<E,TStore>/Model<T,E,TStore>/ModelConstructor<T,Args,E,TStore> threading E in the second position, NostrEvent-defaulted"
  - "EventModels<E, TStore> implements IEventSubscriptions<E>; filters()/event()/replaceable()/addressable()/timeline() return E-typed observables"
  - "EventStore<E>/AsyncEventStore<E> extend EventModels<E> (D-02 seam closed) — subscription methods now genuinely E-typed instead of dropping to NostrEvent"
  - "Full-workspace pnpm -r build confirmed green under EventModels' second type parameter, including the 6 zero-type-param declare-module augmentations (RESEARCH Pitfall 2)"
affects: [02-generic-models-casts (Plan 03 — cast infrastructure CastRefEventStore<E>/castEvent<E> builds directly on EventModels<E>)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit <E, TStore> param on IEventModelMixin (rather than relying on TStore alone) when a bare TStore constraint (`IEventStore | IAsyncEventStore`, defaulting to NostrEvent) cannot absorb an abstract E — tsc surfaces this as a TS2344 'not assignable to constraint' at the exact call site"
    - "Let EventModels' own TStore parameter default (the IEventStore<E> | IAsyncEventStore<E> union) on EventStore<E>/AsyncEventStore<E>'s extends clause rather than narrowing to a single store shape, to preserve assignability to every downstream bare EventModels<E>/CastRefEventStore<E> consumer"
    - "Localized ModelConstructor<T,Args,E,TStore> bridge cast at an EventModels method call site when the underlying model function is intentionally NostrEvent-only (profile()/contacts()/mailboxes() calling ProfileModel/ContactsModel/MailboxesModel)"

key-files:
  created:
    - .changeset/genericize-event-models.md
  modified:
    - packages/core/src/event-store/interface.ts
    - packages/core/src/event-store/event-models.ts
    - packages/core/src/event-store/event-store.ts
    - packages/core/src/event-store/async-event-store.ts
    - packages/core/src/models/base.ts
    - packages/common/src/observable/filter-timeline-by-mutes.ts

key-decisions:
  - "IEventModelMixin gained an explicit <E, TStore> parameter (not just TStore alone) — RESEARCH Open Question 1's 'simpler first' attempt (filling ModelConstructor's E slot with StoreEvent inside IEventModelMixin's body) failed to type-check: TStore's own constraint (`IEventStore | IAsyncEventStore`, bare = NostrEvent default) rejected an abstract IEventStore<E>/IAsyncEventStore<E>, so both IEventStore<E>/IAsyncEventStore<E> extends clauses now pass IEventModelMixin<E, IEventStore<E>>/IEventModelMixin<E, IAsyncEventStore<E>>, exactly the plan's documented fallback path"
  - "models/base.ts's four base models' Model<T> return annotations (Plan 01's deliberately-1-arg form) were widened to Model<T, E> in this plan — once Model/ModelConstructor genuinely thread E, a bare 1-arg Model<E> silently resolved its internal event-store type to the NostrEvent default instead of the function's own E, breaking EventModels' filters()/event()/replaceable()/timeline() calls (this.model(FiltersModel<E>, ...) etc.). This was anticipated by the plan's own read_first note (models/base.ts 'Plan 01 result') but not spelled out as an explicit file edit"
  - "EventStore<E>/AsyncEventStore<E> extend bare EventModels<E> (letting TStore default to the IEventStore<E>|IAsyncEventStore<E> union) rather than the plan's literally-specified EventModels<E, IEventStore<E>>/EventModels<E, IAsyncEventStore<E>> — pinning TStore to a single store shape broke every downstream consumer of bare EventModels<E>/CastRefEventStore (discovered via the mandated pnpm -r build gate: applesauce-wallet's nut-wallet.ts castUser()/ActionRunner() call sites failed because EventStore<E>'s models map became incompatible with the union TStore those consumers expect). This is the Task 2 remedy-priority-1 'in-core fix' — resolves the regression without touching any downstream file, and the D-02 seam (E-typed subscription returns) is unaffected either way"
  - "packages/common/src/observable/filterTimelineByMutes (not in this plan's files_modified) needed a one-line arity fix: its eventStore param was typed IEventModelMixin<IEventStore | IAsyncEventStore> (bare, 1-arg), which became under-arity once IEventModelMixin gained its <E> parameter. Pinned to IEventModelMixin<NostrEvent, IEventStore | IAsyncEventStore> since MuteModel (its sole model() call) is intentionally NostrEvent-only and out of this phase's scope — exactly the Task 2-mandated 'restore arity' remedy for a downstream regression caught by the full-workspace build gate"

patterns-established:
  - "When a type gains a new generic parameter that a sibling/dependent type's constraint cannot structurally absorb (TS2344 'does not satisfy the constraint'), add the explicit parameter to the dependent type rather than trying to route it through an existing bare constraint — verified live via tsc, not assumed"
  - "Prefer widening a generic default (removing an explicit narrower type argument, letting the class's own default apply) over hand-specifying a narrower argument, when the narrower argument breaks downstream consumers that rely on the wider default — this keeps the fix localized to the class declaration itself rather than requiring casts scattered across every consumer"

requirements-completed: [CORE-06]

coverage:
  - id: D1
    description: "IEventSubscriptions<E>/EventModels<E,TStore> subscription methods (event/replaceable/addressable/filters/timeline) return E-typed observables instead of dropping to NostrEvent — the literal WR-02 fix"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (592/592, event-store.test.ts + async-event-store.test.ts exercise .event()/.replaceable()/.timeline()/.filters() unchanged)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-check of the full generic surface)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Model<T,E,TStore>/ModelConstructor<T,Args,E,TStore>/ModelEventStore<E,TStore> thread E in the second position with NostrEvent defaults; EventModels<E,TStore> extends/implements chain closes the D-02 seam (EventStore<E>/AsyncEventStore<E> extend EventModels<E>)"
    requirement: "CORE-06"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build && pnpm --filter applesauce-core test"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full-workspace pnpm -r build is green — the 6 zero-type-param declare-module EventModels augmentations (packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts, packages/actions/src/action-runner.ts) and every other downstream package compile under EventModels' second type parameter"
    requirement: "CORE-06"
    verification:
      - kind: integration
        ref: "pnpm -r build (full workspace, all 18 packages/apps)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-09
status: complete
---

# Phase 2 Plan 2: Close the D-02/WR-02 seam — generic EventModels<E,TStore> Summary

**`IEventSubscriptions<E>`'s type parameter made live end-to-end through `Model`/`ModelConstructor`/`ModelEventStore`/`EventModels<E,TStore>`, so `EventStore<E>`/`AsyncEventStore<E>` truly return `E`-typed observables from `event()`/`replaceable()`/`filters()`/`timeline()`, verified clean across the full 18-package workspace build.**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-07-09T03:19:40Z
- **Tasks:** 2
- **Files modified:** 6 (5 source + 1 changeset)

## Accomplishments
- `IEventModelMixin<E, TStore>`, `ModelEventStore<E, TStore>`, `Model<T, E, TStore>`, and `ModelConstructor<T, Args, E, TStore>` all thread `E` in the second position with `NostrEvent` defaults — zero downstream 1-arg/2-arg call sites across `applesauce-{common,wallet,concord,react,actions}` required edits
- `EventModels<E, TStore>` implements `IEventSubscriptions<E>`; `filters()`/`event()`/`replaceable()`/`addressable()`/`timeline()` return `E`-typed observables (the literal WR-02 fix)
- `EventStore<E>`/`AsyncEventStore<E>` extend `EventModels<E>` — the D-02 seam Phase 1 left open is closed
- Full-workspace `pnpm -r build` (18 packages/apps) green — the 6 zero-type-param `declare module { interface EventModels }` augmentations (RESEARCH Pitfall 2) compiled unmodified; only one narrow downstream arity fix was needed (`filter-timeline-by-mutes.ts`)
- `pnpm --filter applesauce-core test` green (592/592 tests unchanged)

## Task Commits

Each task was committed atomically:

1. **Task 1: Close the D-02/WR-02 seam — genericize interface.ts + EventModels + store extends clauses** - `41101862` (feat)
2. **Task 2: Full-workspace build gate (Pitfall 2 module-augmentation check) + changeset** - `5841564b` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `packages/core/src/event-store/interface.ts` - `IEventSubscriptions<E>`'s dead type param made live; `Model<T,E,TStore>`/`ModelConstructor<T,Args,E,TStore>`/`ModelEventStore<E,TStore>` thread `E`; `IEventModelMixin<E,TStore>` gained an explicit `E` param; `IEventStore<E>`/`IAsyncEventStore<E>` extend `IEventSubscriptions<E>`/`IEventModelMixin<E, ...>`
- `packages/core/src/event-store/event-models.ts` - `EventModels<E,TStore>` implements `IEventSubscriptions<E>`; subscription methods return `E`; `profile()`/`contacts()`/`mailboxes()` bridge-cast their (intentionally out-of-scope) `ModelConstructor` arguments to the class's `E`
- `packages/core/src/event-store/event-store.ts`, `async-event-store.ts` - extend `EventModels<E>` (D-02 closed), letting `TStore` default to the union rather than narrowing
- `packages/core/src/models/base.ts` - `EventModel`/`ReplaceableModel`/`TimelineModel`/`FiltersModel`'s `Model<T>` return annotations widened to `Model<T, E>` so their event-store type matches their own `E` instead of silently defaulting to `NostrEvent`
- `packages/common/src/observable/filter-timeline-by-mutes.ts` - gate-driven arity fix: pinned `IEventModelMixin`'s new `E` slot to `NostrEvent` (its sole model, `MuteModel`, is out-of-scope/`NostrEvent`-only)
- `.changeset/genericize-event-models.md` - `applesauce-core: minor` changeset (single sentence)

## Decisions Made
- `IEventModelMixin` needed an explicit `<E, TStore>` parameter rather than relying on `TStore` alone (RESEARCH Open Question 1's simpler-first attempt) — `TStore`'s bare constraint (`IEventStore | IAsyncEventStore`, defaulting to `NostrEvent`) rejected an abstract `IEventStore<E>`/`IAsyncEventStore<E>`; both store extends clauses now pass `IEventModelMixin<E, IEventStore<E>>`/`IEventModelMixin<E, IAsyncEventStore<E>>`.
- `models/base.ts`'s four base models needed their `Model<T>` (Plan 01's deliberately-1-arg form) widened to `Model<T, E>` — a bare 1-arg `Model<E>` silently resolved its internal event-store type param to the `NostrEvent` default instead of the function's own `E`, which broke `EventModels`' `this.model(FiltersModel<E>, ...)`-style calls once `Model`/`ModelConstructor` genuinely threaded `E`.
- `EventStore<E>`/`AsyncEventStore<E>` extend bare `EventModels<E>` (letting `TStore` default to the union) rather than the plan's literally-specified `EventModels<E, IEventStore<E>>`/`EventModels<E, IAsyncEventStore<E>>` — pinning `TStore` to a single store shape broke `applesauce-wallet`'s `nut-wallet.ts` (`castUser()`/`ActionRunner()` expect bare `EventModels<E>`'s union default). This is the Task 2 remedy-priority-1 in-core fix: it resolves the regression without touching any downstream file, and the D-02 seam (E-typed subscription returns) is unaffected either way.
- `packages/common/src/observable/filter-timeline-by-mutes.ts` needed a one-line arity fix (pinned `IEventModelMixin<NostrEvent, ...>`) since its sole `model()` call (`MuteModel`) is intentionally `NostrEvent`-only and out of this phase's scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `IEventModelMixin`'s "simpler first" approach (RESEARCH Open Question 1) did not type-check**
- **Found during:** Task 1
- **Issue:** Filling `ModelConstructor`'s new `E` slot with `StoreEvent` inside `IEventModelMixin<TStore>`'s body (without adding an explicit `<E>` param to the interface) failed: `TStore`'s own constraint (`IEventStore | IAsyncEventStore`, bare = `NostrEvent` default) does not accept an abstract `IEventStore<E>`/`IAsyncEventStore<E>` for a generic `E`, producing `TS2344` at both store extends clauses.
- **Fix:** Added an explicit `<E, TStore>` parameter to `IEventModelMixin` (the plan's own documented fallback) and threaded `E` into both `IEventStore<E>`/`IAsyncEventStore<E>` extends clauses (`IEventModelMixin<E, IEventStore<E>>` / `IEventModelMixin<E, IAsyncEventStore<E>>`).
- **Files modified:** `packages/core/src/event-store/interface.ts`
- **Committed in:** `41101862` (Task 1 commit)

**2. [Rule 3 - Blocking] `models/base.ts`'s bare `Model<T>` return annotations broke `EventModels`' method bodies**
- **Found during:** Task 1
- **Issue:** After threading `E` through `Model`/`ModelConstructor`, `FiltersModel`/`EventModel`/`ReplaceableModel`/`TimelineModel`'s Plan-01-era `Model<E | undefined>`/`Model<E[]>`/`Model<E>` (1-arg) annotations resolved their internal event-store type parameter to `NostrEvent` (Model's own default) rather than the function's own `E`, so `this.model(FiltersModel<E>, ...)` etc. in `event-models.ts` failed to type-check for any abstract `E`.
- **Fix:** Widened all four models' return types to the 2-arg form (`Model<E | undefined, E>`, `Model<E[], E>`, `Model<E, E>`), matching the function's own `E` on both the content and event-store type slots.
- **Files modified:** `packages/core/src/models/base.ts`
- **Committed in:** `41101862` (Task 1 commit)

**3. [Rule 3 - Blocking] `profile()`/`contacts()`/`mailboxes()` (out-of-scope models) failed to type-check against the abstract class `E`**
- **Found during:** Task 1
- **Issue:** `ProfileModel`/`ContactsModel`/`MailboxesModel` are intentionally `NostrEvent`-only (out of CORE-06 scope). Their bare `Model<T>` annotations resolve to `E = NostrEvent`, which is not assignable to `EventModels`' abstract class `E` when passed into `this.model(...)`.
- **Fix:** Applied a localized `as unknown as ModelConstructor<T, Args, E, TStore>` bridge cast at each of the three call sites (`profile()`, `contacts()`, `mailboxes()`), mirroring the established bridge-cast pattern for intentionally non-genericized helpers.
- **Files modified:** `packages/core/src/event-store/event-models.ts`
- **Committed in:** `41101862` (Task 1 commit)

**4. [Rule 3 - Blocking, gate-driven] `EventStore<E>`/`AsyncEventStore<E>` extending `EventModels<E, IEventStore<E>>`/`EventModels<E, IAsyncEventStore<E>>` (as literally specified) broke `applesauce-wallet`**
- **Found during:** Task 2 (`pnpm -r build`)
- **Issue:** Pinning `TStore` to a single store shape narrowed `EventStore<E>`'s inherited `models` map compared to bare `EventModels<E>`'s union default (`IEventStore<E> | IAsyncEventStore<E>`), which every downstream `CastRefEventStore`/`ActionRunner` consumer expects. `packages/wallet/src/wallet/nut-wallet.ts`'s `castUser(this.pubkey, this.eventStore)` and `new ActionRunner(this.eventStore, ...)` failed with `TS2769`/`TS2345` ("EventStore<NostrEvent> is not assignable to EventModels<NostrEvent, IEventStore<NostrEvent> | IAsyncEventStore<NostrEvent>>").
- **Fix:** Changed both store classes to extend bare `EventModels<E>` (letting `TStore` default to the union) instead of pinning a narrower `TStore` — the Task 2 remedy-priority-1 in-core fix, restoring compatibility for every downstream consumer without touching any file outside `applesauce-core`. The D-02 seam (E-typed subscription returns) is unaffected by this choice.
- **Files modified:** `packages/core/src/event-store/event-store.ts`, `packages/core/src/event-store/async-event-store.ts`
- **Committed in:** `5841564b` (Task 2 commit)

**5. [Rule 3 - Blocking, gate-driven] `packages/common/src/observable/filter-timeline-by-mutes.ts` under-arity after `IEventModelMixin` gained its `<E>` param**
- **Found during:** Task 2 (`pnpm -r build`)
- **Issue:** `filterTimelineByMutes`'s `eventStore: IEventModelMixin<IEventStore | IAsyncEventStore>` (bare, 1-arg) became under-arity (`TS2314: Generic type 'IEventModelMixin<E, TStore>' requires 2 type argument(s)`).
- **Fix:** Pinned the new `E` slot to `NostrEvent` (`IEventModelMixin<NostrEvent, IEventStore | IAsyncEventStore>`) since its sole `model()` call (`MuteModel`) is intentionally `NostrEvent`-only and out of this phase's scope (mutes genericization is Phase 4 territory).
- **Files modified:** `packages/common/src/observable/filter-timeline-by-mutes.ts`
- **Committed in:** `5841564b` (Task 2 commit)

---

**Total deviations:** 5 auto-fixed (all Rule 3 - blocking)
**Impact on plan:** All five were required to make the D-02/WR-02 seam closure actually type-check across the full workspace. Deviations 1-3 were anticipated by the plan's own fallback language ("add an explicit `IEventModelMixin<E, TStore>` param ONLY if the build reports an inference gap") and read_first notes; deviations 4-5 are exactly the "gate-driven, minimal" downstream fixes Task 2's action text explicitly authorizes and requires be recorded. No scope creep — the 7 out-of-scope models (`ProfileModel`/`ContactsModel`/`MailboxesModel`/`PublicContactsModel`/`HiddenContactsModel`/`OutboxModel`/`EncryptedContentModel`) and `MuteModel` remain untouched at the `NostrEvent` default.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `EventModels<E, TStore>` is fully generic and closes the D-02/WR-02 seam; `EventStore<E>`/`AsyncEventStore<E>` genuinely return `E`-typed observables from every subscription method.
- Full workspace `pnpm -r build` confirmed green (18 packages/apps) — no downstream package regressed; the 6 module-augmentation files and `filter-timeline-by-mutes.ts`'s one arity fix are the only cross-package ripples, both resolved.
- Plan 03 (cast infrastructure — `CastRefEventStore<E>`/`CastConstructor<E,C>`/`castEvent<E,C>`/`castEventStream<E,C>`/`castTimelineStream<E,C>`) is unblocked: it can now compose `EventModels<E>` directly instead of bridging.
- No blockers for Plan 03.

---
*Phase: 02-generic-models-casts*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created/modified files and both task commit hashes (`41101862`, `5841564b`) were verified present on disk and in git history.
