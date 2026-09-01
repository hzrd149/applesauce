---
phase: 22-req-family-re-layer
plan: 09
status: complete
subsystem: relay-validation
tags: [mutation, req, provenance, gap-closure]
requires: [22-08]
provides: [REQ-04 mutation evidence, whole-lifetime oracle amendment]
key-files:
  modified:
    - packages/relay/src/group.ts
    - packages/relay/src/__tests__/group.test.ts
    - .planning/phases/22-req-family-re-layer/22-04-SUMMARY.md
---
# Phase 22 Plan 09: REQ-04 Evidence Gap Closure Summary

Exact D-19/D-20 causal RED→GREEN evidence plus an honest supersession of the obsolete Group ERROR progress oracle under value-agnostic whole-operation timing.

## Accomplishments

- Recorded isolated fresh-attempt and clean-CLOSED-holder mutations with named failures, exit codes, restore commands, and identical-command GREEN results.
- Strengthened the Group ERROR-plus-silence test to assert the declared whole-lifetime deadline remains armed.
- Removed timing-critical claims from the retained legacy `isGroupReqProgress` export and cited Phase 13 residual backlog 999.18 WR-07.
- Reconciled REQ-04, D-21/D-22, validation, and verification to 12/12 without claiming a false Group ERROR RED result.

## Verification

- Named Relay mutation targets pass after restoration.
- Group whole-operation ERROR tests pass.
- Static audit finds one `isGroupReqProgress` occurrence: its legacy export only.
- `packages/relay/src/relay.ts` is byte-identical to HEAD.

## Deviations from Plan

The temporary worktree could not use the literal `pnpm` shim from `/tmp` because its relative managed-store lookup resolved to `/tmp/.pnpm-store`; the same repository Vitest binary was invoked directly with identical arguments and no installation or dependency change.

## Self-Check: PASSED
