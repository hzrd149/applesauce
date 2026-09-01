---
phase: 21-group-error-surface-request-subscription
plan: 01
subsystem: relay
tags: [rxjs, aggregate-error, dynamic-membership]
requires: []
provides: [RelayOutcome, RelayGroupError, latest-cohort settlement]
affects: [phase-22, phase-23, relay-group]
tech-stack:
  added: []
  patterns: [membership-first cohort replacement, single terminal arbitrator]
key-files:
  created: [packages/relay/src/__tests__/group-error.test.ts]
  modified: [packages/relay/src/types.ts, packages/relay/src/group.ts]
key-decisions:
  - "Install the entire normalized replacement cohort before subscribing new relay streams."
  - "Preserve the five-second post-EOSE fallback while the arbitrator owns terminal settlement."
requirements-completed: [GROUP-01, GROUP-02, GROUP-03]
coverage:
  - id: D1
    description: Total active-cohort failure raises RelayGroupError with URL-keyed identity-preserved causes.
    requirement: GROUP-01
    verification: [{ kind: integration, ref: "group-error.test.ts#RelayGroupError", status: pass }]
    human_judgment: false
duration: 8min
completed: 2026-09-01
status: complete
---

# Phase 21 Plan 01: Group Aggregate Settlement Summary

**Typed aggregate relay failure with normalized per-source outcomes and deterministic latest-cohort settlement**

## Accomplishments

- Exported `RelayOutcome<T>` and `RelayGroupError` with native ordered causes.
- Added membership-first request/subscription settlement covering empty, mixed, replacement, and final-error precedence cases.
- Preserved raw `req()` lifecycle bookkeeping unchanged.

## Task Commits

1. **Trace failed cohort** — `db0e2865`, `fa0eec84`
2. **Complete cohort settlement** — `e4aa6af2`, `22ce1f94`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Installed the complete cohort before synchronous inner subscription**
- **Found during:** Task 1
- **Issue:** A synchronous first failure could settle before later relay URLs entered pending state.
- **Fix:** Split membership installation from inner subscription.
- **Verification:** Focused normalized aggregate test passes.
- **Committed in:** `fa0eec84`

## Self-Check: PASSED

All listed files and commits exist.
