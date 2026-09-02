---
phase: 24
slug: negentropy-sync-re-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-02
---
# Phase 24 — Validation Strategy

## Infrastructure
| Property | Value |
|---|---|
| Raw protocol | relay negentropy focused Vitest |
| Sync | relay sync/Group/Pool focused Vitest |
| Loader | sync-loader focused/full Vitest |
| Types/docs | explicit tsc project + VitePress |
| Full | Plan 24-09 Task 2 |

## Per-Task Map
| Task | Requirements | Evidence | Status |
|---|---|---|---|
| 24-01-01 | SYNC-01/02 | >32 rounds, send-before-emit, terminal/close/share | pending |
| 24-01-02 | SYNC-01/02 | options/errors/abort/unsubscribe | pending |
| 24-02-01 | SYNC-03 | positive fresh reconnect | pending |
| 24-02-02 | SYNC-03 | one auth budget/no timeout/cancel | pending |
| 24-03-01 | SYNC-02/03/04 | concurrency/fairness/nonblocking/drain/order | pending |
| 24-03-02 | SYNC-04/RESID-03 | exact results/store/zero EOSE | pending |
| 24-04-01 | SYNC-04 | Group failure isolation | pending |
| 24-04-02 | SYNC-04 | removed negentropy/Pool parity | pending |
| 24-05-01 | RESID-03 | fallback auth close/timer rearm | pending |
| 24-05-02 | SYNC-04 | structural loader union | pending |
| 24-06-01 | SYNC-01/02 | mutations 1/2 RED→GREEN | pending |
| 24-06-02 | SYNC-02 | mutation 3 RED→GREEN | pending |
| 24-07-01 | SYNC-03 | mutations 4/5 RED→GREEN | pending |
| 24-07-02 | SYNC-03 | mutations 6/7 RED→GREEN | pending |
| 24-08-01 | SYNC-01..04 | public type/export negatives | pending |
| 24-08-02 | SYNC-01..04 | docs migration | pending |
| 24-09-01 | SYNC-01..04/RESID-03 | provenance/no-timeout | pending |
| 24-09-02 | all | changesets/full gates | pending |

## Wave 0 / Non-vacuity
- [ ] Create real >32 and synchronous subscriber ordering tests before protocol rewrite.
- [ ] Create scheduler/auth/reconnect causal tests before implementation.
- [ ] Create type negatives and loader fallback timer test before declarations/migration.
- [ ] Execute all seven isolated mutations with exact diff/command/output/restore/GREEN; a normal green suite is insufficient.

## Coverage Audit
| SOURCE | ID | Plan | Status |
|---|---|---|---|
| GOAL | — | 01-09 | COVERED |
| REQ | SYNC-01 | 01,06,08,09 | COVERED |
| REQ | SYNC-02 | 01,03,06,09 | COVERED |
| REQ | SYNC-03 | 02,03,07,09 | COVERED |
| REQ | SYNC-04 | 03-05,08,09 | COVERED |
| REQ | RESID-03 | 03,05,09 | COVERED |
| CONTEXT | D-01..D-07 | 01,04,08 | COVERED |
| CONTEXT | D-08..D-14 | 02,03,07 | COVERED |
| CONTEXT | D-15..D-19 | 03,04,08 | COVERED |
| CONTEXT | D-20..D-23 | 05,08 | COVERED |
| CONTEXT | D-24 | 06,07 | COVERED |
| CONTEXT | D-25..D-27 | 08,09 | COVERED |
| RESEARCH | protocol/scheduler/error/type/docs constraints | 01-09 | COVERED |

## Failure Policy
Missing follow-up, emit-before-write, blocked negotiation, active>4, starvation, multiplied auth budget, stale reconnect state, duplicate close/execution, timeout option, silent send failure, EmptyError, unattributed Group failure, stale docs/types/provenance, or mutation residue is stop-and-investigate.

## Sign-Off
- [x] Every task has automated verification.
- [x] All requirements and D-01..27 map to evidence.
- [x] No dependency install or redundant user checkpoint.
- [ ] Complete only after all seven mutations and final gates pass.

**Approval:** pending
