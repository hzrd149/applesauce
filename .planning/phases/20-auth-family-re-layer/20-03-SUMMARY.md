---
phase: 20-auth-family-re-layer
plan: 03
subsystem: auth-integration
tags: [duck-typing, relay-group, loaders, vertex]
requires:
  - phase: 20-auth-family-re-layer
    provides: pinned terminal authenticate errors
provides: [cross-package terminal error parity, verified Concord and Vertex compatibility]
affects: [loaders, concord, extra]
tech-stack:
  added: []
  patterns: [actual-instance parity tests across name-based boundaries]
key-files:
  created: [packages/extra/src/__tests__/vertex.test.ts]
  modified: [packages/relay/src/group.ts, packages/loaders/src/loaders/sync-loader.ts]
key-decisions:
  - "Production loader coupling remains structural while tests import actual relay error instances."
requirements-completed: [AUTHF-03, AUTHF-05]
coverage:
  - id: D1
    description: Group and loader recognize every new terminal authenticate error
    requirement: AUTHF-05
    verification:
      - kind: integration
        ref: packages/loaders/src/loaders/__tests__/sync-loader.test.ts#actual terminal instances
        status: pass
    human_judgment: false
  - id: D2
    description: Vertex retains challenge-driven high-level authentication
    verification:
      - kind: unit
        ref: packages/extra/src/__tests__/vertex.test.ts
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-31
status: complete
---

# Phase 20 Plan 03: AUTH Integration Parity Summary

**Pinned timeout and freshness errors now cross Group and loader boundaries, while Concord and Vertex retain their high-level authentication behavior.**

## Task Commits

1. **Trace terminal errors across classifiers** - `042b7eb9`
2. **Prove Concord and Vertex compatibility** - `bbe61ce1`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

Group 31/31, loader 42/42, Concord 602/602, Extra 1/1, and all affected builds passed.
