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
| 3 | Channel key material is read only from `material.channels`, never edition JSON; a channel Rekey takes effect immediately, `rollForwardChannel`'s output addresses the new epoch's plane without a client reload. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `helpers/control.ts:217-283`; client-level `community.test.ts:144-212`. |
| 4 | A client can query visible-but-inaccessible vs key-held without hand-rolling a lookup; a deleted channel cannot be revived by a later edition. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `client/community.ts:130-145,199-316`; `control.ts:234-257`; test `control.test.ts:211-265`. |
| 5 | All five Accordian-named (TEST-02) tests pass. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `keys.test.ts:334,357,370`; `community.test.ts:274,319`. |
| 6 | (TEST-01, standing) Every channel derivation this phase touches has a hand-derived, spec-computed (never self-referential) test for both CORD-03 §1 branches, and the keyless case asserts absence, not a public-address match. | ✓ VERIFIED | Unchanged since prior report — regression-checked. `keys.test.ts:334-413`; `channel-rekey.test.ts` ROTATE-03 probe still green. |

**Score:** 6/6 ROADMAP success criteria fully verified. The one prior partial (criterion 2 / CHAN-02) is now fully closed across all seven channel-plane write entry points.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `material.channels` | `channelSecret`/`channelKeyFor` | direct lookup, total (null on miss) | ✓ WIRED | Unchanged since prior report. |
| `channelKeyFor` | `channelKeyMemo` | `keys.ts:160` | ✓ WIRED | Unchanged since prior report. |
| `foldControl` channel loop | `heads.set` + `channels.push` | one scan, `control.ts:234-282` | ✓ WIRED | Unchanged since prior report. |
| `receiveChannelKeys`/`persistChannelKey`/`dropChannelKey`/`mintChannelKey` | `materialChanged$.next()` | `community.ts:679,712,734,370` | ✓ WIRED | Unchanged since prior report. |
| `sendMessage`/`sendEvent`/`sendThread`/`replyToThread`/`react`/`editMessage`/`deleteMessage` | `requireChannelKey` → `MissingChannelKeyError` | `community.ts:835,849,888,895,902,912,918` | ✓ WIRED (full coverage) | **Gap closed.** All 7 of 7 channel-plane write entry points now guard identically; verified by direct source read and by the new 5-path regression test passing. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
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

**WR-01 (the CHAN-02 typed-guard coverage gap) is now RESOLVED** — the five previously-unguarded methods (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`) all call `requireChannelKey` as their first statement, confirmed by direct source read of `community.ts:886-920` and by the passing regression test.

### Human Verification Required

None. All findings are resolvable by direct code inspection and automated test execution; no visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

No gaps remain. The single open gap from the prior verification — CHAN-02 / ROADMAP Success Criterion 2 being only partially met (2 of 7 channel-plane write entry points guarded) — is closed by Plan 07-04. Verification confirms:

2. A known-but-keyless private channel now throws `MissingChannelKeyError` (instanceof, exact message `"missing private channel key"`, matching `channelId`) on all seven channel-plane write paths, never `planeKeyFor`'s generic `unknown channel` — verified by a new regression test (`community.test.ts`) that exercises all five newly-guarded methods and explicitly asserts the message is not the generic backstop.
3. `requireChannelKey`, `MissingChannelKeyError`, and `planeKeyFor`'s generic `unknown channel` backstop (the fail-closed guard for truly-unknown ids) were NOT modified — `git diff` shows an exact 5-line addition (one guard call per method) with zero other changes, confirming no scope creep and no security regression.

Phase 07 goal is fully achieved: private channel access derives only from held key material, never falls through to the public formula or Control-Plane edition JSON, and a client can now uniformly `instanceof`-catch `MissingChannelKeyError` across every channel-plane write path to gate composing, reacting, editing, deleting, and threading on a channel it has lost (or never had) access to.

---

_Verified: 2026-07-17T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
