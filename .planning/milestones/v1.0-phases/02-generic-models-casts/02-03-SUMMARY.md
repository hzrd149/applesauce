---
phase: 02-generic-models-casts
plan: 03
subsystem: core
tags: [typescript, generics, rxjs, casts, event-store, nostr]

# Dependency graph
requires:
  - phase: 02-generic-models-casts
    provides: "Plan 02: EventModels<E, TStore> generic and implementing IEventSubscriptions<E> (D-02/WR-02 seam closed) — CastRefEventStore<E> composes EventModels<E> directly"
provides:
  - "CastRefEventStore<E extends StoreEvent = NostrEvent> = IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>"
  - "CastConstructor<C, E>/castEvent<C, E> thread E with NostrEvent defaults; constructor's event param stays NostrEvent (contravariance trick preserved)"
  - "castEventStream<C, E>/castTimelineStream<C, E> thread E through to CastRefEventStore<E>"
  - "Full-workspace pnpm -r build confirmed green with the generic cast surface in place (phase gate for CORE-06 + CORE-07)"
affects: [03-rumor-store (RumorStore-backed casts can now type CastRefEventStore<Rumor> correctly instead of relying on structural compatibility)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CastConstructor's constructor `event` param stays NostrEvent while only the `store: CastRefEventStore<E>` field widens — the documented contravariance trick (cast.ts:16-19) preserved verbatim across the genericization"
    - "Long single-line generic type aliases (CastConstructor) are left to Prettier's own line-wrapping (printWidth 120) rather than manually wrapped — the multi-parameter clause exceeding 120 chars gets reflowed onto multiple lines by `prettier --write`, which is the repo's enforced format"

key-files:
  created:
    - .changeset/genericize-cast-infrastructure.md
  modified:
    - packages/core/src/casts/cast.ts
    - packages/core/src/observable/cast-stream.ts

key-decisions:
  - "CastConstructor/castEvent/castEventStream/castTimelineStream all gained a second, defaulted `E extends StoreEvent = NostrEvent` type parameter exactly as RESEARCH/PATTERNS specified — no deviation from the documented target shape was needed since EventModels<E> (Plan 02) already composes cleanly"
  - "No downstream file needed a fix for Task 2's full-workspace build gate — castUser/User/castPubkey/PubkeyCast (casts/user.ts, casts/pubkey.ts) continued resolving bare CastRefEventStore to the NostrEvent default with zero edits, and no other package in the 18-package workspace regressed"

patterns-established: []

requirements-completed: [CORE-07]

coverage:
  - id: D1
    description: "CastRefEventStore<E>/CastConstructor<C,E>/castEvent<C,E> generic over E extends StoreEvent = NostrEvent, with the constructor's event param staying NostrEvent (contravariance trick preserved) and the getParentEventStore bridge-cast target updated to CastRefEventStore<E>"
    requirement: "CORE-07"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test casts/__tests__/rumor-cast.test.ts (unmodified — castEvent(rumor, RumorNote, new EventStore()) still passes)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-check of the generic cast surface)"
        status: pass
    human_judgment: false
  - id: D2
    description: "castEventStream<C,E>/castTimelineStream<C,E> thread E through to CastRefEventStore<E>, delegating unchanged to castEvent"
    requirement: "CORE-07"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test (592/592, full suite including cast-stream consumers)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full-workspace pnpm -r build is green — castUser/User/castPubkey/PubkeyCast (bare CastRefEventStore consumers, out of CORE-07 scope) resolve to the NostrEvent default with zero edits, and no downstream package across the 18-package workspace regressed"
    requirement: "CORE-07"
    verification:
      - kind: integration
        ref: "pnpm -r build (full workspace, all packages/apps, exit code 0)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-09
status: complete
---

# Phase 2 Plan 3: Genericize cast infrastructure + final phase gate Summary

**`CastRefEventStore<E>`/`CastConstructor<C,E>`/`castEvent<C,E>`/`castEventStream<C,E>`/`castTimelineStream<C,E>` now generic over `StoreEvent` with `NostrEvent` defaults, the documented contravariance trick intact, and a green full-workspace `pnpm -r build` closing out CORE-06/CORE-07.**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-07-09T03:33:58Z
- **Tasks:** 2
- **Files modified:** 3 (2 source + 1 changeset)

## Accomplishments
- `CastRefEventStore<E extends StoreEvent = NostrEvent>` now composes `IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>` instead of the bare, `NostrEvent`-hardcoded union
- `CastConstructor<C, E>`/`castEvent<C, E>` gained the `E` parameter; the constructor's `event` param deliberately stays `NostrEvent` (the contravariance trick documented at `cast.ts:16-19` is unchanged) — only the `store: CastRefEventStore<E>` field widened
- `castEvent`'s `getParentEventStore(event) as unknown as CastRefEventStore<E>` bridge target updated; `getParentEventStore` itself untouched
- `castEventStream<C, E>`/`castTimelineStream<C, E>` (`observable/cast-stream.ts`) thread `E` through to `CastRefEventStore<E>`, delegating unchanged to `castEvent`
- `rumor-cast.test.ts` and `user.test.ts` pass UNMODIFIED (verified via `git diff --exit-code`, zero output)
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` green (592/592 tests)
- Final phase gate: full-workspace `pnpm -r build` (all packages/apps, `apps/examples` Vite build included) exits 0 — no downstream package regressed; `castUser`/`User`/`castPubkey`/`PubkeyCast` (bare `CastRefEventStore` consumers, out of CORE-07 scope) continue resolving to the `NostrEvent` default with zero edits

## Task Commits

Each task was committed atomically:

1. **Task 1: Genericize CastRefEventStore, CastConstructor, castEvent, castEventStream, castTimelineStream + changeset** - `66c17a32` (feat)
2. **Task 2: Final phase gate — full-workspace build** - no commit (verification-only; `pnpm -r build` was green with zero code changes required, per the plan's own "no code change needed" branch)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `packages/core/src/casts/cast.ts` - `CastRefEventStore<E>` widened to compose `IEventSubscriptions<E> & EventModels<E> & IEventStoreStreams<E>`; `CastConstructor<C, E>`/`castEvent<C, E>` gained the `E` parameter with the constructor's `event` param kept `NostrEvent`; bridge-cast target updated to `CastRefEventStore<E>`
- `packages/core/src/observable/cast-stream.ts` - `castEventStream<C, E>`/`castTimelineStream<C, E>` widened `store?: CastRefEventStore` to `store?: CastRefEventStore<E>`; added the `NostrEvent` import needed for the new default
- `.changeset/genericize-cast-infrastructure.md` - `applesauce-core: minor` changeset (single sentence)

## Decisions Made
- Followed the RESEARCH/PATTERNS-documented target shape exactly — inserting `E extends StoreEvent = NostrEvent` as a second, defaulted type parameter on `CastConstructor`/`castEvent`/`castEventStream`/`castTimelineStream`, mirroring `EventCast<T>`'s already-generic shape. No structural deviation was needed.
- `CastConstructor`'s type alias exceeds Prettier's 120-char `printWidth` as a single line once the second `E` parameter and widened `store` type are added; `prettier --write` reflows it onto multiple lines (its enforced format) rather than a single line — this is a cosmetic formatting outcome of the repo's own linter, not a change to the type's semantics. The constructor's `event: NostrEvent` parameter and the `CastRefEventStore<E>` store type are both still present and unchanged in meaning.

## Deviations from Plan

None - plan executed exactly as written. Task 2's full-workspace build gate was green on the first run with no downstream fixes required (the plan's own "if `pnpm -r build` is green: the phase is complete — no code change needed" branch applied).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CORE-07 complete: the cast infrastructure (`CastRefEventStore<E>`, `CastConstructor<C,E>`, `castEvent<C,E>`, `castEventStream<C,E>`, `castTimelineStream<C,E>`) is fully generic with `NostrEvent` defaults, composing directly on top of Plan 02's `EventModels<E>`.
- Phase 2 (CORE-06 + CORE-07) is now fully complete: the reactive model framework and cast infrastructure are both generic, the D-02/WR-02 seam is closed, and the full 18-package/app workspace builds clean.
- Phase 3 (rumor store) is unblocked: `RumorStore`-backed casts can now type `CastRefEventStore<Rumor>` correctly through the real generic surface instead of relying on structural compatibility-by-accident (as `rumor-cast.test.ts` demonstrated pre-phase).
- No blockers for Phase 3.

---
*Phase: 02-generic-models-casts*
*Completed: 2026-07-09*

## Self-Check: PASSED

Both modified source files (`packages/core/src/casts/cast.ts`, `packages/core/src/observable/cast-stream.ts`) and the changeset (`.changeset/genericize-cast-infrastructure.md`) were verified present on disk; the Task 1 commit hash (`66c17a32`) was verified present in git history.
