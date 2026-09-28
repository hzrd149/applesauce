# Phase 23: Group count() Isolation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-01
**Phase:** 23-group-count-isolation
**Areas discussed:** progressive result contract, cohort identity and sharing, per-relay policy and aggregate use, compatibility and proof

---

## Progressive Result Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Cumulative RelayOutcome snapshots | Emit settled success/failure entries progressively and complete with the current cohort | ✓ |
| Delta entries | Make consumers rebuild membership state | |
| All-at-once combineLatest | Retain slowest-relay gating and fail-fast behavior | |

**User's choice:** Accepted all recommendations.
**Notes:** All relay failures still produce a final outcome record; only membership/invariant failures stay outer errors.

---

## Cohort Identity and Sharing

| Option | Description | Selected |
|--------|-------------|----------|
| Latest normalized cohort, immutable ordered snapshots, one replayed execution | Replace instances safely and preserve one call-scoped ID | ✓ |
| Restart full cohort | Duplicate retained relay work | |
| Per-subscriber/no-replay | Miss progressive state or duplicate COUNT requests | |

**User's choice:** Accepted all recommendations.
**Notes:** Empty cohorts complete without an empty record; non-empty membership retractions emit revised snapshots.

---

## Per-relay Policy and Aggregate Use

| Option | Description | Selected |
|--------|-------------|----------|
| Independent scalar COUNT operations | Uniform forwarded inputs, full concurrency, isolated lifecycle and cancellation | ✓ |
| Group-wide policy budgets | Couple unrelated relays | |
| Automatic total | Hide failures/missing HLL and risk double counting | |

**User's choice:** Accepted all recommendations.
**Notes:** Consumers use successful HLL sketches and existing union helpers; partial results are provisional.

---

## Compatibility and Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Intentional Group/Pool major entry-type break | Named public type, canonical docs/provenance, combineLatest RED→GREEN mutation | ✓ |
| Auxiliary errors/new method | Leave canonical count defective or fragment API | |
| Green tests only | Fail to prove progression is not still gated | |

**User's choice:** Accepted all recommendations.
**Notes:** Relay scalar COUNT remains unchanged; membership errors preserve outer cause identity.

## the agent's Discretion

- Exported record alias/private helper names, RxJS decomposition, and focused test placement.

## Deferred Ideas

- Per-relay input/policy maps, concurrency controls, and automatic totals.
