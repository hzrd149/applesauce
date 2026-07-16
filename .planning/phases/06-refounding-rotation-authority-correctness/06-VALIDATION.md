---
phase: 6
slug: refounding-rotation-authority-correctness
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-16
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `06-RESEARCH.md` §Validation Architecture. Per-task rows are
> completed by the planner once PLAN task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`, workspace-wide) |
| **Config file** | `vitest.config.ts` / `vitest.workspace.ts` (root) |
| **Quick run command** | `pnpm --filter applesauce-concord test -- helpers/__tests__/keys.test.ts helpers/__tests__/guestbook.test.ts client/__tests__/community.test.ts` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~15–30 seconds (package-scoped) |

---

## Sampling Rate

- **After every task commit:** Run the quick-run command scoped to the touched test files
- **After every plan wave:** Run `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** Full `applesauce-concord` suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

*Requirement → behavior → oracle map (from research). Task IDs (`6-NN-NN`) are
filled in by the planner; every derivation/fold row must be verified against an
**independently hand-derived spec value**, never the implementation output (TEST-01).*

| Requirement | Wave | Secure Behavior | Independently-Derived Oracle | Test Type | Automated Command | File Exists |
|-------------|------|-----------------|------------------------------|-----------|-------------------|-------------|
| ROTATE-01 | 1 | `rollForward(...).control.pk`/`.guestbook.pk` equal the CORD-02 §4/§5 formula over the new root | hand-computed `controlGroupKey`/`guestbookGroupKey` over new root+epoch (via `crypto.ts`) | unit, spec-derived | `... test -- keys.test.ts -t "guestbook address"` | ❌ guestbook probe (control exists `keys.test.ts:191`) |
| ROTATE-02 | 1 | Each held epoch addresses a distinct plane (base-rekey address) | hand-computed `baseRekeyGroupKey` — addresses `newEpoch` under the **PRIOR** root (off-by-root guard) | unit, spec-derived | `... test -- keys.test.ts -t "rekey address"` | ❌ base-rekey probe |
| ROTATE-04 | 1 | Excluded member absent from new-epoch Complete Memberlist even with prior-epoch Join/`observed` | hand-built memberlist from snapshot only; removed member has no new-epoch plane activity | integration | `... test -- guestbook.test.ts community.test.ts -t "observed"` | ❌ observed-re-admission (H02 gap) |
| AUTH-01 | 1 | `readRekey` root path DENIES `removed` when `canRemoveSelf` absent/false (fail-closed) | rotator not strictly outranking self ⇒ denied; analog `channel-rekey.test.ts:206` | unit | `... test -- keys.test.ts -t "outrank"` | ❌ root-path outrank test |
| AUTH-02 | 1 | `refound()` throws when caller does not strictly outrank an excluded target | caller lacking `PERM.BAN` over target.position ⇒ throw, no publish | integration | `... test -- community.test.ts -t "outrank"` | ❌ send-path outrank test |
| TEST-01 (standing) | 1 | Every touched derivation/fold has a spec-independent oracle asserting the impl matches | all oracles above computed by hand from CORD-02 §4/§5 | unit, spec-derived | (rows above) | Partial — control + channel-plane exist; guestbook + base-rekey are the gap |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `helpers/__tests__/keys.test.ts` — add guestbook + base-rekey spec-derived probes (D-10/D-11), following the `keys.test.ts:191-213` pattern; include the D-11 seed-memo-then-`rollForward` anti-regression probe for guestbook + rekey
- [ ] `helpers/__tests__/guestbook.test.ts` — add the observed-re-admission-across-refounding test (the H02 gap named in CONTEXT.md)
- [ ] `client/__tests__/community.test.ts` — add (1) a root-path outrank-on-removal test (AUTH-01) and (2) a `refound()` send-path outrank-rejection test (AUTH-02), mirroring `channel-rekey.test.ts:206-237`
- [ ] Decide during planning whether Open Question 1 (public-channel `observed` post-exclusion residual) is in-scope for Phase 6 or explicitly deferred with a code comment

*No framework install needed — Vitest is already the workspace runner.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All Phase 6 behaviors have automated verification — every success criterion reduces to a spec-derived unit/integration assertion.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (confirmed by gsd-plan-checker across 06-01/06-02/06-03)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (guestbook/base-rekey probes, observed-re-admission, both outrank tests)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-16 (plans verified — `wave_0_complete` flips when execution lands the Wave 0 tests)
