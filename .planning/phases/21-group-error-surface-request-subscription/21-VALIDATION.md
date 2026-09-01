---
phase: 21
slug: group-error-surface-request-subscription
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 21 — Validation Strategy

> **Phase 22 D-23/D-24 amendment:** Subscription timeout validation rows are historical and superseded. Persistent subscriptions have no built-in duration/inactivity clock.

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest 4, real mock WebSocket relays, observer spy, fake timers, and TypeScript 7 |
| Quick run | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group-error.test.ts` |
| Type boundary | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Docs boundary | `pnpm --dir apps/docs build` |
| Full phase gate | Plan 21-04 Task 2 command |

## Sampling Rate

- After each task: run its focused test and relay build when declarations change.
- After each wave: run the focused Group/Pool suites affected so far.
- Before verification: run full relay tests/build, explicit type fixture, runtime export snapshot, docs build, exact changeset/provenance gates, and package-integrity check.
- Keep iterative commands under 60 seconds; reserve the complete gate for phase close.

## Per-Task Verification Map

| Task | Wave | Requirements | Evidence | Automated command | Status |
|---|---:|---|---|---|---|
| 21-01-01 | 1 | GROUP-01..03 | Real-wire aggregate, normalized ordered outcomes, identity, stable name/message | focused group-error test + build | pending |
| 21-01-02 | 1 | GROUP-01..03 | Events-before-failure, EOSE/mixed success, empty/static/dynamic membership, precedence | complete group-error test | pending |
| 21-02-01 | 2 | GROUP-04, GROUP-05 | Request default whole lifetime, no activity reset, teardown | focused timer cases + build | pending |
| 21-02-02 | 2 | GROUP-04, GROUP-05 | Subscription opt-in/false and shared overlapping-auth suspension | group-error + existing Group tests | pending |
| 21-03-01 | 3 | GROUP-01..05 | Same contract through request/subscription/subscriptionMap/outboxSubscription | focused Pool real-wire cases | pending |
| 21-03-02 | 3 | GROUP-02..05 | Runtime error export and compile-time outcome/timeout forwarding | exports + type fixture + build | pending |
| 21-04-01 | 4 | GROUP-01..05 | Docs build and D-10 requirements/roadmap provenance | docs + rg gates | pending |
| 21-04-02 | 4 | GROUP-01..05 | Exact major changeset and complete phase gate | Plan 21-04 exact command | pending |

## Wave 0 Requirements

- [ ] Create `packages/relay/src/__tests__/group-error.test.ts` with failing real-wire settlement, empty, membership, precedence, timeout, and auth cases before production changes.
- [ ] Create `packages/relay/type-tests/group-error-types.ts` and include it in the explicit type-test project before finalizing public declarations.
- [ ] Add real-wire Pool cases for request, subscription, subscriptionMap, and outboxSubscription before relying on delegation.
- [ ] Replace the old event-cancels-clock expectation with a RED proof that activity does not reset the whole lifetime.

Each owning task creates its failing evidence first, so no verification depends on a manual-only placeholder.

## Non-Vacuity Gates

- Temporarily skip the final ERROR state update; the after-EVENT and same-message-precedence cases must fail.
- Temporarily retain a removed relay outcome; the latest-cohort replacement case must fail.
- Temporarily cancel/reset the lifetime on EVENT; the no-activity-reset cases must fail.
- Temporarily use a boolean auth gate instead of the shared counter; overlapping-auth timing must fail.
- Temporarily wrap the Pool error or loosen an unsupported timeout type; identity or compiler-negative coverage must fail.
- Temporarily omit RelayGroupError from the barrel surface; the runtime export snapshot must fail.

## Source Coverage Audit

| SOURCE | ID | Feature / Requirement | Plan | Status | Notes |
|---|---|---|---|---|---|
| GOAL | — | Total current-cohort failure is a real typed error with reusable per-relay causes | 01-04 | COVERED | Runtime, facade, docs, and release gates |
| REQ | GROUP-01 | request/subscription default total-failure error | 01, 03 | COVERED | Before/after events and all Pool paths |
| REQ | GROUP-02 | URL-keyed original causes | 01, 03 | COVERED | Normalization, order, identity |
| REQ | GROUP-03 | one reusable RelayOutcome shape | 01, 03 | COVERED | Type export; Phase 23 implementation excluded |
| REQ | GROUP-04 | D-10 single whole-returned-Observable lifetime amendment | 02, 04 | COVERED | Request default, subscription opt-in, no reset |
| REQ | GROUP-05 | every enabled clock suspends across auth | 02, 04 | COVERED | Shared overlapping gate |
| CONTEXT | D-01..D-05 | outcome/error shape and failure semantics | 01 | COVERED | Exact contracts and mixed success |
| CONTEXT | D-06..D-10 | one whole lifetime and provenance amendment | 02, 04 | COVERED | No first/idle options |
| CONTEXT | D-11..D-16 | latest membership, empty/mixed settlement, precedence | 01 | COVERED | Unified decision |
| CONTEXT | D-17..D-18 | Pool transparency and raw req boundary | 01, 03 | COVERED | Four Pool paths; req unchanged |
| CONTEXT | D-19..D-22 | major release, docs, exports/types, exhaustive proof | 03, 04 | COVERED | Exact gates |
| RESEARCH | — | membership-first control before synchronous replacement inners | 01 | COVERED | Explicit action and test |
| RESEARCH | — | sibling lifetime operator with complete teardown | 02 | COVERED | Existing first-progress consumers preserved |
| RESEARCH | — | no package install; opaque causes; normalized record | 01-04 | COVERED | Threat and integrity gates |

Excluded by locked deferral: Phase 23 progressive count records and per-relay idle/liveness clocks.

## Failure Policy

Any empty cohort aggregate, stale removed-relay outcome, cause wrapping, custom-completion win on the same final failure, activity-reset clock, default subscription lifetime, overlap race, Pool translation, raw req regression, stale provenance, or multi-change changeset is stop-and-investigate.

## Validation Sign-Off

- [x] Every task has a runnable automated verification command.
- [x] GROUP-01 through GROUP-05 and D-01 through D-22 map to executable evidence.
- [x] Runtime, compile-time, real-wire, docs, provenance, release, and dependency-integrity gates are independent.
- [x] No package install or human checkpoint is required.
- [ ] Wave 0 failing fixtures created and restored green during execution.
- [ ] Set `nyquist_compliant: true` only after executed evidence is reconciled.

**Approval:** pending
