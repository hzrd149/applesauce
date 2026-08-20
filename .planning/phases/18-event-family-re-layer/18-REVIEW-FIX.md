---
phase: 18-event-family-re-layer
fixed_at: 2026-08-20T16:17:28Z
review_path: .planning/phases/18-event-family-re-layer/18-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 18: Code Review Fix Report

**Fixed at:** 2026-08-20T16:17:28Z
**Source review:** `.planning/phases/18-event-family-re-layer/18-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 1
- Fixed: 1
- Skipped: 0

## Fixed Issues

### CR-01: Generic retry resends EVENT after unknown non-transient failures

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** 95c2531b
**Applied fix:** Replaced retry-by-default with a positive whitelist for `RelayEventTimeoutError` and unclean WebSocket close events, and added a real-wire regression proving an arbitrary operator error rejects after one EVENT frame. Fixed; requires human verification because this changes retry classification logic.

---

_Fixed: 2026-08-20T16:17:28Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
