---
phase: 16-method-layering-foundation-typescript-7
plan: 01
subsystem: relay
tags: [layering, documentation, auth]
requires: []
provides: [amended D-01 contract, aligned relay citations]
affects: [phase-18, phase-20, phase-22]
tech-stack: { added: [], patterns: [one-hop throw consumer, multi-hop value signal] }
key-files: { created: [], modified: [packages/relay/src/relay.ts, packages/relay/src/operators/auth-retry.ts, packages/relay/src/__tests__/relay.test.ts] }
decisions: ["Throws may signal failure to an immediate retry or aggregation consumer; multi-hop expected state remains value-shaped."]
metrics: { tasks: 2, completed: 2026-08-19 }
status: complete
---
# Phase 16 Plan 01: Relay Method Layering Summary

D-01 now distinguishes legitimate one-hop throw consumption from multi-hop value signalling while assigning interaction and policy ownership to low- and high-level methods.

## Verification

- Exact D-01 distribution: `relay.ts` 10, `auth-retry.ts` 3, `relay.test.ts` 1.
- Relay suite: 309 tests passed.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
