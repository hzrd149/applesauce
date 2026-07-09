---
phase: 2
slug: generic-models-casts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Skeleton created at plan-time; finalized by `/gsd-validate-phase` after execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` + `vitest.workspace.ts` |
| **Quick run command** | `pnpm --filter applesauce-core test` |
| **Full suite command** | `pnpm --filter applesauce-core test` + `pnpm -r build` (full workspace type-check gate) |
| **Estimated runtime** | ~3s core tests; workspace build longer |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter applesauce-core test`
- **After every plan wave:** core build + test
- **Before phase completion:** `pnpm --filter applesauce-core test` green + `pnpm -r build` exit 0 (the WR-02/Phase-1 downstream-inference gate)
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| CORE-06 | Core models generic, return `E`-typed observables; existing signed-event model tests pass unchanged | unit | `pnpm --filter applesauce-core test` | ⬜ pending |
| CORE-07 | Cast infrastructure generic with `NostrEvent` defaults; existing cast tests pass unchanged | unit | `pnpm --filter applesauce-core test` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — this is a type-genericization phase whose acceptance is "existing signed-event model/cast tests pass without changes" plus a clean full-workspace build. No new test framework needed.

---

## Manual-Only Verifications

All phase behaviors have automated verification (unit tests + type-check build).

---

## Validation Sign-Off

- [ ] All requirements have automated verification
- [ ] Existing model/cast tests pass unchanged
- [ ] `pnpm -r build` exit 0 (full workspace, downstream-inference gate)
- [ ] `nyquist_compliant: true` set in frontmatter (at validate-phase)

**Approval:** pending (finalized by /gsd-validate-phase after execution)
