---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: event-store-supports-rumors
current_phase: 03
current_phase_name: rumorstore-verification
status: verifying
stopped_at: Completed 03-03-PLAN.md (Phase 3 complete)
last_updated: "2026-07-09T05:02:36.660Z"
last_activity: 2026-07-09
last_activity_desc: Phase 03 execution started
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
  percent: 75
---

# Project State

## Current Position

Phase: 03 (rumorstore-verification) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-07-09 — Phase 03 execution started

## Session

**Last session:** 2026-07-09T05:02:36.653Z
**Stopped at:** Completed 03-03-PLAN.md (Phase 3 complete)
**Resume file:** None

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 01 P01 | 10min | 3 tasks | 9 files |
| Phase 01 P02 | 8min | 2 tasks | 2 files |
| Phase 01-generic-store-foundation P03 | 12min | 2 tasks | 5 files |
| Phase 01-generic-store-foundation P04 | 15min | 2 tasks | 6 files |
| Phase 02 P01 | 25min | 2 tasks | 5 files |
| Phase 02 P02 | 25min | 2 tasks | 6 files |
| Phase 02-generic-models-casts P03 | 12min | 2 tasks | 3 files |
| Phase 03 P01 | 20min | 2 tasks | 5 files |
| Phase 03 P02 | 15min | 2 tasks | 2 files |
| Phase 03 P03 | 12min | 2 tasks | 2 files |

## Decisions

- [Phase 01]: Imported getEventHash as a local binding in event.ts since a bare re-export does not create a usable local identifier for verifyRumor
- [Phase 01]: Cast Reflect.get(event, SeenRelaysSymbol) explicitly to Set<string> | undefined in relays.ts to satisfy tsc generic inference
- [Phase 01]: IEventStore<E>/IAsyncEventStore<E> extend IEventSubscriptions and IEventModelMixin bare (NostrEvent default) since those methods come from the non-generic EventModels superclass deferred to Phase 2 (D-02 seam)
- [Phase 01]: EventMemory's claims WeakMap<E, number> compiles directly without an E-extends-object conditional guard
- [Phase 01]: D-01 kept: EventStore/AsyncEventStore verifyEvent setter console.warn preserved verbatim even for intentional undefined
- [Phase 01]: Deferred applesauce-relay EventMemory<StoreEvent> inference break to deferred-items.md (out of scope for Plan 04)
- [Phase 02 Plan 01]: claimEvents' non-array narrowing needed a localized 'as E' cast since TS cannot narrow a naked type param against a generic-parameterized union constraint
- [Phase 02 Plan 01]: Kept Model<T> return type (1-arg, TStore default) on the four base models and bridge-cast each model's store to IEventStore<E>|IAsyncEventStore<E> internally, deferring full Model<T,E,TStore>/ModelEventStore<E,TStore> threading to Plan 02
- [Phase 02 Plan 01]: event-models.ts call sites needed explicit <NostrEvent> type arguments (FiltersModel<NostrEvent> etc.) since a bare generic function reference infers E from its constraint, not its default
- [Phase 02 Plan 02]: IEventModelMixin gained an explicit <E, TStore> parameter (not just TStore alone) because TStore's bare constraint could not absorb an abstract IEventStore<E>/IAsyncEventStore<E>
- [Phase 02 Plan 02]: EventStore<E>/AsyncEventStore<E> extend bare EventModels<E>, letting TStore default to the union, rather than the plan's literal EventModels<E, IEventStore<E>> -- pinning a narrower TStore broke applesauce-wallet's castUser/ActionRunner call sites
- [Phase 02 Plan 03]: CastConstructor/castEvent/castEventStream/castTimelineStream gained a defaulted E extends StoreEvent = NostrEvent parameter with zero deviation from the RESEARCH/PATTERNS target shape; the contravariance trick (constructor event param stays NostrEvent) was preserved verbatim
- [Phase 02 Plan 03]: full-workspace pnpm -r build gate was green on first run with no downstream fixes required -- castUser/User/castPubkey/PubkeyCast continued resolving bare CastRefEventStore to the NostrEvent default with zero edits
- [Phase 03]: No AsyncRumorStore added -- AsyncEventStore<Rumor> already covers the async case with no concrete consumer requiring a dedicated class
- [Phase 03]: Test rumors constructed as plain object literals with getEventHash-computed ids rather than via FakeUser, to directly demonstrate unsigned rumor-shaped input
- [Phase 03 Plan 02]: Used sig-gated CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent (not the naive exact-T conditional) for castEvent's public input, since the exact-T form was empirically proven in RESEARCH to over-tighten concord's ConcordDirectInvite narrowed-kind rumor cast
- [Phase 03 Plan 02]: cast-stream.ts imports EventCast from ../casts/event.js and performCast from ../casts/cast.js separately, since cast.ts imports EventCast locally without re-exporting it
- [Phase 03 Plan 03]: Used a minimal local SignedOnlyCast probe class (reads this.event.sig) rather than reusing a production cast, keeping the WR-01 regression guard self-contained
- [Phase 03 Plan 03]: RumorStore was already present in the exports snapshot from plan 01; this plan's regeneration only needed to absorb performCast
