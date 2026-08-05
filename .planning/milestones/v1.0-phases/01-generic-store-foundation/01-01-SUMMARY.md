---
phase: 01-generic-store-foundation
plan: 01
subsystem: core
tags: [typescript, generics, nostr-tools, nip-59, event-store]

# Dependency graph
requires: []
provides:
  - "verifyRumor(rumor) hash-based NIP-59 verifier exported from packages/core/src/helpers/event.ts"
  - "All eleven CORE-04 structural helpers generic over E extends StoreEvent = NostrEvent"
affects: [01-02-managers-and-interfaces, 01-03-event-store-generic, 01-04-async-event-store-generic, phase-3-rumor-store]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "E extends StoreEvent = NostrEvent generic parameter on structural helpers, mirroring the EventCast<T extends StoreEvent = NostrEvent> convention already established in casts/event.ts"

key-files:
  created:
    - packages/core/src/helpers/__tests__/rumor.test.ts
    - .changeset/add-verify-rumor.md
    - .changeset/genericize-core-helpers.md
  modified:
    - packages/core/src/helpers/event.ts
    - packages/core/src/helpers/filter.ts
    - packages/core/src/helpers/expiration.ts
    - packages/core/src/helpers/pointers.ts
    - packages/core/src/helpers/relays.ts
    - packages/core/src/helpers/__tests__/exports.test.ts

key-decisions:
  - "Imported getEventHash as a local binding in event.ts (in addition to its existing re-export) since a bare re-export does not create a usable local identifier for verifyRumor's body"
  - "Cast Reflect.get(event, SeenRelaysSymbol) explicitly to Set<string> | undefined in relays.ts — without the cast, tsc infers a conditional indexed-access type from the generic E parameter that is incompatible with Set<string>"

patterns-established:
  - "Genericize structural helpers by adding <E extends StoreEvent = NostrEvent>(event: E) to the signature only, leaving bodies and internal call chains untouched — the default preserves NostrEvent inference at every existing call site"

requirements-completed: [CORE-04, RUMOR-01, RUMOR-02]

coverage:
  - id: D1
    description: "verifyRumor(rumor) returns true for a correctly-hashed rumor and false for a tampered/incorrect id"
    requirement: "RUMOR-02"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/rumor.test.ts#verifyRumor should return true when the id matches the recomputed hash"
        status: pass
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/rumor.test.ts#verifyRumor should return false when the id does not match the recomputed hash"
        status: pass
    human_judgment: false
  - id: D2
    description: "StoreEvent, Rumor, and verifyRumor are exported from packages/core/src/helpers/event.ts"
    requirement: "RUMOR-01"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/exports.test.ts#exports should export the expected functions"
        status: pass
    human_judgment: false
  - id: D3
    description: "getEventUID, getReplaceableAddress, getReplaceableIdentifier, getIndexableTags, matchFilter, matchFilters, getExpirationTimestamp, eventMatchesPointer, addSeenRelay, getSeenRelays, isFromRelay are generic over E extends StoreEvent = NostrEvent"
    requirement: "CORE-04"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core build (tsc type-checks all eleven genericized signatures)"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-core test (full 589-test suite, unchanged behavior for signed NostrEvent)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-07-09
status: complete
---

# Phase 1 Plan 1: Generic Structural Helpers + verifyRumor Summary

**Genericized all eleven CORE-04 structural helpers over `E extends StoreEvent = NostrEvent` and added a hash-based `verifyRumor` NIP-59 verifier, with zero behavior change for signed-event callers.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-08T19:57Z
- **Completed:** 2026-07-09T01:00Z
- **Tasks:** 3 completed
- **Files modified:** 9 (5 modified helper files, 1 modified test file, 1 new test file, 2 new changesets)

## Accomplishments
- `verifyRumor(rumor: Rumor): boolean` exported from `helpers/event.ts`, verified by a focused unit test covering correct-id (true) and tampered-id (false) cases
- `getEventUID`, `getReplaceableAddress`, `getReplaceableIdentifier` (event.ts) and `getIndexableTags`, `matchFilter`, `matchFilters` (filter.ts) genericized to `<E extends StoreEvent = NostrEvent>`
- `getExpirationTimestamp` (expiration.ts), `eventMatchesPointer` (pointers.ts), and `addSeenRelay`/`getSeenRelays`/`isFromRelay` (relays.ts) genericized to `<E extends StoreEvent = NostrEvent>`
- Full `applesauce-core` build and test suite (589 tests) pass with no behavior change for signed `NostrEvent` consumers

## Task Commits

Each task was committed atomically:

1. **Task 1: Add verifyRumor + unit test + exports snapshot** - `1ead293b` (feat)
2. **Task 2: Genericize event.ts and filter.ts structural helpers** - `1813d88d` (refactor)
3. **Task 3: Genericize expiration.ts, pointers.ts, relays.ts helpers** - `c8a83a6f` (refactor)

_No plan-metadata commit for docs yet — created after this summary._

## Files Created/Modified
- `packages/core/src/helpers/event.ts` - Added `verifyRumor`, imported `getEventHash` locally, genericized `getEventUID`/`getReplaceableAddress`/`getReplaceableIdentifier`
- `packages/core/src/helpers/filter.ts` - Genericized `getIndexableTags`/`matchFilter`/`matchFilters`
- `packages/core/src/helpers/expiration.ts` - Genericized `getExpirationTimestamp`
- `packages/core/src/helpers/pointers.ts` - Genericized `eventMatchesPointer`
- `packages/core/src/helpers/relays.ts` - Genericized `addSeenRelay`/`getSeenRelays`/`isFromRelay`, added explicit `Set<string> | undefined` casts on `Reflect.get`
- `packages/core/src/helpers/__tests__/rumor.test.ts` - New unit test for `verifyRumor`
- `packages/core/src/helpers/__tests__/exports.test.ts` - Updated inline snapshot with the new `verifyRumor` export key
- `.changeset/add-verify-rumor.md` - Changeset for the `verifyRumor` addition
- `.changeset/genericize-core-helpers.md` - Changeset for the CORE-04 helper genericization

## Decisions Made
- Imported `getEventHash` as a local binding in `event.ts` rather than relying on the existing re-export, since a bare `export { getEventHash } from "..."` re-export does not create a usable local identifier for `verifyRumor`'s body to call
- Added explicit `as Set<string> | undefined` casts on `Reflect.get(event, SeenRelaysSymbol)` in `relays.ts` because `tsc` cannot resolve the conditional indexed-access type produced by combining `Reflect.get`'s generic overload with the new `E extends StoreEvent` parameter

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `getEventHash` needed a local import, not just a re-export**
- **Found during:** Task 1 (verifyRumor implementation)
- **Issue:** The plan assumed the existing `export { getEventHash, ... } from "nostr-tools/pure"` line at event.ts:12 made `getEventHash` available for internal use in the same module. Running the rumor test failed with `ReferenceError: getEventHash is not defined` because a re-export does not bind the name locally.
- **Fix:** Added `getEventHash` to the existing named import from `nostr-tools/pure` at the top of `event.ts`, alongside `EventTemplate`, `NostrEvent`, etc.
- **Files modified:** packages/core/src/helpers/event.ts
- **Verification:** `pnpm --filter applesauce-core test rumor exports` passes
- **Committed in:** 1ead293b (Task 1 commit)

**2. [Rule 1 - Bug] `Reflect.get` type inference broke under the new generic parameter in relays.ts**
- **Found during:** Task 3 (genericize relays.ts)
- **Issue:** `pnpm --filter applesauce-core build` failed with TS2322/TS2339 errors in `addSeenRelay`/`getSeenRelays` — TypeScript inferred a conditional indexed-access type (`unique symbol extends keyof E ? E[keyof E & unique symbol] : any`) from `Reflect.get(event, SeenRelaysSymbol)` once `event` became generic over `E`, which is incompatible with `Set<string>`.
- **Fix:** Added explicit `as Set<string> | undefined` type assertions on both `Reflect.get` call sites, matching the existing cast pattern already used in `event.ts` (e.g. `getEventUID`'s `Reflect.get(event, EventUIDSymbol) as string | undefined`).
- **Files modified:** packages/core/src/helpers/relays.ts
- **Verification:** `pnpm --filter applesauce-core build` type-checks clean; `pnpm --filter applesauce-core test` passes (589/589)
- **Committed in:** c8a83a6f (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both were necessary to make the plan's spec-fixed code compile and run; no scope creep — the fixes stayed within the files/tasks the plan already targeted.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All eleven CORE-04 structural helpers are generic and ready for Plan 03 (managers) and Plan 04 (event-store classes) to call with `E`-typed arguments
- `verifyRumor` is exported and unit-tested, ready for Phase 3's `RumorStore` to adopt as its default verifier
- `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` are both green with no signed-event behavior change
- No blockers for Plan 01-02 (interfaces/managers genericization)

---
*Phase: 01-generic-store-foundation*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 9 created/modified files verified present on disk; all 3 task commit hashes (1ead293b, 1813d88d, c8a83a6f) verified present in git log.
