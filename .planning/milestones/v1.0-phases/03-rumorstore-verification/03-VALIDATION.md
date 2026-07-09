---
phase: 3
slug: rumorstore-verification
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract. Skeleton created at plan-time; finalized by `/gsd-validate-phase` after execution. Unlike Phases 1–2 (zero-behavior-change genericization), this phase ships NEW behavior (RumorStore) and therefore NEW rumor-typed tests.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` + `vitest.workspace.ts` |
| **Quick run command** | `pnpm --filter applesauce-core test` |
| **Full suite command** | `pnpm --filter applesauce-core test` + `pnpm -r build` (castEvent is public) |
| **Estimated runtime** | ~3s core tests |

---

## Sampling Rate

- **After every task commit:** `pnpm --filter applesauce-core test`
- **After every plan wave:** core build + test
- **Before phase completion (Part A gate):** `pnpm --filter applesauce-core test` green + `pnpm --filter applesauce-core build` green + full `pnpm -r build` exit 0
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | Test File | Status |
|-------------|----------|-----------|-------------------|-----------|--------|
| RUMOR-03 | `RumorStore` accepts a correct-`id` rumor, rejects an incorrect-`id` rumor (verifyRumor default verifier) | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/rumor-store.test.ts` (new) | ✅ green |
| RUMOR-04 | `RumorStore.filters()` streams rumors; `timeline()` returns `Rumor[]`; `replaceable()` returns latest replaceable rumor; `getEvent()` returns a `Rumor` | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/rumor-store.test.ts` (new) | ✅ green |
| RUMOR-05 | Kind-5 delete rumors remove matching stored rumors | unit | `pnpm --filter applesauce-core test` | `event-store/__tests__/rumor-store.test.ts` (new) | ✅ green |
| RUMOR-06 | A custom `EventCast<Rumor>` works with `castEvent` against a rumor store; signed-only cast rejects a rumor at compile time | unit + type-check | `pnpm --filter applesauce-core test` | `casts/__tests__/rumor-cast.test.ts` (extended) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New rumor test files (`rumor-store.test.ts`, extended `rumor-cast.test.ts`) are authored within this phase's plans — no separate framework install. Add type-level coverage (`@ts-expect-error`) where practical so `tsc` catches regressions (e.g., a signed cast rejecting a rumor).

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All requirements have automated verification (new rumor tests + type-check)
- [x] Part A gate: core test + build green, full `pnpm -r build` exit 0
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09 (autonomous — RUMOR-03/04/05/06 all covered by new rumor tests, 601/601 green, Part A gate passed; no gaps)
