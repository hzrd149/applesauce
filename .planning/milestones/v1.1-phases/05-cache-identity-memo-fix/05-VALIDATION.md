---
phase: 5
slug: cache-identity-memo-fix
status: approved
nyquist_compliant: true
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

Bound to the 5 plans created 2026-07-15. All 13 tasks carry an `<automated>` verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | CACHE-01 | T-05-01 | Memo written non-enumerable, so a Refounding actually rotates key material instead of being a cryptographic no-op | unit | `pnpm --filter applesauce-core test` | ✅ | ⬜ pending |
| 05-01-02 | 01 | 1 | CACHE-02 | — | N/A | source assertion (prose — see Manual-Only) | `pnpm --filter applesauce-core test` (guards regression only) | ✅ | ⬜ pending |
| 05-01-03 | 01 | 1 | CACHE-01 | — | N/A | CLI assertion | changeset shape script (patch bump + single-sentence body) | ✅ | ⬜ pending |
| 05-02-01 | 02 | 2 | CACHE-01 | — | N/A | unit | `pnpm --filter applesauce-core test cache` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 2 | CACHE-03 | T-05-02 | Plaintext still resolves off a signed event that passed through the pipe's spreads — the fix does not over-reach into the carry-forward path | integration (real pipe + real signing) | `pnpm --filter applesauce-core test cache` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | CACHE-02 | — | N/A | behavior assertion (comment-only diff) | `pnpm --filter applesauce-core test` | ✅ | ⬜ pending |
| 05-03-02 | 03 | 2 | CACHE-02 | — | N/A | behavior assertion (comment-only diff) | `pnpm --filter applesauce-common test` | ✅ | ⬜ pending |
| 05-03-03 | 03 | 2 | CACHE-02 | — | N/A | behavior assertion (comment-only diff) | `pnpm --filter applesauce-concord test` | ✅ | ⬜ pending |
| 05-04-01 | 04 | 2 | TEST-01 (H01a) | T-05-01 | Epoch rotation actually rotates the control address per CORD-02 §4 | unit (spec-derived) | `pnpm --filter applesauce-concord test keys` | ✅ (new case) | ⬜ pending |
| 05-04-02 | 04 | 2 | TEST-01 (H01c) | T-05-01 | Channel rekey actually rotates the plane address per CORD-03 §1 | unit (spec-derived) | `pnpm --filter applesauce-concord test channel-rekey` | ✅ (new case) | ⬜ pending |
| 05-05-01 | 05 | 3 | CACHE-01, TEST-01 | — | N/A | non-vacuity probe (revert `cache.ts`) | `git status --porcelain` empty + core/concord suites | n/a | ⬜ pending |
| 05-05-02 | 05 | 3 | CACHE-03 | — | N/A | non-vacuity probe (empty `PRESERVE_EVENT_SYMBOLS`) | `git status --porcelain` empty + `pnpm --filter applesauce-core test cache` | n/a | ⬜ pending |
| 05-05-03 | 05 | 3 | all four | — | N/A | phase gate | `pnpm -r test` + D-10 grep 34/34 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Wave structure:** 05-01 (wave 1) lands the fix; 05-02/05-03/05-04 (wave 2) all depend on it and have zero `files_modified` overlap, so they run fully parallel; 05-05 (wave 3) runs alone because its probes temporarily mutate `cache.ts` and `pipeline.ts`, which cannot safely happen beside other agents.

**On the two non-vacuity probes (05-05-01 / 05-05-02):** Probe A reverts the `cache.ts` fix and must turn the memo-drop half **and** both concord cases red — while the carry-forward half stays **green**. That is not a bug in the probe: the carry-forward write sites do not route through `cache.ts`, so expecting them to go red would be a misreading of the finding. Probe B (emptying `PRESERVE_EVENT_SYMBOLS`) is the only probe that can turn the carry-forward half red, which is what proves that half is non-vacuous. Both probes are temporary and `git checkout`-restored, with an empty `git status --porcelain` as an acceptance criterion.

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
| Each classified sweep site carries a one-liner naming its category and pointing at `cache.ts` | CACHE-02 | Comment presence across 35 sites; the re-runnable grep confirms completeness, but comment *wording* is a review judgment | Re-run the D-10 grep from `05-RESEARCH.md` § Gap 2 and confirm every hit under `packages/{core,common}/src` (excluding `__tests__`) carries a category one-liner. Post-fix the grep returns exactly **34** (all sweep sites — `cache.ts` no longer uses `Reflect.set`), plus the one non-grep object-literal at `core/operations/tags.ts:87` = 35 total. `05-05-03` runs this as a 34/34 gate. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — all 13/13 tasks carry one
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — `cache.test.ts` (05-02) plus the two concord cases (05-04)
- [x] No watch-mode flags
- [x] Per-task map bound to real task IDs
- [x] Non-vacuity proven, not assumed — every new test has a probe that reintroduces the defect it guards (05-05)
- [x] `nyquist_compliant: true` set in frontmatter

**Not yet satisfiable (execution-time):**
- [ ] Feedback latency measured — record on the first Wave 0 run rather than assume a number
- [ ] `wave_0_complete: true` — flips when 05-02/05-04's test files exist and are green

**Approval:** approved 2026-07-15 (plan-checker: VERIFICATION PASSED, no blockers)
