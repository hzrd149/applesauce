---
phase: 13
slug: operation-scoped-nip-42-auth-hooks
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-05
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `13-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`^4.0.15` in package.json, resolves to 4.1.10) |
| **Config file** | Root `vitest.config.ts` — no per-package workspace projects |
| **Quick run command** | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` |
| **Full suite command** | `pnpm --filter applesauce-relay test` + `pnpm --filter applesauce-loaders test` |
| **Estimated runtime** | ~3 seconds (quick run, measured: 103 tests / 1.88s vitest duration) |

**Filter caveat (project lesson):** positional path filters only bind when `vitest` runs from the repo
root. The `pnpm --filter <pkg> test -- <path>` form silently runs the whole suite instead of the
named file. Always use `pnpm vitest run <path>` from the repo root for per-file runs.

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <the test file touched by that task>`
- **After every plan wave:** `pnpm --filter applesauce-relay test`, plus
  `pnpm --filter applesauce-loaders test` once the loaders changes land
- **Before `/gsd-verify-work`:** both full suites green
- **Smoke check (cheap, non-gating):** `pnpm --filter applesauce-concord test` — Concord still reads
  `authRequiredForRead` / `authRequiredForPublish` off `RelayStatus`
  (`packages/concord/src/client/relay-auth.ts:110,206`, `invite-watcher.ts:258,428,435`), so this
  catches accidental behavior change in the flags this phase demotes to informational.
  Not required by REQUIREMENTS.md's Verification Standard until Phase 15.
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

Task IDs are assigned when PLAN.md files are written; this map is keyed by requirement until then.
The executor fills the Task ID / Plan / Wave columns as each task is planned.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | RAUTH-01 | — | Handler receives operation-local context only | unit (wire-trace, `vitest-websocket-mock`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-02 | — | Earlier operation's `auth-required:` does not pre-block a fresh operation | unit (wire-trace, two REQs on distinct ids) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-03 | T-13-01 (retry storm) | Retry bounded by `authRetries` (default 1) | unit (wire-trace, count REQ sends) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-04 | T-13-01 (retry storm) | `authTimeout` bounds the wait; `false` waits indefinitely | unit (real-timer, short explicit `authTimeout`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-05 | T-13-03 (concurrent AUTH) | Each concurrent operation resolves independently, no relay-internal dedupe | unit (two concurrent REQs, handler-invocation-count assertion) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-06 | — | `waitForAuth: false` → immediate `AuthRequiredError`, handler never called; `event(…, "AUTH")` never invokes it | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-07 | — | Options present on all 8 operations and passed through Pool/Group | unit (pass-through assertions) | `pnpm vitest run packages/relay/src/__tests__/pool.test.ts packages/relay/src/__tests__/group.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-08 | — | `SyncLoader` threads options into negentropy and paginated paths identically | unit (mocked `request`/`sync`, assert call args) | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-09 | — | `authRequiredForRead$`/`authRequiredForPublish$` keep updating as informational status | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-03 (gap) | T-13-02 (handler bug mis-attribution) | `AuthHandlerError` distinguishes a caller-handler rejection from a genuine relay timeout, carrying the original as `.cause` | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-08 (gap) | — | `SyncLoader` stall guard does not fire during a *slow post-handler wait* (handler resolves fast, `authSatisfied$` slow) — see RESEARCH Assumption A2 | unit (held-out: exercises the residual window the recommended design does not obviously cover) | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | RAUTH-02 (gap) | T-13-01 (retry storm) | `publish()`'s `customRetryOperator` skips `RelayClosedError` so removing the pre-block cannot produce a hot loop (D-07) | unit (wire-trace, assert bounded EVENT sends) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. `relay.test.ts`, `pool.test.ts`,
`group.test.ts`, and `sync-loader.test.ts` all exist with an established
`vitest-websocket-mock` + `subscribeSpyTo` (relay) / mocked-function (sync-loader) convention.
No new test infrastructure or fixture file is needed — only new `describe`/`it` blocks in the
existing files.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

Two behaviors need **real-timer** tests rather than fake timers, because the assertion is about
wall-clock waiting rather than a wire sequence — these are still automated, just noted so the
executor does not reach for `vi.useFakeTimers()`:

| Behavior | Requirement | Why real-timer | Test Instructions |
|----------|-------------|----------------|-------------------|
| `authTimeout: false` waits indefinitely | RAUTH-04 | There is no deadline to advance to; the assertion is "still pending after N ms" | Use a short real delay and assert the observable has not emitted or errored |
| `authTimeout: <short>` bounds the wait | RAUTH-04 | Interacts with the operation-level timeout suspension (D-15); fake timers make the suspension logic untestable | Pass an explicit short `authTimeout` (e.g. 50ms) and assert `AuthTimeoutError` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references *(N/A — no gaps)*
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
