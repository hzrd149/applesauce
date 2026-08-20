---
phase: 17-correctness-fixes-concord-residuals
plan: 01
subsystem: relay
tags: [security, closed-reasons, retry, websocket]
requires: [16-method-layering-foundation-typescript-7]
provides: [prototype-safe CLOSED prefix classification, public retry-path regressions]
affects: [applesauce-relay REQ error handling]
tech-stack: { added: [], patterns: [private mutable Map for closed-prefix constructors] }
key-files:
  created: [.changeset/relay-closed-prefix-safety.md]
  modified: [packages/relay/src/relay.ts, packages/relay/src/__tests__/relay.test.ts]
decisions: ["Keep CLOSED prefix extension private while using a mutable Map for exact-key classification."]
metrics: { duration: 2m, tasks: 2, files: 3, completed: 2026-08-20 }
status: complete
---
# Phase 17 Plan 01: Prototype-Safe CLOSED Prefix Classification Summary

Relay-controlled CLOSED reasons now use exact `Map` lookup, preventing inherited property names from changing error typing or retry behavior while preserving every recognized prefix.

## Verification

- TDD RED: focused FIX-01 tests timed out for `constructor:` and `__proto__:` against the object lookup; the unknown and recognized controls passed.
- `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts`: 175 tests passed, including the repeated tracer gate.
- `pnpm --filter applesauce-relay test`: 313 tests passed across 11 files.
- `pnpm --filter applesauce-relay build`: passed with declaration output.
- Export review confirmed `CLOSED_ERROR_PREFIXES` and `parseClosedError` remain module-private.
- Changeset shape gate confirmed one patch-scoped Markdown sentence.

## Decisions Made

- Kept the prefix registry as an internal mutable `Map`; no registration, override, injection, or lifecycle API was exported.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- All three planned artifacts exist.
- Commits `01c19931`, `086622d1`, and `25909a1d` exist in history.
- All task acceptance criteria and plan-level verification gates pass.
