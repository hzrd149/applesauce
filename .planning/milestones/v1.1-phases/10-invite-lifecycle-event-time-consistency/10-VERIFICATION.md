---
phase: 10-invite-lifecycle-event-time-consistency
verified: 2026-07-21T14:44:35Z
status: passed
score: 6/7 must-haves verified (1 accepted narrowing)
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "TEST-01 standing — inviteBundleKey derivation hand-derived spec-value test"
    reason: "inviteBundleKey was not touched by any Phase 10 plan (10-RESEARCH.md V6 STRIDE row; no phase-10 commit modifies crypto.ts inviteBundleKey). TEST-01's standing wording covers derivations 'this phase touches'; the ROADMAP SC#6 mention of inviteBundleKey by name predates the RESEARCH scoping and is an accepted narrowing. inviteBundleKey remains a standing TEST-01 candidate for any future phase that modifies it."
    accepted_by: "hzrd149"
    accepted_at: "2026-07-21"
gaps:
  - truth: "(TEST-01, standing, ROADMAP SC #6) Every derivation this phase touches has a hand-derived spec-value test — the ROADMAP explicitly names the `inviteBundleKey` derivation as one of the things this criterion covers for Phase 10"
    status: overridden
    reason: "No test anywhere in packages/concord exercises inviteBundleKey(token) against an independently hand-computed key. The only coverage is round-trip tests (roundtrip.test.ts:105, planes.test.ts:95) that call encryptBundle/decryptBundle — both of which call inviteBundleKey internally — so a wrong derivation formula would still pass as long as both sides used the same (wrong) value. This does not meet D-13's 'never by calling the implementation under test' bar."
    artifacts:
      - path: "packages/concord/src/helpers/crypto.ts"
        issue: "inviteBundleKey (line ~199) has zero hand-derived-value test coverage; crypto.test.ts covers groupKey/editionHash/epochKeyCommitment/communityId but not inviteBundleKey"
      - path: "packages/concord/src/helpers/__tests__/invite-bundle.test.ts"
        issue: "Net-new file from 10-01/10-06 covers validateInviteBundle, decodeFragment, getInviteBundleVsk, expires_at round-trip, and the getInviteBundleLocator coordinate — but never asserts an inviteBundleKey output against an independently-derived expected value"
    missing:
      - "A test that independently computes the expected inviteBundleKey(token) output from CORD-05's key-derivation formula (not by calling inviteBundleKey itself) and asserts encodeFragment/decodeFragment or encryptBundle/decryptBundle actually use that exact key"
---

# Phase 10: Invite Lifecycle & Event Time Consistency Verification Report

**Phase Goal:** A revoked invite link is unjoinable regardless of relay lag, malformed bundles fail closed at the validation boundary, and an event's `created_at`/`ms` pair is always one true decomposition of a single clock read — so ordering and membership never silently disagree.
**Verified:** 2026-07-21T14:44:35Z
**Status:** passed (1 accepted narrowing — see Gaps Summary)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A revoked invite link is unjoinable even when a lagging relay still serves the old bundle — coordinate resolves to newest event first, tombstone evaluated after | ✓ VERIFIED | `client.ts:89-95` `newestAtCoordinate` (verbatim NIP-01 rule replicated from `event-store.ts:264-267`); `client.ts:451-452` collapses full union THEN checks `isInviteBundleRevoked(winner)`. Test `client.test.ts:921` "rejects when a fresher tombstone coexists with a stale live bundle from a lagging relay" — passes, non-vacuity reasoned in comment and independently re-derivable |
| 2 | `validateInviteBundle` fails closed on non-array `channels`/`relays`; `decodeFragment` rejects an unknown fragment version | ✓ VERIFIED | `invite-bundle.ts:224` `if (!Array.isArray(bundle.channels) || !Array.isArray(bundle.relays)) return undefined;` before any `.length`/`.slice`; `invite-bundle.ts:81` `if (version !== FRAGMENT_VERSION) throw ...` (strict-not-equal, both directions). Tests in `invite-bundle.test.ts` (lines 38-106) cover both, all green |
| 3 | `refreshInviteBundles` skips a link it cannot rebuild and continues; `expires_at` is written in the spec-correct unit | ✓ VERIFIED | `community.ts:1136-1155` wraps the whole per-link body in `try {...} catch (err) { console.warn(...); }` (no `continue` needed — for-loop falls through). `expires_at` is unix seconds end-to-end (see truth 6 below for the site-by-site check). Test `community.test.ts` "skips a link that can't rebuild and still refreshes the rest" passes |
| 4 | An event's `created_at`/`ms` come from a single clock read via `splitTime()`, zero skew | ✓ VERIFIED | `stream.ts:16-18` `splitTime`; `channel.ts:30-34` `includeMs` calls `splitTime(ms)` once and overrides both `draft.created_at` and the `ms` tag from the SAME decomposition. `stream.test.ts` decomposition case (`1700000000700 → {created_at:1700000000, ms:700}`, no skew) and reorder case both pass |
| 5 | All chunks of one Guestbook snapshot share one timestamp; `rumorMs`/`hasMalformedMs` agree on a valid `ms` tag | ✓ VERIFIED | `guestbook.ts:44-61` `includeSnapshotChunk` takes a pre-computed `{created_at, ms}` pair, no `Date.now()` inside; `factories/guestbook.ts:106-117` `buildSnapshotFactories` calls `splitTime(nowMs)` exactly once, threads identical pair to every chunk. `stream.ts:29-46` `parseMs` is the single predicate both `rumorMs` and `hasMalformedMs` call. `snapshot.test.ts` shared-timestamp assertion and `stream.test.ts` canonical-table test both pass |
| 6a | (TEST-01) Time decomposition and invite coordinate `(33301, link_signer, "")` are hand-derived, not read back from the implementation | ✓ VERIFIED | `invite-bundle.test.ts:178-200` computes `expectedPubkey = getPublicKey(signerSk)` independently and asserts `getInviteBundleLocator(invite)` matches; `stream.test.ts` computes `{created_at:1700000000, ms:700}` by hand from the `1700000000700` instant, not by calling `splitTime` first |
| 6b | (TEST-01) The `inviteBundleKey` derivation, which ROADMAP.md Phase 10 §6 explicitly names as something this phase's spec-derived-test obligation covers, has a hand-derived-value test | ✗ FAILED | No test anywhere hand-derives `inviteBundleKey(token)`'s expected byte output independently of calling the function. `roundtrip.test.ts:105` and `planes.test.ts:95` only prove `encryptBundle`/`decryptBundle` are mutual inverses (both call `inviteBundleKey` internally — a wrong derivation would still round-trip). See Gaps Summary for scoping context |

**Score:** 6/7 truths verified (1 gap: `inviteBundleKey` hand-derived test coverage)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/helpers/invite-bundle.ts` | Array-shape guard, strict fragment-version check, absent-vs-malformed `vsk` | ✓ VERIFIED | All three present, wired, tested |
| `packages/concord/src/helpers/__tests__/invite-bundle.test.ts` | Net-new spec-derived test file | ✓ VERIFIED | 200 lines, 11+ tests across 5 `describe` blocks (validateInviteBundle, decodeFragment, vsk, expires_at, coordinate), all pass |
| `packages/concord/src/helpers/stream.ts` | Exported `parseMs`; `rumorMs`/`hasMalformedMs` consume it | ✓ VERIFIED | `parseMs` at line 29, both consumers call it (lines 37, 46) |
| `packages/concord/src/helpers/__tests__/stream.test.ts` | Net-new spec-derived test file | ✓ VERIFIED | Present, canonical `ms` table + decomposition/reorder cases pass |
| `packages/concord/src/operations/channel.ts` | `includeMs` imports `splitTime`, overrides `created_at` | ✓ VERIFIED | Line 14 import, lines 30-34 single-read override |
| `packages/concord/src/operations/guestbook.ts` | `includeSnapshotChunk` takes `{created_at, ms}` pair, no internal `Date.now()` | ✓ VERIFIED | Confirmed at lines 44-61; `grep Date.now` in file returns nothing |
| `packages/concord/src/factories/guestbook.ts` | `buildSnapshotFactories` reads `splitTime` once | ✓ VERIFIED | Line 115, threaded to every chunk (line 116) |
| `packages/concord/src/client/community.ts` | Per-link try/catch skip-and-continue in `refreshInviteBundles` | ✓ VERIFIED | Lines 1136-1155 |
| `packages/concord/src/client/client.ts` | `newestAtCoordinate` collapse helper; `"#d": [""]` filter scope; collapse-then-tombstone `joinByLink` | ✓ VERIFIED | Lines 89-95, 441, 451-452 |
| `packages/concord/src/casts/direct-invite.ts` | `expired()` uses seconds clock, not `Date.now()` | ✓ VERIFIED | Line 70 `expired(now = unixNow())` |
| `packages/concord/UPSTREAM-NOTES.md` | New entry documenting §1/§4 `expires_at` unit contradiction | ✓ VERIFIED | Lines 19-33, cites both §1 "unix ms" text and §4/§8 magnitude argument, records the seconds reading implemented |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `getInviteBundleVsk` (10-01) | `isInviteBundleRevoked` | `=== INVITE_BUNDLE_VSK_REVOKED` predicate | ✓ WIRED | Malformed `vsk` returns `INVITE_BUNDLE_VSK_REVOKED` directly; predicate denies |
| `isInviteBundleRevoked` (10-01, hardened) | `joinByLink`'s collapse winner (10-05) | `if (!winner \|\| isInviteBundleRevoked(winner)) throw ...` | ✓ WIRED | `client.ts:452` — revocation decided on the single collapse winner, after the collapse, not before |
| `parseMs` | `rumorMs` / `hasMalformedMs` | direct function calls | ✓ WIRED | `stream.ts:37,46` — both consumers, no second parser exists (grep confirms) |
| `splitTime` | `includeMs` | single call inside `EventOperation` closure | ✓ WIRED | `channel.ts:31` |
| `splitTime` | `buildSnapshotFactories` → `SnapshotFactory.create`/`chunk()` → `includeSnapshotChunk` | pair threaded through 3 call layers | ✓ WIRED | `factories/guestbook.ts:74,91,115-116`; `operations/guestbook.ts:49,54,58` |
| `unixNow()` | `joinFromBundle` expiry check / `ConcordDirectInvite.expired()` | seconds-to-seconds comparison | ✓ WIRED | `client.ts:478` `unixNow() > bundle.expires_at`; `direct-invite.ts:70-72` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INVITE-01 | 10-01 (D-04 sub-part), 10-05 (D-01/D-02/D-03) | Revoked link unjoinable despite lagging relay | ✓ SATISFIED | Collapse-then-tombstone in `client.ts`; vsk fail-closed in `invite-bundle.ts`; both tested. **Note:** REQUIREMENTS.md line 152's status table still says "In Progress (D-04 closed by 10-01; D-01/D-02/D-03 pending 10-05)" even though 10-05 has since landed and closed it — a stale doc-sync issue, not a code gap (line 61's checkbox is already `[x]`) |
| INVITE-02 | 10-01 | `validateInviteBundle` array-shape guard | ✓ SATISFIED | `invite-bundle.ts:224`, tested |
| INVITE-03 | 10-04 | `refreshInviteBundles` best-effort per link | ✓ SATISFIED | `community.ts:1136-1155`, tested |
| INVITE-04 | 10-06 | `expires_at` unix seconds end-to-end | ✓ SATISFIED | All sites converted, UPSTREAM-NOTES.md entry filed, tested |
| INVITE-05 | 10-01 | `decodeFragment` rejects unknown version | ✓ SATISFIED | `invite-bundle.ts:81`, tested |
| TIME-01 | 10-02 | Single clock read for `created_at`/`ms` | ✓ SATISFIED | `channel.ts` `includeMs`, tested |
| TIME-02 | 10-03 | Snapshot chunks share one timestamp | ✓ SATISFIED | `factories/guestbook.ts`, tested |
| TIME-03 | 10-02 | `rumorMs`/`hasMalformedMs` agree via `parseMs` | ✓ SATISFIED | `stream.ts`, tested |

No orphaned requirements — all 8 IDs declared across the 6 plans match REQUIREMENTS.md's Phase 10 mapping table (lines 152-159) exactly.

### Anti-Patterns Found

None. Scanned all 18 files touched by this phase's 6 plans (`invite-bundle.ts` + its test, `stream.ts` + its test, `channel.ts`, `chat.test.ts`, `guestbook.ts` (operations + factories) + their tests, `community.ts` + its test, `client.ts` + its test, `types.ts`, `invite-manager.ts`, `direct-invite.ts`, `UPSTREAM-NOTES.md`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero hits.

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 7 phase-touched test files | `npx vitest run <7 files>` (from `packages/concord`) | 94/94 tests passed | ✓ PASS |
| Full `applesauce-concord` suite (regression) | `npx vitest run` | 47 files, 286/286 passed | ✓ PASS |
| TypeScript build | `npx tsc --noEmit` | Clean, no errors | ✓ PASS |
| No `Date.now`/ms wording regressions | `grep -rin "unix ms\|unix-ms\|milliseconds" packages/concord/src \| grep -v __tests__` | No output | ✓ PASS |
| `rekey.ts`/`helpers/rekey.ts` untouched (explicit prohibition, all 6 plans) | `git log --since=2026-07-21 -- operations/rekey.ts helpers/rekey.ts` | No commits | ✓ PASS |

This matches the note provided with the verification task: full workspace suite green, concord 286/286, tsc clean, independently re-confirmed by direct execution rather than trusting the SUMMARY claim.

### Human Verification Required

None. Every truth in this phase is a pure-function/unit-testable correctness property; no UI, visual, or external-service behavior is involved.

## Gaps Summary

Six of the seven roadmap-derived truths are fully verified with real, non-vacuous, independently-re-run tests, clean `tsc`, and no regressions — this is a strong, well-executed phase. The one gap is narrow and specific:

**ROADMAP.md's Phase 10 success criterion #6** ("(TEST-01, standing)") reads in full: *"Every derivation this phase touches has at least one test computing its expected value independently... Covers the `inviteBundleKey` derivation and the invite coordinate `(33301, link_signer, "")`... plus the time decomposition..."* The coordinate and time-decomposition parts are fully satisfied. The `inviteBundleKey` part is not — no test anywhere hand-derives its expected output; existing coverage is round-trip-only (encrypt then decrypt), which cannot catch a self-consistent-but-wrong derivation formula.

Mitigating context found during verification: `10-RESEARCH.md`'s V6 STRIDE row states plainly that "`communityId`/`inviteBundleKey` derivations are untouched by this phase" (no code in `inviteBundleKey` itself was modified), and `10-CONTEXT.md` notes "TEST-01 does NOT close at this phase" — i.e., TEST-01 is a continuously-standing rule, not a per-phase-closeable checkbox. This suggests the roadmap's specific `inviteBundleKey` mention may have been carried over from before RESEARCH narrowed the phase's actual code-touch surface, and the planners may have implicitly (but never explicitly, in DISCUSSION-LOG or CONTEXT) decided it was out of scope since no line of `inviteBundleKey` was edited.

Given the adversarial-verification standard ("absence of implementation is observable → FAILED, not UNCERTAIN"), this is recorded as a failed truth rather than waved through. If this scoping was in fact an intentional, accepted narrowing, add the following to this file's frontmatter and re-run verification:

```yaml
overrides:
  - must_have: "TEST-01 standing — inviteBundleKey derivation hand-derived spec-value test"
    reason: "inviteBundleKey was not touched by any Phase 10 plan (10-RESEARCH.md V6); the roadmap's SC#6 wording predates that scoping decision"
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
```

**Resolution (2026-07-21, hzrd149):** Override accepted. `inviteBundleKey` was confirmed untouched by every Phase 10 plan (10-RESEARCH V6; no phase-10 commit modifies its definition `concordHkdf(token, "concord/invite-key", ZERO_32)`), so the standing TEST-01 obligation — scoped to "derivations this phase touches" — does not attach to it here. The ROADMAP SC#6 by-name mention predates the RESEARCH scoping. `inviteBundleKey` remains a standing TEST-01 candidate for any future phase that modifies it. Frontmatter `overrides` block records the acceptance; phase status is `passed`.

Separately (resolved, was informational): `.planning/REQUIREMENTS.md` line 152's status-table note for INVITE-01 previously read "In Progress" — stale documentation from before 10-05 landed. Fixed in commit `26fe4002` (now reads "Complete", consistent with the `[x]` checkbox at line 61 and the code/tests confirming INVITE-01 is fully closed).

---

*Verified: 2026-07-21T14:44:35Z*
*Verifier: Claude (gsd-verifier)*
