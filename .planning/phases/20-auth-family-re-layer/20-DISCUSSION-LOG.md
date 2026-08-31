# Phase 20: AUTH Family Re-layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-31
**Phase:** 20-auth-family-re-layer
**Areas discussed:** challenge acquisition and freshness, high-level policy and errors, raw AUTH bookkeeping and classifier parity, family architecture and public verb boundary

---

## Challenge Acquisition and Freshness

| Option | Description | Selected |
|--------|-------------|----------|
| Bounded acquisition and freshness retry | Wait for a challenge, sign a snapshot, discard and re-sign if it moves, with a small explicit budget | ✓ |
| Immediate missing-challenge rejection | Preserve the current synchronous read but return it as a Promise rejection | |
| Unbounded challenge following | Keep re-signing for every challenge change | |

**User's choice:** Accepted bounded challenge acquisition, snapshot comparison, and one default freshness retry.
**Notes:** Stable relay rejection is a verdict, not a freshness retry; repeated identical challenge emissions do not consume budget.

---

## High-level Policy and Errors

| Option | Description | Selected |
|--------|-------------|----------|
| Optional policy object | Preserve signer-first Promise API and add whole timeout, challenge retries, and AbortSignal | ✓ |
| Per-stage clocks | Give readiness, signing, and reply separate resettable clocks | |
| Observable authenticate | Convert the high-level method from Promise to Observable | |

**User's choice:** Accepted the optional Promise-based policy object and one whole logical-operation deadline.
**Notes:** The deadline includes readiness, acquisition, signing, freshness retries, and reply; abort suppresses late signer output.

---

## Raw AUTH State and Cross-package Errors

| Option | Description | Selected |
|--------|-------------|----------|
| Attempt-local bookkeeping and classifier parity | Update state only for real low attempts and recognize every terminal auth error across duck-typed consumers | ✓ |
| Candidate bookkeeping | Record state as soon as high-level signing begins | |
| Relay-only error classes | Add errors without loader/group parity | |

**User's choice:** Accepted real-attempt-only bookkeeping, redacted lifecycle logging, and actual-error-instance classifier tests.
**Notes:** Discarded stale candidates and aborted operations must not pollute authentication state.

---

## Family Architecture and Public Verb Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Direct AUTH reimplementation | Give `auth()` a separate copy of readiness/listen/write/timeout machinery | |
| Private shared raw helper | Fix public `event()` to EVENT and `auth()` to AUTH while sharing a private one-frame/one-OK primitive | ✓ |
| Retain public verb selector | Keep `event(event, "EVENT" | "AUTH")` as the raw public escape hatch | |

**User's choice:** Accepted the private-helper design after a focused architecture audit.
**Notes:** The public selector can currently send AUTH while bypassing AUTH bookkeeping and logging. Phase 18 provenance and AUTHF-04 must be amended explicitly, and the v7 source break recorded in a focused changeset.

## the agent's Discretion

- Internal helper, option, and error names.
- RxJS/Promise decomposition, focused test placement, and redacted log wording.

## Deferred Ideas

- Group/pool authentication aggregation.
- Cross-call authentication deduplication.
- Generic retry policy inside `authenticate()` beyond challenge freshness.
