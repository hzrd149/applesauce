---
phase: 7
slug: private-channel-keying
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

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
- **Before `/gsd-verify-work`:** Full concord suite must be green.
- **Max feedback latency:** ~30 seconds.

---

## Per-Task Verification Map

> Populated by the planner / refined during execution. Every derivation task pairs with a spec-derived test whose expected value is computed by hand from CORD-03 §1 (never by calling the implementation under test).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-XX-XX | XX | 1 | CHAN-01 | — | keyless private derives nothing (no keys.channels / channelEpochs / plane) | unit (spec-derived) | `pnpm --filter applesauce-concord test helpers/__tests__/keys.test.ts` | ✅ | ⬜ pending |
| 7-XX-XX | XX | 1 | CHAN-02 | T-7 key-handling | keyless private send rejects with `MissingChannelKeyError` | unit | `pnpm --filter applesauce-concord test client/__tests__/community.test.ts` | ✅ | ⬜ pending |
| 7-XX-XX | XX | 1 | CHAN-07 | — | sticky-deleted id cannot be revived by a later edition | unit | `pnpm --filter applesauce-concord test helpers/__tests__` | ✅ | ⬜ pending |
| 7-XX-XX | XX | 1 | ROTATE-03 / TEST-01 | — | rolled-forward channel derives NEW epoch plane (hand-derived) | unit (spec-derived) | `pnpm --filter applesauce-concord test helpers/__tests__/channel-rekey.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — vitest is configured, and the target `__tests__` suites (`helpers/__tests__/keys.test.ts`, `helpers/__tests__/channel-rekey.test.ts`, `client/__tests__/community.test.ts`) already exist and are extended in place. No framework install or new fixture scaffolding required.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification — every behavioral fix lands with its spec-derived test (TEST-01/TEST-02). The Accordian field scenario is reproduced by TEST-02 case 5 (direct-invite grant-flow round-trip), so no manual step is required.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
