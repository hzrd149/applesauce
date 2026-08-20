---
phase: 17-correctness-fixes-concord-residuals
plan: 05
subsystem: concord-invites
tags: [concord, invites, relay-publication, aggregate-error, tdd]
requires:
  - phase: 17-correctness-fixes-concord-residuals
    provides: Concord AUTH/UI boundary and prior Phase 17 correctness fixes
provides:
  - Any-ack multi-relay invite revocation validation with retained response evidence
  - Ordered bundle, registry, and private Invite List revocation side effects
  - Empty, all-failed, partial-success, and unregister-failure regressions
affects: [concord, invites, relay-publication, event-store]
tech-stack:
  added: []
  patterns: [required relay acknowledgement, stage-labelled aggregate errors, network-before-local mutation]
key-files:
  created:
    - packages/concord/src/client/revocation.ts
    - .changeset/concord-honest-invite-revocation.md
  modified:
    - packages/concord/src/client/admin.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/client/invite-manager.ts
    - packages/concord/src/client/__tests__/client.test.ts
key-decisions:
  - "A revocation publication succeeds when any relay returns ok:true; empty and all-failed response sets retain every response in an AggregateError."
  - "Registry unregister uses a dedicated required-ack control-plane path while ordinary control operations keep their existing optimistic behavior."
patterns-established:
  - "Required remote side effects publish and validate before their corresponding local EventStore mutations."
requirements-completed: [RESID-02]
duration: 9min
completed: 2026-08-20
status: complete
---

# Phase 17 Plan 05: Honest Invite Revocation Summary

**Invite revocation now reports success only after an acknowledged bundle publication and, for members, an acknowledged registry unregister.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-20T12:15:50Z
- **Completed:** 2026-08-20T12:24:11Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added one internal any-ack gate that rejects empty and all-failed relay outcomes with stage and per-relay evidence.
- Delayed membership-free local bundle and private Invite List tombstones until bundle publication succeeds.
- Ordered member revocation as bundle publish, local bundle add, acknowledged registry unregister, private-list tombstone, then `revoked:true`.
- Added focused failure matrices, local-state assertions, ordering checks, and a RESID-02-only changeset.

## Task Commits

1. **Task 1 RED: Membership-free failure tracer** - `e29bf2a9` (test)
2. **Task 1 GREEN: Membership-free publication gate** - `d40da112` (fix)
3. **Task 2 RED: Member ordering regressions** - `b8e0090e` (test)
4. **Task 2 GREEN: Ordered member revocation** - `995be88f` (fix)
5. **Task 2 fix: Internal helper boundary** - `0718c8cb` (fix)
6. **Task 3: RESID-02 changeset** - `eac1e2c6` (chore)

## Files Created/Modified

- `packages/concord/src/client/revocation.ts` - Internal aggregate error and any-ack assertion.
- `packages/concord/src/client/admin.ts` - Required-ack registry unregister publication seam.
- `packages/concord/src/client/community.ts` - Ordered member revocation and strict control publication.
- `packages/concord/src/client/invite-manager.ts` - Network-first membership-free revocation.
- `packages/concord/src/client/__tests__/client.test.ts` - Failure, partial-success, and local-state regressions.
- `.changeset/concord-honest-invite-revocation.md` - Single-sentence Concord patch notice.

## Decisions Made

- Kept the structured helper internal so RESID-02 does not expand Concord's public export surface.
- Preserved ordinary optimistic control-plane publishing and used strict acknowledgement only for invite-registry unregister.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added an acknowledged registry-unregister path**
- **Found during:** Task 2
- **Issue:** `unregisterInviteLink()` previously returned after launching a best-effort publish, so member revocation could resolve before the registry stage succeeded.
- **Fix:** Added an opt-in required-ack publisher for registry unregister and delayed its local echo until a relay accepts it.
- **Files modified:** `packages/concord/src/client/admin.ts`, `packages/concord/src/client/community.ts`
- **Verification:** Unregister rejection regression and full Concord suite pass.
- **Commit:** `995be88f`

**2. [Rule 1 - Bug] Prevented accidental public export growth**
- **Found during:** Task 3 full Concord suite
- **Issue:** Defining the shared helper in `invite-manager.ts` exposed two unplanned public symbols and broke the export snapshot.
- **Fix:** Moved the helper and error into an unexported internal client module.
- **Files modified:** `packages/concord/src/client/revocation.ts`, `packages/concord/src/client/invite-manager.ts`, `packages/concord/src/client/community.ts`
- **Verification:** Export snapshot, focused revocation tests, build, and full suite pass.
- **Commit:** `0718c8cb`

**Total deviations:** 2 auto-fixed (1 missing critical functionality, 1 bug). **Impact:** Both changes enforce the locked success contract without broadening the public API or unrelated publish semantics.

## Issues Encountered

The first full suite exposed the helper's accidental barrel export; moving it to an internal module restored the exact public surface.

## Verification

- Focused revocation suite: 8 passed.
- Full `applesauce-concord` suite: 601 passed across 55 files.
- `applesauce-concord` build: passed.
- `applesauce-relay`: 313 passed.
- `applesauce-sqlite`: 63 passed, 2 skipped.
- `applesauce-common`: 545 passed.
- Workspace build: 18/18 tasks passed.
- Mutation check: replacing the any-ack predicate with unconditional resolved-array success failed all three empty/all-failed safeguards.
- Changeset shape: exactly one Markdown sentence.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 17 is complete and its five correctness requirements are covered by focused and workspace-wide gates.

## Self-Check: PASSED

- All six created/modified artifacts exist.
- All six task commits exist in git history.
- Focused, package, workspace, changeset, and mutation gates passed.

---
*Phase: 17-correctness-fixes-concord-residuals*
*Completed: 2026-08-20*
