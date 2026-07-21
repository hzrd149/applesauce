---
phase: 10-invite-lifecycle-event-time-consistency
plan: 05
subsystem: auth
tags: [nostr, concord, invite-bundle, nip-01, event-collapse, vitest]

# Dependency graph
requires:
  - phase: 10-invite-lifecycle-event-time-consistency
    provides: "10-01's fail-closed getInviteBundleVsk/isInviteBundleRevoked (D-04) — a malformed vsk on the collapse winner now denies rather than defaults to live"
provides:
  - "joinByLink resolves the (33301, link_signer, \"\") coordinate to its NIP-01 newest winner across the FULL multi-relay union BEFORE evaluating the tombstone, closing the filter-then-sort inversion that let a lagging relay's stale live bundle win"
  - "pool.request filter scoped to \"#d\": [\"\"] so a sibling-d coordinate cannot pollute the union"
  - "Regression coverage: lagging-relay tombstone-wins-refusal, request-filter d-scope spy, and an end-to-end decoy-withheld test against a tag-honoring pool stand-in"
affects: [10-06]

# Tech tracking
tech-stack:
  added: []
  patterns: ["module-local NIP-01 collapse helper replicated verbatim from EventStore, used pre-join where no store exists"]

key-files:
  created: []
  modified:
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "newestAtCoordinate is a plain module-local function in client.ts (not exported, not a shared helper) — replicates event-store.ts:264-267's tie-break verbatim per the plan's explicit no-different-tie-break prohibition"
  - "D-02 coverage split across two tests: a filter-spy test (asserts the outgoing request carries \"#d\": [\"\"]) plus a new filteringAsyncServingPool stand-in that actually honors tag filters, so the decoy-ignored assertion is a genuine end-to-end behavior proof rather than resting on timestamp ordering alone"
  - "Non-vacuity for the lagging-relay case verified empirically (not just asserted in a comment): temporarily restored the pre-fix client.ts via git show HEAD~1, confirmed the new test fails against it, then restored the fix via git checkout -- <file>"

patterns-established:
  - "Pre-join / no-store NIP-01 collapse: when a store isn't available yet (join flow), replicate EventStore's replaceable-history winner rule inline rather than inventing a new tie-break"

requirements-completed: [INVITE-01]

coverage:
  - id: D1
    description: "joinByLink collapses the full multi-relay union to its single newest-at-coordinate event before evaluating isInviteBundleRevoked, so a lagging relay serving a stale live bundle cannot keep a revoked link joinable"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#ConcordClient.joinByLink (INVITE-01 collapse-then-tombstone, D-01/D-02/D-03) > rejects when a fresher tombstone coexists with a stale live bundle from a lagging relay"
        status: pass
    human_judgment: false
  - id: D2
    description: "joinByLink's pool.request filter is scoped to \"#d\": [\"\"] so a sibling-d coordinate cannot pollute the union"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#ConcordClient.joinByLink (INVITE-01 collapse-then-tombstone, D-01/D-02/D-03) > scopes the pool.request filter to the empty d tag"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#ConcordClient.joinByLink (INVITE-01 collapse-then-tombstone, D-01/D-02/D-03) > ignores a newer decoy event carrying a non-empty d tag (D-02)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 05: Collapse-then-tombstone rewrite of joinByLink Summary

**joinByLink now resolves the invite-bundle coordinate to its NIP-01 newest event across the whole relay union before checking revocation, so one honest relay serving a fresher tombstone closes the link even when another relay still serves the stale live bundle.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-21T15:10Z (approx, prior to first commit)
- **Completed:** 2026-07-21T15:20:12+01:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `newestAtCoordinate`, a module-local NIP-01 collapse helper in `client.ts` replicated verbatim from `EventStore`'s replaceable-history winner rule (`created_at` desc, tie → lowest `id`), since no store exists pre-join
- Rewrote `joinByLink` to scope its `pool.request` filter to `"#d": [""]` and to collapse the full union to a single winner BEFORE evaluating `isInviteBundleRevoked` — closing the filter-then-sort inversion CORD-05 §2 forbids
- Added three regression tests: a lagging-relay tombstone-wins-refusal case (non-vacuity independently verified against the pre-fix implementation), a filter-scope spy, and an end-to-end decoy-withheld case against a new tag-honoring pool stand-in

## Task Commits

Each task was committed atomically:

1. **Task 1: INVITE-01 — collapse-then-tombstone rewrite of joinByLink (D-01/D-02/D-03)** - `48b3e10a` (fix)
2. **Task 2: INVITE-01 — lagging-relay revocation repro (D-01/D-02)** - `ca37f186` (test)

**Plan metadata:** (pending — final docs commit below)

## Files Created/Modified
- `packages/concord/src/client/client.ts` - Added `newestAtCoordinate`; rewrote `joinByLink`'s request filter (`"#d": [""]`) and collapse-then-tombstone logic
- `packages/concord/src/client/__tests__/client.test.ts` - Added the INVITE-01 lagging-relay/D-02 test block plus `filteringAsyncServingPool`, a stricter tag-honoring pool stand-in

## Decisions Made
- `newestAtCoordinate` stays module-local and unexported — it's join-flow-specific (pre-store) and replicates an existing rule rather than generalizing a new shared utility
- D-02 gets two complementary tests (filter-spy + genuine end-to-end decoy-withheld via a new stricter pool stand-in) rather than relying on the OR in the acceptance criteria alone, since a decoy test against the existing permissive `asyncServingPool` would not actually exercise the `#d` scope (the collapse itself has no client-side d-tag check — it's a request-level trust boundary per 10-RESEARCH.md assumption A1)
- Verified the lagging-relay test's non-vacuity empirically rather than by comment inspection alone: swapped in the pre-fix `client.ts` via `git show HEAD~1`, confirmed the new test failed (old code did not reject), then restored the fix via `git checkout -- <file>`

## Deviations from Plan

None - plan executed exactly as written. The extra filter-spy test and `filteringAsyncServingPool` stand-in are within Task 2's explicit "either by asserting the request filter carries `"#d": [""]`, or by confirming the decoy does not win the collapse" acceptance option — both options were implemented for stronger coverage, not a scope change.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- INVITE-01 is now fully satisfied (10-01 closed D-04's vsk fail-closed sub-part; this plan closes D-01/D-02/D-03's collapse-then-tombstone rewrite) — STATE.md's prior caveat about INVITE-01 spanning two plans is resolved
- `joinFromBundle`'s `expires_at` check was deliberately left as-is per the plan's explicit scope note; 10-06 converts it atomically with the other unit sites (D-05)
- Full `applesauce-concord` package test suite green (282/282) and `tsc --noEmit` clean after this plan's changes

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/client.ts
- FOUND: packages/concord/src/client/__tests__/client.test.ts
- FOUND: .planning/phases/10-invite-lifecycle-event-time-consistency/10-05-SUMMARY.md
- FOUND commit: 48b3e10a
- FOUND commit: ca37f186
- FOUND commit: a818fe86
