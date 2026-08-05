---
phase: 10-invite-lifecycle-event-time-consistency
plan: 04
subsystem: concord
tags: [invite-lifecycle, best-effort-batch, error-handling, refounding]

# Dependency graph
requires:
  - phase: 10-invite-lifecycle-event-time-consistency
    provides: prior plans in this phase (invite bundle vsk handling, ms-clock consistency) that this plan is independent of (wave 1, depends_on:[])
provides:
  - refreshInviteBundles is now best-effort per link, matching its own docstring
  - Regression test proving one unrebuildable link can't strand the rest of a refresh batch
affects: [invite-lifecycle-event-time-consistency, refounding]

# Tech tracking
tech-stack:
  added: []
  patterns: [per-item try/skip-and-continue over a best-effort batch]

key-files:
  created: []
  modified:
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/__tests__/community.test.ts

key-decisions:
  - "The per-link try wraps the entire build/sign/store/publish body (not just buildInviteBundle), since InviteBundleFactory.create/finalizeEvent could also throw per RESEARCH Assumption A2"
  - "Reused the existing console.warn best-effort idiom from the loop's own publish .catch rather than introducing a new error-reporting channel or custom error class"
  - "Test triggers the unrebuildable-link failure via leaveChannel (the real-world CORD-05 trigger named in the docstring) rather than hand-constructing a malformed link object"

patterns-established:
  - "Per-item try/skip-and-continue over a best-effort batch (INVITE-03/D-11): for (const item of items) { try { ...whole body... } catch (err) { console.warn(...); } } — same shape as the pre-existing .pool.publish(...).catch(...) idiom, just widened to cover the item's whole build/sign/store/publish sequence."

requirements-completed: [INVITE-03]

coverage:
  - id: D1
    description: "refreshInviteBundles wraps each link's build/sign/store/publish body in try/catch and continues on failure instead of letting one throw abort the whole loop"
    requirement: "INVITE-03"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#refreshInviteBundles skips a link that can't rebuild and still refreshes the rest (INVITE-03/D-11)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts#refreshes live invite bundles behind their URL after a Refounding (CORD-05 §2)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 04: Best-effort refreshInviteBundles Summary

**refreshInviteBundles now skips a link whose channel key was dropped instead of aborting the refresh of every subsequent link in the batch**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-21T14:04:01Z
- **Completed:** 2026-07-21T14:09:05Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `refreshInviteBundles`'s per-link loop body is now wrapped in a `try { ... } catch (err) { console.warn(...); }`, matching the function's own docstring ("Best-effort per link")
- New regression test proves a link referencing a channel we no longer hold a key for (post-`leaveChannel`) is skipped-and-warned while a second, rebuildable link still refreshes and publishes
- Non-vacuity verified by hand: temporarily reverting `community.ts` to its pre-fix state made the new test fail (the call rejected instead of resolving) — confirming the test actually exercises the fixed code path

## Task Commits

Each task was committed atomically:

1. **Task 1: INVITE-03 — per-link try/skip in refreshInviteBundles (D-11)** - `10c46b29` (fix)
2. **Task 2: INVITE-03 — spec test: one bad link does not strand the rest** - `ae518844` (test)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `packages/concord/src/client/community.ts` - `refreshInviteBundles`'s loop body now wraps build/sign/store/publish in try/catch; a throwing link is `console.warn`'d and skipped via `continue` (implicit, end of loop body) rather than aborting the `for` loop
- `packages/concord/src/client/__tests__/community.test.ts` - New `it` exercising a 2-link batch (one whose channel was left, one still rebuildable) asserting the call resolves and only the rebuildable link's bundle republishes

## Decisions Made
- The `try` covers the whole per-link body (build → sign → store → publish), not just `buildInviteBundle`, per the plan's explicit RESEARCH Assumption A2 callout that `InviteBundleFactory.create`/`finalizeEvent` could also throw
- Reused the loop's pre-existing `console.warn` best-effort idiom (no new error class/channel)
- Chose `community.leaveChannel(secret)` as the test's failure trigger over hand-constructing a malformed `ConcordInviteLink`, since it's the real voluntary-leave scenario the function's docstring is written against and exercises the actual `buildInviteBundle` throw path at `helpers/invite-bundle.ts:178`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- INVITE-03/D-11 closed: `refreshInviteBundles` is now provably best-effort per link
- No blockers for 10-05/10-06; this plan's files (`community.ts`, `community.test.ts`) are not touched by the remaining phase plans' declared `files_modified`

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED
