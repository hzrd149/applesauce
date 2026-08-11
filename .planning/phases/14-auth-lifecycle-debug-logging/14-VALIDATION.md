---
phase: 14
slug: auth-lifecycle-debug-logging
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-08
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.0.15` (both `packages/relay` and `packages/loaders`) |
| **Config file** | `./vitest.config.ts` (root; no per-package override in either package) |
| **Quick run command** | `pnpm vitest run <path/to/file.test.ts>` (from repo root — the `--filter … -- <path>` form silently ignores the path) |
| **Full suite command** | `pnpm --filter applesauce-relay test` and `pnpm --filter applesauce-loaders test` |
| **Estimated runtime** | ~30 seconds per package suite |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <changed-test-file-path>`
- **After every plan wave:** Run `pnpm --filter applesauce-relay test` and, if `packages/loaders/` was touched, `pnpm --filter applesauce-loaders test`
- **Before `/gsd-verify-work`:** Both full suites green. `pnpm --filter applesauce-concord test` is not required for this phase (concord is Phase 15's scope) but should stay green as a non-regression check.
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> One row per task across all seven plans in this phase, filled in from executed runs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-T1 | 14-01 | 1 | ALOG-01, ALOG-02 | T-14-01 | `truncateForLog`/`shortId`/`summarizeFilter(s)`/`describeWireRequest` render any wire request as a bounded, human-readable summary | unit | `pnpm vitest run packages/relay/src/helpers/__tests__/auth-log.test.ts` | ✅ | ✅ green |
| 14-01-T2 | 14-01 | 1 | ALOG-02 | — | `negentropy()`'s NEG-OPEN subscription id is minted once per call and stays stable across every auth retry (D-05) | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-01-T3 | 14-01 | 1 | ALOG-01, ALOG-02 | — | `RelayAuthContext.request` threads the exhaustive wire-verb union through all four auth sites; `receivedAuthRequiredFor`/`satisfiedPubkeysFor` adapters added | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts packages/relay/src/__tests__/relay.test.ts packages/relay/src/__tests__/group.test.ts packages/relay/src/__tests__/pool.test.ts` | ✅ | ✅ green |
| 14-02-T1 | 14-02 | 1 | ALOG-03 | — | ALOG-03/ROADMAP Phase 14 criterion 3 restated to the D-18 tightened, non-vacuous wording | static check | `grep -n "ALOG-03" .planning/REQUIREMENTS.md .planning/ROADMAP.md` | ✅ | ✅ green |
| 14-02-T2 | 14-02 | 1 | ALOG-03 | — | `sync-loader.ts`'s per-url request logger hoisted out of the `switchMap` projector, derived once per relay in `buildRelayStream(url)` | unit | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ | ✅ green |
| 14-02-T3 | 14-02 | 1 | ALOG-03 | — | SEED-001 marked resolved with an accurate, non-stale audit record | static check | `grep -c "^status: resolved" .planning/seeds/SEED-001-avoid-inline-debug-extend.md` | ✅ | ✅ green |
| 14-03-T1 | 14-03 | 1 | ALOG-01, ALOG-02 | T-14-05 | `captureDebugOutput`/`messagesOf`/`withDebugCapture` — the shared, restore-safe debug-output capture oracle every later ALOG-01/02 test in this phase reuses | build | `pnpm --filter applesauce-relay build` | ✅ | ✅ green |
| 14-03-T2 | 14-03 | 1 | ALOG-01 | — | `RelayGroup.sync`'s dropped-relay line reworded to human prose naming the auth failure class, internal `(D-19)` citation stripped | unit | `pnpm vitest run packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 14-04-T1 | 14-04 | 2 | ALOG-01 | — | `Relay.authLog` `:auth` sub-namespace derived once per relay; two bucketed internal readers deleted; four relay-side refusal lines rerouted with request-describing summaries | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-04-T2 | 14-04 | 2 | ALOG-01 | T-14-02 | The full NIP-42 connection track — challenge received, signing, AUTH sent, result — logged with the full pubkey, never the AUTH event's signature | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-04-T3 | 14-04 | 2 | ALOG-01 | — | `resetState()`'s guarded auth-invalidation line names the dropped authenticated-pubkey count and whether a challenge was held, silent when nothing to invalidate | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-05-T1 | 14-05 | 2 | ALOG-02 | — | The three D-14 blocked-state lines (phase begin, handler invoked/absent, handler-resolved-now-waiting) each emit exactly one attributable line | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` | ✅ | ✅ green |
| 14-05-T2 | 14-05 | 2 | ALOG-02 | — | The six terminal-outcome lines (opted out, exhausted, wait satisfied, threw, rejected, timed out) each emit exactly one attributable line | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` | ✅ | ✅ green |
| 14-05-T3 | 14-05 | 2 | ALOG-02 | — | Two concurrent operations against distinct wire requests produce individually attributable lines in one shared log stream | unit | `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` | ✅ | ✅ green |
| 14-06-T1 | 14-06 | 3 | ALOG-01 | T-14-02 | A scripted successful NIP-42 exchange against a real `Relay`/mock-WS server produces a readable challenge → signing → sent → result trace, D-08's pubkey join key, and D-06's kind-spelled/authors-counted filter summary, with the AUTH event's signature never logged | integration | `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | ✅ | ✅ green |
| 14-06-T2 | 14-06 | 3 | ALOG-01 | T-14-01 | A hung signer and an unresponsive relay produce different traces (D-09); an oversized relay-supplied `CLOSED` reason/`OK` message is bounded near `AUTH_LOG_TEXT_LIMIT` rather than logged in full; the retries-exhausted outcome names the configured budget; reconnect invalidation (D-12) is reported only when there was something to invalidate | integration | `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | ✅ | ✅ green |
| 14-06-T3 | 14-06 | 3 | ALOG-02 | T-14-05 | Two concurrent operations' lines separate cleanly by wire key, stay individually attributable, and resolving one operation's auth requirement leaves the other genuinely blocked in the trace; every `it()` in the file runs inside `withDebugCapture` | integration | `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts packages/relay/src/__tests__/relay.test.ts packages/relay/src/__tests__/auth-retry.test.ts packages/relay/src/__tests__/group.test.ts` | ✅ | ✅ green |
| 14-07-T1 | 14-07 | 3 | ALOG-01 | — | `event()`'s locally-manufactured timeout response marks itself structurally via `PublishResponse.error`, distinguishable from a genuine relay verdict (D-11) | unit | `pnpm --filter applesauce-relay build && pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-07-T2 | 14-07 | 3 | ALOG-01 | — | A regression test proves both halves of the D-11 discriminator (manufactured timeout has `.error` set, a genuine relay rejection does not) | unit | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | ✅ | ✅ green |
| 14-07-T3 | 14-07 | 3 | ALOG-01 | — | Changeset set for the release window (D-01 edit plus new entries) | static check | `ls .changeset/relay-auth-wire-request-context.md .changeset/relay-publish-timeout-marks-itself.md .changeset/relay-auth-lifecycle-debug-logging.md .changeset/relay-operation-scoped-auth-callbacks.md` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Threat coverage note (T-14-SC):** No row above cites `T-14-SC` (npm/pip/cargo install legitimacy) — its disposition is `accept` per every plan's threat model, since this phase installs no new packages across any of its seven plans (re-confirmed: no `package.json` diffs land any dependency addition in this phase beyond 14-03's `debug`/`@types/debug` devDependency correction, itself a pre-existing-in-lockfile resolution fix, not a new install).

---

## Wave 0 Requirements

- [x] `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` — houses D-16's `captureDebugOutput()` harness (via `withDebugCapture`, lifted from `packages/concord/src/helpers/__tests__/relays.test.ts:243-258` through the 14-03 harness), with setup/teardown discipline for `debug`'s **global** enable state
- [x] RED→GREEN non-vacuity probes for ALOG-01 and ALOG-02, per the standing Verification Standard (D-16) — performed for the hung-signer/unresponsive-relay pair and the reconnect-invalidation pair; see `14-06-SUMMARY.md`
- [x] Confirmed `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` asserts on the D-18 hoist (14-02's derive-once regression test, spy-`Debugger`-based)
- Framework install: **none** — `vitest`, `vitest-websocket-mock`, and `debug` are all already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grep sweep for non-construction-time `.extend(` in `packages/loaders/` | ALOG-03 | D-19 explicitly declines an enforcement mechanism (no lint rule, no grep-based repo test — "that rule wearing different clothes"). Verification is by review. | `grep -rn "\.extend(" packages/loaders/src --include="*.ts" \| grep -v __tests__` — every remaining hit must be either a construction-time derivation or an approved `.extend(nanoid(n))` correlation logger |

**Executed 2026-08-11** (see `14-06-SUMMARY.md` for the full pasted output and per-hit disposition): 11 hits, all either an approved `.extend(nanoid(n))` per-call correlation logger or a construction-time (function-entry/operator-application) derivation. Zero hits inside a re-enterable reactive callback (`switchMap`/`mergeMap` projector). Confirms D-18/D-20 hold across the whole phase.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant` set to `true` in frontmatter

**Approval:** signed off 2026-08-11 (14-06, Wave 3) — every row above has a non-empty Automated Command cell and a recorded green run; the Manual-Only Verification's grep sweep was executed and pasted with a per-hit disposition into `14-06-SUMMARY.md`.
