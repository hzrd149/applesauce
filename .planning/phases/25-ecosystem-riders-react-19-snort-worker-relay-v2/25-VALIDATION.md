---
phase: 25
slug: ecosystem-riders-react-19-snort-worker-relay-v2
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-02
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.6 + React Testing Library 16.3.3 + jsdom 30.0.1 |
| **Config file** | Root `vitest.config.ts`; Wave 0 establishes package-local jsdom selection |
| **Quick run command** | `pnpm --filter applesauce-react test` |
| **Full suite command** | `pnpm test && pnpm --filter applesauce-examples build` |
| **Estimated runtime** | Focused checks must complete within the planner's 60-second feedback target; execution records actual duration in the plan summaries |

## Sampling Rate

- **After every task commit:** Run the directly affected package test or build command.
- **After every plan wave:** Run the React suite, focused folded-fix tests, and examples build.
- **Before `$gsd-verify-work`:** The full suite and React 18/19 matrix must be green.
- **Max feedback latency:** 60 seconds for each focused automated task check; longer full-suite/build gates run at wave and phase boundaries.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | ECO-02 | T-25-SC | Approve SUS React test packages before mutation | legitimacy checkpoint | Research audit exists; human registry verification is the blocking gate | ✅ planned | ⬜ pending |
| 25-01-02 | 01 | 1 | ECO-02 | T-25-01, T-25-02 | Establish renderer dependencies, jsdom, fixtures, and sync/async tracer | rendering integration | `pnpm --filter applesauce-react test -- use-observable-state.test.tsx && pnpm --filter applesauce-react build` | ✅ created by task | ⬜ pending |
| 25-02-01 | 02 | 2 | ECO-02 | T-25-03 | Ignore stale values/errors and release subscriptions | rendering integration | `pnpm --filter applesauce-react test -- use-observable-state.test.tsx use-$.test.tsx` | ✅ created by task | ⬜ pending |
| 25-02-02 | 02 | 2 | ECO-02 | T-25-04, T-25-05 | Enforce provider contracts and matching-major CI swaps | rendering + workflow structure | `pnpm --filter applesauce-react test -- providers.test.tsx` plus four-package workflow assertion | ✅ created by task | ⬜ pending |
| 25-03-01 | 03 | 2 | ECO-03 | T-25-SC | Approve worker-relay v2 package before mutation | legitimacy checkpoint | Existing v1 range assertion; human registry verification is the blocking gate | ✅ planned | ⬜ pending |
| 25-03-02 | 03 | 2 | ECO-03 | T-25-06, T-25-07, T-25-08 | Pin v2, preserve both OPFS routes, and expose settled recovery states | build integration + browser smoke | `pnpm --filter applesauce-examples build` plus structural API audit and specified human-check | ✅ build; smoke specified | ⬜ pending |
| 25-04-01 | 04 | 1 | D-13 | T-25-11 | Comment matches stamp behavior and changeset scope is isolated | unit + structural | `pnpm exec vitest run packages/core/src/operations/__tests__/event.test.ts` plus changeset sentence assertion | ✅ existing test | ⬜ pending |
| 25-04-02 | 04 | 1 | D-13 | T-25-09 | Clear wallet relay metadata on lock | unit + structural | `pnpm exec vitest run packages/wallet/src/helpers/__tests__/wallet.test.ts` plus changeset sentence assertion | ✅ existing test | ⬜ pending |
| 25-04-03 | 04 | 1 | D-13 | T-25-10 | Preserve valid falsy app data | unit + structural | `pnpm exec vitest run packages/common/src/helpers/__tests__/app-data.test.ts` plus changeset sentence assertion | ✅ existing test | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [x] Plan 25-01 Task 2 owns installation of `@testing-library/react`, `react-dom`, `@types/react-dom`, and `jsdom` after Task 1's blocking legitimacy checkpoint.
- [x] Plan 25-01 Task 2 owns package-local jsdom selection plus the tracked-observable fixture; Plan 25-02 Task 1 expands it with error-boundary and teardown accounting.
- [x] Plan 25-02 Task 2 owns local proof and CI encoding of one explicit no-lockfile command that swaps react, react-dom, @types/react, and @types/react-dom to each matrix major.
- [x] Plan 25-03 Task 2 owns the exact browser-smoke procedure through its `<human-check>` after its automated build/API audit; no new general E2E harness is required.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Both worker-relay routes initialize, store/query, and reload their OPFS databases | ECO-03 | OPFS, Web Workers, and WASM require a real browser unless Wave 0 finds a focused harness | Start the examples app, open both worker-relay routes, exercise initialization and query/reload, and record evidence for `cache-relay.db` and `relay.db`. |

## Validation Sign-Off

- [x] All nine tasks have automated verification or an explicit blocking-human verification paired with an automated precondition check.
- [x] Sampling continuity: every implementation task has automated verification; no three consecutive tasks lack it.
- [x] All prerequisite gaps are assigned to executable Tasks 25-01-02, 25-02-01, 25-02-02, and 25-03-02.
- [x] No watch-mode flags.
- [x] Focused feedback target is 60 seconds; full gates are deliberately sampled at wave/phase boundaries.
- [x] `nyquist_compliant: true` and `wave_0_complete: true` are set in frontmatter.

**Approval:** planning-time validation contract approved on 2026-09-02; task statuses remain pending until execution produces green evidence.
