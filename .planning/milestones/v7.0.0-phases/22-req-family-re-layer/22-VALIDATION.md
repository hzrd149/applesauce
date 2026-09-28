---
phase: 22
slug: req-family-re-layer
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-01
---

# Phase 22 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest 4, real mock WebSocket relays, fake timers, and TypeScript 7 |
| Quick Relay run | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` |
| Group/Pool run | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/group-error.test.ts src/__tests__/pool.test.ts` |
| Type boundary | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Docs boundary | `pnpm --dir apps/docs build` |
| Full phase gate | Plan 22-08 Task 1 command plus Plan 06/07 audit commands |

## Sampling Rate

- After each task: run its focused automated command; declarations also run the relay build/type project.
- After each wave: run the affected Relay or Group/Pool suites before continuing through overlapping core files.
- Before completion: run runtime, compiler, docs, provenance, changeset parser, package/workspace build, and dependency-integrity gates.
- Mutation probes are temporary one-at-a-time reversions; restore and rerun GREEN before commit.

## Per-Task Verification Map

| Task | Wave | Requirements | Evidence | Automated command | Status |
|---|---:|---|---|---|---|
| 22-01-01 | 1 | REQ-01 | Raw lifecycle, sharing, readiness, dynamic filters, exact writes/listeners/CLOSE | 374 relay tests | passed |
| 22-01-02 | 1 | REQ-01, REQ-05 | ID-only runtime/type seam and one-attempt auth error | relay build + type fixture | passed |
| 22-02-01 | 2 | REQ-02 | Finite request policy, positive reconnect, whole clock, EOSE/custom completion | relay suite | passed |
| 22-02-02 | 2 | REQ-02, REQ-03 | Stable-ID persistent re-establishment, hidden OPEN, repeated EOSE, no clock | relay suite + build | passed |
| 22-03-01 | 3 | REQ-02, REQ-03 | Group settlement/dedupe across re-establishment and immediate failure | Group/group-error suites | passed |
| 22-03-02 | 3 | REQ-03, REQ-05 | All Pool forwarding families inherit Group without timeout | Pool suite + build | passed |
| 22-04-01 | 4 | REQ-02 | Sync RECEIVE synchronous auth resend and EOSE completion | relay suite | passed |
| 22-04-02 | 4 | REQ-04 | Applicable D-19/D-20 and OPEN mutations fail causally; superseded Group ERROR oracle has behavioral/static replacement | exact summary evidence + restored GREEN | passed |
| 22-05-01 | 5 | REQ-05 | Positive/negative Relay, Group, Pool option surface | explicit type-test project | passed |
| 22-06-01 | 6 | REQ-02, REQ-03 | Phase 21 design artifacts carry D-23/D-24 supersession | five-file amendment search | passed |
| 22-06-02 | 6 | REQ-02, REQ-03 | All 21-01..04 PLAN/SUMMARY files amended | eight-file amendment loop | passed |
| 22-06-03 | 6 | REQ-02, REQ-03 | Whole Phase 21 stale-claim audit and surviving request/failure positives | supersession markers in all 16 artifacts | passed |
| 22-07-01 | 7 | REQ-01..03, REQ-05 | Docs/canonical no-timeout and caller composition | docs build + canonical searches | passed |
| 22-07-02 | 7 | REQ-01, REQ-05 | Both major changesets contain one package and one sentence | executable Node parser | passed |
| 22-08-01 | 8 | REQ-01..05 | Full runtime/type/docs/provenance/release/workspace evidence | runtime/type/docs/dependency gates | passed |

## Wave 0 Requirements

- [ ] Add raw lifecycle/count tests before extracting policy from `req()`.
- [ ] Add lifecycle-compositor request/subscription tests before Group rewiring.
- [ ] Add Group/Pool re-establishment and no-clock tests before deleting Phase 21 behavior.
- [ ] Add `req-family-types.ts` and include it in the explicit type-test project before final public declarations.
- [ ] Preserve/strengthen mutation targets so all four deliberate reversions have causal RED symptoms.

Each owning task writes failing evidence first; no task relies on manual-only verification.

## Non-Vacuity Gates

- Hoist fresh attempt construction outside `defer`: synchronous auth resend must lose reply/listener observation.
- Move the clean-CLOSED repeat holder into attempt scope: the next enabled repeat must not write.
- Count synthetic OPEN as progress: the exact auth retry bound must fail.
- Manufactured Group ERROR progress oracle: superseded/non-applicable because whole-lifetime timing ignores values; use behavioral deadline and static no-consumer proof.
- Restore a subscription timeout field/operator: compiler-negative or static/runtime no-clock evidence must fail.
- Reintroduce an unqualified Phase 21 subscription-timeout claim: the directory-wide provenance audit must fail.
- Malform either changeset package count, bump, paragraph count, list, fence, or sentence count: the Node parser must fail.

## Source Coverage Audit

| SOURCE | ID | Feature / Requirement | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Raw req is one interaction; request/subscription own policy and re-establishment | 01-08 | COVERED | Runtime through release evidence |
| REQ | REQ-01 | Raw req owns no auth/reconnect/repeat | 01, 07 | COVERED | Wire, type, docs/release |
| REQ | REQ-02 | High-level methods own policy | 02-04, 06-08 | COVERED | Relay, Group, sync, provenance |
| REQ | REQ-03 | Stable observable re-establishment contract | 02, 03, 06-08 | COVERED | ID/OPEN/EOSE/dedupe |
| REQ | REQ-04 | Three applicable RED→GREEN proofs plus superseded Group ERROR behavioral/static proof | 04, 08, 09 | COVERED | Exact evidence reconciled |
| REQ | REQ-05 | Positive option types | 01-03, 05, 07 | COVERED | Compiler and release contract |
| RESEARCH | — | Fresh attempts and call-scoped state | 01, 02, 04 | COVERED | Includes mutation oracle |
| RESEARCH | — | Lifecycle-before-mapping and positive terminal classification | 01-03 | COVERED | Relay and Group paths |
| RESEARCH | — | No subscription clock plus Phase 21 reversal | 02, 03, 05-08 | COVERED | Runtime/type/all artifacts/docs |
| CONTEXT | D-01..D-04 | Raw REQ contract | 01 | COVERED | Exact lifecycle and teardown |
| CONTEXT | D-05..D-09 | Finite request | 02 | COVERED | Policy and clock |
| CONTEXT | D-10..D-13 | Persistent subscription | 02, 03 | COVERED | Re-establish/dedupe/no timeout |
| CONTEXT | D-14..D-16 | Positive option surfaces | 01-03, 05 | COVERED | Exact compiler surface |
| CONTEXT | D-17..D-18 | Private compositor and sync | 02-04 | COVERED | Metadata and auth preserved |
| CONTEXT | D-19..D-22 | Applicable mutations and amended whole-lifetime proof | 04, 08, 09 | COVERED | Group ERROR mutation superseded/non-applicable |
| CONTEXT | D-23..D-26 | Full reversal/docs/changesets | 03, 05-08 | COVERED | Every Phase 21 artifact included |

Excluded by locked deferral: Phase 24 sync-policy consolidation and direct Relay subscription deduplication.

## Failure Policy

Any leaked raw policy, shared dying attempt, reset retry budget, reconnect of a non-allowlisted failure, visible OPEN, unstable ID, missing repeated EOSE, per-attempt Group dedupe, built-in subscription clock, delayed total failure, unqualified stale Phase 21 claim, multi-package/multi-sentence changeset, or mutation that stays green is stop-and-investigate.

## Validation Sign-Off

- [x] Every task has a runnable automated verification command.
- [x] REQ-01 through REQ-05 and D-01 through D-26 map to executable evidence.
- [x] Runtime, compile-time, mutation, docs, provenance, release, and dependency gates are independent.
- [x] No package install or human checkpoint is required.
- [x] Wave 0 failing fixtures created and restored GREEN during execution.
- [x] Plan 22-08 reconciled executed evidence before setting `nyquist_compliant: true`.

**Approval:** complete — 2026-09-01
