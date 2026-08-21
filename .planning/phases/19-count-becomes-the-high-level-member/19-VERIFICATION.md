---
phase: 19-count-becomes-the-high-level-member
verified: 2026-08-21T10:10:00Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
---

# Phase 19: COUNT Becomes the High-Level Member Verification Report

**Phase Goal:** Keep `count()` as the COUNT family's high-level Observable while adding bounded policy, strict NIP-45 responses, and HLL utilities.
**Status:** passed

## Goal Achievement

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Relay, Group, and Pool preserve Observable COUNT APIs. | VERIFIED | Declarations compile and Group/Pool continue deriving Relay parameters. |
| 2 | COUNT responses validate count, approximate, and HLL before emission. | VERIFIED | `nip45.ts` strict parser and focused wire/pure tests pass. |
| 3 | Unknown own fields survive without prototype mutation. | VERIFIED | Data-property-safe copy test passes, including own `__proto__`. |
| 4 | HLL merge is a lowercase 256-register maximum. | VERIFIED | Hand-authored winner and malformed-input tests pass. |
| 5 | HLL estimation matches independent harmonic-mean fixtures. | VERIFIED | Zero, small-range, and raw-estimate fixtures pass. |
| 6 | COUNT uses one whole-request deadline across readiness/retry/backoff. | VERIFIED | Source ordering places suspendable timeout downstream of retry. |
| 7 | Deadline expiry is terminal and typed. | VERIFIED | `RelayCountTimeoutError` is emitted by the downstream timeout fallback. |
| 8 | Generic retries admit only reconnectable unclean transport failures. | VERIFIED | COUNT passes `isReconnectableTransportError` to the classifier-supplied retry operator. |
| 9 | Auth time is suspended and counters are call-scoped. | VERIFIED | Per-call `AuthPhaseGate` and explicit auth counter; existing auth/reentrancy tests pass. |
| 10 | Public exports/docs/changeset match the shipped contract. | VERIFIED | Export snapshot, docs build, and exact one-sentence changeset pass. |

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| COUNT-01 | SATISFIED | Widened options, typed terminal timeout, transport-only retry, full relay suite. |
| COUNT-02 | SATISFIED | Strict parser, forward-compatible response type, wire tests. |
| COUNT-03 | SATISFIED | Public merge/estimate helpers and independent fixtures. |

## Behavioral Verification

- `pnpm --filter applesauce-relay test`: 12 files, 327 tests passed.
- `pnpm --filter applesauce-relay build`: passed.
- `pnpm --dir apps/docs build`: passed.
- Structural D-01/operator/export audit: passed.

## Gaps Summary

No blocking gaps. Progressive per-relay isolation and aggregation remain deliberately deferred to Phase 23.

---
_Verified: 2026-08-21_
_Verifier: Codex (gsd-verifier inline fallback)_
