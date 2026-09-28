---
phase: 26-release-coordination-v7-0-0
plan: 13
subsystem: release-coordination
tags: [wallet, node-esm, rxjs, changesets, packed-artifact]
requires:
  - phase: 26-release-coordination-v7-0-0
    plan: 12
    provides: release audit and strict-Node wallet-root blocker evidence
provides:
  - plain-Node importability for the packed applesauce-wallet root
  - subscription-time bc-ur loading with animated QR behavior retained
  - focused wallet compatibility changeset and corrected release audit
affects: [26-14, stable-v7-release, applesauce-wallet]
actuals:
  tokens: 5113
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns: [subscription-time dynamic dependency loading, packed-tarball Node import evidence]
key-files:
  created:
    - .changeset/wallet-node-root-import.md
    - .planning/phases/26-release-coordination-v7-0-0/26-13-SUMMARY.md
  modified:
    - packages/wallet/src/helpers/animated-qr.ts
    - packages/wallet/src/helpers/__tests__/animated-qr.test.ts
    - .planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md
key-decisions:
  - "Load bc-ur inside each QR observable subscription so package-root evaluation never enters its incompatible ESM graph."
  - "Keep CS-075 mechanically validated but explicitly pending Plan 26-14 human semantic acceptance."
patterns-established:
  - "Optional runtime-specific graphs can remain public while loading through RxJS defer plus switchMap at subscription time."
requirements-completed: [REL-01, REL-04]
coverage:
  - id: D1
    description: "The exact packed applesauce-wallet root imports with plain supported Node and exposes nonempty package namespaces."
    requirement: REL-01
    verification:
      - kind: integration
        ref: "phase26-wallet-node/v1 packed-tarball import under Node v26.4.0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Animated QR loading remains cold while fragment ordering, decoding progress, reconstruction, and exports remain intact."
    requirement: REL-01
    verification:
      - kind: unit
        ref: "packages/wallet/src/helpers/__tests__/animated-qr.test.ts and exports.test.ts; 99 wallet tests pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "The wallet compatibility changeset is one line and one sentence and the audit accounts for all 74 notes."
    requirement: REL-04
    verification:
      - kind: integration
        ref: "Plan 26-13 changeset parser and complete audit-path accounting command"
        status: pass
    human_judgment: true
    rationale: "Mechanical shape is proven, but Plan 26-14 owns the D-02/D-04 one-change semantic judgment."
duration: 8min
completed: 2026-09-24
status: complete
---

# Phase 26 Plan 13: Wallet Plain-Node Root Import Summary

**The packed `applesauce-wallet` root now loads under plain Node by deferring bc-ur until animated-QR subscription, with 99 wallet tests and release metadata accounting green.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-24T17:58:00Z
- **Completed:** 2026-09-24T18:05:47Z
- **Tasks:** 2
- **Files modified:** 5 including this summary

## Accomplishments

- Moved bc-ur evaluation behind RxJS subscription boundaries without changing `sendAnimated` or `receiveAnimated` signatures.
- Preserved ordered animated fragments, decode progress, token reconstruction, and public helper exports across 99 passing wallet tests.
- Imported the exact packed wallet root under Node v26.4.0 with status 0 and six nonempty namespace exports; recorded tarball SHA-256 `e52b84416b8d0de3903ef2011af57881b723c1b217c412265081cf0986fab18f`.
- Added one focused patch changeset and expanded the audit to 74 tracked notes while leaving CS-075 human semantic acceptance pending for Plan 26-14.

## Task Commits

1. **Task 1 RED: Add deferred-loading regression** — `365330ea` (test)
2. **Task 1 GREEN: Defer animated QR dependency loading** — `6050f929` (fix)
3. **Task 2: Add truthful release metadata and audit evidence** — `abc0838b` (docs)

## Files Created/Modified

- `packages/wallet/src/helpers/animated-qr.ts` — loads bc-ur from cold RxJS subscription paths.
- `packages/wallet/src/helpers/__tests__/animated-qr.test.ts` — distinguishes module import from dependency evaluation and retains behavior coverage.
- `.changeset/wallet-node-root-import.md` — one-sentence wallet patch note.
- `.planning/phases/26-release-coordination-v7-0-0/26-RELEASE-AUDIT.md` — corrected Node evidence, 74-note inventory, and pending semantic status.
- `.planning/phases/26-release-coordination-v7-0-0/26-13-SUMMARY.md` — execution outcome and coverage record.

## Decisions Made

- Used `defer(() => import(...)).pipe(switchMap(...))` for both encoding and decoding so bc-ur errors remain observable errors and each subscription retains isolated encoder/decoder state.
- Preserved the prior 73 semantic judgments as their exact pre-gap population; CS-075 is separately marked `HUMAN ACCEPTANCE PENDING` rather than inferred from parser success.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed decoder observable inference after deferred loading**
- **Found during:** Task 1 build
- **Issue:** TypeScript inferred `Observable<unknown>` through the dynamically loaded decoder branch.
- **Fix:** Declared the internal observable as `Observable<string | number>`, preserving the exported operator signature.
- **Files modified:** `packages/wallet/src/helpers/animated-qr.ts`
- **Verification:** Wallet build and all 99 wallet tests pass.
- **Committed in:** `6050f929`

**2. [Rule 3 - Blocking] Built workspace dependencies before the isolated wallet build**
- **Found during:** Task 1 verification
- **Issue:** The fresh isolated worktree had no sibling package `dist` outputs, so direct wallet compilation could not resolve workspace package exports.
- **Fix:** Ran the existing Turbo dependency build for `applesauce-wallet...`, then reran the required direct wallet build and tests.
- **Files modified:** Generated ignored build outputs only.
- **Verification:** Seven dependency builds passed, followed by the direct wallet build.
- **Committed in:** No tracked-file change required.

**3. [Rule 3 - Blocking] Resolved the worktree-safe Git evidence directory**
- **Found during:** Task 1 packed-artifact proof
- **Issue:** In a linked worktree `.git` is a file, so the plan's literal `.git/gsd-phase-26-release-evidence/...` path cannot be created beneath the checkout.
- **Fix:** Resolved the worktree administrative Git directory with `git rev-parse --absolute-git-dir` and stored the same evidence hierarchy there.
- **Files modified:** Local Git administrative evidence only.
- **Verification:** `phase26-wallet-node/v1` evidence records runtime, archive hash, status 0, and nonempty exports; extracted package and tarball were removed.
- **Committed in:** No tracked-file change required.

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking issues)
**Impact on plan:** All fixes were required for typed correctness or isolated-worktree execution; package dependencies, lockfile, protected refs, and public APIs remain unchanged.

## Issues Encountered

- Context7 was unavailable in the environment; no new or version-sensitive external API was introduced beyond existing RxJS operators already installed in the workspace.

## User Setup Required

None - no external credentials, publication, or service configuration was used.

## Verification Evidence

- `pnpm --filter applesauce-wallet build` — pass.
- Required wallet test invocation — 15 files and 99 tests passed.
- Packed root import — Node v26.4.0, status 0, six namespace exports, archive hash recorded.
- Changeset/audit gate — 74 tracked release notes accounted for; wallet release oracle includes `wallet-node-root-import` at computed `7.0.0`.
- `pnpm-lock.yaml`, `packages/wallet/package.json`, `refs/heads/next`, `STATE.md`, and `ROADMAP.md` were not modified.

## Known Stubs

None.

## Next Phase Readiness

Plan 26-14 can perform the required human semantic review over the 73 pre-gap judgments plus CS-075. The wallet supported-Node blocker is closed; no Bun or resolver override is part of the proof.

## Self-Check: PASSED

- All five created or modified tracked artifacts exist in the isolated worktree.
- Task commits `365330ea`, `6050f929`, and `abc0838b` are reachable.
- The packed-root evidence validates and protected `next` remains at the expected base.
- `.planning/STATE.md` and `.planning/ROADMAP.md` remain unchanged.

---
*Phase: 26-release-coordination-v7-0-0*
*Completed: 2026-09-24*
