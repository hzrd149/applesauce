---
phase: 19-count-becomes-the-high-level-member
plan: 02
subsystem: relay
tags: [rxjs, retry, timeout, auth]
requires: [{ phase: 19-01, provides: validated COUNT response boundary }]
provides: [whole-request COUNT deadline, transport-only retry, widened COUNT options]
affects: [19-03, phase-23]
tech-stack: { added: [], patterns: [deadline outside retry and suspended during auth] }
key-files:
  created: []
  modified: [packages/relay/src/types.ts, packages/relay/src/relay.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions: [Timeout is terminal and downstream of transport-only retry]
requirements-completed: [COUNT-01, COUNT-02]
duration: 8min
completed: 2026-08-21
status: complete
---
# Phase 19 Plan 02: High-Level COUNT Policy Summary

**One shared COUNT operation with a non-resetting deadline, auth suspension, and positively classified transport retries**

## Accomplishments
- Added `retries`, `reconnect`, and configurable `timeout` without changing Observable signatures.
- Kept auth and retry state call-scoped and timeout terminal outside retry.
- Preserved Group/Pool derived option forwarding and record Observables.

## Task Commits
1. **COUNT policy implementation** — `7fb16e47`

## Verification
- Full applesauce-relay suite: 327 tests passed.
- Relay declaration build passed.

## Deviations from Plan
No separate Group/Pool production edits were needed because their parameter-derived forwarding already carries the widened contract.

## Known Stubs
None.

## Self-Check: PASSED
