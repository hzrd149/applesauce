---
phase: 21-group-error-surface-request-subscription
fixed_at: 2026-09-01T15:51:40Z
review_path: .planning/phases/21-group-error-surface-request-subscription/21-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 21: Code Review Fix Report

**Fixed at:** 2026-09-01T15:51:40Z
**Source review:** `.planning/phases/21-group-error-surface-request-subscription/21-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Same-URL relay replacement keeps the removed relay subscribed

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-error.test.ts`
**Commit:** 8154b929
**Applied fix:** Relay subscription entries now retain relay identity, replace a different instance at the same normalized URL, and ignore the removed instance. Fixed: requires human verification.

### CR-02: Removing and re-adding a URL duplicates native aggregate causes

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-error.test.ts`
**Commit:** 81f583d6
**Applied fix:** Settlement ordering is rebuilt from each current normalized cohort so re-added URLs produce exactly one aggregate cause. Fixed: requires human verification.

### CR-03: Synchronous per-relay request construction bypasses aggregate settlement

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-error.test.ts`
**Commit:** b07e058b
**Applied fix:** Per-relay projection is deferred so synchronous filter-factory and request-construction throws enter normal relay failure settlement after the cohort is installed. Fixed: requires human verification.

### CR-04: Errors from custom completion operators are detached from the returned Observable

**Files modified:** `packages/relay/src/group.ts`, `packages/relay/src/__tests__/group-error.test.ts`
**Commit:** 7537884d
**Applied fix:** The completion observer forwards operator errors through the returned Observable while the existing decision-before-notification ordering preserves all-failed precedence. Fixed: requires human verification.

## Verification

- Relay suite: 374 tests passed across 13 files.
- Relay TypeScript build/typecheck: passed.
- Relay dedicated type tests: passed.
- VitePress documentation build: passed (chunk-size warning only).

---

_Fixed: 2026-09-01T15:51:40Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
