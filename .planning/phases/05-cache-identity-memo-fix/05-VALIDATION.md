---
phase: 5
slug: cache-identity-memo-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` § Validation Architecture. Locked decisions live in `05-CONTEXT.md` (D-01 … D-18).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.15 (workspace-wide) |
| **Config file** | `vitest.config.ts` (root) + per-package configs for `core` and `concord` |
| **Quick run command** | `pnpm --filter applesauce-core test` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | Not yet measured — record on the first Wave 0 run rather than assume |

No framework install needed: Vitest is already wired at the workspace root and in both `core` and `concord`.

---

## Sampling Rate

- **After every task commit:** `pnpm --filter applesauce-core test` (add `--filter applesauce-concord test` once the spec-derived fixture tasks land)
- **After every plan wave:** `pnpm -r test`
- **Before `/gsd-verify-work`:** full suite green
- **Phase gate:** `pnpm -r test` green against the recorded baseline of **1989 tests, exit 0** (Success Criterion 4)

**Reading the baseline correctly:** this phase *adds* tests, so a higher total is expected and is not a regression signal. A lower *pass* count, or any failure, is. Compare passes and exit code — not the raw total.

---

## Per-Task Verification Map

Task IDs are assigned by the planner; this map is requirement-level until plans exist, and the planner is responsible for binding each row to a concrete task ID.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1 | CACHE-01 | — | N/A | unit | `pnpm --filter applesauce-core test cache` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | CACHE-02 | — | N/A | manual (prose) | code review at PR time | n/a | ⬜ pending |
| TBD | TBD | 1 | CACHE-03 | — | N/A | integration | `pnpm --filter applesauce-core test cache` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | TEST-01 (H01a) | — | N/A | unit (spec-derived) | `pnpm --filter applesauce-concord test keys` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | TEST-01 (H01c) | — | N/A | unit (spec-derived) | `pnpm --filter applesauce-concord test channel-rekey` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**TEST-01 is an anchor here, not a closure** — it stands across Phases 6–12 and does not close in this phase.

---

## The Two-Sided Convention Test (D-13/D-14/D-15)

Both halves live in one new file, `packages/core/src/helpers/__tests__/cache.test.ts` — which does not exist today (confirmed). They assert **opposite** outcomes on the same mechanism, and that contrast is the lesson:

1. **Memo half → proves CACHE-01.** Write via `setCachedValue`/`getOrComputeCachedValue` onto a plain mutable object, spread it with one field changed, assert the symbol is **absent** on the copy and that recomputation yields the new-field-derived value rather than the stale memo.
2. **Carry-forward half → proves CACHE-03.** Real encrypt operation → real `eventPipe`/`tagPipe` spreads → real `signer.signEvent` → then `getEncryptedContent`/`getHiddenTags` off the signed event. This promotes the audit's already-passing hand-run probe into CI (D-15) instead of inventing coverage.

**Why the pair matters:** a future tidy-up that migrates `EncryptedContentSymbol`'s write sites onto `setCachedValue` must turn half 2 red immediately. Prose explains the convention; this test enforces it. A comment alone is exactly what failed at `keys.ts:100-103`, where the comment existed and was confidently wrong.

---

## Spec-Derived Test Independence (TEST-01, D-18)

The milestone exists because all 189 concord tests passed while 9 HIGH bugs were live — every test compared the implementation to itself.

**Resolved approach (user-confirmed during planning):** expected values come from `controlGroupKey`/`channelGroupKey` in `packages/concord/src/helpers/crypto.ts`, fed the spec's `(label, secret, id, epoch)` tuple explicitly and **bypassing `baseKeysFor`/`deriveConcordKeys`/`rollForward` entirely**. `crypto.ts` is a byte-exact transcription of CORD-02 Appendix A that PROJECT.md registers as separately audited and out of scope; the implementation under test in this phase is the memo/spread mechanism. This is what the audit's own H01 proof did.

**Prohibited:** any self-referential form, e.g. asserting `rollForward(...).control.pk === deriveConcordKeys(oldMaterialWithNewRoot).control.pk`. That reproduces the exact failure mode this milestone closes.

Formulas (CORD-02 §4 control address, CORD-03 §1 private-channel address) and the byte-encoding gotchas are recorded in `05-RESEARCH.md` § Gap 1 — including that ids and secrets are hex strings on the material objects and need `hexToBytes` before reaching `crypto.ts`.

---

## Wave 0 Requirements

- [ ] `packages/core/src/helpers/__tests__/cache.test.ts` — new file; both D-13 halves (memo-drop + carry-forward-survival)
- [ ] New case in `packages/concord/src/helpers/__tests__/keys.test.ts` — H01(a) spec-derived fixture
- [ ] New case in `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` — H01(c) spec-derived fixture
- [ ] No framework/config install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canonical taxonomy prose in `cache.ts` names the three categories (identity memo / carry-forward payload / accumulated state), uses the `EncryptedContentSymbol` dual-lifecycle split as its worked example, and cross-references `PRESERVE_EVENT_SYMBOLS` (`pipeline.ts:5`) and the `event-store.ts` merge list | CACHE-02 | Prose cannot carry an automated assertion | Read `packages/core/src/helpers/cache.ts` at review time: confirm all three D-04 categories are named, that categories are framed as classifying **write sites** not symbols (D-05), and that both D-07 executable cross-references are present |
| Each classified sweep site carries a one-liner naming its category and pointing at `cache.ts` | CACHE-02 | Comment presence across 33 sites; re-runnable grep confirms completeness, but wording is a review judgment | Re-run the D-10 grep from `05-RESEARCH.md` § Gap 2 and confirm every hit under `packages/{core,common}/src` (excluding `__tests__`) carries a category one-liner |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Per-task map bound to real task IDs by the planner
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
