---
phase: 21-group-error-surface-request-subscription
plan: 02
subsystem: relay
tags: [rxjs, timeout, authentication]
requires: [{ phase: 21-01, provides: latest-cohort settlement }]
provides: [auth-suspendable whole-operation timeout]
affects: [relay-group, relay-pool]
tech-stack:
  added: []
  patterns: [call-scoped shared auth gate, activity-neutral lifetime budget]
key-files:
  created: []
  modified: [packages/relay/src/operators/auth-retry.ts, packages/relay/src/group.ts, packages/relay/src/__tests__/group-error.test.ts]
key-decisions:
  - "Add a sibling lifetime operator and leave suspendableTimeout first-progress semantics unchanged."
requirements-completed: [GROUP-04, GROUP-05]
coverage:
  - id: D1
    description: Request and opt-in subscription lifetimes ignore activity and pause across overlapping auth.
    requirement: GROUP-04
    verification: [{ kind: unit, ref: "group-error.test.ts#whole-operation timeout", status: pass }]
    human_judgment: false
duration: 4min
completed: 2026-09-01
status: complete
---

# Phase 21 Plan 02: Whole-Operation Timeout Summary

**One activity-neutral lifetime budget with shared overlapping-auth suspension for Group request and subscription**

## Accomplishments

- Added an auth-suspendable whole-lifetime RxJS operator without changing existing first-progress consumers.
- Applied the 30-second request default and numeric-only opt-in subscription lifetime.
- Preserved the established five-second completion fallback after first EOSE.

## Task Commits

1. **Whole request deadline** — `22086dd7`, `03f480d7`
2. **Subscription/auth overlap** — `6ab4ef54`, `cce8bfa7`

## Deviations from Plan

None - plan executed with the clarified legacy completion requirement.

## Self-Check: PASSED

All listed files and commits exist.
