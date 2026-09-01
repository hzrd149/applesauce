---
phase: 23-group-count-isolation
fixed_at: 2026-09-01T23:54:15Z
review_path: .planning/phases/23-group-count-isolation/23-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-09-01T23:54:15Z
**Source review:** `.planning/phases/23-group-count-isolation/23-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: Removing the last settled outcome replays a stale removed relay

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-count.test.ts`
**Commit:** b2824208
**Applied fix:** The internal replay stream now records a filtered empty-retraction sentinel when an active cohort temporarily has no settled outcomes, preventing late subscribers from receiving removed URLs. Fixed: requires human verification.

### CR-02: Same-URL replacement does not immediately retract the replaced outcome

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-count.test.ts`
**Commit:** f9c7b443
**Applied fix:** Cohort change detection now includes relay instance identity and order, so same-normalized-URL replacement retracts the old outcome before starting and settling the replacement. Fixed: requires human verification.

### CR-03: A membership source that completes without emitting leaves count open forever

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-count.test.ts`
**Commit:** e072020e
**Applied fix:** Membership completion runs the common settlement decision, completing an empty finite operation without a public snapshot while retaining pending active counts until they settle. Fixed: requires human verification.

## Verification

- Relay suite: 387 tests passed across 14 files.
- Relay TypeScript build/typecheck: passed.
- Relay dedicated type tests: passed.
- VitePress documentation build: passed (chunk-size warning only).

---

_Fixed: 2026-09-01T23:54:15Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
