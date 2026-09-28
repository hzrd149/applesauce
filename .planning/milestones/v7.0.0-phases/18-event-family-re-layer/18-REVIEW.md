---
phase: 18-event-family-re-layer
reviewed: 2026-08-20T16:13:40Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - .changeset/relay-event-publish-layering.md
  - .changeset/relay-operation-scoped-auth-callbacks.md
  - .changeset/relay-publish-response-error-field.md
  - .changeset/relay-publish-timeout-marks-itself.md
  - .changeset/wait-for-auth-pubkeys.md
  - packages/relay/src/__tests__/exports.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/pool.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/operators/auth-retry.ts
  - packages/relay/src/pool.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/types.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-08-20T16:13:40Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The EVENT raw/high-level split, forwarding signatures, typed verdict boundary, tests, and release metadata were reviewed. The focused package suite passes all 314 tests, but `publish()` still retries every thrown error except the `RelayClosedError` family. That violates the phase's explicit transient-only retry contract and can duplicate an EVENT write after an unexpected programming, parsing, or operator error.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Generic retry resends EVENT after unknown non-transient failures

**File:** `packages/relay/src/relay.ts:1411-1416`
**Classification:** BLOCKER
**Issue:** `customRetryOperator()` uses an exclusion list: it rejects only `RelayClosedError` and schedules a retry for every other error. `publish()` applies this operator to the complete raw-attempt/auth pipeline at line 1554, so an unexpected non-transient error escaping `event()`, an RxJS operator, or future attempt logic consumes the transient retry budget and writes the same EVENT again. The promised contract is the inverse: retry only `RelayEventTimeoutError` and explicitly recognized reconnectable transport failures. Retrying unknown errors hides defects and can produce duplicate side effects at the relay.

**Fix:** Add a positive retryability predicate and reject anything outside the known transient set before consulting the configured delay. Keep terminal auth errors and arbitrary errors on the immediate error path. For example:

```ts
if (!isRetryablePublishError(error)) return throwError(() => error);

if (typeof config.delay === "number") return timer(config.delay);
if (typeof config.delay === "function") return config.delay(error, count);
return of(null);
```

Define `isRetryablePublishError` narrowly around `RelayEventTimeoutError` and the socket/transport error types the relay connection layer deliberately exposes. Add a real-wire regression that injects an arbitrary `Error`, enables retries, and asserts both immediate rejection and exactly one EVENT frame.

---

_Reviewed: 2026-08-20T16:13:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
