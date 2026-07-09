---
phase: 2
slug: generic-models-casts
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| CORE-06 | Core models generic, return `E`-typed observables; existing signed-event model tests pass unchanged | unit + type-check | `pnpm --filter applesauce-core test` (592/592) + verifier type probe (`EventStore<Rumor>.event()` → `Observable<Rumor>`) | ✅ green |
| CORE-07 | Cast infrastructure generic with `NostrEvent` defaults; existing cast tests pass unchanged | unit + type-check | `pnpm --filter applesauce-core test` + `rumor-cast.test.ts`/`user.test.ts` unmodified (`git diff --exit-code`) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — this is a type-genericization phase whose acceptance is "existing signed-event model/cast tests pass without changes" plus a clean full-workspace build. No new test framework needed.

---

## Manual-Only Verifications

All phase behaviors have automated verification (unit tests + type-check build).

---

## Validation Sign-Off

- [x] All requirements have automated verification (existing unit tests + type-check build; CORE-06/07 COVERED, no gaps)
- [x] Existing model/cast tests pass unchanged (592/592; `rumor-cast.test.ts`/`user.test.ts` unmodified)
- [x] `pnpm -r build` exit 0 (full workspace, 18 packages/apps — downstream-inference gate)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-08 (autonomous — no coverage gaps; zero-behavior-change genericization validated by unchanged existing tests + type-check + verifier type probe)
