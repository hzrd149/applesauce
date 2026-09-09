---
phase: 8
slug: rotation-robustness-consensus
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-19
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. All tests are **spec-derived** (TEST-01): every expected value is computed by hand from CORD-06 §2/§3, never read back from the implementation under test.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Config file** | Workspace-root vitest config (monorepo-wide; no per-package override) |
| **Full suite command** | `pnpm run build && pnpm exec vitest run` |
| **Estimated runtime** | ~30–60 seconds (package quick run); full monorepo longer |

---

## Sampling Rate

- **Before `/gsd-verify-work`:** `pnpm run build && pnpm exec vitest run` (full monorepo) must be green
- **Max feedback latency:** ~60 seconds (package quick run)

---

## Per-Requirement Verification Map

> Task IDs are assigned by the planner; rows below map each requirement to its spec-derived oracle and command. The planner MUST attach every ROTATE-05..13 row to at least one task's `<verify>`/`must_haves`.

| Requirement | Behavior (spec-derived oracle) | Test Type | Automated Command | File Exists |
|-------------|--------------------------------|-----------|-------------------|-------------|
| TEST-01 (standing) | Continuity math, `lowerKeyWins` tie-break, complete-set gate each have a hand-derived §2/§3 oracle | unit | (covered by rows above) | Partial — pattern established, extend |

*Status per task assigned during execution: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `helpers/__tests__/rekey.test.ts` — `vac`-tag round-trip (once `ParsedRekey`/`includeRekeyChunk` gain the field); `n`-disagreement and `prevepoch`-disagreement consistency-guard tests (ROTATE-10/11)
- [ ] `helpers/__tests__/keys.test.ts` — transient-decrypt-≠-removal (ROTATE-05); down-only latch (ROTATE-06); opaque-fork-deferral (ROTATE-07, D-10); `vac`-verification-reject (ROTATE-08, D-12); abort-on-unfoldable-head (ROTATE-13)
- [ ] `client/__tests__/community.test.ts` — majority-gated publish (ROTATE-09, D-11): mock `pool.publish` → `PublishResponse[]` with minority `ok:true`; assert `refound()` throws and does NOT call `adoptRefounding`/publish compaction
- [ ] `client/__tests__/sync.test.ts` (new or extended) — direct unit for `buildChain` per-epoch `refounder` attribution (ROTATE-12), not just indirect via `community.test.ts`
- [ ] Channel-scope re-read spine coverage — verify during planning whether `channel-rekey.test.ts` already hosts `syncChannelEpochs`/`syncRekeyAndAdvance` convergence tests; extend there or add a `channel-sync.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | All phase behaviors have automated spec-derived verification. |

*All phase behaviors have automated verification — this is pure protocol-math correctness work with no UI or external-service surface.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (ROTATE-08/09/12/13 test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-19
