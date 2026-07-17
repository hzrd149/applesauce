---
phase: 7
slug: private-channel-keying
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-17
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Reconciled against the final plans (07-01/02/03).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (via root `vitest.config.ts` / `vitest.workspace.ts`) |
| **Config file** | `vitest.config.ts` (root); no per-package config |
| **Quick run command** | `pnpm --filter applesauce-concord test <changed test file>` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~15–30 seconds (package-scoped) |

---

## Sampling Rate

- **After every task commit:** Run the quick command against the task's touched `__tests__` file.
- **After every plan wave:** Run `pnpm --filter applesauce-concord test`.
- **Before `/gsd-verify-work`:** Full concord suite must be green; `vitest run` (full monorepo) green before phase verification.
- **Max feedback latency:** ~30 seconds.

---

## Per-Task Verification Map

> Every derivation task pairs with a spec-derived test whose expected value is computed by hand from CORD-03 §1 via `crypto.ts` primitives — never by calling the implementation under test. The keyless-private case asserts absence (derives nothing), never equality to the public address.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | CHAN-04, CHAN-05, CHAN-07 | T-07-01..08 (H06/H07/H08/CHAN-07) | Source-of-truth refactor: keys read only from `material.channels`; edition fields picked with type checks; sticky-delete pins `heads.set` to the terminal deleting edition | unit + tsc | `pnpm --filter applesauce-concord test` | ✅ | ⬜ pending |
| 7-01-02 | 01 | 1 | CHAN-01, CHAN-03, TEST-01/02 | — | Keyless private derives nothing (no `keys.channels`/`channelEpochs`/plane); public + keyed-private branches derive from CORD-03 §1 hand-derived values | unit (spec-derived) | `pnpm --filter applesauce-concord test helpers/__tests__/keys.test.ts` | ✅ | ⬜ pending |
| 7-01-03 | 01 | 1 | CHAN-04, CHAN-07, TEST-02 | T-07 (CHAN-07 revive) | Explicit edition field-pick; deleted id cannot be revived across a compaction round-trip / fresh-joiner fold | unit | `pnpm --filter applesauce-concord test helpers/__tests__/control.test.ts` | ✅ | ⬜ pending |
| 7-02-01 | 02 | 2 | CHAN-06 | — | `hasChannelKey` adopted at the two ad-hoc `material.channels` lookup sites | unit | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-02-02 | 02 | 2 | CHAN-06 | — | `ChannelView.accessible` + `materialChanged$` wired into all four material-mutation sites; `channels$` redefined via `combineLatest` | unit | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-02-03 | 02 | 2 | CHAN-06 | — | `channels$` re-emits `accessible:true` after a key grant with no control-plane fold in between | unit (reactivity) | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-03-01 | 03 | 3 | CHAN-02 | T-07 send-path | `MissingChannelKeyError` thrown from `sendMessage`/`sendEvent` guard for known private+keyless channel | unit | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-03-02 | 03 | 3 | CHAN-02, CHAN-05, TEST-02 | T-07 send-path | Send to keyless private rejects with distinct error; TEST-02 case 5 grant round-trip derives once key is folded | unit | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-03-03 | 03 | 3 | ROTATE-03, TEST-02 | T-07 rekey | Client-level rotate→send addresses the NEW epoch's plane without reload (hand-derived) | unit (spec-derived) | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — vitest is configured, and the target `__tests__` suites (`helpers/__tests__/keys.test.ts`, `helpers/__tests__/control.test.ts`, `helpers/__tests__/channel-rekey.test.ts`, `client/__tests__/community.test.ts`) already exist and are extended in place. No framework install or new fixture scaffolding required.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification — every behavioral fix lands with its spec-derived test (TEST-01/TEST-02). The Accordian field scenario is reproduced by TEST-02 case 5 (direct-invite grant-flow round-trip) and the CHAN-06 reactivity test, so no manual step is required.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra suffices)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-17
