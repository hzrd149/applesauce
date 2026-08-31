---
phase: 20-auth-family-re-layer
fixed_at: 2026-08-31T16:46:57Z
review_path: .planning/phases/20-auth-family-re-layer/20-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-08-31T16:46:57Z
**Source review:** `.planning/phases/20-auth-family-re-layer/20-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Abort and outer timeout do not cancel an in-flight AUTH exchange

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** 9e2acbb9
**Applied fix:** Kept the final AUTH exchange observable cancellable through `takeUntil` and added post-write abort/timeout tests proving late `OK` frames cannot update authentication state.

### CR-02: Event IDs are not valid identities for concurrent AUTH attempts

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** e10c9a10
**Applied fix:** Added unique in-memory attempt tokens for keyed and deprecated state mirrors and serialized duplicate deterministic event IDs so sequential opposite wire verdicts settle the correct logical calls. Fixed; requires human verification because this changes concurrency coordination semantics.

### CR-03: Vertex drops authentication failures as unhandled rejections

**Files modified:** `packages/extra/src/vertex.ts`, `packages/extra/src/__tests__/vertex.test.ts`
**Commit:** ce07f593
**Applied fix:** Consumed automatic authentication rejection, reported it through the existing console channel, and verified the in-flight guard resets for a later challenge.

### WR-01: Public numeric policy accepts nonsensical retry and timeout values

**Files modified:** `packages/relay/src/relay.ts`, `packages/relay/src/types.ts`, `packages/relay/src/__tests__/relay.test.ts`
**Commit:** a450cf92
**Applied fix:** Rejected non-finite, negative, or fractional retry policies and non-finite or negative deadlines before connection work; documented and tested zero-value behavior.

### WR-02: Phase tests claim cancellation/concurrency coverage without exercising the failing boundaries

**Files modified:** `packages/relay/src/__tests__/relay.test.ts`
**Commit:** aed45027
**Applied fix:** Strengthened real-wire assertions for post-write cancellation, late opposite verdicts, deterministic duplicate IDs, logical promise settlement, and both keyed and deprecated authentication mirrors.

## Verification

- Relay suite: 12 files passed, 356 tests passed.
- Vertex focused suite: 1 file passed, 2 tests passed.
- `applesauce-core`, `applesauce-signers`, and `applesauce-relay` builds passed.
- Relay public type fixture passed with `tsc -p packages/relay/tsconfig.type-tests.json --noEmit`.

---

_Fixed: 2026-08-31T16:46:57Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
