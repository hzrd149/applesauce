---
phase: 05-cache-identity-memo-fix
plan: 04
subsystem: testing
tags: [concord, crypto, regression-tests, spec-derived-assertions, cache-memo, D-18]

# Dependency graph
requires:
  - phase: 05-cache-identity-memo-fix
    provides: "05-01's non-enumerable cache-memo fix in applesauce-core (BaseKeysSymbol/ChannelPlaneKeysSymbol no longer survive an object spread)"
provides:
  - "keys.test.ts case proving rollForward's control address matches the CORD-02 §4 formula, closing H01(a)"
  - "channel-rekey.test.ts case proving rollForwardChannel's plane address matches the CORD-03 §1 private-channel formula, closing H01(c)"
  - "First two spec-derived (non-self-referential) assertions in the concord test suite — the pattern 05-05's revert-probe and Phase 6+ regression guards build on"
affects: [05-05, phase-06, phase-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spec-derived expected-value pattern: import controlGroupKey/channelGroupKey directly from crypto.ts, call with the spec's raw (secret, id, epoch) tuple, and assert the implementation-under-test's output equals that — never comparing the implementation to itself (D-18)"
    - "Arm-then-roll non-vacuity pattern: derive keys from the SOURCE object first (writes the identity-cache memo), THEN roll forward — proving the assertion would have caught the pre-05-01 memo-carry bug"

key-files:
  created: []
  modified:
    - packages/concord/src/helpers/__tests__/keys.test.ts
    - packages/concord/src/helpers/__tests__/channel-rekey.test.ts

key-decisions:
  - "Placed both new cases as additional it(...) blocks in the existing describe suites rather than new files, per the plan's explicit artifact list"
  - "Used the private branch of the CORD-03 §1 formula for H01(c) (channel's own key/epoch), not the public branch (community_root/root_epoch) — getting this wrong would silently never match rather than fail loudly"

patterns-established:
  - "Every future concord regression test asserting rotation must follow arm-then-roll plus expected-value-via-crypto.ts, per D-18"

requirements-completed: [TEST-01]

coverage:
  - id: D1
    description: "H01(a): rollForward's control address matches the CORD-02 §4 formula over the new root, and differs from the pre-roll address"
    requirement: "TEST-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#rollForward's control address matches the CORD-02 §4 formula over the new root"
        status: pass
    human_judgment: false
  - id: D2
    description: "H01(c): rollForwardChannel's plane address matches the CORD-03 §1 private-channel formula over the new key/epoch, and differs from the pre-roll address"
    requirement: "TEST-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/channel-rekey.test.ts#rollForwardChannel's plane address matches the CORD-03 §1 private formula over the new key/epoch"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-15
status: complete
---

# Phase 05 Plan 04: Spec-derived H01(a)/H01(c) regression tests Summary

**Two new spec-derived assertions in the concord test suite prove rollForward and rollForwardChannel actually rotate their plane addresses, computing expected values independently from crypto.ts rather than from the code under test.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-15
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `keys.test.ts` gained a case asserting `rollForward`'s rolled-forward `.control.pk` equals `controlGroupKey(newRoot, hexToBytes(material.community_id), newEpoch)` computed directly from `crypto.ts`, and differs from the pre-roll control pk — closing CONCORD-H01(a).
- `channel-rekey.test.ts` gained a case asserting `rollForwardChannel`'s rolled `.current.pk` equals `channelGroupKey(hexToBytes(newKey), hexToBytes(channel.id), newEpoch)` (private branch) computed directly from `crypto.ts`, and differs from the pre-roll plane pk — closing CONCORD-H01(c) and the memo half of H08.
- Both cases arm the identity-cache memo (via `deriveConcordKeys`/`deriveChannelKeys` on the SOURCE object) before rolling forward, so they are non-vacuous against the pre-05-01 memo-carry bug — the memo-arming step for the channel case does not happen naturally and required a deliberate extra call per the plan.
- Neither case derives its expected value through `deriveConcordKeys`/`baseKeysFor`/`rollForward`/`deriveChannelKeys`/`rollForwardChannel` — satisfying the D-18 no-self-referential-assertion rule.

## Task Commits

Each task was committed atomically:

1. **Task 1: H01(a) — rollForward's control address matches the CORD-02 §4 formula** - `c44cb38d` (test)
2. **Task 2: H01(c) — rollForwardChannel's plane address matches the CORD-03 §1 formula** - `f9eca302` (test)

## Files Created/Modified
- `packages/concord/src/helpers/__tests__/keys.test.ts` - Added spec-derived H01(a) rollForward regression case; added `hexToBytes`, `rollForward`, `controlGroupKey` imports
- `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` - Added spec-derived H01(c) rollForwardChannel regression case; added `hexToBytes`, `channelGroupKey` imports

## Decisions Made
- None beyond the plan's explicit instructions — both tests follow the exact sequence (arm → pick fresh root/key+epoch → compute expected via crypto.ts → roll → assert equal and assert rotated) specified in the plan's `<action>` blocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built `applesauce-core`, `applesauce-common`, `applesauce-signers`, `applesauce-loaders`, `applesauce-relay` before tests would run**
- **Found during:** Task 1 verification (`pnpm --filter applesauce-concord test keys`)
- **Issue:** The workspace `dist/` output for `applesauce-core` (and its own workspace dependencies) did not exist in this worktree, so Vitest could not resolve `applesauce-core/helpers/keys`, `applesauce-core/helpers/encryption`, `applesauce-core/helpers/cache`, or `applesauce-signers` subpath/main exports. This affected all 40 concord test files, not just the two touched by this plan — a pre-existing environment gap, not something introduced by this plan's edits.
- **Fix:** Ran `pnpm --filter applesauce-core build` followed by `pnpm --filter applesauce-common --filter applesauce-loaders --filter applesauce-relay --filter applesauce-signers build` to populate each package's `dist/`.
- **Files modified:** None (build artifacts only, not committed — `dist/` is gitignored per each package's standard build output).
- **Verification:** `pnpm --filter applesauce-concord test` now passes 42/42 test files, 191/191 tests (previously 40/42 files failed to resolve imports).
- **Committed in:** N/A (no source files changed by the build; not part of either task commit).

---

**Total deviations:** 1 auto-fixed (1 blocking — pre-existing environment/build-order issue, out of this plan's file scope)
**Impact on plan:** No scope creep — this was a monorepo build-order prerequisite affecting test execution, not a plan or code change. No files owned by sibling plans (05-02, 05-03) were touched.

## Issues Encountered
None beyond the build-order deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both H01(a) and H01(c) now have permanent, non-self-referential regression guards in the concord test suite (191/191 concord tests green, full workspace unaffected).
- 05-05 can proceed to systematically prove both new cases are non-vacuous by temporarily reverting the 05-01 fix and confirming they go red.
- TEST-01 is anchored per this plan's scope (not closed — it stands across Phases 6-12 as more spec-derived tests land).
- Phase 6 inherits these two cases as regression guards when it addresses H01(b) (the epoch walk, explicitly out of scope here per D-17) and the broader memberlist/H02 work.

---
*Phase: 05-cache-identity-memo-fix*
*Completed: 2026-07-15*
