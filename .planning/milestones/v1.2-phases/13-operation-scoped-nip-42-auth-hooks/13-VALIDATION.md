---
phase: 13
slug: operation-scoped-nip-42-auth-hooks
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
updated: 2026-08-06
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

Task IDs use the `{phase}-{plan}-{task}` convention (e.g. `13-02-03` = phase 13, plan 02, task 3),
matching this milestone's prior VALIDATION.md precedent. Each row's Task ID/Plan/Wave point at the
task whose test run is the row's `Automated Command`; where a requirement was proven incrementally
across several plans (all eight auth sites), the row points at the plan that closed the last
remaining site, per that plan's own SUMMARY note.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-02-03 | 02 | 2 | RAUTH-01 | — | Handler receives operation-local context only | unit (wire-trace, `vitest-websocket-mock`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-06-03 | 06 | 5 | RAUTH-02 | — | Earlier operation's `auth-required:` does not pre-block a fresh operation — proven per site in 13-02/13-04/13-05, closed for the last site (negentropy/sync) here | unit (wire-trace, two REQs on distinct ids) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-06-03 | 06 | 5 | RAUTH-03 | T-13-01 (retry storm) | Retry bounded by `authRetries` (default 1) — proven per site in 13-02/13-04/13-05, closed for the last site here | unit (wire-trace, count REQ/NEG-OPEN sends) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-06-03 | 06 | 5 | RAUTH-04 | T-13-01 (retry storm) | `authTimeout` bounds the wait; `false` waits indefinitely — proven per site in 13-02/13-04/13-05, closed for the last site here | unit (real-timer, short explicit `authTimeout`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-02-03 | 02 | 2 | RAUTH-05 | T-13-03 (concurrent AUTH) | Each concurrent operation resolves independently, no relay-internal dedupe (single-relay proof) | unit (two concurrent REQs, handler-invocation-count assertion) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-02-03 | 02 | 2 | RAUTH-06 | — | `waitForAuth: false` → immediate `AuthRequiredError`, handler never called; `event(…, "AUTH")` never invokes it | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-07-02 | 07 | 6 | RAUTH-07 | — | Options present on all 8 operations and passed through Pool/Group — closed by this plan's group/pool leg | unit (table-driven pass-through assertions) | `pnpm vitest run packages/relay/src/__tests__/pool.test.ts packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 13-03-03 | 03 | 2 | RAUTH-08 | — | `SyncLoader` threads options into negentropy and paginated paths identically | unit (mocked `request`/`sync`, assert call args) | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ | ✅ green |
| 13-02-03 | 02 | 2 | RAUTH-09 | — | `authRequiredForRead$`/`authRequiredForPublish$` keep updating as informational status (relay-level proof) | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-02-03 | 02 | 2 | RAUTH-03 (gap) | T-13-02 (handler bug mis-attribution) | `AuthHandlerError` distinguishes a caller-handler rejection from a genuine relay timeout, carrying the original as `.cause` | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-03-03 | 03 | 2 | RAUTH-08 (gap) | — | `SyncLoader` stall guard does not fire during a *slow post-handler wait* (handler resolves fast, `authSatisfied$` slow) — see RESEARCH Assumption A2 | unit (held-out: exercises the residual window the recommended design does not obviously cover) | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ | ✅ green |
| 13-05-03 | 05 | 4 | RAUTH-02 (gap) | T-13-01 (retry storm) | `publish()`'s `customRetryOperator` skips `RelayClosedError` so removing the pre-block cannot produce a hot loop (D-07) | unit (wire-trace, assert bounded EVENT sends) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-01-03 | 01 | 1 | D-04 (shared operator, all-site foundation) | — | `authRetry`/`AuthPhaseGate`/`suspendableTimeout` proven directly, independent of any call site: signal never reaches the subscriber, handler invoked once per phase, source resubscribed exactly `authRetries + 1` times, counter resets on progress, `waitForAuth: false` short-circuit, handler rejection carries `.cause`, timeout bounds, `authTimeout: false` unbounded, gate suspension | unit (real timers only) | `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` | ✅ | ✅ green |
| 13-06-03 | 06 | 5 | RAUTH-08 (sync internal calls) | — | `Relay.sync`'s two previously-unthreaded internal relay calls (SEND-direction `event()`, RECEIVE-direction `req()`) now carry the caller's full auth option set, driven through a genuine two-party NIP-77 negotiation | unit (real negentropy round trip via `serverRespondToNegOpen`) | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 13-07-02 | 07 | 6 | RAUTH-05 (group) | T-13-03 (concurrent AUTH) | Two relays in a group each invoke their own handler independently; a handler rejecting for one relay does not affect the other's retry | unit (two mock relays, independent AUTH round trips) | `pnpm vitest run packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 13-07-01 / 13-07-02 | 07 | 6 | D-19 (group sync isolation) | T-13-01 (DoS via fan-out) | `RelayGroup.sync` catches per relay so one relay's sync failure no longer ends the group sync for the rest | unit (mocked `relay.sync`, one erroring one emitting) | `pnpm vitest run packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 13-07-01 / 13-07-02 | 07 | 6 | D-18 (`PublishResponse.error`) | T-13-02 (repudiation) | A failed group publish carries the original error object on `.error` alongside the unchanged `.message` fallback | unit | `pnpm vitest run packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 13-07-02 | 07 | 6 | RAUTH-09 (group) | — | `group.status$` still surfaces `authRequiredForRead`/`authRequiredForPublish` per relay through the merged status record | unit | `pnpm vitest run packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

All rows above were confirmed green via `pnpm --filter applesauce-relay test` (231/231) and
`pnpm --filter applesauce-loaders test` (118/118) on 2026-08-06, the day this plan closed the phase.
The non-gating Concord smoke check (`pnpm --filter applesauce-concord test`, 559/559) also passed,
confirming RAUTH-09's two informational flags are unaffected for Concord's existing readers
(`relay-auth.ts:110,206`, `invite-watcher.ts:258,428,435`).

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references *(N/A — no gaps)*
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant` set to `true` in frontmatter

**Approval:** approved (2026-08-06, 13-07 — every row in the per-task verification map has an
automated command and a confirmed green result; both minimum gates plus the non-gating Concord
smoke check are green)
