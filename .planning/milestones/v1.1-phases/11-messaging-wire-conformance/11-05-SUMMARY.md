---
phase: 11-messaging-wire-conformance
plan: 05
subsystem: testing
tags: [concord, nip-59, nip-22, nip-09, nip-25, vitest, wire-conformance, cord-protocol]

# Dependency graph
requires:
  - phase: 11-01
    provides: cord-wire-fixtures.ts (REACTION_KIND7_EXAMPLE, THREADED_REPLY_KIND1111_EXAMPLE, DELETE_KIND5_EXAMPLE, CORD_TARGET_KIND_RULE, CORD_REPLY_ROOT_INHERITANCE_RULE, substituteFixtureTags, missingFixtureTags, tagValues)
  - phase: 11-04
    provides: react/replyToThread/deleteMessage routed through the full target Rumor
provides:
  - Fixture-anchored regression tests binding WIRE-03/04/05 to the vendored examples.md tag sets, closing this phase's TEST-01 audit trail
affects: [12.3-audit-milestone, any-future-concord-wire-shape-change]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "decode-the-published-wrap: kind-5 delete rumors are intercepted by EventStore.add's delete-tracking branch and never land in a queryable getTimeline() result; assert against them by capturing the published wrap and decoding it with the plane's own GroupKey (channelGroupKey for a public channel) rather than reading the store"

key-files:
  created: []
  modified:
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "setupWireConformance's pool.publish mock captures published wraps (mirroring the file's existing published:NostrEvent[] pattern) so WIRE-05's delete cases can decode a kind-5 rumor that EventStore itself refuses to store queryably — additive change, does not affect WIRE-03/04's store-read cases"
  - "Task 3 probe 2 (whole target object passed to DeleteFactory.fromEvents instead of target.id) throws inside wrapForTarget's getEventHash rather than producing a stringified-object e tag as the plan's action text predicted; documented as an empirical correction, not a test-code change — both cases still observably RED, satisfying the non-vacuity requirement"

requirements-completed: [WIRE-03, WIRE-04, WIRE-05]

coverage:
  - id: D1
    description: "A reaction to a kind-1111 threaded reply emits a k tag naming 1111 (non-vacuous target), and a reaction to a kind-9 message matches examples.md §2.3 verbatim"
    requirement: WIRE-03
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-03: a reaction to a threaded reply names the reply's real kind (1111), not a hardcoded 9 (non-vacuous)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-03: a reaction to a kind-9 message matches examples.md §2.3 verbatim"
        status: pass
    human_judgment: false
  - id: D2
    description: "A depth-1 reply to a kind-9 message matches examples.md §2.2 verbatim, and a depth-2 reply inherits its uppercase root tags from the message, not its immediate parent, with an explicit negative root-identity assertion"
    requirement: WIRE-04
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-04: a depth-1 reply to a kind-9 message matches examples.md §2.2 verbatim"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-04: a depth-2 reply inherits the ROOT from the message, not from its immediate parent (D-03, non-vacuous)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A delete of a genuine sig-less Rumor matches examples.md §2.4 with a real 64-hex e tag, and a delete of a kind-1111 reply names 1111 rather than 9 in its k tag"
    requirement: WIRE-05
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-05: delete of a genuine sig-less Rumor matches examples.md §2.4, with a real 64-hex e tag"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#WIRE-05: delete of a kind-1111 reply names the reply's real kind, not the message's (CORD_TARGET_KIND_RULE)"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-07-29
status: complete
---

# Phase 11 Plan 05: Wire-Conformance Fixture Binding Summary

**Six new `community.test.ts` cases bind WIRE-03/04/05 to the vendored `cord-wire-fixtures.ts` module, each empirically observed RED against a surgical revert of the exact line it covers.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-29T10:42:30Z (after 11-04's completion commit)
- **Completed:** 2026-07-29T10:58:21Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added a `wire conformance` `describe` block to `community.test.ts` with a shared `setupWireConformance` helper (fresh community, one public "general" channel, captured published wraps) and two lookup helpers (`newestOfKind`, `rumorWithContent`), used by all six cases so no test hand-rolls its own genesis.
- WIRE-03: a non-vacuous case reacting to a kind-1111 threaded reply (asserting the `k` tag names 1111, not a hardcoded 9) plus a fixture-shape case reacting to a kind-9 message matching `examples.md` §2.3 verbatim via `missingFixtureTags`.
- WIRE-04: a depth-1 case matching `examples.md` §2.2 verbatim (both root and parent placeholders bound to the same message), plus a depth-2 case proving the root is inherited from the original message rather than re-pointed at the intermediate reply — the `CORD_REPLY_ROOT_INHERITANCE_RULE` non-vacuity trap, closed with both a positive root-identity assertion and its negative counterpart.
- WIRE-05: a case against a genuine sig-less `Rumor` target (with an explicit `"sig" in message === false` precondition assertion) matching `examples.md` §2.4, including a 64-hex `e`-tag length check that catches a stringified-object regression; plus a case against a kind-1111 target proving the `k` tag names the real target kind.
- All three tasks' non-vacuity probes were run empirically (temporary in-place revert of the exact fixed line, confirm RED, restore, confirm GREEN) rather than merely asserted in a comment.

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared wire-conformance setup plus the WIRE-03 reaction k-tag assertions** - `16f43948` (test)
2. **Task 2: WIRE-04 threaded reply at depth 1 and depth 2** - `e315770d` (test)
3. **Task 3: WIRE-05 delete k tag, built from a genuine sig-less Rumor** - `81585ea4` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/concord/src/client/__tests__/community.test.ts` - Added the `wire conformance` describe block (six test cases + shared setup/lookup helpers) and imports from `cord-wire-fixtures.ts` and `helpers/gift-wrap.ts`.

## Decisions Made

- `setupWireConformance`'s `pool.publish` mock captures every published wrap into a `published: NostrEvent[]` array (mirroring the file's pre-existing pattern from other tests), returned alongside `community`/`channelId`/`pubkey`/`rootEpoch`. This is additive — WIRE-03/04's cases read from the channel store as originally planned and never touch `published`; only WIRE-05's two cases use it.
- WIRE-05's delete rumor cannot be read back via `channelStore(channelId).getTimeline([{ kinds: [5] }])`: `EventStore.add()` special-cases `kinds.EventDeletion` (routes it into the internal `DeleteManager` and returns early without adding it to the queryable database — confirmed by reading `packages/core/src/event-store/event-store.ts:234-239`). This was discovered empirically when the first draft of the delete cases threw `no rumor of kind 5 found in channel ...`. The fix decodes the published wrap directly via `decodeWrap(wrap, channelGroupKey(...).convKey)` (the same helper already used by `roundtrip.test.ts`/`keys.test.ts`/`message.test.ts`), clearing `published.length = 0` immediately before each `deleteMessage` call so the correct wrap is unambiguous.
- Kept `CORD_TARGET_KIND_RULE` and `CORD_REPLY_ROOT_INHERITANCE_RULE` referenced as prose in code comments (not imported as identifiers) per the plan's literal instruction ("reference in a comment above the case") — importing them without using their string values would trigger an unused-import lint under the workspace's strict settings.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing functionality, or blocking issues were found in application code. All deviations below are refinements to the test-construction approach discovered while implementing the plan's own instructions; no plan `<action>` text was left unimplemented.

**1. [Rule 3 - Blocking, self-resolved within Task 3] Delete rumors are unreadable via `getTimeline`; switched WIRE-05 to wrap-decode**
- **Found during:** Task 3 (initial draft, before first test run)
- **Issue:** `newestOfKind(community, channelId, kinds.EventDeletion)` always threw "no rumor of kind 5 found" — `EventStore.add()` routes kind-5 events into `DeleteManager` instead of the queryable database, so no kind-5 rumor is ever visible to `getTimeline`.
- **Fix:** Added wrap capture (`published: NostrEvent[]`) to `setupWireConformance`, and a `decodedChannelDelete` helper that computes the public channel's `channelGroupKey` from `community.material` and decodes the matching published wrap via `decodeWrap` (existing helper, already used elsewhere in the package for exactly this purpose).
- **Files modified:** `packages/concord/src/client/__tests__/community.test.ts` (same file, same commit as Task 3 — no separate commit needed since this was resolved before any commit was made).
- **Verification:** Both WIRE-05 cases pass against the current fix and were RED under both non-vacuity probes (see below).

---

**Total deviations:** 1 self-resolved test-construction fix (no application-code changes). No scope creep — this is the exact "decode the wrap" technique the codebase already uses for control/guestbook/channel-plane assertions elsewhere; WIRE-05 is simply the first case in this file needing it for a kind the EventStore treats specially.

## Non-Vacuity Probe Log

Per the plan's `<action>` instructions, each task's fixed line was temporarily reverted in place, the wire-conformance suite was re-run to observe the failure, then the fix was restored and re-verified GREEN with an empty `git diff` on `community.ts`.

**Task 1 (WIRE-03, `react`):** Reverted to build a hand-built `{ id, pubkey, kind: 9 }` identity instead of passing the target rumor.
- Case A (non-vacuous, kind-1111 target) — **RED**: `expected '9' to be '1111'`.
- Case B (kind-9 fixture-shape) — **GREEN** (unchanged, since the target genuinely was kind 9) — this is exactly the divergence the plan's non-vacuity trap requires: a kind-9-only test would never have caught the pre-fix hardcode.
- Restored; both GREEN; `git diff --stat community.ts` empty.

**Task 2 (WIRE-04, `replyToThread`):** Reverted to rebuild a hand-crafted event pointer with a hardcoded `kind: 11` (forum-thread) instead of passing the parent rumor.
- Case A (depth-1, `examples.md` §2.2 verbatim) — **RED**: `missingFixtureTags` found `[["K","9"],["k","9"]]` missing (both came back as `11` instead).
- Case B (depth-2, root-identity) — **RED** specifically on `expect(tagArray(reply2, "E")).toEqual(tagArray(reply1, "E"))` — reply2's `E` tag pointed at a different (wrong-root) id than reply1's own root tag, i.e. the silent re-rooting D-03 describes.
- Restored; both GREEN; `git diff --stat community.ts` empty.

**Task 3 (WIRE-05, `deleteMessage`), probe 1:** Removed the `ensureKTag` application, leaving `target.id` passed correctly.
- Both cases — **RED**: `missingFixtureTags`/`tagValues` found no `k` tag at all (`expected [] to have a length of 1 but got +0`, and `missingFixtureTags` reporting `[["k","9"]]` unmatched).
- Restored; confirmed empty diff before proceeding to probe 2.

**Task 3, probe 2:** Passed the whole `target` object into `DeleteFactory.fromEvents` instead of `target.id`, leaving `ensureKTag` in place.
- **Both cases threw** (`Error: can't serialize event with wrong or missing properties` from `nostr-tools`' `getEventHash`, called inside `wrapForTarget`), rather than the plan's predicted outcome of "Case A's 64-character `e`-tag assertion goes RED while the `k` assertions stay GREEN." Root cause: `setDeleteEvents`'s non-`isEvent` branch does `ensureEventPointerTag(tags, { id: event })` where `event` is the whole Rumor object (not a string) — the resulting `e` tag element is a raw object reference, not a stringified id, so `nostr-tools`' event serializer throws while iterating tags rather than producing a comparably-wrong string. Both cases still observably fail (RED) — the non-vacuity requirement ("MUST go RED") is satisfied, just via a harder crash than the plan anticipated rather than a soft assertion mismatch on Case A alone with Case B staying green. Documented here per the plan's "record all observed outcomes" instruction; no test-code change was needed since the deployed fix (passing `target.id`) already avoids this path entirely.
- Restored; both GREEN; `git diff --stat community.ts` empty.

## Issues Encountered

None beyond the delete-readback discovery documented above (which resolved cleanly with an established codebase pattern, not a new one).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 11's TEST-01 audit trail (ROADMAP success criterion 6) is now traceable: every WIRE-02/03/04/05 wire shape this phase touches has at least one assertion binding to `cord-wire-fixtures.ts` (WIRE-02 was 11-01/11-06's scope; WIRE-03/04/05 close here).
- REQUIREMENTS.md's WIRE-03/04/05 rows should move from "In Progress" to "Complete" — this plan is their final sub-part per the roadmap's own accounting.
- `applesauce-concord` is 494 tests green (488 baseline + 6 new); `pnpm test` is 2367 passed / 2 skipped (baseline 2361 + 6 new).
- Plan 11-06 (voice presence, per the phase's Artifacts section) is next; nothing in this plan blocks it.

---
*Phase: 11-messaging-wire-conformance*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: commit 16f43948 (Task 1)
- FOUND: commit e315770d (Task 2)
- FOUND: commit 81585ea4 (Task 3)
