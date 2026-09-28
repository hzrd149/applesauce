# Phase 22: REQ Family Re-layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-01
**Phase:** 22-req-family-re-layer
**Areas discussed:** raw req boundary, finite request policy, persistent subscription policy, migration and regression proof

---

## Raw req Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| ID-only raw options with full FilterInput | Preserve dynamic filters and move all policy upward | ✓ |
| Static filters only | Stronger one-frame purity but wider source break | |
| Keep policy in raw req | Retain current nested ownership | |

**User's choice:** Accepted all recommendations.
**Notes:** Raw req remains readiness-aware, lifecycle-valued, shared per call, and exact about CLOSE teardown.

---

## Finite request Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh attempts under call-scoped ID/budgets | Positive reconnect/repeat/auth branches and one whole timeout | ✓ |
| Per-attempt IDs/clocks | Reset identity and deadlines on retry | |
| Broad generic retry | Retry all non-relay errors | |

**User's choice:** Accepted all recommendations.
**Notes:** EOSE/custom completion terminate successfully without policy re-entry; errors win on the same terminal notification.

---

## Persistent subscription Policy

| Option | Description | Selected |
|--------|-------------|----------|
| High-level re-establish loop with no timeout | Stable ID, repeated EOSE, layer-specific dedupe, consumer-owned lifetime | ✓ |
| Optional built-in lifetime timeout | Carry Phase 21’s Group/Pool timeout into subscriptions | |
| Generic retry loop | Merge auth/reconnect/repeat classifications | |

**User's choice:** Accepted Q1–Q3 and explicitly rejected every built-in subscription timeout.
**Notes:** Remove Phase 21’s newly added timeout across Relay/Group/Pool and amend all provenance; total Group/Pool failure still errors immediately.

---

## Migration and Regression Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Positive type split + shared lifecycle compositor + mutation proof | Preserve sync auth and Phase 13 invariants while correcting pending release metadata | ✓ |
| Duplicate loops and trust green tests | Simpler relocation without deliberate reverts | |
| Defer internal consumers/provenance | Allow temporary behavior/doc contradictions | |

**User's choice:** Accepted all recommendations.
**Notes:** Phase 21’s pending major changeset is revised in place; Phase 22 adds a focused one-sentence major changeset.

## the agent's Discretion

- Private compositor/operator names, implementation decomposition, test placement, and concise docs examples.

## Deferred Ideas

- Phase 24’s final sync policy consolidation.
- Relay-level subscription deduplication.
