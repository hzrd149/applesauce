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
| **Estimated runtime** | ~15–30 seconds (package-scoped) |

---

## Sampling Rate

- **After every task commit:** Run the quick command against the task's touched `__tests__` file.
- **Max feedback latency:** ~30 seconds.

---

## Per-Task Verification Map

> Every derivation task pairs with a spec-derived test whose expected value is computed by hand from CORD-03 §1 via `crypto.ts` primitives — never by calling the implementation under test. The keyless-private case asserts absence (derives nothing), never equality to the public address.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|

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
