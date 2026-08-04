---
phase: 12-document-caps-conformance
plan: 02
subsystem: dependencies
tags: [nostr-tools, nip-44, encryption, vitest, monorepo-dependency-bump]

# Dependency graph
requires:
  - phase: 12-document-caps-conformance (plan 01)
    provides: CORD-02 cap literals, section registry, and citation scanner substrate other 12-xx plans assert against (not consumed directly by this plan)
provides:
  - nostr-tools bumped to ^2.24 in packages/core, packages/common, packages/relay, deduplicated to a single installed 2.24.1 instance
  - A behavioral regression test in packages/core proving a 70,000-byte NIP-44 plaintext round-trips past the old 65,535-byte ceiling
  - Runtime evidence that D-07's premise (the byte ceiling moved upstream) is real, not merely un-enforced in concord
affects: [12-04, 12-05, 12-06, 12-09, any future concord/core encryption work]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Non-vacuity RED/GREEN proof via temporary manifest revert + reinstall rather than a mocked library boundary"]

key-files:
  created: []
  modified:
    - packages/core/package.json
    - packages/common/package.json
    - packages/relay/package.json
    - pnpm-lock.yaml
    - packages/core/src/helpers/__tests__/encryption.test.ts

key-decisions:
  - "All three manifests moved to the identical ^2.24 range in one commit so pnpm dedupes to a single installed nostr-tools instance (verified via node_modules symlink resolution, not just manifest text)"
  - "Test lives in packages/core, not packages/concord, since concord declares no direct nostr-tools dependency and only reaches nip44 through core's re-export"
  - "Comment attributes the byte figure to CORD-02 Appendix B and corrects D-11's superseded claim per D-25: the maxPlaintextSize fix landed in nostr-tools 2.23.4, not 2.24.0"

patterns-established:
  - "Non-vacuity revert-reinstall-observe-restore cycle for a transitive dependency behavior change, mirroring the in-place source revert precedent from Phase 10/11 plans but applied to a package manifest instead of a source file"

requirements-completed: [WIRE-08]

coverage:
  - id: D1
    description: "nostr-tools bumped to ^2.24 across packages/core, packages/common, packages/relay; lockfile updated; installed version resolves to 2.24.1 for all three; packages/concord still declares no direct nostr-tools dependency"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-core test / applesauce-common test / applesauce-relay test / applesauce-concord test (all four suites green: 671/533/150/507 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A 70,000-byte NIP-44 plaintext (past the old 65,535-byte ceiling) round-trips through encrypt/decrypt via packages/core's nip44 re-export, proven RED against the pre-bump library and GREEN against ^2.24"
    requirement: "WIRE-08"
    verification:
      - kind: unit
        ref: "packages/core/src/helpers/__tests__/encryption.test.ts#nip44 plaintext ceiling > round-trips a plaintext over the old 65,535-byte ceiling"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-30
status: complete
---

# Phase 12 Plan 02: nostr-tools ^2.24 Bump + NIP-44 Ceiling Regression Test Summary

**Bumped `nostr-tools` to `^2.24` across core/common/relay and pinned the lifted 65,535-byte NIP-44 plaintext ceiling with a RED-then-GREEN regression test proving the old library throws and the new one round-trips.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-30T09:58:43Z
- **Completed:** 2026-07-30T10:04:39Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- All three affected manifests (`packages/core`, `packages/common`, `packages/relay`) now pin `nostr-tools` at the identical `"^2.24"` range; `pnpm install` deduplicates them to a single installed `nostr-tools@2.24.1` instance (confirmed via `node_modules` symlink resolution in each package, not just manifest text)
- `packages/concord` still declares zero direct `nostr-tools` dependency (grep-confirmed)
- All four affected suites are green post-bump: `applesauce-core` 671/671, `applesauce-common` 533/533, `applesauce-relay` 150/150, `applesauce-concord` 507/507
- New `nip44 plaintext ceiling` test in `packages/core/src/helpers/__tests__/encryption.test.ts` builds a 70,000-ASCII-character (70,000-UTF-8-byte) plaintext, asserts its measured byte length inline (`new TextEncoder().encode(...).length`) exceeds 65,535, encrypts it, decrypts it, and asserts byte-identical round-trip — with zero assertions against any library constant (`maxPlaintextSize`/`extendedPrefixThreshold` appear only in the explanatory comment)
- Non-vacuity proven empirically, not just asserted: reverted all three manifests to their pre-bump ranges (`~2.19`/`^2.19`/`~2.19`), reinstalled (confirmed installed `nostr-tools@2.19.4`), ran the new test — it failed with the pre-bump library's own error, `Error: invalid plaintext size: must be between 1 and 65535 bytes`. Restored `^2.24` via `git checkout --`, reinstalled (confirmed `nostr-tools@2.24.1` restored, `pnpm-lock.yaml` diff-clean against the committed state), reran the test — it passed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bump nostr-tools to ^2.24 in core, common, and relay; reinstall; run all four affected suites** - `e1f2451a` (feat)
2. **Task 2: Pin the lifted NIP-44 plaintext ceiling with a behavioral round-trip test** - `f0023ac6` (test)

**Plan metadata:** committed separately after this SUMMARY (docs: complete plan)

_Note: Task 2 is a single `test` commit — no separate `feat`/implementation commit was needed since the behavior being pinned already exists upstream in nostr-tools 2.24.1; the non-vacuity RED/GREEN cycle was performed via a temporary, reverted manifest edit rather than a committed implementation step._

## Files Created/Modified
- `packages/core/package.json` - `nostr-tools` range `~2.19` → `^2.24`
- `packages/common/package.json` - `nostr-tools` range (devDependencies) `^2.19` → `^2.24`
- `packages/relay/package.json` - `nostr-tools` range `~2.19` → `^2.24`
- `pnpm-lock.yaml` - resolved lockfile update; installed `nostr-tools` deduplicates to `2.24.1` for all three consuming packages
- `packages/core/src/helpers/__tests__/encryption.test.ts` - added `nip44 plaintext ceiling` describe block with the 70,000-byte round-trip regression test

## Decisions Made
- Confirmed via `node_modules` symlink resolution (not manifest grep alone) that core, common, and relay each resolve to the identical installed `nostr-tools@2.24.1`, satisfying the plan's runtime-not-just-manifest verification requirement
- Followed the plan's explicit citation discipline: the test comment attributes the byte figure to CORD-02 Appendix B, states NIP-44's own `max_plaintext_size` is now 4294967295 with `extended_prefix_threshold` = 65536, and corrects D-11's superseded claim per D-25 — the `maxPlaintextSize` fix landed in nostr-tools 2.23.4, not 2.24.0 (the target range `^2.24` is unchanged by that correction)
- Performed the non-vacuity RED/GREEN cycle via `git checkout -- <file>` restore (not `git stash`, which is prohibited in this executor's git safety rules) since Task 1's commit already held the target `^2.24` state to restore back to

## Deviations from Plan

None - plan executed exactly as written. No `.changeset/` file created, per D-19 (`applesauce-concord` unreleased in this milestone).

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- D-07's premise (the byte ceiling moved upstream, not merely un-enforced) is now demonstrable at runtime through the exact module every `PrivateKeySigner`-based concord consumer resolves
- Plans 12-03/12-04/12-05 (which remove concord's own byte-cap enforcement per D-07/D-08/D-19) can proceed without risk of relocating the refusal into a still-pinned-below-2.23.4 `nostr-tools`
- No blockers for subsequent wave-1/wave-2 plans in this phase

---
*Phase: 12-document-caps-conformance*
*Completed: 2026-07-30*

## Self-Check: PASSED

All created/modified files found on disk; both task commits (`e1f2451a`, `f0023ac6`) confirmed present in git log.
