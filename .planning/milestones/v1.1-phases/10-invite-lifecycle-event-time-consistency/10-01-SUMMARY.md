---
phase: 10-invite-lifecycle-event-time-consistency
plan: 01
subsystem: concord-invites
tags: [concord, nostr, invite-bundle, input-validation, fail-closed]

# Dependency graph
requires: []
provides:
  - "validateInviteBundle rejects non-array channels/relays before any .length/.slice runs (INVITE-02/D-10)"
  - "decodeFragment rejects any fragment version not exactly FRAGMENT_VERSION, higher and lower alike (INVITE-05/D-12)"
  - "getInviteBundleVsk distinguishes absent vsk (live) from present-but-unparseable vsk (denied) (INVITE-01/D-04)"
  - "Net-new spec-derived test file helpers/__tests__/invite-bundle.test.ts, extended by 10-06 for expires_at"
affects: [10-05, 10-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed guard-before-array-method (Array.isArray before .length/.slice), same shape as AUTH-04 in control.ts"
    - "Absent-vs-malformed two-branch parse shape, mirroring hasMalformedMs in stream.ts"

key-files:
  created:
    - packages/concord/src/helpers/__tests__/invite-bundle.test.ts
  modified:
    - packages/concord/src/helpers/invite-bundle.ts

key-decisions:
  - "getInviteBundleVsk's malformed-vsk branch returns INVITE_BUNDLE_VSK_REVOKED directly (executor's discretion per D-04), so the existing isInviteBundleRevoked === REVOKED predicate needs no change"
  - "Sequenced Task 2's decodeFragment fix as a temporary revert/reapply around Task 1's commit so each task lands as an isolated, git-diff-clean commit despite both edits sharing one source file"

requirements-completed: [INVITE-02, INVITE-05, INVITE-01]

coverage:
  - id: D1
    description: "validateInviteBundle returns undefined for non-array channels or relays, before any .length/.slice executes; well-formed bundles still validate"
    requirement: "INVITE-02"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/invite-bundle.test.ts#validateInviteBundle (INVITE-02/D-10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "decodeFragment throws for any fragment version other than exactly FRAGMENT_VERSION (both higher and lower), and still decodes the current version"
    requirement: "INVITE-05"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/invite-bundle.test.ts#decodeFragment (INVITE-05/D-12)"
        status: pass
    human_judgment: false
  - id: D3
    description: "isInviteBundleRevoked denies a present-but-unparseable vsk, stays live when vsk is absent, stays joinable for a clean non-vocabulary numeric (7), and still denies vsk=9"
    requirement: "INVITE-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/invite-bundle.test.ts#getInviteBundleVsk / isInviteBundleRevoked (INVITE-01/D-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "getInviteBundleLocator produces the hand-derived (33301, link_signer, \"\") coordinate from CORD-05 §2, computed independently via getPublicKey rather than read back from the function under test"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/invite-bundle.test.ts#getInviteBundleLocator coordinate (TEST-01/D-13)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 01: Invite Bundle Fail-Closed Guards Summary

**Three fail-closed input-validation fixes on `helpers/invite-bundle.ts` — non-array `channels`/`relays`, unknown fragment versions, and malformed `vsk` — each landing with a hand-derived spec-value test in a net-new `invite-bundle.test.ts`.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-21T13:39:16Z (session start per STATE.md)
- **Completed:** 2026-07-21T13:47:44Z
- **Tasks:** 3 completed
- **Files modified:** 2 (1 modified, 1 net-new)

## Accomplishments
- `validateInviteBundle` now rejects a bundle whose `channels` or `relays` is not an array before any array method touches it (INVITE-02/D-10), closing the unbounded-allocation/substring-typed-as-array hole.
- `decodeFragment` now rejects any fragment version that isn't exactly `FRAGMENT_VERSION` — both higher and lower — instead of only rejecting lower versions, so a future v5 fragment can't be silently misdecoded against the current v4 relay dictionary (INVITE-05/D-12).
- `getInviteBundleVsk` distinguishes an absent `vsk` (stays live, CORD-05 §1 default) from a present-but-unparseable `vsk` (denies), closing the `Number("junk") → NaN → live` revocation-bypass; a clean numeric non-vocabulary value like `"7"` stays joinable (INVITE-01/D-04).
- Net-new `packages/concord/src/helpers/__tests__/invite-bundle.test.ts` with 11 spec-derived tests, including a hand-derived `(33301, link_signer, "")` coordinate assertion against `getInviteBundleLocator` computed independently via `getPublicKey`.

## Task Commits

Each task was committed atomically:

1. **Task 1: INVITE-02 — Array.isArray guard in validateInviteBundle (D-10)** - `8ea567fd` (fix)
2. **Task 2: INVITE-05 — decodeFragment rejects any unknown version (D-12)** - `efc3be82` (fix)
3. **Task 3: INVITE-01/D-04 — vsk fails closed on malformed, plus hand-derived coordinate (TEST-01)** - `34bf20bc` (fix)

**Plan metadata:** pending (docs: complete plan, this commit)

_Note: each task's non-vacuity claim was verified by hand — the guard was temporarily reverted in the working tree, the target test(s) confirmed to fail exactly as documented, then the guard restored before committing. No revert was ever itself committed._

## Files Created/Modified
- `packages/concord/src/helpers/invite-bundle.ts` - `validateInviteBundle` array-shape guard (D-10), `decodeFragment` strict version check (D-12), `getInviteBundleVsk` absent-vs-malformed branch (D-04)
- `packages/concord/src/helpers/__tests__/invite-bundle.test.ts` - net-new spec-derived test file (11 tests across 4 `describe` blocks)

## Decisions Made
- `getInviteBundleVsk`'s malformed branch returns `INVITE_BUNDLE_VSK_REVOKED` directly rather than a distinct sentinel value — the simplest conforming shape per the plan's stated executor discretion, since `isInviteBundleRevoked`'s existing `=== INVITE_BUNDLE_VSK_REVOKED` predicate then denies it with zero downstream changes.
- To keep each task's git diff isolated despite Tasks 1-3 all touching the same source file, Task 2's `decodeFragment` edit was applied after Task 1's commit (not before), and Task 3's `getInviteBundleVsk` edit after Task 2's commit — each task's non-vacuity revert/restore cycle ran against only that task's own guard.

## Deviations from Plan

None - plan executed exactly as written. All three `must_haves.truths` hold: the array guard runs before any `.length`/`.slice`; `decodeFragment` throws for both higher and lower versions; a present-but-unparseable `vsk` denies while absent stays live and a clean `7` stays joinable; the coordinate test hand-derives `(33301, link_signer, "")` per CORD-05 §2 without reading it back from `getInviteBundleLocator`.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `getInviteBundleVsk`'s absent-vs-malformed distinction is now the primitive that `joinByLink`'s collapse-then-tombstone-check rewrite (10-05, D-01..D-03) will consume on its coordinate collapse winner — the `key_links` dependency this plan's frontmatter recorded.
- `invite-bundle.test.ts` is intentionally left open for 10-06 to extend with `expires_at` unit (D-05) coverage in the same file, per this plan's `## Artifacts This Phase Produces` note.
- No blockers. Full `applesauce-concord` suite green (263/263, up from 255 pre-plan) and `pnpm --filter applesauce-concord build` (tsc) clean.

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: packages/concord/src/helpers/__tests__/invite-bundle.test.ts
- FOUND: packages/concord/src/helpers/invite-bundle.ts
- FOUND: commit 8ea567fd
- FOUND: commit efc3be82
- FOUND: commit 34bf20bc
