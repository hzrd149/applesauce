---
phase: 25
slug: ecosystem-riders-react-19-snort-worker-relay-v2
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Estimated runtime** | To be measured in Wave 0 |

## Sampling Rate

- **After every task commit:** Run the directly affected package test or build command.
- **After every plan wave:** Run the React suite, focused folded-fix tests, and examples build.
- **Before `$gsd-verify-work`:** The full suite and React 18/19 matrix must be green.
- **Max feedback latency:** Measure and record in Wave 0.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | ECO-02 | — | N/A | rendering integration | `pnpm --filter applesauce-react test` | ❌ W0 | ⬜ pending |
| 25-02-01 | 02 | 2 | ECO-02 | — | Ignore stale observable errors | rendering integration | `pnpm --filter applesauce-react test` | ❌ W0 | ⬜ pending |
| 25-03-01 | 03 | 1 | ECO-03 | — | Pin worker-relay v2 | build integration | `pnpm --filter applesauce-examples build` | ✅ | ⬜ pending |
| 25-03-02 | 03 | 2 | ECO-03 | — | Preserve both OPFS routes | browser smoke | Wave 0 procedure | ❌ W0 | ⬜ pending |
| 25-04-01 | 04 | 1 | D-13 | T-25-01 | Clear wallet relay metadata on lock | unit | `pnpm exec vitest run packages/wallet/src/helpers/__tests__/wallet.test.ts` | ✅ | ⬜ pending |
| 25-04-02 | 04 | 1 | D-13 | T-25-02 | Preserve valid falsy app data | unit | `pnpm exec vitest run packages/common/src/helpers/__tests__/app-data.test.ts` | ✅ | ⬜ pending |
| 25-04-03 | 04 | 1 | D-13 | — | Comment matches stamp behavior | unit | `pnpm exec vitest run packages/core/src/operations/__tests__/event.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] Install `@testing-library/react`, `react-dom`, `@types/react-dom`, and `jsdom` for `applesauce-react` after dependency-legitimacy checkpoints.
- [ ] Establish jsdom selection for the new `.tsx` rendering suite.
- [ ] Add tracked-observable and error-boundary fixtures.
- [ ] Prove the pnpm React-major swap command before encoding it in CI.
- [ ] Establish and record the worker browser-smoke procedure; automate only if the existing route harness keeps it focused.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Both worker-relay routes initialize, store/query, and reload their OPFS databases | ECO-03 | OPFS, Web Workers, and WASM require a real browser unless Wave 0 finds a focused harness | Start the examples app, open both worker-relay routes, exercise initialization and query/reload, and record evidence for `cache-relay.db` and `relay.db`. |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verification or Wave 0 dependencies.
- [ ] Sampling continuity: no three consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Feedback latency is measured and acceptable.
- [ ] `nyquist_compliant: true` is set in frontmatter.

**Approval:** pending
