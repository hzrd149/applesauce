---
phase: 15-concord-stream-auth-cleanup
plan: 10
subsystem: auth
tags: [nip-42, debug-logger, concord, observability, stream-signers]

# Dependency graph
requires:
  - phase: 15-concord-stream-auth-cleanup
    provides: "StreamSigners (D-06), the scope-owned signer holder auth.ts already defines, and its onAuthFailure sink shape (D-13) community.ts/private-channel.ts already use"
provides:
  - "A total-answering-failure report on StreamSigners.onAuthRequired — the CR-01 detection backstop (WR-03)"
  - "ConcordInviteManager's holder now wired with an onAuthFailure sink onto its own :invite logger (WR-04)"
affects: [15-14, concord-stream-auth-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Total-failure-over-non-empty-request as the reporting condition, distinct from any-failure — keeps the union-widened cross-scope isolation oracle quiet while making a registration gap loud on first occurrence"

key-files:
  created: []
  modified:
    - packages/concord/src/client/auth.ts
    - packages/concord/src/client/invite-manager.ts
    - packages/concord/src/client/__tests__/auth.test.ts
    - packages/concord/src/client/__tests__/client.test.ts

key-decisions:
  - "failNoSigner is a sibling private method to fail(), not a reuse of fail()'s per-pubkey shape — the two messages mean different things (relay refusing a correct signature vs. this scope being unable to sign at all) and must stay distinguishable"
  - "StreamSigners construction moved from a field initializer into ConcordInviteManager's constructor body (after this.log is assigned) — the only way to close the onAuthFailure gap without breaking the class's existing field/constructor separation"
  - "The new client.test.ts case isolates the bundle-revocation publish from the invite-list save publish by author (invite-LINK pubkey vs. user pubkey) since revoke() also tombstones and saves, recording two publishes, not one"

patterns-established:
  - "Total-failure guard (Array.isArray(missingPubkeys) && length > 0 && answered === 0) as the reporting condition for a per-operation-scoped signer holder — any future StreamSigners-shaped holder should reuse this exact guard rather than reporting on any partial miss"

requirements-completed: [CAUTH-01]

coverage:
  - id: D1
    description: "A holder that answers none of a non-empty missingPubkeys emits a distinct :auth trace and an onAuthFailure message; a partial answer and a null missingPubkeys request stay silent"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/auth.test.ts#StreamSigners.onAuthRequired total answering failure"
        status: pass
      - kind: unit
        ref: "packages/concord/src/client/__tests__/community.test.ts (union-widened two-scope isolation oracle)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ConcordInviteManager's holder reports a rejected invite-link AUTH during revokeBundle() on its own :invite logger"
    requirement: "CAUTH-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/client/__tests__/client.test.ts#revokeBundle's rejected invite-link AUTH reports on the invite manager's own logger (T-15-26/WR-04)"
        status: pass
    human_judgment: false

# Metrics
duration: ~35min
completed: 2026-08-18
status: complete
---

# Phase 15 Plan 10: Auth Failure Reporting (WR-03/WR-04) Summary

**A total-answering-failure on `StreamSigners.onAuthRequired` now emits a `:auth` trace and an `onAuthFailure` message, and `ConcordInviteManager`'s holder reports rejected invite-link AUTHs on its own logger — closing the two places a NIP-42 auth problem could disappear without a trace.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-18T09:46:24Z (per STATE.md session start)
- **Completed:** 2026-08-18T09:56:08Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `StreamSigners.onAuthRequired` now tracks how many requested pubkeys it actually answered; when `missingPubkeys` is a non-empty array and the answered count is zero, it reports through both the module-level `:auth` tracer and `onAuthFailure` with a message distinguishable from the existing per-pubkey "relay rejected the AUTH" text
- A partial answer (this scope owns some but not all of a union-widened request) and a `null` `missingPubkeys` (the client-wide user-auth path) both stay silent, verified against the pre-existing union-widened two-scope isolation oracle in `community.test.ts`
- `ConcordInviteManager`'s `signers` field construction moved from a field initializer into the constructor body (after `this.log` is assigned) so it can pass an `onAuthFailure` sink wired to `this.log` — closing the last of the three in-package `StreamSigners` construction sites that lacked one
- A new `client.test.ts` case drives the real `revokeBundle()` publish path with a rejected AUTH and asserts the manager's logger spy received a message containing `invite-link auth failed`

## Task Commits

Each task was committed atomically:

1. **Task 1: Make a total answering failure loud on the holder** - `93effa69` (feat)
2. **Task 2: Give the invite manager's holder a failure sink** - `0cf9cbcf` (feat)

_No plan-metadata commit issued in worktree mode — the orchestrator handles shared-file writes after merge._

## Files Created/Modified
- `packages/concord/src/client/auth.ts` - `onAuthRequired` now counts answered pubkeys and calls a new private `failNoSigner()` on total failure over a non-empty request; doc comment states the new invariant
- `packages/concord/src/client/invite-manager.ts` - `signers` field declaration split from its initialization; construction moved into the constructor body with `onAuthFailure: (message) => this.log("invite-link auth failed: %s", message)`
- `packages/concord/src/client/__tests__/auth.test.ts` - three new cases: total failure reports and skips `relay.authenticate`, partial success stays quiet, `null` `missingPubkeys` stays quiet
- `packages/concord/src/client/__tests__/client.test.ts` - one new case constructing a `ConcordInviteManager` directly with an injected logger spy and a rejected-AUTH pool, driving `revokeBundle()`'s real publish path

## Decisions Made
- `failNoSigner` is a sibling private method to the existing `fail()`, not a reuse of its per-pubkey message shape — the two report different failure modes and must read as distinguishable to a developer scanning the `:auth` namespace (per the plan's explicit instruction)
- The invite-manager test isolates the bundle-revocation publish record from the invite-list save publish by comparing `event.pubkey` against the invite-link's `signerPubkey` — `revoke()` calls `tombstone()` → `save()` after `revokeBundle()`, so two publishes are recorded, not the one a naive `recorded[0]` assumption would expect

## Deviations from Plan

None — plan executed as written. One test-construction detail not specified by the plan (isolating the bundle-revocation publish from the invite-list save publish, both fired by `revoke()`) was resolved during Task 2 by asserting on publish author rather than array index; this is a test-correctness detail, not a behavior change, and is documented above under Decisions Made rather than as a deviation.

## Issues Encountered
- `pnpm vitest run` initially failed with "Cannot find package 'applesauce-core/helpers/keys'" / "Failed to resolve entry for package 'applesauce-signers'" — the workspace's `dist/` outputs for `applesauce-core`, `applesauce-signers`, `applesauce-common`, `applesauce-relay`, and `applesauce-loaders` were stale/absent in this worktree checkout. Resolved by running `pnpm --filter <pkg> build` for each before running concord's test suite; not a code defect, just a build-order prerequisite for a fresh worktree.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- WR-03 and WR-04 both closed; the `StreamSigners`/invite-manager auth-failure reporting surface named in this plan's `must_haves` is fully wired and test-pinned
- No new gaps surfaced during this plan's execution — `pnpm --filter applesauce-concord test` is green at 588 passed / 0 skipped across 55 files, and `pnpm --filter applesauce-concord build` exits 0
- Remaining phase-15 gap-closure plans (15-11 through 15-14) are unaffected by this plan's scope and can proceed independently

---
*Phase: 15-concord-stream-auth-cleanup*
*Completed: 2026-08-18*

## Self-Check: PASSED

All claimed files exist (auth.ts, invite-manager.ts, auth.test.ts, client.test.ts, this SUMMARY.md) and both task commit hashes (93effa69, 0cf9cbcf) resolve in git log.
