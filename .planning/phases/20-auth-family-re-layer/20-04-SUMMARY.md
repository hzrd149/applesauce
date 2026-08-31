---
phase: 20-auth-family-re-layer
plan: 04
subsystem: documentation-release
tags: [vitepress, changesets, provenance]
requires:
  - phase: 20-auth-family-re-layer
    provides: fixed raw AUTH routing and bounded authenticate implementation
provides: [public AUTH documentation, Phase 18 supersession provenance, focused major changeset]
affects: [release-coordination, phase-21]
tech-stack:
  added: []
  patterns: [dated provenance amendment, one-change one-sentence changeset]
key-files:
  created: [.changeset/relay-auth-family-re-layer.md]
  modified: [apps/docs/loading/relays/relays.md, .planning/ROADMAP.md, .planning/REQUIREMENTS.md, .planning/phases/18-event-family-re-layer/18-CONTEXT.md]
key-decisions:
  - "Phase 18 transport invariants remain; only its public verb selector is superseded."
requirements-completed: [AUTHF-01, AUTHF-02, AUTHF-03, AUTHF-04, AUTHF-05]
coverage:
  - id: D1
    description: Public docs and provenance match fixed AUTH routing and bounded authenticate options
    verification:
      - kind: other
        ref: pnpm --dir apps/docs build
        status: pass
    human_judgment: false
  - id: D2
    description: Focused applesauce-relay major changeset records the source break
    verification:
      - kind: other
        ref: Phase 20 exact changeset/static audit
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-08-31
status: complete
---

# Phase 20 Plan 04: AUTH Contract Publication Summary

**The fixed AUTH family is documented, provenance-correct, release-described, and green across Relay, loaders, Concord, Extra, types, and docs.**

## Performance

- **Duration:** 8 min
- **Tasks:** 2
- **Files modified:** 5

## Task Commits

1. **Trace shipped contract through docs and provenance** - `51102520`
2. **Add focused breaking changeset and run phase gate** - `e218b126`

## Verification

- Relay: 345 tests, type fixture, build
- Loaders: 128 tests, build
- Concord: 602 tests, build
- Extra: 1 test, build
- VitePress: production build
- Static routing, classifier parity, and exact one-sentence changeset audit

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

All listed files and commits exist, and the complete phase gate passed.
