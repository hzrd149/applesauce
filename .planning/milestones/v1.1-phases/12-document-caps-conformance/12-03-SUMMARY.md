---
phase: 12-document-caps-conformance
plan: 03
tags: [invite, byte-cap-removal, conformance]
dependency-graph:
  requires: [12-02]
  provides: [WIRE-08-invite-half]
  affects: [12-05]
tech-stack:
  added: []
  patterns:
    - "D-07 byte-cap removal: delete the constant, the gate, and every comment that reasoned from it — never leave a tombstone comment (D-10)"
    - "Structural export-surface guard (Object.keys(Module).not.toContain) as the permanence proof for a removed symbol"
key-files:
  created: []
  modified:
decisions:
  - "Rewrote community-list.ts's COMMUNITY_LIST_MAX_ENTRY_BYTES doc comment (out of this plan's declared files_modified) to drop its dangling citation of the deleted INVITE_BUNDLE_MAX_TOTAL_BYTES — required by this plan's own top-level verification (zero surviving occurrences of the removed symbol name outside the structural test guard) and by D-10; the constant and its enforcement are untouched, still plan 12-05's scope"
  - "Chose INVITE_BUNDLE_MAX_CHANNELS (256) as the rewritten aggregate-size test's channel count — comfortably above the former ~164-channel byte ceiling while sitting exactly at the surviving count cap, so one test proves both halves: the byte gate is gone, the count bound still fires at cap+1"
metrics:
  duration: 9.5min
  completed: 2026-07-30
status: complete
---

# Phase 12 Plan 03: Delete the Invite serialized-byte caps Summary


## What Was Built

**Task 1 — Invite List byte cap and publish gate deleted.**
`helpers/invite-list.ts` no longer declares `INVITE_LIST_MAX_BYTES` or `inviteListWithinByteCap`. `client/invite-manager.ts`'s `save()` no longer imports or consults either symbol — it falls straight from the fingerprint dirty check to plaintext serialization and publish, with no replacement diagnostic (D-25 scopes the keep-the-diagnostic carve-out to `saveCommunityList` only, not the invite path).

**Task 2 — INVITE_BUNDLE_MAX_TOTAL_BYTES deleted at all four sites.**
`helpers/invite-bundle.ts`: the constant declaration and its multi-paragraph derivation doc block are gone; `buildInviteBundle` no longer measures or throws on aggregate serialized size; `validateInviteBundle` no longer measures the rebuilt object or rejects on aggregate size after the owner-proof check. `INVITE_BUNDLE_MAX_TEXT_LENGTH`'s doc comment was rewritten to justify 256 on its own terms (attacker-controlled display/attribution strings a joiner renders, serialized twice per Community List entry) without citing the deleted whole-document ceiling or a 65535-byte publish cap. `INVITE_BUNDLE_MAX_CHANNELS`/`MAX_HELD_ROOTS`/`MAX_HELD_CHANNEL_KEYS`/`MAX_RELAY_URL_LENGTH` and `rebuildByRules` are byte-for-byte unchanged (D-09/D-18 — confirmed via `git diff` showing zero touched lines in `rebuildByRules`).

**Task 3 — Four test blocks rewritten, not deleted.**
- `invite-list.test.ts`: removed the `inviteListWithinByteCap` import and its single assertion from the terminal-revocation liveness test; every other assertion in that test (tombstone terminality) is untouched.
- `invite-bundle.test.ts`: the aggregate-size test now asserts `validateInviteBundle` returns a *defined* rebuilt bundle for a legal 256-channel set (the surviving count cap, chosen to sit comfortably above the former ~164-channel byte ceiling while staying at `INVITE_BUNDLE_MAX_CHANNELS`), plus a second assertion that 257 channels still rejects the whole bundle — pinning both halves of the change in one test. The `buildInviteBundle` throw test now asserts `not.toThrow()` and that the returned bundle's `channels.length` matches the requested count. The text-cap test's stale "wedges the Community List past the whole-document byte cap" comment was reworded to the surviving justification (reaches every joiner's render, serialized twice per entry).
- `invite-bundle-schema.test.ts`: the obsolete three-link cap-chain arithmetic test (`2x INVITE_BUNDLE_MAX_TOTAL_BYTES fits the per-entry ceiling, 2x that fits LIST_MAX_BYTES`) was replaced with a structural permanence guard (`Object.keys(InviteBundleModule)` does NOT contain `INVITE_BUNDLE_MAX_TOTAL_BYTES`) plus five literal-anchored assertions of the surviving bounds (256/64/64/256/512), each compared to a hand-written literal per D-21's anchoring discipline. The now-unneeded `LIST_MAX_BYTES` import from `community-list.js` was removed (confirmed it was this test's only consumer in the file).


## Non-Vacuity Observation (recorded per task instruction)


## Verification

- `INVITE_BUNDLE_MAX_CHANNELS`/`MAX_HELD_ROOTS`/`MAX_HELD_CHANNEL_KEYS`/`MAX_TEXT_LENGTH`/`MAX_RELAY_URL_LENGTH` all present at their original literal values (256/64/64/256/512).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / D-10] Dangling comment reference to a deleted constant in `community-list.ts`**
- **Found during:** Task 3's final verification sweep (this plan's top-level `<verification>` requires zero surviving occurrences of the removed bundle-total constant name outside the structural test guard).
- **Fix:** Reworded the comment to state the per-entry ceiling's own rationale (material serialized twice, so no membership may occupy more than half the document) without the cross-file citation. No exported symbol, value, or behavior in `community-list.ts` changed.
- **Commit:** e866012a

## Self-Check: PASSED

- Commit ea1aadc0: FOUND
- Commit 8f2bc07a: FOUND
- Commit e866012a: FOUND
