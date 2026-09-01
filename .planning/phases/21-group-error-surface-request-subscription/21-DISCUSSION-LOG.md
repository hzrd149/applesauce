# Phase 21: Group Error Surface — request()/subscription() - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-01
**Phase:** 21-group-error-surface-request-subscription
**Areas discussed:** aggregate representation, timeout semantics, dynamic membership and settlement, public propagation and release

---

## Aggregate Failure Representation

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated outcome plus typed AggregateError | URL-keyed reusable success/failure arms and standard aggregate interoperability | ✓ |
| Failure-only record | Simpler Phase 21 shape but unusable as Phase 23's shared success/failure representation | |
| Separate successes/errors records | Clear but not one per-source entry shape | |

**User's choice:** Accepted after explanation.
**Notes:** Protocol completion is not transport failure; earlier events do not hide later total relay loss.

---

## Timeout Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| First-progress plus idle clocks | Two separately configurable liveness conditions | |
| One whole Observable-lifetime timeout | Convenience equivalent to applying one suspendable RxJS timeout to the returned Observable | ✓ |
| First-progress only | Preserve existing behavior where one event permanently disarms the clock | |

**User's choice:** Rejected the two-clock complexity and reaffirmed the cross-family whole-request rule.
**Notes:** Request defaults to 30 seconds; subscription is indefinite unless numeric timeout is supplied; activity never resets the budget; auth suspends it. GROUP-04/Roadmap and GROUP-05 wording must be amended explicitly.

---

## Dynamic Membership and Settlement

| Option | Description | Selected |
|--------|-------------|----------|
| Latest active cohort with method-specific empty behavior | Request empty completes; subscription empty remains pending; one state decision owns completion/error | ✓ |
| Empty always pending | Preserves future membership for requests but makes finite empty requests wait for timeout | |
| Empty always completes | Breaks dynamic subscriptions awaiting future relays | |

**User's choice:** Accepted after correcting empty-cohort semantics.
**Notes:** Mixed EOSE/error request succeeds; same-message all-failed error has precedence over normal completion.

---

## Public Propagation and Release

| Option | Description | Selected |
|--------|-------------|----------|
| Shared Group error through all Pool families | Same error instance/outcomes/options, major changeset, docs and runtime/type/wire proof | ✓ |
| Group-only contract | Leaves main Pool consumers inconsistent | |
| Pool-specific wrapper | Adds no source information and fragments handling | |

**User's choice:** Accepted all recommendations.
**Notes:** Custom completion may finish earlier but cannot convert the same final all-error state into success.

## the agent's Discretion

- Internal state-machine/operator decomposition, helper names, focused test placement, and timeout error subtype.

## Deferred Ideas

- Phase 23 progressive COUNT applies the shared outcome representation.
- Silent-but-connected subscription idle detection and per-relay liveness clocks.
