---
phase: 02-generic-models-casts
verified: 2026-07-09T03:57:04Z
status: passed
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 2: Generic models & casts Verification Report

**Phase Goal:** Genericize the reactive model framework and cast infrastructure so `EventStore<E>` returns `E`-typed observables and casts compose over any store event.
**Verified:** 2026-07-09T03:57:04Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

All verification in this report was performed by reading the actual source files, running the real build/test commands myself (not trusting SUMMARY.md), and compiling an independent type-level probe against the built `EventStore<Rumor>` API to confirm the WR-02 seam is genuinely closed (not just claimed).

### Observable Truths

| # | Truth (from ROADMAP success criteria + merged PLAN must_haves) | Status | Evidence |
|---|---|---|---|
| 1 | Core models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) are generic and return `E`-typed observables | ✓ VERIFIED | `packages/core/src/models/base.ts:93,130,186,287` — all four declared `<E extends StoreEvent = NostrEvent>`; `packages/core/src/event-store/event-models.ts:41-44` — `class EventModels<E, TStore> implements IEventSubscriptions<E>` |
| 2 | `IEventSubscriptions<E>` body is live — `event()`/`replaceable()`x2/`addressable()`/`filters()`/`timeline()` return `E`/`E[]`, not hardcoded `NostrEvent` (the literal WR-02 fix) | ✓ VERIFIED | Read `packages/core/src/event-store/interface.ts:112-132` directly — every method returns `E`/`E[]`; independently compiled a type probe (see below) proving `E` is not silently re-defaulted |
| 3 | `EventStore<E>`/`AsyncEventStore<E>` extend `EventModels<E, ...>`, closing the D-02 seam | ✓ VERIFIED | `event-store.ts:63-66` `class EventStore<E> extends EventModels<E> implements IEventStore<E>`; `async-event-store.ts:57-60` mirrors it |
| 4 | Cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `castEvent`, `castEventStream`, `castTimelineStream`) is generic with `NostrEvent` defaults | ✓ VERIFIED | `packages/core/src/casts/cast.ts:6-8,20-31` and `packages/core/src/observable/cast-stream.ts` — all five symbols declared `<... E extends StoreEvent = NostrEvent>` |
| 5 | `CastConstructor`'s constructor `event` param stays `NostrEvent` (contravariance trick preserved); only `store` widens to `CastRefEventStore<E>` | ✓ VERIFIED | `cast.ts:22-25` — `new (event: NostrEvent, store: CastRefEventStore<E>) => C` |
| 6 | `claimEvents`/`claimLatest` generic over `E extends StoreEvent = NostrEvent`, `IEventClaims<E>`-typed, internal `Set`/`latest` state is `E`-typed | ✓ VERIFIED | `claim-events.ts:7-10` `new Set<E>()`; `claim-latest.ts:7-10` `let latest: E \| undefined` |
| 7 | Four module-private helpers (`getEventFromStores`, `getReplaceableFromStores`, `getByFiltersFromStores`, `loadEventUsingFallback`) generic over `E` in lockstep | ✓ VERIFIED | `base.ts:38,49,60,74` — all four `<E extends StoreEvent = NostrEvent>` |
| 8 | `insertEventIntoDescendingList` bridged locally in `TimelineModel`; its own signature and `watchEventUpdates` untouched | ✓ VERIFIED | `base.ts:274` — localized `as unknown as NostrEvent[]`/`as unknown as NostrEvent` cast at the single call site; `grep -c watchEventUpdates base.ts` = 0 |
| 9 | `Model<T,E,TStore>`/`ModelConstructor<T,Args,E,TStore>`/`ModelEventStore<E,TStore>` thread `E` in the second position with `NostrEvent` defaults | ✓ VERIFIED | `interface.ts:140,149-152` and surrounding `Model`/`ModelConstructor` declarations read directly |
| 10 | Existing signed-event model and cast tests pass without changes (core promise: zero runtime behavior change) | ✓ VERIFIED | `pnpm --filter applesauce-core test` → 592/592 passed; `rumor-cast.test.ts`/`user.test.ts` last touched by pre-phase commit `82c8839c` (no Phase 2 commit modifies them) and both pass (8/8) when run directly |
| 11 | `pnpm --filter applesauce-core build` type-checks the generic model/cast surface | ✓ VERIFIED | Ran it myself: `tsc` exits clean, no errors |
| 12 | Full-workspace `pnpm -r build` exits 0 — six zero-type-param `declare module { interface EventModels }` augmentations (`packages/common/src/models/{comments,reactions,thread,blossom,mutes}.ts`, `packages/actions/src/action-runner.ts`) still compile unmodified under `EventModels`' second type parameter | ✓ VERIFIED | Ran `pnpm -r build` myself, exit code 0; confirmed via `git log` that none of these 6 files were touched by any Phase 2 commit, yet they still compile against the new `EventModels<E,TStore>` |
| 13 | `E` genuinely flows `IEventSubscriptions<E>` → `EventModels<E>` → `EventStore<E>` (not silently re-defaulted to `NostrEvent`) | ✓ VERIFIED | Independently compiled a fresh type probe (not the one in 02-REVIEW.md): `new EventStore<Rumor>().event("abc")` resolves to `Observable<Rumor \| undefined>`; assigning it to `Observable<NostrEvent \| undefined>` fails with `TS2345: Property 'sig' is missing in type 'Rumor'` — proves the type is real `Rumor`, not a re-defaulted `NostrEvent` |
| 14 | Changesets present for all three plans (minor, single-sentence body per CLAUDE.md) | ✓ VERIFIED | `.changeset/genericize-base-models.md`, `.changeset/genericize-event-models.md`, `.changeset/genericize-cast-infrastructure.md` all exist with `"applesauce-core": minor` and a single-sentence body |

**Score:** 14/14 truths verified (0 present-but-behavior-unverified — this is a compile-time/type-level phase with no runtime state-transition or cancellation/cleanup invariants to spot-check)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/observable/claim-events.ts` | `claimEvents<E extends StoreEvent = NostrEvent, T>` | ✓ VERIFIED | Signature present, `Set<E>` internal state, wired into `base.ts` |
| `packages/core/src/observable/claim-latest.ts` | `claimLatest<E extends StoreEvent = NostrEvent, T>` | ✓ VERIFIED | Signature present, `E \| undefined` internal state |
| `packages/core/src/models/base.ts` | Four generic base models + generic private helpers | ✓ VERIFIED | All four exported models + four private helpers generic; localized bridge cast for `insertEventIntoDescendingList` |
| `packages/core/src/event-store/interface.ts` | `IEventSubscriptions<E>` live body, `Model<T,E,TStore>`, `ModelConstructor<T,Args,E,TStore>`, `ModelEventStore<E,TStore>`, `IEventStore<E>`/`IAsyncEventStore<E>` extending `IEventSubscriptions<E>` | ✓ VERIFIED | All present; `IEventModelMixin<E,TStore>` (explicit param, a documented deviation from the plan's "prefer simpler" default, itself gate-verified) |
| `packages/core/src/event-store/event-models.ts` | `EventModels<E,TStore> implements IEventSubscriptions<E>` | ✓ VERIFIED | Class decl + implements clause confirmed |
| `packages/core/src/event-store/event-store.ts` | `EventStore<E> extends EventModels<E, ...>` | ✓ VERIFIED | Extends bare `EventModels<E>` (TStore defaults to the union — a documented, gate-driven deviation that preserves downstream compatibility; does not weaken the D-02 closure) |
| `packages/core/src/event-store/async-event-store.ts` | `AsyncEventStore<E> extends EventModels<E, ...>` | ✓ VERIFIED | Mirrors `event-store.ts` |
| `packages/core/src/casts/cast.ts` | `CastRefEventStore<E>`, `CastConstructor<C,E>`, `castEvent<C,E>` | ✓ VERIFIED | All present with contravariance trick intact |
| `packages/core/src/observable/cast-stream.ts` | `castEventStream<C,E>`, `castTimelineStream<C,E>` | ✓ VERIFIED | Both widened, delegate unchanged to `castEvent` |
| `.changeset/genericize-base-models.md` | changeset (minor) | ✓ VERIFIED | Present, correct format |
| `.changeset/genericize-event-models.md` | changeset (minor) | ✓ VERIFIED | Present, correct format |
| `.changeset/genericize-cast-infrastructure.md` | changeset (minor) | ✓ VERIFIED | Present, correct format |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `models/base.ts` (TimelineModel) | `observable/claim-events.ts` | `claimEvents(store)` on an `E`-typed stream | ✓ WIRED | `claimEvents<E>` imported and called |
| `models/base.ts` (EventModel/ReplaceableModel) | `observable/claim-latest.ts` | `claimLatest(store)` | ✓ WIRED | Confirmed by clean `tsc` + passing tests |
| `models/base.ts` | `insertEventIntoDescendingList` | localized cast bridge | ✓ WIRED | Single call site, cast scoped correctly |
| `event-store/interface.ts` | `IEventSubscriptions` | `IEventStore<E>`/`IAsyncEventStore<E>` extend `IEventSubscriptions<E>` | ✓ WIRED | Confirmed via direct read, not just grep count |
| `event-store/event-store.ts` | `event-store/event-models.ts` | `extends EventModels<E>` | ✓ WIRED | Confirmed via independent compiled probe — `E` flows through to `.event()`/`.timeline()`/`.filters()` |
| `event-store/event-models.ts` | `event-store/interface.ts` | `ModelConstructor<T,Args,E,TStore>` | ✓ WIRED | Confirmed via direct read of `event-models.ts` model map + `model()` signature |
| `casts/cast.ts` | `event-store/event-models.ts` | `CastRefEventStore<E>` composes `EventModels<E>` | ✓ WIRED | `cast.ts:6-8` |
| `observable/cast-stream.ts` | `casts/cast.ts` | `castEventStream`/`castTimelineStream` import `CastConstructor`/`CastRefEventStore<E>`, delegate to `castEvent` | ✓ WIRED | Confirmed by direct read of `cast-stream.ts` |
| `casts/cast.ts` | `casts/__tests__/rumor-cast.test.ts` | `castEvent(rumor, RumorNote, new EventStore())` passes unmodified | ✓ WIRED | Ran the test directly — 8/8 pass, file unmodified since pre-phase commit `82c8839c` |

### Behavioral Spot-Checks / Independent Verification

| Behavior | Command | Result | Status |
|---|---|---|---|
| `applesauce-core` build type-checks | `pnpm --filter applesauce-core build` | `tsc` exits clean, no errors | ✓ PASS |
| `applesauce-core` full test suite | `pnpm --filter applesauce-core test` | 53 files / 592 tests passed | ✓ PASS |
| Full workspace build (mandated phase gate) | `pnpm -r build` | Exit code 0, all 18 packages/apps built (including `apps/examples` Vite build) | ✓ PASS |
| CORE-07 regression guards run in isolation | `npx vitest run .../rumor-cast.test.ts .../user.test.ts` | 2 files / 8 tests passed | ✓ PASS |
| **Independent compiled type probe** (not reused from 02-REVIEW.md) — proves `E` is not silently re-defaulted | Wrote `src/__verify_probe.ts`: `new EventStore<Rumor>().event("abc")` assigned to a function expecting `Observable<NostrEvent \| undefined>`; ran `npx tsc --noEmit -p tsconfig.json`; deleted probe file after | Compile **fails** with `TS2345: Property 'sig' is missing in type 'Rumor' but required in type 'NostrEvent'` — i.e. the returned observable is genuinely `Rumor`-typed, not `NostrEvent` | ✓ PASS (confirms WR-02 seam closure independently of the code-review's own probe) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CORE-06 | 02-01, 02-02 | Core models (`EventModels`, `EventModel`, `ReplaceableModel`, `TimelineModel`, `FiltersModel`) return `E`-typed observables | ✓ SATISFIED | Truths 1, 2, 3, 6, 7, 8, 9 above |
| CORE-07 | 02-03 | Core cast infrastructure (`CastRefEventStore<E>`, `EventCast<E>`, `CastConstructor`, `castEvent`, `castEventStream`, `castTimelineStream`) is generic | ✓ SATISFIED | Truths 4, 5, 10 above |

No orphaned requirements — `REQUIREMENTS.md` maps only CORE-06 and CORE-07 to Phase 2, and both appear in the plans' `requirements:` frontmatter (02-01/02-02 → CORE-06, 02-03 → CORE-07).

### Anti-Patterns Found

None. Scanned all 10 phase-modified files (`claim-events.ts`, `claim-latest.ts`, `models/base.ts`, `event-store/interface.ts`, `event-store/event-models.ts`, `event-store/event-store.ts`, `event-store/async-event-store.ts`, `casts/cast.ts`, `observable/cast-stream.ts`, `common/observable/filter-timeline-by-mutes.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` and stub-return patterns (`return null`/`return {}`/`return []`/`=> {}`) — zero matches.

### Deferred (Not Phase 2 Gaps)

Per explicit task instruction and `deferred-items.md`, the following code-review finding is intentionally NOT a Phase 2 gap:

- **WR-01** (`castEvent`'s `event: StoreEvent` input is not tied to the cast's own event type, so a `Rumor` can compile against a signed-only cast) — documented as owned by Phase 3 (RumorStore) / Phase 4 (common package rumor casts), where rumor casting is first exercised with real usage. The attempted stricter fix in Phase 2 did not compile cleanly (breaks `castEventStream`/`castTimelineStream` and over-tightens external call sites), so deferring is the correct call, not an oversight.
- **WR-03/IN-01/IN-02** — pre-existing cosmetic issues (dead no-op in `profile()`, stale comments, no-op `defined()`), explicitly low-priority and unrelated to CORE-06/CORE-07 correctness.
- **CORE-03 release-note reminder** — already accepted in Phase 1 (`01-SECURITY.md` AR-01); carried forward as a release-notes action item, not a Phase 2 code gap.

### Human Verification Required

None. This phase is entirely compile-time/type-level (no new runtime behavior, no UI, no external services). All must-haves were verified via direct source inspection, an independently-compiled type probe, and actually running the build/test commands.

### Gaps Summary

No gaps found. All 14 merged must-haves (4 from ROADMAP success criteria + 10 from the three plans' `must_haves.truths`, deduplicated) are verified against the actual codebase — not just SUMMARY.md claims. Both mandated full-workspace `pnpm -r build` gates (end of Plan 02, end of Plan 03) were re-run independently by this verifier and passed with exit code 0. The core test suite passed 592/592. The WR-02 seam closure — the highest-risk claim in this phase — was re-confirmed with a probe written and compiled independently of the one in `02-REVIEW.md`.

---

_Verified: 2026-07-09T03:57:04Z_
_Verifier: Claude (gsd-verifier)_
