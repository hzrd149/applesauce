---
phase: 22-req-family-re-layer
plan: 03
status: complete
subsystem: relay-group-pool
tags: [group, pool, dedupe, settlement]
---
# Phase 22 Plan 03: Group and Pool REQ Integration Summary

Group and Pool consume lifecycle-aware attempts, retain aggregate settlement and call-scoped deduplication, and expose no subscription duration clock.

## Verification

- Group/Pool focused tests: 74/74.
- Relay build passes.

## Deviations from Plan

A fallback to raw `req()` remains only for structural fake Relay fixtures that do not implement the lifecycle method; real Relay instances always use the compositor.

## Self-Check: PASSED
