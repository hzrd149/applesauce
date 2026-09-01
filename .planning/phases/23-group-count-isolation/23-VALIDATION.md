---
phase: 23
slug: group-count-isolation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 23 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest 4, fake/real relay streams, fake timers, TypeScript 7 |
| Focused | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group-count.test.ts` |
| Integration | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts` |
| Types | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Full gate | Plan 23-06 Task 2 |

## Per-Task Verification Map

| Task | Wave | Requirements | Evidence | Automated command | Status |
|---|---:|---|---|---|---|
| 23-01-01 | 1 | COUNT-04/05 | Static progressive success/failure/order/identity | group-count suite | pending |
| 23-01-02 | 1 | COUNT-04/05 | Exact ID/options and concurrent scalar independence | group-count + build | pending |
| 23-02-01 | 2 | COUNT-04/05 | Duplicate/replacement/late/removal/retraction/empty cohorts | group-count suite | pending |
| 23-02-02 | 2 | COUNT-04/05 | Sharing/replay/membership completion/error/cancellation | group-count + build | pending |
| 23-03-01 | 3 | COUNT-04/05 | Pool progression/failure/replay parity | focused Pool count | pending |
| 23-03-02 | 3 | COUNT-04/05 | Real scalar auth/options/ID preserved | Group/Pool + build | pending |
| 23-04-01 | 4 | COUNT-04/05 | Narrowing/scalar/Group/Pool types | explicit type project | pending |
| 23-04-02 | 4 | COUNT-04/05 | combineLatest progression/isolation RED→GREEN | exact summary evidence + focused suite | pending |
| 23-05-01 | 5 | COUNT-04/05 | Progressive/HLL/reduced-coverage docs | docs build/search | pending |
| 23-05-02 | 5 | COUNT-04/05 | Phase 19/21/canonical amendments | provenance search | pending |
| 23-06-01 | 6 | COUNT-04/05 | Exact major changeset | Node parser | pending |
| 23-06-02 | 6 | COUNT-04/05 | Complete runtime/type/docs/workspace gate | full command | pending |

## Wave 0 and Non-Vacuity

- [ ] Create failing fast/slow and success/offline tests before replacing combineLatest.
- [ ] Create dynamic replacement/removal/replay/cancellation tests before completing the helper.
- [ ] Create and include `group-count-types.ts` before final public declarations.
- [ ] Restore combineLatest in an isolated worktree: both named core tests must fail causally, then restored source passes.

## Source Coverage Audit

| SOURCE | ID | Feature / Requirement | Plan | Status |
|---|---|---|---|---|
| GOAL | — | Progressive isolated Group/Pool COUNT | 01-06 | COVERED |
| REQ | COUNT-04 | One failure costs only its own outcome | 01-04 | COVERED |
| REQ | COUNT-05 | Emit as each relay settles | 01-04 | COVERED |
| RESEARCH | — | Latest cohort/token/replay/error boundaries | 01-03 | COVERED |
| RESEARCH | — | Types/docs/provenance/combineLatest proof | 04-06 | COVERED |
| CONTEXT | D-01..D-04 | Progressive outcome contract | 01, 03 | COVERED |
| CONTEXT | D-05..D-09 | Dynamic cohort/removal | 02 | COVERED |
| CONTEXT | D-10..D-13 | snapshots/sharing/replay/ID | 01-03 | COVERED |
| CONTEXT | D-14..D-17 | forwarding/policy/cancellation | 01-03 | COVERED |
| CONTEXT | D-18..D-19 | HLL interpretation/no total | 05 | COVERED |
| CONTEXT | D-20..D-22 | public types/error boundary | 01-04 | COVERED |
| CONTEXT | D-23..D-25 | docs/provenance/release | 05-06 | COVERED |
| CONTEXT | D-26 | combineLatest RED→GREEN | 04 | COVERED |
| CONTEXT | D-27 | exhaustive runtime matrix | 01-04, 06 | COVERED |

Excluded: automatic totals and per-relay option/filter/concurrency maps.

## Failure Policy

Any withheld first settlement, escaping per-relay error, stale replacement signal, mutated prior snapshot, response-ordered keys, emitted empty record, duplicated shared work, missing terminal replay, leaked cancellation, scalar Relay type change, naive sum guidance, or green combineLatest mutation is stop-and-investigate.

## Sign-Off

- [x] Every task has automated verification.
- [x] COUNT-04/05 and D-01..D-27 map to evidence.
- [x] No install or human checkpoint is required.
- [ ] Set complete only after Plan 23-06 reconciles actual results.

**Approval:** pending
