---
phase: 24-negentropy-sync-re-layer
fixed_at: 2026-09-02T17:25:46Z
review_path: .planning/phases/24-negentropy-sync-re-layer/24-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Fix Report

**Fixed at:** 2026-09-02T17:25:46Z
**Source review:** `.planning/phases/24-negentropy-sync-re-layer/24-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: Reconnect retains work and results from the failed negotiation attempt

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/sync.test.ts`
**Commit:** 16a78cf5
**Applied fix:** Every reconnect generation now owns an abort controller, queues, scheduler counters, and completion state; reconnectable negotiation failure invalidates and cancels that generation before retry so queued jobs never start and late in-flight settlements cannot emit. Fixed: requires human verification.

### CR-02: Premature protocol completion is accepted as successful negotiation

**Files modified:** `packages/relay/src/negentropy.ts`, `packages/relay/src/__tests__/negentropy.test.ts`
**Commit:** 98d65891
**Applied fix:** Raw negotiation records terminal-round processing and converts uncancelled upstream completion before that round into a typed `NegentropyError` instead of successful completion. Fixed: requires human verification.

### CR-03: Group sync captures membership eagerly and ignores later removal

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group.test.ts`
**Commit:** 4afc4eb6
**Applied fix:** Group sync now tracks normalized current membership and relay instance identity, cancels removed/replaced relays, ignores late stale signals, and supports observable-controlled groups without accessing the throwing snapshot getter. Fixed: requires human verification.

## Verification

- Relay suite: 408 tests passed across 16 files.
- Loader suite: 130 tests passed across 16 files.
- Relay and loader TypeScript builds: passed.
- Relay dedicated type tests: passed.
- VitePress documentation build: passed (chunk-size warning only).

---

_Fixed: 2026-09-02T17:25:46Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
