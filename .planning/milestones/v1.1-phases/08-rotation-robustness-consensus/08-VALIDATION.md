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
| **Framework** | Vitest (`packages/concord/package.json`: `vitest run --passWithNoTests`) |
| **Config file** | Workspace-root vitest config (monorepo-wide; no per-package override) |
| **Quick run command** | `pnpm --filter applesauce-concord test` |
| **Full suite command** | `pnpm run build && pnpm exec vitest run` |
| **Estimated runtime** | ~30–60 seconds (package quick run); full monorepo longer |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter applesauce-concord test -- <changed-test-file>`
- **After every plan wave:** Run `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** `pnpm run build && pnpm exec vitest run` (full monorepo) must be green
- **Max feedback latency:** ~60 seconds (package quick run)

---

## Per-Requirement Verification Map

> Task IDs are assigned by the planner; rows below map each requirement to its spec-derived oracle and command. The planner MUST attach every ROTATE-05..13 row to at least one task's `<verify>`/`must_haves`.

| Requirement | Behavior (spec-derived oracle) | Test Type | Automated Command | File Exists |
|-------------|--------------------------------|-----------|-------------------|-------------|
| ROTATE-05 | Decrypt failure at own locator ≠ removal; resolves to `none`, retried on re-read (§2 removal rule) | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend |
| ROTATE-06 | Racing rotations converge down-only to strictly-lower sibling; settled epoch never re-forks (§3 latch) | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend (new latch assertions) |
| ROTATE-07 | Winner among ALL authorized+complete+continuity candidates; **opaque competing fork ⇒ defer `none`** (D-10) | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ✅ extend (opaque-fork scenario) |
| ROTATE-08 | `vac` cited on emit; receiver verifies structural resolve to `grantLocator` + folded-Roster grant, fail-closed; owner exempt (D-12) | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` / `keys.test.ts` | ❌ Wave 0 |
| ROTATE-09 | Compaction/snapshot publish gated on **per-wrap majority-confirmed** root roll; minority ⇒ `refound()` throws, no `adoptRefounding` (D-11) | unit/integration | `pnpm --filter applesauce-concord test -- community.test.ts` | ❌ Wave 0 |
| ROTATE-10 | Chunks correlate on `(rotator,scope,newepoch,prevcommit)` only; `n`-disagreement marks set inconsistent, never completes (D-02) | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` | ✅ extend |
| ROTATE-11 | `prevepoch` identity validated across a rotation's chunks; disagreement marks inconsistent (rides D-02) | unit | `pnpm --filter applesauce-concord test -- rekey.test.ts` | ✅ extend |
| ROTATE-12 | Historical epoch material does not inherit tip `refounder`; genesis = `undefined` (per-epoch attribution) | unit | `pnpm --filter applesauce-concord test -- sync.test.ts` | ❌ Wave 0 (create) |
| ROTATE-13 | Unfoldable compaction head ⇒ `buildRefounding` throws before any publish (D-01) | unit | `pnpm --filter applesauce-concord test -- keys.test.ts` | ❌ Wave 0 |
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
