---
phase: 17-correctness-fixes-concord-residuals
plan: 03
subsystem: common
tags: [group-pointers, websocket, url-normalization, compatibility]
requires: [16-method-layering-foundation-typescript-7]
provides: [lossless group-pointer relay serialization, first-apostrophe ID parsing, fragment rejection]
affects: [applesauce-common group pointer consumers]
tech-stack: { added: [], patterns: [first-delimiter compatibility codec, independently expected round-trip matrix] }
key-files:
  created: [.changeset/group-pointer-lossless-roundtrip.md]
  modified: [packages/common/src/helpers/groups.ts, packages/common/src/helpers/__tests__/groups.test.ts]
decisions: ["Omit only a default wss scheme that decoding reconstructs exactly; retain ws schemes, ports, IPv6 authorities, paths, and queries."]
requirements-completed: [FIX-03]
coverage:
  - id: D1
    description: "Group-pointer compatibility strings retain the complete normalized WebSocket relay endpoint and arbitrary ID remainder."
    requirement: FIX-03
    verification:
      - kind: unit
        ref: "packages/common/src/helpers/__tests__/groups.test.ts#Group pointer utilities"
        status: pass
      - kind: other
        ref: "pnpm --filter applesauce-common build"
        status: pass
    human_judgment: false
metrics: { duration: 4m, tasks: 2, files: 3, completed: 2026-08-20 }
status: complete
---
# Phase 17 Plan 03: Lossless Group Pointer Compatibility Summary

Applesauce group-pointer compatibility strings now preserve normalized WebSocket schemes, authorities, ports, paths, queries, and apostrophe-bearing IDs while rejecting fragments.

## Verification

- `pnpm --filter applesauce-common exec vitest run src/helpers/__tests__/groups.test.ts`: 13 tests passed.
- `pnpm --filter applesauce-common test`: 545 tests passed across 65 files.
- `pnpm --filter applesauce-common build`: passed.
- The changeset shape gate confirmed exactly one patch-scoped Markdown sentence.
- Non-vacuity mutation restoring `URL.hostname` produced five expected failures covering scheme, port, IPv6, and path/query loss; restoring the implementation returned the focused suite to green.

## TDD Gate Compliance

- RED: `a9812f23` added the localhost/port and apostrophe-ID tracer and failed against the prior implementation.
- GREEN: `413db1a8` implemented full endpoint normalization, first-delimiter parsing, and fragment rejection; the tracer passed before expansion.
- Expansion: `82fe2739` replaced the focused cases with the complete independent compatibility matrix and added release metadata.

## Decisions Made

- Treat the apostrophe format as Applesauce compatibility policy, explicitly separate from NIP-29 kind-39000 `naddr` references.
- Remove only a reconstructible default `wss://` scheme; preserve `ws://` and every endpoint component that affects relay identity.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- All three planned artifacts exist.
- Commits `a9812f23`, `413db1a8`, and `82fe2739` exist in history.
- All task acceptance criteria and plan-level verification gates pass.
