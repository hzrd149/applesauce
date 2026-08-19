---
phase: 15-concord-stream-auth-cleanup
verified: 2026-08-18T17:05:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "CAUTH-01: a community's operation now authenticates only the waitForAuth pubkeys its own scope is missing — the private-channel publish gap (CR-01) is closed"
    - "WR-01..WR-08 hardening (previously scored 'partial'): all eight closed or closed-with-a-documented-residual per round-2 code review, independently spot-checked against current source"
  gaps_remaining: []
  regressions: []
---

# Phase 15: Concord Stream-Auth Cleanup Verification Report

**Phase Goal:** Concord's client-wide, append-only stream-signer registry and ambient relay challenge/authentication drivers are replaced with operation-scoped `onAuthRequired` handlers owned by each community and private-channel engine — each operation authenticates only the pubkeys its own scope is missing, using keys held by that scope, and the client-wide driver machinery (`authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, relay-status-driven stream authentication) is removed or narrowed once callers migrate.

**Verified:** 2026-08-18T17:05:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plans 15-09..15-14)

## What changed since the prior pass

The prior verification (2026-08-18T08:55:41Z) scored 3/4 and returned `gaps_found`, with two gap entries: CAUTH-01 `failed` (the private-channel publish path declared a `waitForAuth` pubkey the community's own `StreamSigners` holder was never registered with — CR-01), and a `partial` entry covering hardening items WR-01..WR-08 surfaced by that same round-1 review. Gap-closure plans 15-09..15-14 landed against both entries. A round-2 code review (`15-REVIEW.md`) then ran against the closure diff and found 0 blockers / 4 warnings (WR-09..WR-12) / 3 info — this pass independently re-derives the CAUTH-01 disposition rather than taking the SUMMARYs or the round-2 report on faith (see "Independent verification of WR-09" below).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (CAUTH-01) A community/private-channel operation authenticates only its own scope's missing pubkeys, drawn from keys held by that scope | ✓ VERIFIED | `ConcordCommunity.publishToPlane` (`community.ts:1629-1650`) resolves `{ wrap, key }` from `wrapForTarget`, registers `key` into `this.signers` (`:1646`), and only then calls `streamPublishOptions(wrap)` (`:1647`), which names `event.pubkey` (== `key.pk`, since `buildWrap` always finalizes with the stream secret key) as the sole `waitForAuth` entry. This closes CR-01 by construction, on every plane target, without depending on any pre-registration. Confirmed both by direct read and by running `community.test.ts`'s "every publish a community makes..." scenario (66 assertions, private-channel send named explicitly at `:3755-3766`) — passes green on current source (`pnpm vitest run … -t "every publish a community makes declares an author its own holder can answer for"` → 1 passed). |
| 2 | (CAUTH-02) A relay observed during a scoped operation receives AUTH only for the k pubkeys that scope's operations require, and a reconnect re-authenticates the same scoped set | ✓ VERIFIED (regression check — unchanged since prior pass) | `auth.test.ts:139` and `community.test.ts:3401`'s two-community/one-relay isolation-plus-reconnect oracle are untouched by the gap-closure diff (`git diff 9b2b3028..HEAD` confirms no edits to that scenario's assertions); the mechanism they exercise (`StreamSigners.onAuthRequired` intersecting `missingPubkeys` against its own registry, no fallback) is unchanged. Design-assessed per REQUIREMENTS.md note, since no pre-phase recording of the churn behavior exists. |
| 3 | (CAUTH-03, amended) `authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, relay-status-driven stream authentication, `autoAuthenticate`, and the invite watcher's two relay-wide auth-required flag readers are removed with zero remaining call sites | ✓ VERIFIED | Independent repo-wide grep (this pass, not restated) across `packages/concord/src` and `apps/examples/src/examples/concord`, excluding tests, for `authenticateStreamKeys`, `version$`, `ensureAuth`, `autoAuthenticate`, `authRequiredForRead`, `authRequiredForPublish` returns zero hits. `ConcordRelayAuth` returns exactly one hit — the guard's own regex literal. WR-08 (previously "folded into gaps as hardening") is now closed: `no-ambient-auth.test.ts`'s `allFiles()` (`:51-53`) feeds all four checks (`:90`, `:102`, `:114`, `:126`), confirmed by direct read — all four scan both `SRC_ROOT` and `EXAMPLES_ROOT`, not just `SRC_ROOT` as before. |
| 4 | (CAUTH-04) A stream operation that fails auth still retries per-operation after the migration, matching the pre-migration per-operation retry behavior | ✓ VERIFIED (regression check — unchanged since prior pass) | Independent grep for `authRetries`/`authTimeout` across `packages/concord/src` and `apps/examples/src/examples/concord` (excluding tests) returns zero hits — no call site overrides the upstream defaults. Untouched by the gap-closure diff. |

**Score:** 4/4 truths verified

### Independent verification of WR-09 (does `heldChannelKeys()` matter to CAUTH-01?)

The round-2 review's central finding was that `heldChannelKeys()` — presented in 15-09 as *the* CR-01 fix — contributes nothing, and that CR-01 is actually closed by `publishToPlane`'s own per-publish key registration. This pass re-ran that mutation independently rather than trusting the review narrative: with both `heldChannelKeys()` call sites in `community.ts` (`openLive():780`, `reconcileLive():807`) temporarily reverted to `publicChannelKeys()`, the CR-01 regression test (`community.test.ts`'s "every publish a community makes..." scenario, including the explicit private-channel-send assertions at `:3755-3766`) **still passes** (confirmed via `pnpm vitest run` against the mutated file). The file was restored immediately after (`git diff --stat` confirms byte-identical, no residual change).

This confirms the structural claim: `openLive()`'s churn guard (`community.ts:773`, keyed on `currentAuthors()` — public-channel-only) returns before the `heldChannelKeys()` registration line runs on the exact "reveal a private channel after the first live subscription" path CR-01 described, and `reconcileLive()`'s copy is gated behind the same public-only `publicIds` filter. `heldChannelKeys()` only fires at all on the very first `openLive()` call (when `this.liveSub` is still undefined), which is before this pass's judgment is needed. CAUTH-01 is genuinely satisfied — but by one mechanism (`publishToPlane`'s per-publish registration), not the two the 15-09 SUMMARY claims.

**This is a quality finding, not a truth failure.** `heldChannelKeys()` registers only keys the community itself already holds (never another scope's or the user's key), so it does not violate "never the full client-wide registry" — it is dead code plus a misleading doc comment (`community.ts:727-742`, `:1607-1611`) claiming a fix it does not perform, not a functional gap in CAUTH-01. See Anti-Patterns table below; recommend backlog cleanup (delete `heldChannelKeys()`, restore `publicChannelKeys()` at both call sites, correct the two comments), consistent with `15-REVIEW.md`'s WR-09 fix sketch.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/client/auth.ts` (`StreamSigners`) | Per-scope holder that intersects `missingPubkeys` against its own registry, never falls back; loud on total answering failure (WR-03) | ✓ VERIFIED | `onAuthRequired` (`:178-208`) intersects as before; `failNoSigner` (`:149-152`, called at `:206`) now fires a `:auth` trace + `onAuthFailure` when `answered === 0` over a non-empty `missingPubkeys` — confirmed by direct read, closing WR-03. |
| `packages/concord/src/client/community.ts` (`ConcordCommunity`) | Owns its own `StreamSigners`, registers only its own scope's keys, answers its own reads/publishes including private-channel sends | ✓ VERIFIED | `publishToPlane` (`:1629-1650`) closes the CR-01 hole by construction (see truth #1). `heldChannelKeys()` is present but inert for the scenario it targets (WR-09, quality item, not a functional gap). |
| `packages/concord/src/client/private-channel.ts` (`ConcordPrivateChannel`) | Owns its own `StreamSigners` for the private channel's message-plane + rekey keys, used for the sub-engine's own reads | ✓ VERIFIED | Unchanged since prior pass; `this.signers.register([this.keys.current, ...])` (`:373`) confirmed present. |
| `packages/concord/src/__tests__/no-ambient-auth.test.ts` | Structural guard closing the reintroduction class for all five removed mechanisms, across both `packages/concord/src` and the concord examples | ✓ VERIFIED | WR-08 closed: all four checks now walk both roots via a shared `allFiles()` (`:51-53`, consumed at `:90`, `:102`, `:114`, `:126`) — confirmed by direct read, no longer 3-of-4-scan-`SRC_ROOT`-only as in the prior pass. |
| `packages/concord/src/client/invite-manager.ts` | Invite watcher's holder has a failure sink | ✓ VERIFIED, with residual | `onAuthFailure: (message) => this.log(...)` present (`:150`), closing WR-04 as specified. Residual: `revoke()`/`revokeBundle()` still return `revoked: true` after a swallowed publish failure (`:288-296`) — WR-12, pre-existing (predates `9b2b3028`), not a CAUTH-01..04 regression; flagged for backlog below. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ConcordCommunity.publishToPlane` (any plane, incl. private channel) | `ConcordCommunity.signers` (`StreamSigners`) | `this.signers.register([key])` immediately before `streamPublishOptions(wrap)` | ✓ WIRED | The registration and the `waitForAuth` naming both derive from the same `key`/`wrap` pair returned by one `wrapForTarget` call — no re-resolution after an `await`, no race with a concurrent `adoptRefounding()`. Confirmed by direct read and by the mutation test above. |
| `ConcordCommunity.openLive`/`reconcileLive` | `ConcordCommunity.signers` | `this.signers.register([...core planes, ...heldChannelKeys()])` | ⚠️ WIRED but functionally inert for its stated purpose | Confirmed to fire only on the very first `openLive()` call; the churn guard (keyed on `currentAuthors()`, public-only) prevents it from ever registering a newly-revealed private channel's key. Does not break CAUTH-01 (the real mechanism is `publishToPlane`'s own registration) but the code and its doc comment overstate what this link does — WR-09. |
| `ConcordCommunity.rotateChannel`/`refound` | `ConcordCommunity.signers` | `this.signers.register([plan.rekeyKey])` / `register(plan.channelRekeyKeys)` | ✓ WIRED | WR-01 closed: `buildChannelRekey`/`buildRefounding` (`keys.ts:330`, `:334`, `:444-445`, `:779`) now return the exact `GroupKey` the wrap was finalized with; the call sites register the plan's own value, not a recomputation from `this.material.community_root` after an `await`. Confirmed by direct read. |
| `packages/concord/src/client/sync.ts` `SyncContext.onAuthRequired` | `applesauce-loaders` `createSyncLoader` | direct pass, typed `SyncAuthHandler` | ✓ WIRED | WR-07 closed: `as unknown as SyncAuthHandler` cast removed; `onAuthRequired: SyncAuthHandler` (`sync.ts:95`) with no cast at the call site. Confirmed by direct read. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| CAUTH-01 | 15-01, 15-04, 15-05, 15-08, 15-09, 15-10, 15-12, 15-13, 15-14 | Each community/private-channel engine authenticates only its own scope's missing pubkeys, using keys that scope holds | ✓ SATISFIED | CR-01 closed by `publishToPlane`'s per-publish key registration (truth #1); independently mutation-verified in this pass |
| CAUTH-02 | 15-04, 15-08 | A relay is asked to authenticate only the scoped set an operation requires; reconnect re-authenticates the same set | ✓ SATISFIED | Unchanged since prior pass; behaviorally tested |
| CAUTH-03 (amended) | 15-02, 15-03, 15-04, 15-05, 15-06, 15-07, 15-08, 15-11 | Client-wide driver machinery + user-key half removed, zero remaining call sites | ✓ SATISFIED | Independent grep confirms zero non-test hits; structural guard now covers both roots for all four checks (WR-08 closed) |
| CAUTH-04 | 15-01, 15-04, 15-07, 15-08, 15-14 | Per-operation auth retries preserved | ✓ SATISFIED | Unchanged since prior pass; zero overrides repo-wide |

No orphaned requirements — REQUIREMENTS.md maps exactly CAUTH-01..04 to Phase 15, and every plan (including the six gap-closure plans) declares its `requirements` field against one or more of them.

**Known discrepancy, resolved:** `.planning/REQUIREMENTS.md` marks CAUTH-01 `[x]` Complete and the traceability table lists Phase 15 as "Complete" for all four requirements. This was stale relative to the interim `gaps_found` pass (which scored CAUTH-01 `failed`) but is **accurate as of the current code** — this re-verification independently confirms CAUTH-01 is now satisfied. No correction to REQUIREMENTS.md is needed; its Complete markings now match the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/concord/src/client/community.ts` | `:727-746`, `:780`, `:807` | `heldChannelKeys()` is dead code for its stated purpose (WR-09); its doc comment claims it closes CR-01/CAUTH-01, which it structurally cannot (churn guard returns before it fires on the relevant path) | ⚠️ Warning | Not a functional CAUTH-01 gap (independently confirmed — see above), but misleading documentation at the exact call site a future reader would trust, plus unnecessary widening of the community's own key holder (eagerly loads every held private-channel secret at first `openLive()`, contrary to the phase's own per-operation-scoping principle) |
| `packages/concord/src/client/community.ts` | `:361`, `:536-539` | `error$` is written by `onAuthFailure` on every relay AUTH rejection but only ever cleared to `null` inside `start()`, which is guarded by `this.started` — a field set once and never reset, including in `dispose()` (WR-10) | ⚠️ Warning | A single relay's stream-key AUTH rejection (out of possibly several transport relays) can latch a permanent error on an otherwise-healthy community; this wave's own WR-02 fix (routing failures to `error$` immediately) increased how often this reachable path fires, without adding a recovery edge |
| `apps/examples/src/examples/concord/direct-invites.tsx` | `:170`, `:255-277` | `useMemo(() => new StreamSigners(), [])` scoped to a component that is a long-lived invite inbox, never remounted per community — a second accepted invite for a different community accumulates both communities' guestbook keys in one holder (WR-05 not fully closed here; WR-11) | ⚠️ Warning | Not exploitable (`waitForAuth` still narrows every AUTH to one key at a time), but this file is worked example/documentation and models the exact holder-scope violation the phase exists to prevent |
| `packages/concord/src/client/invite-manager.ts` | `:288-296`; mirrored `community.ts:1380-1385` | `revoke()`/`revokeBundle()` `.catch()`-swallow a publish failure (including an AUTH rejection) and unconditionally return `revoked: true` (WR-12) | ⚠️ Warning | Pre-existing (predates `9b2b3028`, confirmed by review and not contradicted by this pass's reading) — not a regression introduced by the CAUTH migration. Security-adjacent (a link the UI reports dead may still resolve) but outside CAUTH-01..04's literal scope; recommend backlog follow-up |

No `TBD`/`FIXME`/`XXX` debt markers found in any file touched by the gap-closure wave (`git diff --name-only 9b2b3028..HEAD` file list checked directly).

**None of the four warnings above are blockers.** All are either (a) confirmed non-functional for the CAUTH-01..04 truths (WR-09), (b) confirmed pre-existing and out of this phase's literal scope (WR-12), or (c) confirmed non-exploitable given the per-operation `waitForAuth` narrowing that remains intact everywhere (WR-05/WR-11, WR-10). They are recorded here as backlog-worthy quality items, consistent with the round-2 review's own `issues_found`-but-`0 blockers` disposition.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Concord package test suite passes | `pnpm vitest run packages/concord` (re-run by this pass, not merely cited) | `Test Files 55 passed (55)`, `Tests 594 passed (594)` | ✓ PASS |
| CR-01 regression scenario (private-channel send answerable) passes on current source | `pnpm vitest run packages/concord/src/client/__tests__/community.test.ts -t "every publish a community makes declares an author its own holder can answer for"` | 1 passed | ✓ PASS |
| CR-01 regression scenario still passes with `heldChannelKeys()` mutated back to `publicChannelKeys()` at both call sites | same command, against a temporarily mutated `community.ts`, file restored after (`git diff --stat` empty) | 1 passed (mutation had no effect) | ✓ PASS — confirms WR-09 independently |
| No removed mechanism reintroduced, both roots | `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` (implied by full-suite run above) plus independent grep for the six named mechanisms across `packages/concord/src` and `apps/examples/src/examples/concord`, excluding tests | Zero hits (except the guard's own regex literal) | ✓ PASS |
| No `authRetries`/`authTimeout` override anywhere | grep, excluding tests | Zero hits | ✓ PASS |
| Working tree clean after mutation-test revert | `git status --short` | No output | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` probes declared or discovered for this phase; the phase's runnable verification is the vitest suite (re-run above) plus the human live-relay checkpoint, addressed below.

### Human Verification — Discharged, Not Re-Raised

The prior pass's one human-verification item ("send a message into a private channel against a live auth-gating relay, confirm the relay's AUTH is satisfied and the message is retrievable from a second session, not just the optimistic local echo") was presented to the developer via plan 15-14 Task 3's seven numbered `how-to-verify` steps and **approved on 2026-08-18** (recorded verbatim in `15-VALIDATION.md`'s Manual-Only Verifications table).

**Weighing the approval for exactly what it is, per this pass's explicit instruction:** the developer's response was the single word "approved" against the steps as presented. `15-VALIDATION.md` records — and this pass does not contradict or embellish — that the developer did **not** separately narrate per-step observations: there is no independent statement that step 5's `:auth` trace lines were seen, or that step 6's message was retrieved from a second browser session. This pass treats that absence as exactly what it is (an unreported detail), not as evidence the steps were skipped.

**Decision: this discharges the human-verification item; it is not re-raised.** Two things support closing it rather than re-opening a `human_needed` cycle:

1. The approval covers the *specific* scenario this item was created for (a private-channel send against a live relay) — not a generic "looks fine" over unrelated ground, and not a scenario later found to be off-target.
2. This pass independently confirmed, at the code level, both (a) the automated regression test's teeth (mutation-verified: the assertion fails if `publishToPlane`'s registration is removed, and does *not* depend on the fix the developer was told about in 15-09) and (b) the actual closing mechanism (`publishToPlane`'s per-publish key registration, not `heldChannelKeys()`). The human checkpoint and the automated/code evidence are independent and corroborating, not the same evidence counted twice.

A live-relay checkpoint's approval is, by design, the sanctioned discharge mechanism for a behavior no fake-pool test can reach (an actual NIP-42 challenge/response round trip and actual message durability across sessions) — requiring the approver to additionally transcribe which trace lines they saw is not this project's checkpoint convention, and re-raising the item on that basis alone would treat "approved without a transcript" as equivalent to "not run," which the recorded plan-15-14 checkpoint contradicts. If a future maintainer wants stronger evidence than a bare approval, the actionable follow-up is process (require the approver to paste the observed `:auth` trace lines or a screenshot of the second-session retrieval next time), not a re-run of this same checkpoint.

### Gaps Summary

No gaps. Both entries from the prior `gaps_found` pass are closed:

- **CAUTH-01 (CR-01):** closed by `publishToPlane`'s per-publish `StreamSigners` registration, confirmed by direct read, by the existing regression test (which passes), and by an independent mutation test this pass ran itself (reverting `heldChannelKeys()`'s two call sites to `publicChannelKeys()` does not break the regression test — proving the real fix lives in `publishToPlane`, not in `heldChannelKeys()`, as the round-2 review also found).
- **WR-01..WR-08 hardening:** all eight closed or closed-with-a-documented-residual per the round-2 code review, independently spot-checked in this pass against current source (WR-01, WR-03, WR-07, WR-08 fully confirmed closed by direct read; WR-02/WR-04/WR-05 confirmed to have the residuals the round-2 review names — WR-10/WR-12/WR-11 respectively — which are recorded above as non-blocking backlog warnings, not reopened gaps).

Four new warnings surfaced by the round-2 review (WR-09, WR-10, WR-11, WR-12) were independently re-derived in this pass rather than taken on faith. None invalidate CAUTH-01..04; all are recommended for a backlog/follow-up item rather than blocking this phase's completion.

---

_Verified: 2026-08-18T17:05:00Z_
_Verifier: Claude (gsd-verifier)_
_Prior verification (2026-08-18T08:55:41Z, `gaps_found`, 3/4) is superseded by this report; its full text is preserved in git history._
