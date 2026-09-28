---
phase: 21-group-error-surface-request-subscription
plan: 04
subsystem: documentation
tags: [vitepress, changesets, relay]
requires: [{ phase: 21-03, provides: public Group and Pool contract }]
provides: [consumer guidance, provenance amendment, major changeset]
affects: [release, phase-22, phase-23]
tech-stack:
  added: []
  patterns: [in-place integration guidance, single-sentence changeset]
key-files:
  created: [.changeset/relay-group-error-surface.md]
  modified: [apps/docs/loading/relays/pool.md, apps/docs/migration/v5-v6.md, .planning/REQUIREMENTS.md, .planning/ROADMAP.md]
key-decisions:
  - "Document one whole-returned-Observable timeout rather than first/idle clocks."
requirements-completed: [GROUP-01, GROUP-02, GROUP-03, GROUP-04, GROUP-05]
coverage:
  - id: D1
    description: Documentation, provenance, and release metadata match the tested Group contract.
    requirement: GROUP-05
    verification: [{ kind: other, ref: "pnpm --dir apps/docs build", status: pass }]
    human_judgment: false
duration: 4min
completed: 2026-09-01
status: complete
---

# Phase 21 Plan 04: Documentation and Release Summary

> **Phase 22 D-23/D-24 amendment:** Subscription timeout documentation and changeset claims are superseded; caller-composed RxJS bounds are current.

**Concise Group/Pool error and timeout guidance with corrected provenance and one major relay changeset**

## Accomplishments

- Updated existing Pool and migration documentation with aggregate, empty, mixed, dynamic, and timeout behavior.
- Amended GROUP-04/GROUP-05 and stale roadmap notes to the locked whole-lifetime contract.
- Added the exact one-package, one-sentence major changeset and passed the full phase gate.

## Task Commits

1. **Documentation and provenance** — `72353908`, `a9d16791`
2. **Major changeset** — `d084099e`

## Verification

- Focused suites: 71 tests passed.
- Full relay suite: 370 tests passed.
- Relay type-test compile, package build, docs build, provenance, and dependency-integrity gates passed.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All listed files and commits exist.
