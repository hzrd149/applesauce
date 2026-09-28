---
phase: 24
slug: negentropy-sync-re-layer
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| Full | Plan 24-10 Task 2 |

## Per-Task Map
| Task | Requirements | Evidence | Status |
|---|---|---|---|
| 24-01-01 | SYNC-01/02 | >32 rounds, send-before-emit, terminal/close/share | passed |
| 24-01-02 | SYNC-01/02 | options/errors/abort/unsubscribe | passed |
| 24-02-01 | SYNC-03 | positive fresh reconnect | passed |
| 24-02-02 | SYNC-03 | one auth budget/no timeout/cancel | passed |
| 24-03-01 | SYNC-02/03/04 | concurrency/fairness/nonblocking/drain/order | passed |
| 24-03-02 | SYNC-04/RESID-03 | exact results/store/zero EOSE | passed |
| 24-04-01 | SYNC-04 | Group failure isolation | passed |
| 24-04-02 | SYNC-04 | removed negentropy/Pool parity | passed |
| 24-05-01 | RESID-03 | fallback auth close/timer rearm | passed |
| 24-05-02 | SYNC-04 | structural loader union | passed |
| 24-06-01 | SYNC-01/02 | mutations 1/2 RED→GREEN | passed |
| 24-06-02 | SYNC-02 | mutation 3 RED→GREEN | passed |
| 24-07-01 | SYNC-03 | mutations 4/5 RED→GREEN | passed |
| 24-07-02 | SYNC-03 | mutations 6/7 RED→GREEN | passed |
| 24-08-01 | SYNC-01..04 | public type/export negatives | passed |
| 24-08-02 | SYNC-01..04 | docs migration | passed |
| 24-09-01 | SYNC-01..04/RESID-03 | exact affected/unaffected set equals live rg discovery; named tests and agent-skill overview disposition | passed |
| 24-09-02 | SYNC-01..04/RESID-03 | no-timeout positives; Phase 13 supersession; independent loader-open-auth-before-fallback and zero-event-EOSE-without-EmptyError evidence | passed |
| 24-10-01 | all | ten-note dispositions; Intl sentence count and exact package/bump/subject across twelve remaining notes; retained equality and removed absence | passed |
| 24-10-02 | all | runtime/type/export/docs/provenance/dependency/seven-mutation full gates | passed |
| 24-11-01 | SYNC-01..04/RESID-03 | canonical checklist and traceability exact-status parser | passed |
| 24-11-02 | all | validation/verification 17-of-17 consistency and zero production diff | passed |

## Wave 0 / Non-vacuity
- [x] Create real >32 and synchronous subscriber ordering tests before protocol rewrite.
- [x] Create scheduler/auth/reconnect causal tests before implementation.
- [x] Create type negatives and loader fallback timer test before declarations/migration.
- [x] Execute all seven isolated mutations with exact diff/command/output/restore/GREEN; a normal green suite is insufficient.

## Coverage Audit
| SOURCE | ID | Plan | Status |
|---|---|---|---|
| GOAL | — | 01-11 | COVERED |
| REQ | SYNC-01 | 01,06,08-10 | COVERED |
| REQ | SYNC-02 | 01,03,06,09,10 | COVERED |
| REQ | SYNC-03 | 02,03,07,09,10 | COVERED |
| REQ | SYNC-04 | 03-05,08-10 | COVERED |
| REQ | RESID-03 | 03,05,09,10 | COVERED |
| CONTEXT | D-01..D-07 | 01,04,08 | COVERED |
| CONTEXT | D-08..D-14 | 02,03,07 | COVERED |
| CONTEXT | D-15..D-19 | 03,04,08 | COVERED |
| CONTEXT | D-20..D-23 | 05,08 | COVERED |
| CONTEXT | D-24 | 06,07 | COVERED |
| CONTEXT | D-25..D-27 | 08-10 | COVERED |
| RESEARCH | protocol/scheduler/error/type/docs constraints | 01-10 | COVERED |

## Failure Policy
Missing follow-up, emit-before-write, blocked negotiation, active>4, starvation, multiplied auth budget, stale reconnect state, duplicate close/execution, timeout option, silent send failure, EmptyError, unattributed Group failure, stale docs/types/provenance, or mutation residue is stop-and-investigate.

## Live Contract Inventory (24-09)

The fixed inventory below equals the live `rg -l` discovery set; live-minus-classified is empty.

### Affected

- **Implementation/types:** `packages/relay/src/{negentropy,relay,group,pool,types,index}.ts`, `packages/relay/type-tests/sync-types.ts`, `packages/relay/tsconfig.type-tests.json`, `packages/loaders/src/loaders/sync-loader.ts`, `packages/loaders/src/types.ts`.
- **Tests:** `packages/relay/src/__tests__/{relay,group,pool,negentropy,sync,exports}.test.ts`, `packages/loaders/src/loaders/__tests__/sync-loader.test.ts`.
- **Docs:** `apps/docs/loading/relays/{negentropy,relays,pool}.md`, `apps/docs/loading/loaders/upstream-pool.md`.
- **Examples:** `apps/examples/src/examples/negentrapy/{mentions,note-reactions,relay-difference}.tsx`, `apps/examples/src/examples/messages/{personal-notes,gift-wrap}.tsx`, `apps/examples/src/examples/relay/multi-user-sync-auth.tsx`.

### Unaffected

- `apps/agent-skills/src/skill/references/overview.md` preserves scalar `pool.sync` topology without result or lifetime claims.
- `apps/agent-skills/src/skill/references/casts.md` and `packages/loaders/src/helpers/{cache,upstream}.ts` use unrelated cast/cache synchronization vocabulary.
- `packages/loaders/src/loaders/{address-loader,event-loader,reactions-loader,social-graph,tag-value-loader,timeline-loader,user-lists-loader,zaps-loader}.ts` use generic Observable/cache synchronization and do not expose the negentropy contract.

Any future live discovery must receive an explicit affected or unaffected disposition before this gate passes.

## D-27 Provenance Amendment

- Current Roadmap, Requirements, and research describe raw Observable rounds, discriminated transfer outcomes, explicit Group failures, and caller-owned sync lifetime with no built-in timeout.
- Phase 13 plans and summaries remain immutable history; `13-REVIEW.md` and `13-VERIFICATION.md` index plans 13-01 through 13-14 as collectively superseded for sync behavior.
- **RESID-03(A):** loader open auth phase closes before fallback construction/subscription so its clock re-arms.
- **RESID-03(B):** zero-event RECEIVE EOSE completes without `EmptyError`.

## D-26 Release Dispositions

- **Retain byte-for-byte:** `relay-auth-wire-request-context`, `sync-loader-auth-phase-timer-leak-fixed`, `sync-loader-handlerless-stall-suspension`, `relay-auth-timeout-bounded-wait`, `relay-operation-scoped-auth-callbacks`.
- **Revise punctuation only:** `sync-loader-wait-for-auth` required no content change because its punctuation was already exact; `wait-for-auth-pubkeys` now formats `waitForAuth` as code.
- **Revise contract:** `sync-loader-auth-hooks` now states high-level ownership/paginated fallback, and `relay-group-sync-per-relay-isolation` names attributed `relay-failed` results.
- **Remove:** duplicate `silver-pugs-marry`.
- **Create:** `relay-negentropy-rounds` (relay major), `relay-sync-outcomes` (relay major), and `loaders-sync-fallback-auth` (loaders patch).
- **Parser:** all twelve remaining notes have one exact YAML entry, one unique nonempty body line, and exactly one `Intl.Segmenter` sentence.

## Final Gate Results

- Relay runtime: 16 files, 402 tests passed; build and type-test project passed.
- Loaders runtime: 16 files, 130 tests passed; build passed.
- Documentation build and all 14 package builds passed.
- Mutation summaries 1–7, Plan 09 provenance/inventory, and manifest/lockfile integrity gates passed.

## Sign-Off
- [x] Every task has automated verification.
- [x] All requirements and D-01..27 map to evidence.
- [x] No dependency install or redundant user checkpoint.
- [x] Complete only after all seven mutations and final gates pass.

**Approval:** complete
