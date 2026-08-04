---
phase: 07-private-channel-keying
plan: 04
subsystem: auth
tags: [concord, channel-keying, typed-errors, chan-02]

# Dependency graph
requires:
  - phase: 07-private-channel-keying (07-03)
    provides: MissingChannelKeyError, requireChannelKey guard (wired into sendMessage/sendEvent)
provides:
  - requireChannelKey wired into all five remaining channel-plane write entry points (sendThread, replyToThread, react, editMessage, deleteMessage)
  - Regression test locking all seven channel-plane write methods to the typed MissingChannelKeyError for a known-but-keyless private channel
affects: [phase-verification, channel-write-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "Prepended this.requireChannelKey(channelId) as the literal first statement in each of the five methods, mirroring sendMessage/sendEvent verbatim rather than re-plumbing them through a shared factory body"

patterns-established: []

requirements-completed: [CHAN-02]

coverage:
  - id: D1
    description: "sendThread, replyToThread, react, editMessage, and deleteMessage each reject a known-but-keyless private channel with the typed, instanceof-catchable MissingChannelKeyError instead of planeKeyFor's generic unknown-channel Error"
    requirement: "CHAN-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#every channel-plane write path (react/editMessage/deleteMessage/sendThread/replyToThread) throws MissingChannelKeyError for a keyless private channel, not unknown channel (CHAN-02 / WR-01)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-17
status: complete
---

# Phase 07 Plan 04: Close CHAN-02 typed-error gap across all channel-plane writes Summary

**Wired `requireChannelKey` into `sendThread`, `replyToThread`, `react`, `editMessage`, and `deleteMessage`, closing the last CHAN-02 gap so all seven channel-plane write paths throw the same typed `MissingChannelKeyError`**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-17T14:52:00Z
- **Completed:** 2026-07-17T15:00:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- All five previously-unguarded channel-plane write methods (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`) now call `this.requireChannelKey(channelId)` as their first statement, mirroring the proven `sendMessage`/`sendEvent` guard exactly
- `requireChannelKey`, `MissingChannelKeyError`, and `planeKeyFor`'s generic `unknown channel` backstop are all byte-unchanged — no new symbols introduced
- New regression test drives all five methods against a known-but-keyless private channel and asserts each throws `instanceof MissingChannelKeyError` with the exact message and matching `channelId`, and explicitly that the message is not the generic `"unknown channel"`
- Full `applesauce-concord` suite green: 212/212 (211 baseline + 1 new test)

## Task Commits

Each task was committed atomically:

1. **Task 1: Route the five channel-plane write methods through requireChannelKey** - `01b5c420` (fix)
2. **Task 2: Regression test — all five write paths throw MissingChannelKeyError for a keyless private channel** - `129e141d` (test)

**Plan metadata:** (final commit pending)

## Files Created/Modified
- `packages/concord/src/client/community.ts` - Added `this.requireChannelKey(channelId);` as the first statement of `sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`
- `packages/concord/src/client/__tests__/community.test.ts` - Added a regression test exercising all five methods against a known-but-keyless private channel

## Decisions Made
- Prepended `this.requireChannelKey(channelId)` directly per-method (minimal, mirrors the proven `sendMessage`/`sendEvent` pattern) rather than re-plumbing the five methods' distinct factory bodies through a shared helper — matches the plan's explicit preference

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP Success Criterion 2 / CHAN-02 fully closed: every channel-plane write entry point (all 7) now surfaces the distinct, `instanceof`-catchable `MissingChannelKeyError` for a keyless private channel
- No open gaps remain from 07-VERIFICATION.md / 07-REVIEW.md WR-01 for this phase
- `packages/concord` is unreleased — no changeset required (per project CLAUDE.md / MEMORY.md)

---
*Phase: 07-private-channel-keying*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: packages/concord/src/client/community.ts
- FOUND: packages/concord/src/client/__tests__/community.test.ts
- FOUND: .planning/phases/07-private-channel-keying/07-04-SUMMARY.md
- FOUND commit: 01b5c420
- FOUND commit: 129e141d
