---
phase: 21-group-error-surface-request-subscription
plan: 03
subsystem: relay
tags: [pool, typescript, exports]
requires: [{ phase: 21-02, provides: Group failure and lifetime contract }]
provides: [Pool forwarding proofs, public export and type contracts]
affects: [relay-pool, phase-23]
tech-stack:
  added: []
  patterns: [Parameters-derived facade options, transparent error forwarding]
key-files:
  created: [packages/relay/type-tests/group-error-types.ts]
  modified: [packages/relay/src/__tests__/pool.test.ts, packages/relay/src/__tests__/exports.test.ts]
key-decisions:
  - "Keep Pool implementation unchanged because direct delegation already forwards the Group contract."
requirements-completed: [GROUP-01, GROUP-02, GROUP-03, GROUP-04, GROUP-05]
coverage:
  - id: D1
    description: Every Pool family forwards aggregate failure and timeout options unchanged.
    requirement: GROUP-01
    verification: [{ kind: integration, ref: "pool.test.ts#group failure forwarding", status: pass }]
    human_judgment: false
duration: 3min
completed: 2026-09-01
status: complete
---

# Phase 21 Plan 03: Pool and Public Contract Summary

**Transparent Pool forwarding backed by runtime export snapshots and compile-time outcome/timeout contracts**

## Accomplishments

- Proved aggregate failure across request, subscription, subscriptionMap, and outboxSubscription.
- Added compile-time narrowing and negative timeout-shape coverage.
- Added `RelayGroupError` to the runtime export snapshot while keeping `RelayOutcome` type-only.

## Task Commits

1. **Pool forwarding** — `84e459a9`
2. **Runtime/type contracts** — `ac25387d`

## Deviations from Plan

None - Pool source required no modification.

## Self-Check: PASSED

All listed files and commits exist.
