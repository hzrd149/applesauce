---
phase: 18-event-family-re-layer
plan: 03
subsystem: relay
tags: [group, pool, sync, typescript]
requires:
  - phase: 18-event-family-re-layer
    provides: raw event and high-level publish split
provides:
  - raw RelayGroup and RelayPool EVENT forwarding
  - authenticated sync SEND bridge through publish
affects: [18-04, phase-24-sync]
tech-stack:
  added: []
  patterns: [structurally derived raw method signatures, publish-owned sync SEND policy]
key-files:
  created: []
  modified: [packages/relay/src/group.ts, packages/relay/src/pool.ts, packages/relay/src/relay.ts, packages/relay/src/__tests__/group.test.ts, packages/relay/src/__tests__/pool.test.ts]
key-decisions:
  - "Group and Pool event methods remain raw; sync SEND temporarily delegates to publish until Phase 24."
requirements-completed: [EVT-05, EVT-06]
coverage:
  - id: D1
    description: "Relay, Group, and Pool preserve the raw/high-level EVENT split while sync SEND retains auth policy."
    requirement: EVT-06
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/group.test.ts and pool.test.ts"
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-20
status: complete
---

# Phase 18 Plan 03: EVENT Consumer Propagation Summary

**Group and Pool now expose raw EVENT fan-out while sync SEND preserves authentication through high-level publish.**

## Performance

- **Duration:** 4 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Narrowed Group and Pool forwarding without adding policy to raw fan-out.
- Preserved per-relay aggregation and high-level publish option forwarding.
- Routed sync SEND through `publish()` while retaining settled isolation and seen-relay success semantics.

## Task Commits

1. **Task 1:** `8b85d929`
2. **Task 2:** `c626185b`

Source migrations for both tasks landed in `3fbe0dc7` as the blocking consumer adjustment during Plan 01.

## Deviations from Plan

None - production forwarding landed early as a declared blocking fix; this plan supplied its dedicated consumer verification.

## Issues Encountered

One Group publish control initially awaited an unmocked second relay; mocking both configured relays restored deterministic isolation coverage.

## User Setup Required

None.

## Next Phase Readiness

Runtime and public declarations are ready for provenance and source-comment alignment.

## Self-Check: PASSED

All three focused suites pass 231 tests and the relay TypeScript build succeeds.
