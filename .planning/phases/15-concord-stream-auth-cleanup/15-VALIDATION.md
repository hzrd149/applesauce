---
phase: 15
slug: concord-stream-auth-cleanup
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-13
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `15-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`; no per-package config in `packages/concord`) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `pnpm vitest run packages/concord/src/client/__tests__/<file>.test.ts` |
| **Full suite command** | `pnpm --filter applesauce-concord test` |
| **Estimated runtime** | ~30s quick / ~2min full |

> **Do not use** the `pnpm --filter … -- <path>` form for a single file — it silently runs the
> whole suite instead. Use `pnpm vitest run <path>` from the repo root.

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <touched-test-file>`
- **After every plan wave:** `pnpm --filter applesauce-concord test`
- **Before `/gsd-verify-work`:** full concord suite green **plus** `pnpm --filter applesauce-examples build` green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

*Populated by the planner — one row per task, keyed to the plan and wave that produces it.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-T2 | 01 | 1 | CAUTH-01 | T-15-01 | `StreamSigners.onAuthRequired` authenticates only the intersection of a relay's `missingPubkeys` and the scope's own registry; a `null` `missingPubkeys` authenticates nothing, even across two disjoint holders sharing one relay | unit | `pnpm vitest run packages/concord/src/client/__tests__/auth.test.ts` | ✅ | ✅ green |
| 15-04-T3 | 04 | 3 | CAUTH-02 | T-15-01, T-15-09 | Two communities sharing one relay each authenticate only their own authors, proven under a relay-supplied `missingPubkeys` deliberately widened to the union of both scopes' authors (so the isolation claim cannot pass vacuously); a reconnect cycle re-authenticates that same scoped set, never a union | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-07-T2 | 07 | 6 | CAUTH-03 | T-15-15, T-15-16 | Source-tree-walk guard (two roots: `packages/concord/src` and `apps/examples/src/examples/concord`) fails CI on reintroduction of any of the five removed mechanisms, any new ambient-auth trigger (`challenge$`/`authRequiredForRead`/`authRequiredForPublish`), any retry-budget override (`authRetries`/`authTimeout`), or any second missing-pubkeys handler outside `client/auth.ts` | structural | `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` | ✅ | ✅ green |
| 15-04-T3 | 04 | 3 | CAUTH-04 | T-15-04 | Recorded live-subscription options leave `authRetries`/`authTimeout` undefined so the upstream defaults (`1`, `30_000`) govern, and a second auth-required cycle is never suppressed or deduped | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-01-T2 | 01 | 1 | CAUTH-04 | T-15-04 | Invoking the same handler twice with the same `missingPubkeys` sends two AUTHs — no dedupe, no suppression of a second auth-required cycle (D-18) | unit | `pnpm vitest run packages/concord/src/client/__tests__/auth.test.ts` | ✅ | ✅ green |
| 15-09-T3 | 09 | 1 (gap closure) | CAUTH-01 | T-15-21 | A private-channel send's `waitForAuth` pubkey is registered in the community's own `StreamSigners` (`heldChannelKeys()`), so the recorded `onAuthRequired` handler authenticates it (closes CR-01) | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-10-T1 | 10 | 1 (gap closure) | CAUTH-01 | T-15-24, T-15-27 | A total-answering-failure over a non-empty `missingPubkeys` emits a distinct `:auth` trace and an `onAuthFailure` message (`failNoSigner`); a partial answer and a `null` `missingPubkeys` stay silent (WR-03) | unit | `pnpm vitest run packages/concord/src/client/__tests__/auth.test.ts packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-10-T2 | 10 | 1 (gap closure) | CAUTH-01 | T-15-26 | `ConcordInviteManager`'s holder reports a rejected invite-link AUTH during `revokeBundle()` on its own `:invite` logger (WR-04) | unit | `pnpm vitest run packages/concord/src/client/__tests__/client.test.ts` | ✅ | ✅ green |
| 15-11-T2 | 11 | 1 (gap closure) | CAUTH-03 | T-15-29 | All four `no-ambient-auth.test.ts` checks (removed mechanisms, ambient-auth trigger, retry-budget override, missing-pubkeys handler) scan both `packages/concord/src` and `apps/examples/src/examples/concord` via a shared `allFiles()` helper (WR-08) | structural | `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` | ✅ | ✅ green |
| 15-12-T1 | 12 | 2 (gap closure) | CAUTH-01 | T-15-31 | `buildChannelRekey`/`buildRefounding` return the exact `GroupKey`(s) that finalized their wraps (`rekeyKey`, `channelRekeyKeys`), including the `priorRoot`-divergence case a caller-side recomputation would get wrong | unit | `pnpm vitest run packages/concord/src/helpers/__tests__/channel-rekey.test.ts packages/concord/src/helpers/__tests__/keys.test.ts` | ✅ | ✅ green |
| 15-12-T2 | 12 | 2 (gap closure) | CAUTH-01 | T-15-31 | `rotateChannel()`/`refound()` register the exact key their own plan finalized the wraps with; no channel-rekey address is derived from `this.material.community_root` anywhere in `community.ts`, even under a mid-flight root change (WR-01) | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |
| 15-12-T3 | 12 | 2 (gap closure) | CAUTH-01 | T-15-32, T-15-33 | An auth failure at any point in either engine's lifetime (not just walk-end) reaches `error$`/`status$.error` immediately, with no second walk required (WR-02) | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts packages/concord/src/client/__tests__/private-channel.test.ts` | ✅ | ✅ green |
| 15-13-T2 | 13 | 2 (gap closure) | CAUTH-01 | T-15-35, T-15-36, T-15-37 | `SyncContext.onAuthRequired` is typed `SyncAuthHandler` (not `RelayAuthHandler`) and `syncAuthors` passes it to `createSyncLoader` with no cast; a handler that reads `request` is rejected at compile time (WR-07) | unit | `pnpm vitest run packages/concord/src/client/__tests__/sync.test.ts packages/concord/src/client/__tests__/channel-sync.test.ts` | ✅ | ✅ green |
| 15-14-T1 | 14 | 3 (gap closure) | CAUTH-01 | T-15-38 | The publish-answerability scenario drives every `ConcordCommunity` publish site — `refound()`'s four sites, `refreshInviteBundles()`, and the private-channel send — and asserts a lower bound (10) on the number of distinct publishing authors exercised, replacing the loop's unchecked universality comment (WR-06) | unit | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement → Oracle Map

| Req | Oracle | Independence |
|-----|--------|--------------|
| CAUTH-01 | Handler invoked with `missingPubkeys` narrowed to the operation's own `waitForAuth`; authenticates only signers the scope holds | Expected set derived from the operation's own filter `authors`, computed independently of the handler under test |
| CAUTH-02 | `authenticate` spy records `(pubkey, relayUrl)` pairs across a two-scope fixture sharing one relay; assert per-scope isolation and that reconnect re-triggers the same per-scope set, not a union | **Design-derived, not a before/after diff** — no "before" recording of the prior churn behavior was ever committed. Expected `k` comes from each operation's own `waitForAuth`. |
| CAUTH-03 | Source-tree-walk guard, mirroring `packages/concord/src/__tests__/cord-citations.test.ts` | Structural — fails automatically if any of the five mechanisms is reintroduced |
| CAUTH-04 | Relay answers `auth-required:` once then succeeds → operation resolves; refuses twice in one connection → operation errors rather than looping | Parity target is `applesauce-relay`'s **documented** `authRetries` contract, not the old driver's loop-until-no-progress shape |

---

## Wave 0 Requirements

- [x] **CAUTH-02 oracle** — extended `fakePool()` / `fakePoolWithStatus()` (`packages/concord/src/client/__tests__/community.test.ts`) with a captured-handler oracle: two communities share one relay, `missingPubkeys` is deliberately widened to the union of both scopes' authors, and the test asserts (a) per-scope isolation, (b) reconnect re-auths the same scoped set. Landed in plan 15-04, Task 3 — `15-04-SUMMARY.md` coverage item D2.
- [x] **CAUTH-04 retry-parity test** — bounded-retry assertions against the documented `authRetries`/`authTimeout` defaults staying undefined, plus a no-suppression assertion on a second auth-required cycle. Landed in plan 15-04, Task 3 — `15-04-SUMMARY.md` coverage item D3 — and reinforced by plan 15-01's no-dedupe unit test — `15-01-SUMMARY.md` coverage item D3.
- [x] **CAUTH-03 structural guard** — `packages/concord/src/__tests__/no-ambient-auth.test.ts`, a real two-root Vitest source-walk test (not a manual grep), asserting zero reintroduction of the five removed mechanisms, no new ambient-auth trigger, no retry-budget override, and no second missing-pubkeys handler outside `client/auth.ts`. Landed in plan 15-07, Task 2 — `15-07-SUMMARY.md` coverage item D2.
- [x] **Non-vacuity probes** — RED→GREEN recorded for every new oracle: plan 15-01's `auth.test.ts` probe (whole-registry-fallback regression, 2 assertions RED then restored — `15-01-SUMMARY.md`); plan 15-04's CAUTH-02 oracle, two probes (shared-`StreamSigners` regression and `onAuthRequired` omission, both RED then restored — `15-04-SUMMARY.md`); plan 15-07's structural guard, two probes (a reintroduced `autoAuthenticate` literal and a second `missingPubkeys` handler, both RED then restored — `15-07-SUMMARY.md`). All five probes named the offending file/assertion and returned to green after restore.
- [x] **Gap-closure wave non-vacuity probes (plans 15-09..15-14)** — one line per plan, citing the SUMMARY carrying each recorded RED→GREEN:
  - **15-09**: reverted `community.ts` to its pre-plan (`9b2b3028`) form and reran the publish-answerability scenario — RED, naming the private channel's message-plane pubkey as unanswered (`AssertionError: expected [] to deeply equal [...]`); restored and reran — GREEN, 64/64. `15-09-SUMMARY.md` § Non-Vacuity Probe.
  - **15-10**: no source-level RED/GREEN revert — Task 1's acceptance criterion instead requires the new report be reachable without any source edit (the first new `auth.test.ts` case drives the real `onAuthRequired` and observes the report fire), which the plan states explicitly in place of a revert-based probe. `15-10-SUMMARY.md`.
  - **15-11**: three probes planted one at a time in `direct-invites.tsx` (a `challenge$` subscriber, an `authRetries` override, a `missingPubkeys`-reading handler) — each RED naming the planted file, each reverted via `git checkout --`, each restored to GREEN (5/5). `15-11-SUMMARY.md` § Non-Vacuity Probes.
  - **15-12**: restored `community.ts` to its pre-Task-1/2 form (`git show b03f4d76:...`, the wave's base commit) and reran the WR-01 mid-flight-root regression test — RED, naming the rekey publish's unauthenticated pubkey; restored the fix (`diff` exit 0, byte-identical) and reran — GREEN, 65/65. `15-12-SUMMARY.md` § Non-Vacuity Probe.
  - **15-13**: type-level non-vacuity verified via a scratch `tsconfig` scoped to `sync.test.ts`: with the `@ts-expect-error` directive removed, `tsc --noEmit` reported `TS2322` on the negative case (confirming it genuinely fails without the suppression); restored — back to only the one pre-existing, unrelated error. `15-13-SUMMARY.md` § Verification Notes.
  - **15-14**: reverted `refound()`'s `plan.channelRekeyKeys` registration to register nothing and reran the extended publish-answerability scenario — RED, naming the unanswered channel-rekey publish (`AssertionError: expected [] to deeply equal [...]`); restored (`git diff --stat` empty, byte-identical) and reran — GREEN, 66/66. Recorded in this plan's own SUMMARY.

*Existing fixtures (`fakePool`, `fakePoolWithStatus`, `mkStatus`, `spyOnDrivers`) cover fixture construction; no new framework or config is needed — only new assertions and fixtures within existing files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Example apps still run against a live relay after migration | CAUTH-03 | Examples are UI surfaces with no test harness; build-green is automated but runtime behavior is not | `pnpm dev`, open the concord examples, confirm auth-dependent views still load — **discharged 2026-08-15, plan 15-08 Task 3** |
| A private-channel send against a live auth-gating relay lands, retrievable from a second client/session (not just the sending session's optimistic local echo) | CAUTH-01 | The suite's fake pools never open a socket; the 2026-08-15 checkpoint's six steps never performed a private-channel send, which is exactly how CR-01 reached verification | Plan 15-14 Task 3's `how-to-verify` steps 1-7, with step 6 confirmed from a second browser session — **pending, this plan's blocking checkpoint** |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (CAUTH-02, CAUTH-03, CAUTH-04)
- [x] No watch-mode flags (`pnpm vitest run`, never bare `vitest`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Full-gate run (2026-08-15, plan 15-08 Task 2), recorded verbatim:**

1. `pnpm --filter applesauce-concord build` — exit 0 (`rimraf dist && tsc`, no errors).
2. `pnpm --filter applesauce-concord test` — exit 0, `Test Files 55 passed (55)`, `Tests 584 passed (584)`, zero failures, zero skipped.
3. `pnpm --filter applesauce-examples build` — exit 0, `✓ built in 1.55s` (only pre-existing, unrelated warnings: a third-party `dashjs` CJS/ESM interop notice and a chunk-size-limit notice).
4. `pnpm build` (repo-wide `turbo build`) — exit 0, `Tasks: 18 successful, 18 total`, `FULL TURBO`.

Structural confirmation: `grep -rn 'ConcordRelayAuth' packages apps --include='*.ts' --include='*.tsx'` returns exactly one hit — the guard's own regex literal at `packages/concord/src/__tests__/no-ambient-auth.test.ts:54`.

**Approval:** 2026-08-15 — all four gates green together; the manual live-relay verification (see Manual-Only Verifications above) was run by the user against a live auth-gating relay and approved the same day, in plan 15-08's Task 3. **This approval covered rumor-stores/crypto-history/direct-invites/admin-management — none of those steps performed a private-channel send.** A subsequent code review found CR-01 (a private-channel send's `waitForAuth` pubkey was never registered into the community's own `StreamSigners` holder), which the 2026-08-15 checkpoint could not have caught since it never exercised that path. The phase's status was corrected from complete to gaps-found on 2026-08-18, and gap-closure plans 15-09..15-14 were added — this section's "fully complete" close is superseded by the run below, pending this plan's Task 3 checkpoint.

---

**Full-gate run (2026-08-18, plan 15-14 Task 2), recorded verbatim — covers every gap-closure plan (15-09..15-14):**

1. `pnpm --filter applesauce-concord build` — exit 0 (`rimraf dist && tsc`, no errors).
2. `pnpm --filter applesauce-concord test` — exit 0, `Test Files 55 passed (55)`, `Tests 594 passed (594)`, zero failures, zero skipped (up from 584 at the 2026-08-15 run — 10 new tests: plan 15-09's private-channel-send regression + `wrapForTarget` key tests, plan 15-10's auth-failure-reporting tests, plan 15-11's widened structural-guard checks, plan 15-12's WR-01/WR-02 regression tests, plan 15-13's type-narrowing pin, and this plan's `refreshInviteBundles`/`refound()` extension to the existing publish-answerability scenario).
3. `pnpm --filter applesauce-examples build` — exit 0, `✓ built in 2.44s`–`2.60s` across repeated runs (only pre-existing, unrelated warnings: the third-party `dashjs` CJS/ESM interop notice, a chunk-size-limit notice, and a `@tailwindcss/vite` sourcemap notice).
4. `pnpm build` (repo-wide `turbo build`) — exit 0, `Tasks: 18 successful, 18 total`.
5. `npx prettier --check` over every file the gap-closure wave touched (`git diff --name-only 9b2b3028..HEAD`, the wave's start commit) — initially flagged 2 files (`packages/concord/src/client/auth.ts`, `packages/concord/src/helpers/__tests__/keys.test.ts`, both from plans 15-10/15-09 respectively — IN-01's recorded prior flag). Fixed via `npx prettier --write` on those two files (formatting-only diff, confirmed by inspection and a green rebuild/retest); `npx prettier --check` on the same file list then reported `All matched files use Prettier code style!`.

Non-vacuity of this task's own oracle (the extended publish-answerability scenario, plan 15-14 Task 1) is recorded in this plan's own SUMMARY and in the Wave 0 gap-closure bullet above.

**CAUTH-01 status discrepancy (surfaced, not corrected, per this plan's explicit instruction):** `.planning/REQUIREMENTS.md` still marks CAUTH-01 `[x]` Complete, while `15-VERIFICATION.md` (2026-08-18) scored it `failed` for the private-channel-send gap this wave closes. `git diff --stat .planning/REQUIREMENTS.md .planning/ROADMAP.md` for this plan is empty — neither file was touched here. Whether CAUTH-01 (and the phase overall) can now be marked Complete is the re-verification pass's call, against `15-VERIFICATION.md`'s two gap entries and this plan's Task 3 checkpoint outcome.
