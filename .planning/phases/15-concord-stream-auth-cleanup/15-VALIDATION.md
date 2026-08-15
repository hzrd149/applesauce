---
phase: 15
slug: concord-stream-auth-cleanup
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| 15-01-T2 | 01 | 1 | CAUTH-01 | T-15-01 | `StreamSigners.onAuthRequired` authenticates only the intersection of a relay's `missingPubkeys` and the scope's own registry; a `null` `missingPubkeys` authenticates nothing, even across two disjoint holders sharing one relay | unit | `pnpm vitest run packages/concord/src/client/__tests__/auth.test.ts` | ✅ | ✅ green |
| 15-04-T3 | 04 | 3 | CAUTH-02 | T-15-01, T-15-09 | Two communities sharing one relay each authenticate only their own authors, proven under a relay-supplied `missingPubkeys` deliberately widened to the union of both scopes' authors (so the isolation claim cannot pass vacuously); a reconnect cycle re-authenticates that same scoped set, never a union | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-07-T2 | 07 | 6 | CAUTH-03 | T-15-15, T-15-16 | Source-tree-walk guard (two roots: `packages/concord/src` and `apps/examples/src/examples/concord`) fails CI on reintroduction of any of the five removed mechanisms, any new ambient-auth trigger (`challenge$`/`authRequiredForRead`/`authRequiredForPublish`), any retry-budget override (`authRetries`/`authTimeout`), or any second missing-pubkeys handler outside `client/auth.ts` | structural | `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` | ✅ | ✅ green |
| 15-04-T3 | 04 | 3 | CAUTH-04 | T-15-04 | Recorded live-subscription options leave `authRetries`/`authTimeout` undefined so the upstream defaults (`1`, `30_000`) govern, and a second auth-required cycle is never suppressed or deduped | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-01-T2 | 01 | 1 | CAUTH-04 | T-15-04 | Invoking the same handler twice with the same `missingPubkeys` sends two AUTHs — no dedupe, no suppression of a second auth-required cycle (D-18) | unit | `pnpm vitest run packages/concord/src/client/__tests__/auth.test.ts` | ✅ | ✅ green |

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

- [x] **CAUTH-02 oracle** — extended `fakePool()` / `fakePoolWithStatus()` (`packages/concord/src/client/__tests__/community.test.ts`) with a captured-handler oracle: two communities share one relay, `missingPubkeys` is deliberately widened to the union of both scopes' authors, and the test asserts (a) per-scope isolation, (b) reconnect re-auths the same scoped set. Landed in plan 15-04, Task 3 — `15-04-SUMMARY.md` coverage item D2.
- [x] **CAUTH-04 retry-parity test** — bounded-retry assertions against the documented `authRetries`/`authTimeout` defaults staying undefined, plus a no-suppression assertion on a second auth-required cycle. Landed in plan 15-04, Task 3 — `15-04-SUMMARY.md` coverage item D3 — and reinforced by plan 15-01's no-dedupe unit test — `15-01-SUMMARY.md` coverage item D3.
- [x] **CAUTH-03 structural guard** — `packages/concord/src/__tests__/no-ambient-auth.test.ts`, a real two-root Vitest source-walk test (not a manual grep), asserting zero reintroduction of the five removed mechanisms, no new ambient-auth trigger, no retry-budget override, and no second missing-pubkeys handler outside `client/auth.ts`. Landed in plan 15-07, Task 2 — `15-07-SUMMARY.md` coverage item D2.
- [x] **Non-vacuity probes** — RED→GREEN recorded for every new oracle: plan 15-01's `auth.test.ts` probe (whole-registry-fallback regression, 2 assertions RED then restored — `15-01-SUMMARY.md`); plan 15-04's CAUTH-02 oracle, two probes (shared-`StreamSigners` regression and `onAuthRequired` omission, both RED then restored — `15-04-SUMMARY.md`); plan 15-07's structural guard, two probes (a reintroduced `autoAuthenticate` literal and a second `missingPubkeys` handler, both RED then restored — `15-07-SUMMARY.md`). All five probes named the offending file/assertion and returned to green after restore.

*Existing fixtures (`fakePool`, `fakePoolWithStatus`, `mkStatus`, `spyOnDrivers`) cover fixture construction; no new framework or config is needed — only new assertions and fixtures within existing files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Example apps still run against a live relay after migration | CAUTH-03 | Examples are UI surfaces with no test harness; build-green is automated but runtime behavior is not | `pnpm dev`, open the concord examples, confirm auth-dependent views still load |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (CAUTH-02, CAUTH-03, CAUTH-04)
- [x] No watch-mode flags (`pnpm vitest run`, never bare `vitest`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Full-gate run (2026-08-15, plan 15-08 Task 2), recorded verbatim:**

1. `pnpm --filter applesauce-concord build` — exit 0 (`rimraf dist && tsc`, no errors).
2. `pnpm --filter applesauce-concord test` — exit 0, `Test Files 55 passed (55)`, `Tests 584 passed (584)`, zero failures, zero skipped.
3. `pnpm --filter applesauce-examples build` — exit 0, `✓ built in 1.55s` (only pre-existing, unrelated warnings: a third-party `dashjs` CJS/ESM interop notice and a chunk-size-limit notice).
4. `pnpm build` (repo-wide `turbo build`) — exit 0, `Tasks: 18 successful, 18 total`, `FULL TURBO`.

Structural confirmation: `grep -rn 'ConcordRelayAuth' packages apps --include='*.ts' --include='*.tsx'` returns exactly one hit — the guard's own regex literal at `packages/concord/src/__tests__/no-ambient-auth.test.ts:54`.

**Approval:** 2026-08-15 — all four gates green together; the manual live-relay verification (see Manual-Only Verifications above) was run by the user against a live auth-gating relay and approved the same day, in plan 15-08's Task 3. All Manual-Only Verifications are discharged and the phase's validation contract is fully complete.
