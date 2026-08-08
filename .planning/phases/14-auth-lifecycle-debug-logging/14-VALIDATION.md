---
phase: 14
slug: auth-lifecycle-debug-logging
status: draft
nyquist_compliant: false
wave_0_complete: false
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

> Populated by the planner. One row per task; every row needs an automated command or an explicit Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ALOG-01 | T-14-01 | Relay-supplied free text (`CLOSED` reason, `OK` message) truncated before interpolation into a log line | integration | `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALOG-02 | — | N/A | integration | `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ALOG-03 | — | N/A | unit + static check | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | ✅ (verify coverage in W0) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` (or a new `describe` block in `relay.test.ts`) — houses D-16's `captureDebugOutput()` harness, lifted from `packages/concord/src/helpers/__tests__/relays.test.ts:243-258`, with setup/teardown discipline for `debug`'s **global** enable state
- [ ] RED→GREEN non-vacuity probes for ALOG-01 and ALOG-02, per the standing Verification Standard (D-16)
- [ ] Confirm whether `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` already asserts on log/request line content sufficient to catch a regression from the D-18 hoist at `sync-loader.ts:611`; add an assertion if not
- Framework install: **none** — `vitest`, `vitest-websocket-mock`, and `debug` are all already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Grep sweep for non-construction-time `.extend(` in `packages/loaders/` | ALOG-03 | D-19 explicitly declines an enforcement mechanism (no lint rule, no grep-based repo test — "that rule wearing different clothes"). Verification is by review. | `grep -rn "\.extend(" packages/loaders/src --include="*.ts" \| grep -v __tests__` — every remaining hit must be either a construction-time derivation or an approved `.extend(nanoid(n))` correlation logger |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
