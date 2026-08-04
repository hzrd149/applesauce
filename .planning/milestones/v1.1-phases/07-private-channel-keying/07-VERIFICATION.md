---
phase: 07-private-channel-keying
verified: 2026-07-17T15:10:00Z
status: passed
score: 6/6 roadmap success criteria fully verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "5/6 (1 partial)"
  gaps_closed:
    - "Sending to a private channel without key material rejects with a distinct, clear error, never the generic `unknown channel` — ROADMAP Success Criterion 2 / CHAN-02, now closed across all seven channel-plane write entry points (sendMessage, sendEvent, sendThread, replyToThread, react, editMessage, deleteMessage)."
  gaps_remaining: []
  regressions: []
deferred: []
---

# Phase 07: Private Channel Keying Verification Report

**Phase Goal:** Private channel access derives only from held key material — never a fallthrough to the public `community_root` formula and never from Control-Plane edition JSON — and a client can tell "visible metadata" apart from "key held" without hand-rolling a lookup. Closes the field-confirmed Accordian-blocking bug (H07/H08) end to end.
**Verified:** 2026-07-17T15:10:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (Plan 07-04, closing the single open gap from the prior 07-VERIFICATION.md: CHAN-02 / ROADMAP Success Criterion 2)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, the authoritative contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A private channel with visible metadata but no held key derives no channel `GroupKey`, no `keys.channels`/`keys.channelEpochs` entry, and its plane is never registered/subscribed/published to. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `helpers/community.ts:37-52`, `helpers/keys.ts:151-189`, `client/community.ts:648-656`. Test: `keys.test.ts:334-355`. |
| 2 | Sending to a private channel without key material rejects with a distinct, clear error (`missing private channel key`), never the generic `unknown channel`. | ✓ VERIFIED (gap closed) | **All seven** channel-plane write entry points now guard: `sendEvent` (`community.ts:835`), `sendMessage` (`:849`), `sendThread` (`:888`), `replyToThread` (`:895`), `react` (`:902`), `editMessage` (`:912`), `deleteMessage` (`:918`) each call `this.requireChannelKey(channelId)` as their first statement, before `channelEpoch`/`bindToChannel`/`publishToPlane`. Confirmed by direct read of `community.ts:810-920` (see excerpt below) and by `git show 01b5c420`, an exact 5-line diff adding only the five guard calls, nothing else. New regression test `community.test.ts` ("every channel-plane write path (react/editMessage/deleteMessage/sendThread/replyToThread) throws MissingChannelKeyError for a keyless private channel, not unknown channel (CHAN-02 / WR-01)") drives all five methods against a known-but-keyless private channel (minted private, then `leaveChannel` to drop the local key while the channel stays folded in `state$.value.channels`) and asserts, per method, `instanceof MissingChannelKeyError`, exact message `"missing private channel key"`, `.channelId === channelId`, and explicitly `.message !== "unknown channel"`. Full concord suite green: 212/212 (re-ran independently, matches claim). |
| 3 | Channel key material is read only from `material.channels`, never edition JSON; a channel Rekey takes effect immediately, `rollForwardChannel`'s output addresses the new epoch's plane without a client reload. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `helpers/control.ts:217-283`; client-level `community.test.ts:144-212`. |
| 4 | A client can query visible-but-inaccessible vs key-held without hand-rolling a lookup; a deleted channel cannot be revived by a later edition. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `client/community.ts:130-145,199-316`; `control.ts:234-257`; test `control.test.ts:211-265`. |
| 5 | All five Accordian-named (TEST-02) tests pass. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `keys.test.ts:334,357,370`; `community.test.ts:274,319`. |
| 6 | (TEST-01, standing) Every channel derivation this phase touches has a hand-derived, spec-computed (never self-referential) test for both CORD-03 §1 branches, and the keyless case asserts absence, not a public-address match. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `keys.test.ts:334-413`; `channel-rekey.test.ts` ROTATE-03 probe still green. |

**Score:** 6/6 ROADMAP success criteria fully verified. The one prior partial (criterion 2 / CHAN-02) is now fully closed across all seven channel-plane write entry points.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/types.ts` | `ChannelMetadata.key`/`.epoch` removed | ✓ VERIFIED | Unchanged since prior report. |
| `packages/concord/src/helpers/community.ts` | Total nullable branches + `hasChannelKey` | ✓ VERIFIED | Unchanged since prior report. |
| `packages/concord/src/helpers/keys.ts` | `channelKeyMemo` null-signalling, `deriveConcordKeys` skip-loop, `channelEpochs` from `held.epoch` | ✓ VERIFIED | Unchanged since prior report; `planeKeyFor`'s generic `unknown channel` throw (`keys.ts:221`) confirmed byte-unchanged. |
| `packages/concord/src/helpers/control.ts` | Rewritten channel loop: explicit field pick + sticky-delete + heads pinning | ✓ VERIFIED | Unchanged since prior report. |
| `packages/concord/src/client/community.ts` | `ChannelView`, `materialChanged$`, `channels$`, `MissingChannelKeyError`, `requireChannelKey`, guard wired into ALL channel-plane write entry points | ✓ VERIFIED | Gap closed — `requireChannelKey` now called from all 7 write methods (`sendEvent`, `sendMessage`, `sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`). `requireChannelKey` itself (`:816-820`) and `MissingChannelKeyError` (`:159-164`) confirmed byte-unchanged from 07-03 via `git diff 5c57ff41 HEAD`. |
| `packages/concord/src/helpers/__tests__/keys.test.ts` | CHAN-01/03/TEST-01 spec-derived cases | ✓ VERIFIED | Unchanged since prior report. |
| `packages/concord/src/helpers/__tests__/control.test.ts` | CHAN-04 + CHAN-07 compaction round-trip | ✓ VERIFIED | Unchanged since prior report. |
| `packages/concord/src/client/__tests__/community.test.ts` | CHAN-06 reactivity + CHAN-02/TEST-02 case 4-5 + ROTATE-03 client-level + full 7-path CHAN-02 regression | ✓ VERIFIED | New regression test added (57 lines, commit `129e141d`); pre-existing cases unchanged and still pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `material.channels` | `channelSecret`/`channelKeyFor` | direct lookup, total (null on miss) | ✓ WIRED | Unchanged since prior report. |
| `channelKeyFor` | `channelKeyMemo` | `keys.ts:160` | ✓ WIRED | Unchanged since prior report. |
| `channelKeyMemo` | `deriveConcordKeys` loop | `keys.ts:182-189` | ✓ WIRED | Unchanged since prior report. |
| `foldControl` channel loop | `heads.set` + `channels.push` | one scan, `control.ts:234-282` | ✓ WIRED | Unchanged since prior report. |
| `receiveChannelKeys`/`persistChannelKey`/`dropChannelKey`/`mintChannelKey` | `materialChanged$.next()` | `community.ts:679,712,734,370` | ✓ WIRED | Unchanged since prior report. |
| `sendMessage`/`sendEvent`/`sendThread`/`replyToThread`/`react`/`editMessage`/`deleteMessage` | `requireChannelKey` → `MissingChannelKeyError` | `community.ts:835,849,888,895,902,912,918` | ✓ WIRED (full coverage) | **Gap closed.** All 7 of 7 channel-plane write entry points now guard identically; verified by direct source read and by the new 5-path regression test passing. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `applesauce-concord` package suite (re-run independently this verification) | `pnpm --filter applesauce-concord test` | 212/212 passed, 43 test files | ✓ PASS |
| Full monorepo suite (executor-reported, not independently re-run — no changes outside concord since last full run) | `pnpm vitest run` | 2087 passed, 2 skipped | ✓ PASS (per executor report; concord subset independently reproduced) |
| `requireChannelKey`/`MissingChannelKeyError`/`planeKeyFor` backstop unchanged (no scope creep) | `git diff 5c57ff41 HEAD -- packages/concord/src/client/community.ts` + `grep -n "unknown channel" helpers/keys.ts` | Diff shows exactly 5 inserted lines (one `requireChannelKey` call per method), no other lines touched; `keys.ts:221` generic throw present, unchanged | ✓ PASS |
| Diff scope for the whole gap-closure plan (both commits) | `git show --stat 01b5c420 129e141d` | `community.ts` +5/-0; `community.test.ts` +57/-0; no other files | ✓ PASS |
| No debt markers in newly modified files | `grep -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across the 2 files touched by 07-04 | No matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CHAN-01 | 07-01 | Keyless private channel derives no key/entry/plane | ✓ SATISFIED | `keys.test.ts:334` |
| CHAN-02 | 07-01/07-03/07-04 | Distinct send-reject error, not generic `unknown channel`, on every channel-plane write path | ✓ SATISFIED (gap closed by 07-04) | `community.test.ts:274-317` (sendMessage/sendEvent) + new regression test (all 5 remaining methods) |
| CHAN-03 | 07-01 | `channelEpochs` from held key's own epoch | ✓ SATISFIED | `keys.test.ts:397` |
| CHAN-04 | 07-01 | Explicit typed field pick, no edition-JSON key material | ✓ SATISFIED | `control.test.ts:158` |
| CHAN-05 | 07-01/07-03 | Rekey takes effect immediately from `material.channels` | ✓ SATISFIED | `community.test.ts:194-208` |
| CHAN-06 | 07-02 | Visible-vs-accessible distinction, reactive, no hand-rolled lookup | ✓ SATISFIED | `community.test.ts:214-272` |
| CHAN-07 | 07-01 | Deletion terminal, survives compaction | ✓ SATISFIED | `control.test.ts:211-265` (see note below on REQUIREMENTS.md staleness) |
| ROTATE-03 | 07-01/07-03 | `rollForwardChannel` addresses new epoch's plane | ✓ SATISFIED | `channel-rekey.test.ts` (unchanged) + `community.test.ts:194-208` |
| TEST-02 | 07-01/07-03/07-04 | All five Accordian-named tests pass | ✓ SATISFIED | Cases 1-5 all present and passing; the 5-remaining-methods regression test extends the same coverage requirement to the wider write surface |

**All 9 requirement IDs declared across the phase's plan frontmatter (CHAN-01 through CHAN-07, ROTATE-03, TEST-02) are present and marked `[x]` Complete in `.planning/REQUIREMENTS.md`'s checklist. No orphaned requirements found.**

**Note on REQUIREMENTS.md internal inconsistency (not a phase gap, carried forward unchanged from the prior report):** the checklist (line 53) marks CHAN-07 `[x]` Complete, but the Traceability table (line 132) still reads "Pending — blocked on spec ruling." ROADMAP.md documents the ruling was resolved during this phase (D-07: "deletion is terminal, id never reused"), and the checklist entry, the actual code, and the passing compaction test all agree CHAN-07 is closed. This is stale bookkeeping in one table of REQUIREMENTS.md, not a functional or verification gap.

### Anti-Patterns Found

None blocking. Carried forward Info-level findings from 07-REVIEW.md (unaffected by this gap-closure plan, no scope creep introduced):

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `helpers/control.ts` | 277 | `typeof raw.custom === "object"` accepts arrays for `ChannelMetadata.custom` | Info | Doesn't crash the fold or leak key material (07-REVIEW.md IN-01) |
| `helpers/control.ts` | 249 | Multi-simultaneous-deletion tiebreak path has no dedicated test | Info | Untested but deterministic branch (07-REVIEW.md IN-02) |
| `helpers/keys.ts` | 181-189 | `deriveConcordKeys` channel loop repeats a lookup `channelKeyMemo` already performed internally | Info | Duplication/maintenance risk, not a live bug (07-REVIEW.md WR-02) |

**WR-01 (the CHAN-02 typed-guard coverage gap) is now RESOLVED** — the five previously-unguarded methods (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`) all call `requireChannelKey` as their first statement, confirmed by direct source read of `community.ts:886-920` and by the passing regression test.

### Human Verification Required

None. All findings are resolvable by direct code inspection and automated test execution; no visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

No gaps remain. The single open gap from the prior verification — CHAN-02 / ROADMAP Success Criterion 2 being only partially met (2 of 7 channel-plane write entry points guarded) — is closed by Plan 07-04. Verification confirms:

1. All five previously-unguarded methods (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`) in `packages/concord/src/client/community.ts` now call `this.requireChannelKey(channelId)` as their first statement, before `channelEpoch`/`bindToChannel`/`publishToPlane` — verified by direct source read.
2. A known-but-keyless private channel now throws `MissingChannelKeyError` (instanceof, exact message `"missing private channel key"`, matching `channelId`) on all seven channel-plane write paths, never `planeKeyFor`'s generic `unknown channel` — verified by a new regression test (`community.test.ts`) that exercises all five newly-guarded methods and explicitly asserts the message is not the generic backstop.
3. `requireChannelKey`, `MissingChannelKeyError`, and `planeKeyFor`'s generic `unknown channel` backstop (the fail-closed guard for truly-unknown ids) were NOT modified — `git diff` shows an exact 5-line addition (one guard call per method) with zero other changes, confirming no scope creep and no security regression.
4. The other five ROADMAP success criteria (H06/H07/H08 single-source-of-truth refactor, CHAN-07 sticky-delete terminality, CHAN-06 reactive accessible view, CHAN-05/ROTATE-03 in-session rekey plane addressing, and the TEST-02/TEST-01 spec-derived test suite) remain untouched by this gap-closure plan (confirmed via `git diff cf7e4241 HEAD --stat` — only `community.ts` and `community.test.ts` under `client/` changed) and their regression is confirmed by the still-green, independently re-run 212/212 concord package suite.

Phase 07 goal is fully achieved: private channel access derives only from held key material, never falls through to the public formula or Control-Plane edition JSON, and a client can now uniformly `instanceof`-catch `MissingChannelKeyError` across every channel-plane write path to gate composing, reacting, editing, deleting, and threading on a channel it has lost (or never had) access to.

---

_Verified: 2026-07-17T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
