---
phase: 11-messaging-wire-conformance
plan: 04
subsystem: messaging
tags: [nostr, nip-25, nip-22, nip-09, concord, wire-conformance]

# Dependency graph
requires:
  - phase: 11-messaging-wire-conformance
    provides: plan 03 landed in the same wave on the same working tree (WrapOptions.ephemeralSk threading through publishToPlane/sendEvent, preserved verbatim here); no direct code dependency
provides:
  - "ConcordCommunity.react(channelId, target: Rumor, reaction) — passes the target rumor straight into ReactionFactory.create, no hand-built identity object"
  - "ConcordCommunity.replyToThread(channelId, parent: Rumor, body) — passes the parent rumor straight into CommentFactory.create, no hand-built pointer"
  - "ConcordCommunity.deleteMessage(channelId, target: Rumor) — passes target.id into DeleteFactory.fromEvents, then applies ensureKTag(template.tags, target.kind) explicitly on the awaited template"
affects: [concord-wire-conformance, concord-messaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Apply an EventOperation-shaped transformation to an awaited factory result when EventFactory only exposes a protected chain (mirrors the existing bindToChannel/includeMediaEncryption idiom, now also used for ensureKTag on the delete path)"
    - "Pass the full target Rumor through to upstream factories instead of hand-building an identity object or pointer, so the wrong (kind-hardcoded, tag-less) path is unrepresentable"

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "D-02's stated mechanism for deleteMessage was corrected per plan Task 1: a Concord Rumor has no sig, so isEvent(event) is false and DeleteFactory.fromEvents([target]) would silently skip the k tag. Fix passes target.id (the bare-string branch) and applies ensureKTag explicitly on the awaited template before binding — D-02's zero-upstream-edits conclusion still holds."
  - "No upstream factory in packages/core or packages/common was touched — ReactionParent/CommentParent already accept Rumor and setReactionParent/setParent already do the right thing once given a real rumor."
  - "Per D-09, no changeset created for these breaking signature changes (concord unreleased)."

requirements-completed: []

coverage:
  - id: D1
    description: "react/replyToThread/deleteMessage each take the full target Rumor; react passes it straight into ReactionFactory.create (no hand-built identity), replyToThread passes it straight into CommentFactory.create (no hand-built pointer), deleteMessage passes target.id into DeleteFactory.fromEvents then applies ensureKTag(template.tags, target.kind) explicitly"
    requirement: "WIRE-03, WIRE-04, WIRE-05"
    verification:
      - kind: build
        ref: "pnpm --filter applesauce-concord build exits 0"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#every channel-plane write path ... throws MissingChannelKeyError for a keyless private channel (CHAN-02 / WR-01) — reshaped target is a genuine sig-less Rumor (kind 1111, non-empty tags), exercised through react/deleteMessage/replyToThread's new signatures"
        status: pass
      - kind: unit
        ref: "pnpm test (full workspace) — 2361 passed, 2 skipped, matching the pre-plan baseline"
        status: pass
    human_judgment: false
    note: "Fixture-anchored conformance assertions (asserting the emitted k/e/tag values against the vendored CORD examples) land in plan 11-05, not this plan — this plan proves the signature shape and routing only."

# Metrics
duration: 10min
completed: 2026-07-29
status: complete
---

# Phase 11 Plan 04: Route react/replyToThread/deleteMessage through the real target Rumor Summary

**`react`, `replyToThread`, and `deleteMessage` now take the full target `Rumor` and route straight through `ReactionFactory`/`CommentFactory`/`DeleteFactory` instead of a hand-built identity object or pointer, closing WIRE-03/04/05 by making the hardcoded-kind wrong path unrepresentable.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-29T11:34:00Z
- **Completed:** 2026-07-29T11:40:09Z
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments

- `react(channelId, target: Rumor, reaction)` deletes the hand-built `{ id, pubkey, kind: kinds.ChatMessage }` object and passes `target` straight into `ReactionFactory.create` — `ReactionParent`'s union already accepts `Rumor` and `setReactionParent` already calls `ensureKTag` with the parent's real kind (WIRE-03)
- `replyToThread(channelId, parent: Rumor, body)` deletes the hand-built `{ type: "event", id, kind: kinds.ForumThread, pubkey }` pointer and passes `parent` straight into `CommentFactory.create`, so `setParent` takes its `"tags" in parent` branch and reaches `createCommentTagsForEvent` — the verbatim-root-inheritance implementation (WIRE-04)
- `deleteMessage(channelId, target: Rumor)` corrects D-02's stated mechanism: since a Concord `Rumor` never has a `sig`, `setDeleteEvents`'s `isEvent(event)` branch would never fire and no `k` tag would be emitted. The fix awaits `DeleteFactory.fromEvents([target.id])` to a plain template, then builds a new template replacing `tags` with `ensureKTag(template.tags, target.kind)`, and hands that to `bindToChannel` (WIRE-05)
- The now-unused `kinds` namespace import was removed from the `applesauce-core/helpers/event` import; `ensureKTag` imported from `applesauce-core/helpers/factory`; `Rumor` added to the existing `../types.js` type-import block
- The `MissingChannelKeyError` table test's shared `target` fixture was reshaped from `{ id, author }` into a genuine sig-less `Rumor` (kind 1111, non-empty tags) — the toolchain cannot catch a stale fixture here (`__tests__` is excluded from `tsc`, and the guard throws before the factory runs), so this was a deliberate correctness change, not a mechanical rename
- `editMessage` (bare-id signature) and `sendMessage`'s `replyTo` (NIP-C7 chat quote-reply) were left untouched, per the plan's explicit out-of-scope fence
- No file under `packages/core` or `packages/common` was touched; no changeset created (D-09, concord unreleased)

## Task Commits

Each task was committed atomically:

1. **Task 1: Take the full Rumor in all three methods and apply ensureKTag on the delete path** - `23615838` (fix)
2. **Task 2: Reshape the existing MissingChannelKeyError table test's target to a genuine sig-less Rumor** - `c7d80c0f` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified

- `packages/concord/src/client/community.ts` - `react`/`replyToThread`/`deleteMessage` signatures changed to take `Rumor`; hand-built identity/pointer objects deleted; `deleteMessage` gained the explicit `ensureKTag` application; `kinds` import removed, `ensureKTag` and `Rumor` imports added
- `packages/concord/src/client/__tests__/community.test.ts` - the `MissingChannelKeyError` table test's shared `target` local reshaped into a genuine sig-less `Rumor` (kind 1111, non-empty tags); `deleteMessage`'s row updated to pass the whole rumor instead of `target.id`

## Decisions Made

- Followed the plan as specified, including its explicit correction of D-02's stated mechanism for `deleteMessage` (D-02's zero-upstream-edits conclusion still holds; only the "why WIRE-05 is fixed" reasoning was wrong in the original decision).
- Confirmed via `grep` that no other call site in the repo (`packages/`, `apps/`) invokes `react`/`replyToThread`/`deleteMessage` outside this test file, so no downstream caller needed updating.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

WIRE-03/04/05 are behaviorally closed by this plan (the hardcoded-kind/hand-built-pointer path is deleted and the upstream machinery is reachable), but per STATE.md's precedent for shared requirement IDs, REQUIREMENTS.md traceability should still read "In Progress" until plan 11-05 lands the fixture-anchored conformance assertions (asserting the emitted `k`/`e`/root-pointer tag values against the vendored CORD examples) — this plan proves the routing/shape, not the wire-level assertion.

---
*Phase: 11-messaging-wire-conformance*
*Completed: 2026-07-29*

## Self-Check: PASSED

All modified files found on disk; both task commit hashes (23615838, c7d80c0f) found in git log.
