# Phase 24: Negentropy & Sync Re-layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-02
**Phase:** 24-negentropy-sync-re-layer
**Areas discussed:** Low-level negentropy rounds, Sync operation policy, Bidirectional result surface, Migration and proof

---

## Low-level negentropy rounds

| Option | Description | Selected |
|--------|-------------|----------|
| Observable rounds | Cold shared-one-execution `Observable<NegentropyRound>`; send each follow-up before emitting the learned round | ✓ |
| Fire-and-forget callback | Keep reconcile callback but stop awaiting it | |
| Accumulated Promise | Resolve all learned rounds after negotiation completes | |

**User's choice:** Observable rounds with strict reconcile → follow-up send → emit ordering.
**Notes:** Every round emits, including terminal/empty rounds; low-level negotiation never waits for transfers and cancellation performs deterministic NEG-CLOSE teardown.

---

## Sync operation policy

| Option | Description | Selected |
|--------|-------------|----------|
| One coordinator, caller lifetime | One global auth budget/gate, no built-in timeout, positive fresh reconnect, unified fair concurrency-4 queue drained before completion | ✓ |
| Per-verb policy | Negotiation, publish, and request keep independent auth/reconnect budgets | |
| Built-in whole timeout | Add a default sync lifetime clock | |

**User's choice:** One operation coordinator with caller-owned lifetime policy.
**Notes:** Reconnect rebuilds current storage and starts a fresh NEG ID/state; the queue is globally bounded and fair between SEND and RECEIVE.

---

## Bidirectional result surface

| Option | Description | Selected |
|--------|-------------|----------|
| Typed progress unions | `SyncMessage` reports received/sent/send-failed; Group adds attributed relay-failed; Pool forwards | ✓ |
| Raw receive events | Preserve `NostrEvent` values and keep SEND results private | |
| Fail-fast sends | Error the whole operation on the first failed upload | |

**User's choice:** Typed, attributed outcome values with per-transfer/per-relay isolation.
**Notes:** Writable store acceptance precedes received emission; read-only inputs still surface fetched events; zero-event EOSE succeeds without `EmptyError`.

---

## Migration and proof

| Option | Description | Selected |
|--------|-------------|----------|
| Coordinated major with mutations | Raw options/API cleanup, remove Group/Pool negentropy, loader fallback fix, seven deliberate RED→GREEN proofs, split changesets | ✓ |
| Compatibility adapters | Keep deprecated callback/group methods for one release | |
| Green-suite only | Rely on ordinary tests without deliberate reversions | |

**User's choice:** Coordinated major migration with exact mutation evidence.
**Notes:** Amend SYNC-03/Roadmap to record caller-owned lifetime instead of an operation clock; update loaders, docs, examples, type mirrors, exports, and pending changeset provenance together.

## the agent's Discretion

- Internal scheduler/operator decomposition and private names.
- Whether a late concurrent low-level subscriber receives the most recent round, provided it cannot start a duplicate negotiation.
- Fair-lane arbitration mechanics, subject to the global bound, FIFO-per-lane, and no-starvation proofs.

## Deferred Ideas

None.
