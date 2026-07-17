---
phase: 07-private-channel-keying
verified: 2026-07-17T14:35:00Z
status: gaps_found
score: 5/6 roadmap success criteria fully verified (1 partial)
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Sending to a private channel without key material rejects with a distinct, clear error (e.g. `missing private channel key`), never the generic `unknown channel` — ROADMAP Success Criterion 2 / CHAN-02."
    status: partial
    reason: "The MissingChannelKeyError guard (requireChannelKey) is wired only into sendMessage and sendEvent. Five other channel-plane write entry points — sendThread, replyToThread, react, editMessage, deleteMessage — call bindToChannel/publishToPlane directly without the guard, so a known-but-keyless private channel still surfaces planeKeyFor's generic, non-instanceof-catchable `Error('unknown channel')` on those paths — exactly the indistinguishable failure mode CHAN-02/D-06 was written to close. No key material or plane content is leaked (deriveConcordKeys still produces no keys.channels entry for a keyless private channel, so no wrong-plane send occurs either way) — this is a typed-error/DX gap, not a security regression. Confirmed identically by code review (07-REVIEW.md WR-01, Warning severity, 0 Critical)."
    artifacts:
      - path: "packages/concord/src/client/community.ts:886-920"
        issue: "sendThread (:887), replyToThread (:894), react (:901), editMessage (:910), deleteMessage (:916) do not call this.requireChannelKey(channelId) before bindToChannel/publishToPlane."
    missing:
      - "Call this.requireChannelKey(channelId) at the top of sendThread, replyToThread, react, editMessage, and deleteMessage (mirroring the sendMessage/sendEvent guard), OR route all five through sendEvent's existing guarded path."
      - "A regression test asserting one of the five (e.g. react or editMessage) throws MissingChannelKeyError instanceof for a known-but-keyless private channel, not the generic unknown-channel Error."
deferred: []
---

# Phase 07: Private Channel Keying Verification Report

**Phase Goal:** Private channel access derives only from held key material — never a fallthrough to the public `community_root` formula and never from Control-Plane edition JSON — and a client can tell "visible metadata" apart from "key held" without hand-rolling a lookup. Closes the field-confirmed Accordian-blocking bug (H07/H08) end to end.
**Verified:** 2026-07-17T14:35:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, the authoritative contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A private channel with visible metadata but no held key derives no channel `GroupKey`, no `keys.channels`/`keys.channelEpochs` entry, and its plane is never registered/subscribed/published to. | ✓ VERIFIED | `helpers/community.ts:37-52` (`channelSecret`/`channelKeyFor` total, return `null` on keyless private); `helpers/keys.ts:151-189` (`channelKeyMemo`/`deriveConcordKeys` skip-loop, `if (!gk) continue`); `client/community.ts:648-656` (`reconcilePrivateChannels` — `if (!key) continue`, never spawns a sub-engine/subscription). Test: `keys.test.ts:334-355` asserts `keys.channels.has(id)===false`, `channelEpochs.has(id)===false`, AND the independently-derived public pk is NOT a plane key (non-aliasing, H07). |
| 2 | Sending to a private channel without key material rejects with a distinct, clear error (`missing private channel key`), never the generic `unknown channel`. | ✗ PARTIAL / FAILED (see gap) | `sendMessage`/`sendEvent` guard correctly (`client/community.ts:822-824,835,849`; test `community.test.ts:274-317` — `instanceof MissingChannelKeyError`, exact message, `channelId`). BUT `sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage` (`client/community.ts:887-919`) do not call `requireChannelKey` — they still surface the generic `planeKeyFor` `unknown channel` `Error` for the identical known-but-keyless-private state. See gap below. |
| 3 | Channel key material is read only from `material.channels`, never edition JSON; a channel Rekey takes effect immediately, `rollForwardChannel`'s output addresses the new epoch's plane without a client reload. | ✓ VERIFIED | `helpers/control.ts:217-283` — explicit typed field pick (`name`/`private`/`deleted`/`voice`/`custom`), no `key`/`epoch` read from edition (`grep` for `meta.key`/`meta.epoch`/`channel.key`/`channel.epoch` in `control.ts`/`community.ts` returns nothing). Client-level: `community.test.ts:144-212` rotates a channel key in-session then asserts the very next `sendMessage`'s wrap `pubkey` equals the hand-derived `channelGroupKey(newKey, id, 2).pk` and differs from the epoch-1 address — non-vacuous, spec-derived (never via `channelKeyFor`/`deriveConcordKeys`). |
| 4 | A client can query visible-but-inaccessible vs key-held without hand-rolling a lookup; a deleted channel cannot be revived by a later edition. | ✓ VERIFIED | `client/community.ts:130-145,199-316` — `ChannelView`/`accessible` computed via `hasChannelKey`, riding `channels$` (never folded into `ChannelMetadata`/`CommunityState` — confirmed `grep -n "accessible" types.ts` empty), reactive via `materialChanged$` at all 4 mutation sites (`receiveChannelKeys:679`, `persistChannelKey:712`, `dropChannelKey:734`, `mintChannelKey` callback:370). Test `community.test.ts:214-272` proves the grant-only reactive flip with no co-triggering `state$` activity. CHAN-07 sticky-delete: `control.ts:234-257` scans ALL authorized candidates for `deleted:true`, pins `heads` to the deleting edition, never pushes; test `control.test.ts:211-265` proves a create→delete→resurrect-attempt→**compaction**→fresh-joiner-fold round trip still drops the channel (the compaction-boundary simulation the plan required, not just a single-fold check). |
| 5 | All five Accordian-named (TEST-02) tests pass. | ✓ VERIFIED | Case 1 (`keys.test.ts:334`), 2 (`keys.test.ts:357`), 3 (`keys.test.ts:370`) — all hand-derived via `channelGroupKey`, never self-referential (grep confirms no `channelKeyFor(`/`deriveConcordKeys(` in an expected-value position). Case 4 (`community.test.ts:274`) and case 5 (`community.test.ts:319`) — reject with typed error / grant round-trip both pass. All 5 pass at the `sendMessage`-shaped scenario the upstream Accordian report specified verbatim. |
| 6 | (TEST-01, standing) Every channel derivation this phase touches has a hand-derived, spec-computed (never self-referential) test for both CORD-03 §1 branches, and the keyless case asserts absence, not a public-address match. | ✓ VERIFIED | `keys.test.ts:334-413` — public branch (`:357`), private branch (`:370`, non-vacuous — asserts `!== publicExpected.pk`), keyless (`:334`, asserts absence not equality). `channel-rekey.test.ts` ROTATE-03 probe confirmed still green (full package run, see below). |

**Score:** 5/6 ROADMAP success criteria fully verified; criterion 2 partially verified (2 of 7 channel-plane send entry points guarded; 5 remain fail-closed-but-generic).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/types.ts` | `ChannelMetadata.key`/`.epoch` removed | ✓ VERIFIED | `grep -n "key?" types.ts` returns no `ChannelMetadata` field match; `ChannelKey` (material.channels entry, :132-141) unchanged as intended. |
| `packages/concord/src/helpers/community.ts` | Total nullable branches + `hasChannelKey` | ✓ VERIFIED | Lines 37-77; exported and consumed by client/community.ts. |
| `packages/concord/src/helpers/keys.ts` | `channelKeyMemo` null-signalling, `deriveConcordKeys` skip-loop, `channelEpochs` from `held.epoch` | ✓ VERIFIED | Lines 151-203. |
| `packages/concord/src/helpers/control.ts` | Rewritten channel loop: explicit field pick + sticky-delete + heads pinning | ✓ VERIFIED | Lines 217-283. |
| `packages/concord/src/client/community.ts` | `ChannelView`, `materialChanged$`, `channels$`, `MissingChannelKeyError`, `requireChannelKey` | ⚠️ PARTIAL | Type/reactivity/error class all present and wired; guard usage incomplete (see gap — WR-01). |
| `packages/concord/src/helpers/__tests__/keys.test.ts` | CHAN-01/03/TEST-01 spec-derived cases | ✓ VERIFIED | 4 new cases, all hand-derived. |
| `packages/concord/src/helpers/__tests__/control.test.ts` | CHAN-04 + CHAN-07 compaction round-trip | ✓ VERIFIED | 2 new cases, CHAN-07 includes the compaction + fresh-joiner-fold simulation the plan required. |
| `packages/concord/src/client/__tests__/community.test.ts` | CHAN-06 reactivity + CHAN-02/TEST-02 case 4-5 + ROTATE-03 client-level | ✓ VERIFIED | All present, all pass; case 4/5 correctly scoped to `sendMessage` only (matches what was implemented, not the broader gap). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `material.channels` | `channelSecret`/`channelKeyFor` | direct lookup, total (null on miss) | ✓ WIRED | `community.ts:41-46` |
| `channelKeyFor` | `channelKeyMemo` | `keys.ts:160` | ✓ WIRED | cache honors `null` via `cache.has`, not truthiness |
| `channelKeyMemo` | `deriveConcordKeys` loop | `keys.ts:182-189` | ✓ WIRED | `if (!gk) continue` — single skip point for keys/epochs/planes |
| `foldControl` channel loop | `heads.set` + `channels.push` | one scan, `control.ts:234-282` | ✓ WIRED | Traced by hand against the CHAN-07 compaction test — holds |
| `receiveChannelKeys`/`persistChannelKey`/`dropChannelKey`/`mintChannelKey` | `materialChanged$.next()` | `community.ts:679,712,734,370` | ✓ WIRED | All 4 sites confirmed present |
| `sendMessage`/`sendEvent` | `requireChannelKey` → `MissingChannelKeyError` | `community.ts:835,849` | ✓ WIRED (partial coverage) | Guard fires correctly for these 2 of 7 channel-plane write entry points; `sendThread`/`replyToThread`/`react`/`editMessage`/`deleteMessage` bypass it (gap) |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `applesauce-concord` package suite | `pnpm --filter applesauce-concord test` | 211/211 passed, 43 test files | ✓ PASS |
| Full monorepo suite | `pnpm vitest run` | 2086 passed, 2 skipped (261 files) | ✓ PASS |
| No debt markers in phase-modified files | `grep -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across 8 modified/created source+test files | No matches | ✓ PASS |
| No edition-JSON key/epoch reads survive in control.ts/community.ts | `grep -n "meta.key\|meta.epoch\|channel.key\|channel.epoch"` | No matches | ✓ PASS |
| No `!` non-null assertion added around nullable-ripple functions | `grep` for `channelKeyFor(`/`voiceKeysFor(`/`channelSecret(` followed by `!` | No matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CHAN-01 | 07-01 | Keyless private channel derives no key/entry/plane | ✓ SATISFIED | `keys.test.ts:334` |
| CHAN-02 | 07-03 | Distinct send-reject error, not generic `unknown channel` | ⚠️ PARTIALLY SATISFIED | Satisfied for `sendMessage`/`sendEvent` (the exact Accordian composer scenario); NOT satisfied for `sendThread`/`replyToThread`/`react`/`editMessage`/`deleteMessage` — see gap |
| CHAN-03 | 07-01 | `channelEpochs` from held key's own epoch | ✓ SATISFIED | `keys.test.ts:397` |
| CHAN-04 | 07-01 | Explicit typed field pick, no edition-JSON key material | ✓ SATISFIED | `control.test.ts:158` |
| CHAN-05 | 07-01/07-03 | Rekey takes effect immediately from `material.channels` | ✓ SATISFIED | `community.test.ts:194-208` |
| CHAN-06 | 07-02 | Visible-vs-accessible distinction, reactive, no hand-rolled lookup | ✓ SATISFIED | `community.test.ts:214-272` |
| CHAN-07 | 07-01 | Deletion terminal, survives compaction | ✓ SATISFIED | `control.test.ts:211-265` (see also note on REQUIREMENTS.md staleness below) |
| ROTATE-03 | 07-01/07-03 | `rollForwardChannel` addresses new epoch's plane | ✓ SATISFIED | `channel-rekey.test.ts` (unchanged, confirmed green) + client-level `community.test.ts:194-208` |
| TEST-02 | 07-01/07-03 | All five Accordian-named tests pass | ✓ SATISFIED | Cases 1-5 all present and passing |

**Note on REQUIREMENTS.md internal inconsistency (not a phase gap):** `.planning/REQUIREMENTS.md`'s checklist (line 56) marks CHAN-07 `[x]` Complete, but its Traceability table (line 132) still reads "Pending — blocked on spec ruling." `.planning/ROADMAP.md`'s Phase 7 section explicitly documents the ruling was resolved during this phase (D-07: "deletion is terminal, id never reused," enforced via the sticky-deleted fold rule landed in 07-01) and the checklist entry, the actual code, and the passing compaction test all agree CHAN-07 is closed. This is stale bookkeeping in one table of REQUIREMENTS.md, not a functional or verification gap — flagged for a trivial doc fix, not blocking.

### Anti-Patterns Found

None blocking. See Info-level code-review findings below (carried forward, not re-litigated):

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `helpers/control.ts` | 277 | `typeof raw.custom === "object"` accepts arrays (not just plain objects) for `ChannelMetadata.custom` | Info | Looser than "explicit type validation" intends; doesn't crash the fold or leak key material (07-REVIEW.md IN-01) |
| `helpers/control.ts` | 249 | Multi-simultaneous-deletion tiebreak path has no dedicated test | Info | Untested but deterministic branch (07-REVIEW.md IN-02) |
| `helpers/keys.ts` | 181-189 | `deriveConcordKeys` channel loop repeats a `material.channels.find(...)` lookup `channelKeyMemo` already performed internally | Info | Duplication/maintenance risk, not a live bug (07-REVIEW.md WR-02) |

### Human Verification Required

None. All findings are resolvable by direct code inspection and automated test execution; no visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

One gap blocks a clean pass: **CHAN-02 / ROADMAP Success Criterion 2** is only fully met for `sendMessage`/`sendEvent`. Five other channel-plane write entry points (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`) still throw `planeKeyFor`'s generic, non-`instanceof`-catchable `Error("unknown channel")` for a known-but-keyless private channel — the exact "indistinguishable from a truly-unknown id" failure mode CHAN-02 exists to close. This was independently caught by 07-REVIEW.md (WR-01, Warning severity, 0 Critical findings overall) and confirmed directly against source in this verification. It is **not a security regression** — `deriveConcordKeys` still produces no `keys.channels` entry for a keyless private channel regardless of entry point, so no wrong-plane send or key leak occurs on any of the five paths; the gap is purely that a consuming app cannot `instanceof`-catch `MissingChannelKeyError` to gate reactions/edits/deletes/thread-replies the way it now can for the composer's `sendMessage`. The fix is small and precisely scoped (route the five methods through the existing `requireChannelKey` guard or through `sendEvent`) and code review already supplied the exact patch shape. Recommend a short closure plan via `/gsd-plan-phase --gaps` before considering CHAN-02/Phase 7 fully closed, or an explicit override if the narrower scope (composer-only, matching the field-confirmed Accordian report) is accepted as sufficient for this milestone.

All other phase must-haves — the H06/H07/H08 single-source-of-truth refactor, the sticky channel-deletion terminality (CHAN-07, including the compaction-boundary simulation), the reactive `accessible` view (CHAN-06), the in-session rekey plane addressing (CHAN-05/ROTATE-03), and all five TEST-02 Accordian-named tests plus the standing TEST-01 spec-derived-value requirement — are verified directly against source and a green 211/211 package suite (2086/2086 full monorepo).

---

_Verified: 2026-07-17T14:35:00Z_
_Verifier: Claude (gsd-verifier)_
