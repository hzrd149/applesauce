---
phase: 22-req-family-re-layer
fixed_at: 2026-09-01T22:24:16Z
review_path: .planning/phases/22-req-family-re-layer/22-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 22: Code Review Fix Report

**Fixed at:** 2026-09-01T22:24:16Z
**Source review:** `.planning/phases/22-req-family-re-layer/22-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Request lifetime timeout is still cancelled by the first progress value

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** 1283e7bd
**Applied fix:** Direct requests now use one auth-suspendable whole-operation lifetime that remains active after early events. Fixed: requires human verification.

### CR-02: REQ reconnect retries arbitrary and programming errors

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** daccb425
**Applied fix:** REQ reconnect now positively allows only unclean transport close errors; arbitrary errors remain single-attempt terminal failures. Fixed: requires human verification.

### CR-03: Function-valued filters execute eagerly instead of per cold interaction

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** 672cd234
**Applied fix:** Filter factories and completion streams are constructed inside the cold interaction so resets reevaluate them and synchronous or Observable failures use the error channel. Fixed: requires human verification.

### WR-01: The private lifecycle compositor is exposed as public API

**Files modified:** `packages/relay/src/internal.ts`, `packages/relay/src/relay.ts`, `packages/relay/src/group.ts`, `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts`, `packages/relay/src/__tests__/group-error.test.ts`, `packages/relay/src/__tests__/group.test.ts`, `packages/relay/src/__tests__/pool.test.ts`, `packages/relay/src/__tests__/relay.test.ts`, `packages/relay/type-tests/req-family-types.ts`
**Commit:** 4869b363
**Applied fix:** The named public method was replaced by a package-internal symbol compositor used by Group and internal tests, with a negative type test for the removed public seam.

## Verification

- Relay suite: 380 tests passed across 13 files.
- Relay TypeScript build/typecheck: passed.
- Relay dedicated type tests: passed.
- VitePress documentation build: passed (chunk-size warning only).

---

_Fixed: 2026-09-01T22:24:16Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
