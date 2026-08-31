---
phase: 20-auth-family-re-layer
plan: 02
subsystem: relay-auth
tags: [nip-42, timeout, abort-signal, freshness]
requires:
  - phase: 20-auth-family-re-layer
    provides: fixed raw AUTH member
provides: [bounded challenge acquisition, freshness-aware signing, abort-safe authentication, typed terminal errors]
affects: [relay-group, loaders, concord, vertex]
tech-stack:
  added: []
  patterns: [one absolute logical-operation deadline, snapshot-sign-compare freshness loop]
key-files:
  created: []
  modified: [packages/relay/src/types.ts, packages/relay/src/relay.ts, packages/relay/src/__tests__/relay.test.ts, packages/relay/src/__tests__/auth-lifecycle-logging.test.ts]
key-decisions:
  - "The outer timeout races every authenticate stage once and never resets; timeout false leaves the fixed raw reply bound intact."
  - "Only changed or null post-sign challenges consume the explicit freshness budget."
requirements-completed: [AUTHF-01, AUTHF-02, AUTHF-03]
coverage:
  - id: D1
    description: Fresh relay challenge acquisition and whole-operation failure semantics
    requirement: AUTHF-01
    verification:
      - kind: integration
        ref: packages/relay/src/__tests__/relay.test.ts#authenticate
        status: pass
    human_judgment: false
  - id: D2
    description: Freshness retry and abandoned candidate suppression
    requirement: AUTHF-02
    verification:
      - kind: integration
        ref: packages/relay/src/__tests__/relay.test.ts#discards a stale signed candidate
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-08-31
status: complete
---

# Phase 20 Plan 02: Bounded Authenticate Lifecycle Summary

**Authenticate now owns a single 30-second-default deadline across challenge wait, signing, freshness retries, abort, and the fixed AUTH reply.**

## Performance

- **Duration:** 10 min
- **Tasks:** 2
- **Files modified:** 5

## Task Commits

1. **Authenticate through bounded challenge and reply lifecycle** - `79cdf118`
2. **Prove freshness, abort, concurrency, and redacted logging** - `eb4a54ee`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated relay export snapshot for the new public errors**
- **Found during:** Full relay suite
- **Fix:** Added both pinned terminal error exports to the API snapshot.
- **Committed in:** `79cdf118`

## Issues Encountered

Cancellation initially allowed RxJS teardown to win the rejection race; ordering the typed cancellation rejection before stream teardown restored error parity.

## Self-Check: PASSED

All listed files and commits exist; 342 relay tests, relay build, type fixture, and focused lifecycle logging passed.
