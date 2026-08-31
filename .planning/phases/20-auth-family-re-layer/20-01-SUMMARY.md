---
phase: 20-auth-family-re-layer
plan: 01
subsystem: relay-auth
tags: [nip-42, rxjs, typescript]
requires:
  - phase: 18-event-family-re-layer
    provides: one-attempt EVENT transport invariants
provides: [fixed EVENT and AUTH public routes, private raw exchange, compile-time selector guard]
affects: [relay, loaders, concord, extra]
tech-stack:
  added: []
  patterns: [private verb-discriminated raw exchange, compile-only API regression fixture]
key-files:
  created: [packages/relay/type-tests/event-auth-types.ts, packages/relay/tsconfig.type-tests.json]
  modified: [packages/relay/src/relay.ts, packages/relay/src/__tests__/relay.test.ts]
key-decisions:
  - "Public event and auth select fixed wire verbs while sharing only the private frame/reply primitive."
requirements-completed: [AUTHF-04]
coverage:
  - id: D1
    description: Fixed EVENT and AUTH routing with family-specific verdict behavior
    requirement: AUTHF-04
    verification:
      - kind: integration
        ref: packages/relay/src/__tests__/relay.test.ts#RAUTH-06
        status: pass
    human_judgment: false
  - id: D2
    description: Removed selector rejected at compile time
    requirement: AUTHF-04
    verification:
      - kind: other
        ref: pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-08-31
status: complete
---

# Phase 20 Plan 01: Fixed Raw AUTH Routing Summary

**EVENT and AUTH now use fixed public members over one private listener-before-write exchange, with a compiler-enforced selector removal.**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files modified:** 4

## Task Commits

1. **Trace fixed EVENT and AUTH frames** - `6b774acb`
2. **Make removed selector fail at compile time** - `3d59433c`

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All listed files and commits exist; focused runtime, build, and type-test gates passed.
