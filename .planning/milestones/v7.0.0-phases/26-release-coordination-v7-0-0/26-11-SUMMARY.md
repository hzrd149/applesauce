---
phase: 26-release-coordination-v7-0-0
plan: 11
subsystem: release-coordination
tags: [changesets, snapshot-release, tarballs, consumer-install, git-restoration]
requires:
  - phase: 26-release-coordination-v7-0-0
    plan: 10
    provides: exact thirteen-package release graph and audited 73-note changeset inventory
provides:
  - immutable-next frozen full-gate and verify-only timestamped snapshot proof
  - coherent thirteen-tarball isolated consumer installation and import evidence
  - exact protected-ref, changeset, lock, config, checkout, and temporary-path restoration proof
affects: [26-12, next-snapshot, stable-v7-release]
actuals:
  tokens: 4234
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [immutable detached snapshot source, local-tarball override closure, schema-v1 restoration evidence]
key-files:
  created:
    - .planning/phases/26-release-coordination-v7-0-0/26-11-SUMMARY.md
  modified:
    - .planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md
key-decisions:
  - "Pin release inputs to refs/heads/next while retaining the mandatory dedicated executor branch for atomic evidence commits."
  - "Use consumer-local pnpm overrides so unpublished exact snapshot dependencies resolve only to the thirteen packed tarballs."
  - "Record the pre-existing Node ESM failure in @gandlaf21/bc-ur explicitly while proving the wallet root through a bundler-compatible Bun import."
patterns-established:
  - "Snapshot evidence keeps source identity, temporary identity, package coherence, and post-cleanup equality as separate fail-closed checks."
requirements-completed: [REL-01, REL-03, REL-04]
coverage:
  - id: D1
    description: "The exact next source passes the frozen full gate and non-publishing timestamped snapshot path without changing protected release state."
    requirement: REL-01
    verification:
      - kind: integration
        ref: "pnpm install --frozen-lockfile; pnpm test; pnpm build; docs/examples builds; snapshot-release.mjs --tag next --verify-only"
        status: pass
    human_judgment: false
  - id: D2
    description: "All thirteen snapshot tarballs install as one isolated consumer set at a shared timestamped version."
    requirement: REL-03
    verification:
      - kind: e2e
        ref: "13 local pnpm packs plus pnpm 11.10.0 consumer install --ignore-scripts and manifest equality checks"
        status: pass
    human_judgment: false
  - id: D3
    description: "Representative package roots load and every temporary path, protected ref, changeset, lock, config, and checkout identity is restored."
    requirement: REL-04
    verification:
      - kind: integration
        ref: "Node/Bun root imports plus schema-v1 ref/content equality and Task 2 automated verifier"
        status: pass
    human_judgment: false
duration: 12min
completed: 2026-09-24
status: complete
---

# Phase 26 Plan 11: Immutable Next Snapshot and Consumer Validation Summary

**An immutable `next` checkout passed the full 2,235-test release gate, produced thirteen coherent timestamped snapshot tarballs, installed as one isolated consumer set, and left every protected release identity unchanged.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-24T15:27:28Z
- **Completed:** 2026-09-24T15:39:18Z
- **Tasks:** 2
- **Files modified:** 1 audit file plus this summary

## Accomplishments

- Passed frozen installation, 13 package builds, 17 workspace builds, 232 test files with 2,235 passing tests, and both documentation and examples builds from a detached immutable `next` worktree.
- Produced exactly thirteen `0.0.0-next-20260924153023` tarballs and installed them together with lifecycle scripts disabled in an isolated pnpm consumer.
- Loaded the representative core, relay, common, loaders, accounts, signers, wallet, and wallet-connect roots and resolved every installed manifest to the shared snapshot version.
- Removed all consumer, tarball, evidence, worktree, and administrative paths while preserving `next`, `master`, `origin/master`, all other refs/tags, 73 changesets, lock/config bytes, and `.planning/STATE.md`.
- Per D-06, performed no npm publication, OTP use, registry write, tag, push, hosted release, or release-history rewrite.

## Task Commits

1. **Task 1: Run the complete release and snapshot path against immutable next** — `c793e9f3` (docs)
2. **Task 2: Pack all thirteen snapshots, install them together, and prove restoration** — `2b9a8dc3` (docs)

## Files Created/Modified

- `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` — immutable source, full-gate, snapshot, package, consumer, cleanup, and restoration evidence.
- `.planning/phases/26-release-coordination-v7-0-0/26-11-SUMMARY.md` — plan outcomes, coverage, deviations, and self-check.

## Decisions Made

- Used the dedicated `worktree-agent-p11` branch for mandatory commits while pinning every release input and detached snapshot operation to the identical immutable `refs/heads/next` OID.
- Added consumer-local pnpm 11 overrides only in the temporary consumer because exact timestamped internal dependencies are intentionally absent from npm until publication.
- Counted the wallet root as imported through Bun's bundler-compatible resolver and recorded Node's pre-existing `@gandlaf21/bc-ur` extensionless-ESM failure rather than hiding it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored changesets deleted by disposable snapshot versioning**
- **Found during:** Task 1 snapshot verification
- **Issue:** `changeset version --snapshot` deleted all 73 pending note files inside the disposable worktree before the retention assertion.
- **Fix:** Restored each recorded changeset path individually from the pinned `HEAD`, then rechecked all 73 SHA-256 values; `next` itself was never mutated.
- **Files modified:** Disposable worktree changesets only.
- **Verification:** Every path/hash matched schema-v1 baseline evidence before packing and cleanup.
- **Committed in:** `c793e9f3` records the resulting evidence.

**2. [Rule 3 - Blocking] Closed unpublished internal dependencies over local tarballs**
- **Found during:** Task 2 isolated consumer install
- **Issue:** Direct tarball dependencies still referenced exact timestamped sibling versions, which pnpm correctly could not find on npm because publication is forbidden.
- **Fix:** Added temporary `pnpm-workspace.yaml` overrides mapping all thirteen package names to their local tarballs and reran installation with scripts disabled.
- **Files modified:** Temporary consumer files only.
- **Verification:** pnpm installed exactly thirteen Applesauce packages at one snapshot version.
- **Committed in:** `2b9a8dc3` records the successful consumer evidence.

**3. [Rule 3 - Blocking] Used a bundler-compatible runtime for the wallet root probe**
- **Found during:** Task 2 representative imports
- **Issue:** Node rejected `@gandlaf21/bc-ur@1.1.12`'s extensionless ESM import while loading `applesauce-wallet`; the other seven required roots loaded under Node.
- **Fix:** Imported all eight roots under Bun, matching the package's successful bundler path, while retaining and documenting the Node failure as a release concern.
- **Files modified:** None.
- **Verification:** Bun loaded all eight roots with nonempty exports; Node loaded the other seven roots; the examples bundle also passed.
- **Committed in:** `2b9a8dc3` records the import evidence.

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking issues)
**Impact on plan:** Snapshot and consumer validation completed without changing source, release inputs, protected refs, or publication scope; the Node wallet-root caveat remains explicit for release review.

## Issues Encountered

- pnpm 11 no longer reads `pnpm.overrides` from `package.json`; the temporary consumer followed current pnpm settings and placed overrides in `pnpm-workspace.yaml`.
- `applesauce-wallet` cannot currently load directly under strict Node ESM because of a transitive extensionless import in `@gandlaf21/bc-ur@1.1.12`; Bun and the repository's Vite build load it successfully.

## User Setup Required

None - npm credentials and publication were deliberately not used.

## Verification Evidence

- Frozen full gate: 13/13 package builds, 17/17 workspace builds, 232 passed test files, 2,235 passed tests, docs build, and examples build.
- Snapshot verify-only gate repeated 17 workspace builds, 13 package builds, and the 2,235-test suite.
- Thirteen embedded tarball manifests and thirteen installed manifests share `0.0.0-next-20260924153023`.
- Temporary consumer, tarballs, detached worktree, worktree gitdir, and both schema-v1 JSON evidence files are absent.
- `next` remains `750fec4e93290e644aa838425a9dfcf20a0c82f1`; local `master` and `origin/master` remain `ec51f7d4ecfd3db6099e786e8eec0062255588d4`.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

## Known Stubs

None.

## Next Phase Readiness

Plan 26-12 can consume the recorded non-publishing snapshot evidence for final release-readiness review. The stable release remains a normal ancestry-preserving `next` to `master` merge, and npm publication remains outside this execution.

## Self-Check: PASSED

- The release audit and this summary exist in the dedicated worktree.
- Task commits `c793e9f3` and `2b9a8dc3` are reachable.
- All final audit markers pass, every Plan 26-11 temporary path is absent, and protected refs retain their recorded OIDs.
- `.planning/STATE.md` and `.planning/ROADMAP.md` remain unchanged from the executor base.

---
*Phase: 26-release-coordination-v7-0-0*
*Completed: 2026-09-24*
