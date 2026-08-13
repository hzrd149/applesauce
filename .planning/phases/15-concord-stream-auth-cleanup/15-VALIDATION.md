---
phase: 15
slug: concord-stream-auth-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-13
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `15-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`; no per-package config in `packages/concord`) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `pnpm vitest run packages/concord/src/client/__tests__/<file>.test.ts` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~30s quick / ~2min full |

> **Do not use** the `pnpm --filter … -- <path>` form for a single file — it silently runs the
> whole suite instead. Use `pnpm vitest run <path>` from the repo root.

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <touched-test-file>`
- **After every plan wave:** `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** full concord suite green **plus** `pnpm --filter applesauce-examples build` green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

*Populated by the planner — one row per task, keyed to the plan and wave that produces it.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-XX-XX | XX | N | CAUTH-01 | — | Scope handler authenticates only signers its own scope holds | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 15-XX-XX | XX | N | CAUTH-02 | T-15-01 | Relay receives AUTH for exactly the scope's k pubkeys, never the client-wide union | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ❌ W0 | ⬜ pending |
| 15-XX-XX | XX | N | CAUTH-03 | — | Zero remaining call sites for the five removed mechanisms | structural | `pnpm vitest run packages/concord/src/__tests__/<guard>.test.ts` | ❌ W0 | ⬜ pending |
| 15-XX-XX | XX | N | CAUTH-04 | — | Failed auth retries per-operation, bounded by `authRetries` | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement → Oracle Map

| Req | Oracle | Independence |
|-----|--------|--------------|
| CAUTH-01 | Handler invoked with `missingPubkeys` narrowed to the operation's own `waitForAuth`; authenticates only signers the scope holds | Expected set derived from the operation's own filter `authors`, computed independently of the handler under test |
| CAUTH-02 | `authenticate` spy records `(pubkey, relayUrl)` pairs across a two-scope fixture sharing one relay; assert per-scope isolation and that reconnect re-triggers the same per-scope set, not a union | **Design-derived, not a before/after diff** — no "before" recording of the prior churn behavior was ever committed. Expected `k` comes from each operation's own `waitForAuth`. |
| CAUTH-03 | Source-tree-walk guard, mirroring `packages/concord/src/__tests__/cord-citations.test.ts` | Structural — fails automatically if any of the five mechanisms is reintroduced |
| CAUTH-04 | Relay answers `auth-required:` once then succeeds → operation resolves; refuses twice in one connection → operation errors rather than looping | Parity target is `applesauce-relay`'s **documented** `authRetries` contract, not the old driver's loop-until-no-progress shape |

---

## Wave 0 Requirements

- [ ] **CAUTH-02 oracle** — extend `fakePool()` / `fakePoolWithStatus()` (`packages/concord/src/client/__tests__/community.test.ts:57-98`) with an `authenticate` spy recording `(pubkey, relayUrl)`; fixture with two scopes sharing a relay; assert (a) per-scope isolation, (b) reconnect re-auths the same scoped set.
- [ ] **CAUTH-04 retry-parity test** — bounded-retry assertions against the documented `authRetries: 1` contract.
- [ ] **CAUTH-03 structural guard** — a real Vitest source-walk test, not a manual one-off grep, so reintroduction fails CI.
- [ ] **Non-vacuity probes** — RED→GREEN for each new test (revert the fix, confirm the test fails for the stated reason, restore). Required **with particular force for CAUTH-02**, whose oracle is design-derived.

*Existing fixtures (`fakePool`, `fakePoolWithStatus`, `mkStatus`, `spyOnDrivers`) cover fixture construction; no new framework or config is needed — only new assertions and fixtures within existing files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Example apps still run against a live relay after migration | CAUTH-03 | Examples are UI surfaces with no test harness; build-green is automated but runtime behavior is not | `pnpm dev`, open the concord examples, confirm auth-dependent views still load |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (CAUTH-02, CAUTH-03, CAUTH-04)
- [ ] No watch-mode flags (`pnpm vitest run`, never bare `vitest`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
