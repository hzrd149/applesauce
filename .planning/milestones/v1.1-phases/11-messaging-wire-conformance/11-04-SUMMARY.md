---
phase: 11-messaging-wire-conformance
plan: 04
subsystem: messaging

# Dependency graph
requires:
  - phase: 11-messaging-wire-conformance
    provides: plan 03 landed in the same wave on the same working tree (WrapOptions.ephemeralSk threading through publishToPlane/sendEvent, preserved verbatim here); no direct code dependency
provides:

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Apply an EventOperation-shaped transformation to an awaited factory result when EventFactory only exposes a protected chain (mirrors the existing bindToChannel/includeMediaEncryption idiom, now also used for ensureKTag on the delete path)"
    - "Pass the full target Rumor through to upstream factories instead of hand-building an identity object or pointer, so the wrong (kind-hardcoded, tag-less) path is unrepresentable"

key-files:
  created: []
  modified:

key-decisions:
  - "No upstream factory in packages/core or packages/common was touched — ReactionParent/CommentParent already accept Rumor and setReactionParent/setParent already do the right thing once given a real rumor."

requirements-completed: []

coverage:
  - id: D1
    description: "react/replyToThread/deleteMessage each take the full target Rumor; react passes it straight into ReactionFactory.create (no hand-built identity), replyToThread passes it straight into CommentFactory.create (no hand-built pointer), deleteMessage passes target.id into DeleteFactory.fromEvents then applies ensureKTag(template.tags, target.kind) explicitly"
    requirement: "WIRE-03, WIRE-04, WIRE-05"
    verification:
      - kind: build
        status: pass
      - kind: unit
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
- The now-unused `kinds` namespace import was removed from the `applesauce-core/helpers/event` import; `ensureKTag` imported from `applesauce-core/helpers/factory`; `Rumor` added to the existing `../types.js` type-import block
- The `MissingChannelKeyError` table test's shared `target` fixture was reshaped from `{ id, author }` into a genuine sig-less `Rumor` (kind 1111, non-empty tags) — the toolchain cannot catch a stale fixture here (`__tests__` is excluded from `tsc`, and the guard throws before the factory runs), so this was a deliberate correctness change, not a mechanical rename
- `editMessage` (bare-id signature) and `sendMessage`'s `replyTo` (NIP-C7 chat quote-reply) were left untouched, per the plan's explicit out-of-scope fence

## Task Commits

Each task was committed atomically:

1. **Task 1: Take the full Rumor in all three methods and apply ensureKTag on the delete path** - `23615838` (fix)
2. **Task 2: Reshape the existing MissingChannelKeyError table test's target to a genuine sig-less Rumor** - `c7d80c0f` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified


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
