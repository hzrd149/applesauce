---
phase: 11
slug: messaging-wire-conformance
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-29
updated: 2026-07-29
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace config at `vitest.workspace.ts`) |
| **Full suite command** | `pnpm test` |
| **Unfiltered build gate** | `pnpm build` (= `turbo build`, includes `apps/examples`' `tsc -b`) |

> `src/**/*.test.ts` and `src/**/__tests__/**/*`, and no `typecheck` / `tsc --noEmit`
> script exists anywhere in the workspace. Vitest transpiles without type-checking, so a
> stale type in a `.test.ts` file surfaces in neither `pnpm build` nor `pnpm test`. Plan
> 11-04's reshaping of `community.test.ts`'s shared `target` local is therefore a
> correctness change the toolchain cannot catch — it is gated by source assertions, not by
> a compiler error.

> **Coverage gap to close in this phase (WIRE-01).** Root `pnpm test` is
> `turbo build --filter='./packages/*' && vitest run` — it **excludes `apps/*`
> from the build**. Removing `ChannelMetadata.voice` / `CreateChannelOptions.voice`
> workspace no longer builds. WIRE-01's verification MUST therefore include an
> unfiltered `pnpm build` (or `tsc -b` inside `apps/examples`) — a green
> `pnpm test` is not sufficient evidence for success criterion 1.

---

## Sampling Rate

- **After every plan wave:** Run `pnpm test`
- **WIRE-01 removal task specifically:** Run `pnpm build` (unfiltered — see gap note above)
- **Before `/gsd-verify-work`:** Full suite must be green AND `pnpm build` must succeed
- **Max feedback latency:** 30 seconds (measured 26s; no task in this phase depends on a slower signal)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-02-02 | 02 | 1 | WIRE-01 | T-11-04 | Workspace still builds — a green `pnpm test` is explicitly NOT accepted as evidence | build guard | `pnpm build` (unfiltered) | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Every WIRE-0x row's automated command exercises a fixture-anchored assertion per
TEST-01 (D-10)** — asserting against the vendored `examples.md` tag set in
own output. The three rows that could otherwise be vacuous each carry an additional
structural guard, spelled out in their plan's acceptance criteria:

- **11-05-01 (WIRE-03)** — exercised against a NON-9 target kind (a kind-1111 reply). Its
  probe requires observing that the kind-9 case stays GREEN under the reverted code, which
  is the direct demonstration that a kind-9-only test would prove nothing.
- **11-05-02 (WIRE-04)** — a two-level chain with an explicit NEGATIVE assertion that the
  root `E` does not name the intermediate reply. A depth-1-only test passes both before and
  after the fix (D-03).
- **11-05-03 (WIRE-05)** — the delete target is read back out of the channel store and
  asserted in-test to have no `sig`, so it cannot satisfy `isEvent` and route through
  `setDeleteEvents`' own `ensureKTag` branch (RESEARCH.md Pitfall 1).

**Revert-and-observe probes are mandatory**, following this project's established
precedent (12.1-01, 10-05, 12.3-06, 12.3-14). Each probe surgically reverts the single
line under test — not the whole plan — so a RED is attributable. Observed RED/GREEN
outcomes are recorded in each plan's SUMMARY.

---

## Wave 0 Requirements

      `examples.md` tag sets with per-entry CORD section citations, plus the three pure
      helpers (`substituteFixtureTags`, `missingFixtureTags`, `tagValues`) (D-10).
      **Delivered by plan 11-01, wave 1.** Every WIRE-02/03/04/05 assertion depends on it
      existing first — hence plans 11-05 and 11-06 both `depends_on` 11-01.
      non-vacuous (an unbound placeholder throws; comparison is order-independent).
      **Delivered by plan 11-01, wave 1.**
- [ ] A `wire conformance` describe block plus its shared setup helper in
      `client/__tests__/community.test.ts`. **Delivered by plan 11-05 Task 1, wave 3**;
      plan 11-06's community-side cases reuse the same helper.

*Otherwise: existing vitest infrastructure covers all phase requirements — no framework
install needed, and no package-manager install occurs anywhere in this phase.*

---

## Wave Structure

| Wave | Plans | Rationale |
|------|-------|-----------|
| 1 | 11-01 (fixture), 11-02 (voice flag removal), 11-03 (`ephemeralSk`) | Zero `files_modified` overlap. |
| 2 | 11-04 (target-kind API) | Serialized behind 11-03 on `client/community.ts`. |
| 3 | 11-05 (fixture-anchored conformance tests) | Needs 11-01's fixture and 11-04's implementation; serialized behind 11-04 on `client/__tests__/community.test.ts`. |
| 4 | 11-06 (voice presence delivery) | Serialized behind 11-04 on `client/community.ts` and behind 11-05 on `client/__tests__/community.test.ts`. |

The chain is imposed by file ownership, not by logical dependency: `client/community.ts`
is touched by three plans and `client/__tests__/community.test.ts` by three, so
same-wave placement would create write conflicts.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

All phase behaviors have automated verification. Two verification steps are
human-executed but machine-observed, and their outputs are recorded in the plan SUMMARYs
rather than asserted by a runner:

1. **The revert-and-observe non-vacuity probes** (plans 11-03, 11-05, 11-06). A probe
   cannot be encoded as a passing test — its whole point is to observe a RED. Each plan's
   acceptance criteria name the exact line to revert and the exact case that must fail.
2. **The fixture transcription audit** (plan 11-01). A reviewer diffs
   `cord-wire-fixtures.ts` against the CORD repo's `examples.md` at branch `main`. The
   per-entry `section` citations exist precisely to make this a mechanical diff rather
   than a judgement call.

---

## Validation Sign-Off

- [x] All 14 tasks have an `<automated>` verify; the three that depend on a Wave 0
      artifact (11-05-01/02/03) declare `depends_on: ["11-01", "11-04"]`
      test`; no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — the fixture module and its helper test are
      plan 11-01, wave 1, ahead of every consumer
      (which is `vitest run`) or `pnpm test` / `pnpm build`; bare `vitest` and
      `watch:test` appear nowhere
- [x] WIRE-01 verified by unfiltered `pnpm build`, not `pnpm test` alone (plan 11-02
      Task 2's acceptance criteria state this explicitly and reject a green `pnpm test`
      as evidence)
- [x] Every WIRE-0x wire-shape assertion is fixture-anchored (TEST-01 / D-10) — see the
      per-task map's Test Type column
- [x] Feedback latency 26s measured, under the 30s budget
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-07-29 — 6 plans, 14 tasks, 4 waves. Status flips to
`wave_0_complete: true` when plan 11-01 lands.
