---
phase: 08-rotation-robustness-consensus
plan: 06

# Dependency graph
requires:
  - phase: 08-rotation-robustness-consensus (08-01, 08-03, 08-05)
    provides: isStrictlyLowerKey ordering centralization, decrypt-throw/opaque-candidate partition in readRekeyScoped, and vac citation/verification wired through refound/rotateChannel
provides:
  - "buildRefounding aborts (throws) before any compactionWraps are returned when a Control head can't be re-wrapped into the new epoch — no partial compaction ships"
  - "held_roots entries carry an optional per-epoch refounder; buildChain attributes each synthesized epoch's refounder from its OWN held_roots entry instead of the tip's"
affects: [phase-09-authority-fold, foldMembers-snapshot-authorization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional object fields are only ever set when they have a value (never `field: undefined`) — applesauce-core's EventStore.model() caches by a value-based hash (hash_sum(args)), and an explicit `undefined` key changes that hash even though the JSON form is unchanged, silently defeating cache reuse downstream"

key-files:
  created: []
  modified:

key-decisions:
  - "buildRefounding's compaction loop throws (not continues/swallows) on any non-plaintext or un-rewrappable Control head — buildRefounding is awaited before refound() publishes anything, so the throw aborts the whole Refounding atomically (CORD-06 §3)"
  - "held_roots.refounder and buildChain's per-epoch refounder are only ever SET when they have a value — omitted (not `undefined`) otherwise, to keep JoinMaterial's object shape stable for the common no-refounder case and avoid changing applesauce-core's model-cache hash for content-identical materials"

requirements-completed: [ROTATE-12, ROTATE-13]

coverage:
  - id: D1
    description: "buildRefounding aborts before any publish when a Control head cannot be re-wrapped into the new epoch (no partial compactionWraps ships), with a positive control proving all-foldable heads still compact cleanly"
    requirement: "ROTATE-13"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D2
    description: "held_roots entries carry an optional per-epoch refounder; buildChain attributes each synthesized historical epoch's refounder from its OWN held_roots entry (genesis undefined) instead of spreading the tip's refounder onto every epoch"
    requirement: "ROTATE-12"
    verification:
      - kind: unit
        status: pass
      - kind: unit
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 06: Fail-closed Refounding compaction and per-epoch refounder attribution Summary

**buildRefounding now aborts atomically before publishing when a Control head can't be re-wrapped, and held_roots/buildChain attribute each historical epoch's refounder to whoever actually minted it instead of inheriting the tip's.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-07-19T14:44:39Z
- **Completed:** 2026-07-19T15:01:15Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Two new spec-derived oracles: `keys.test.ts` proves `buildRefounding` rejects (no plan) on an unfoldable head with an all-plaintext positive control; `sync.test.ts` proves `buildChain` attributes a hand-constructed 4-epoch chain's refounders correctly (genesis undefined, epoch 1 ≠ tip's refounder).

## Task Commits

Each task was committed atomically:

1. **Task 1: buildRefounding aborts on any unfoldable Control head (ROTATE-13, D-01)** - `f0ff2430` (fix)
2. **Task 2: Per-epoch refounder attribution (ROTATE-12, L01)** - `8fffd27c` (feat)
3. **Task 3: Spec-derived oracles — abort-on-unfoldable-head and per-epoch refounder** - `8ed4c340` (test)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified

## Decisions Made
- `buildRefounding` throws rather than returning a sentinel/error-result — matches the plan's explicit acceptance criteria ("the throw is reachable before any `compactionWraps` are returned") and the existing codebase convention of throwing for pre-publish abort conditions (e.g. `refound()`'s outrank check).
- `refounder` is only ever set as an object property when it has an actual string value, never as an explicit `refounder: undefined` — discovered necessary when the naive always-set-the-key approach broke `client.test.ts`'s `communityListDirty$` test by changing `applesauce-core`'s `EventStore.model()` cache key (`hash_sum(args)`) for a content-identical (but shape-different) `material` object, causing a stale cached model subscription to NOT be reused where the test's dirty-detection relies on it staying stale. Omitting the key when undefined keeps `JoinMaterial`'s shape unchanged for the common no-refounder case (genesis, or materials predating this field) and avoids perturbing that unrelated caching behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit `refounder: undefined` broke an existing model-cache-reuse test**
- **Found during:** Task 2 (per-epoch refounder attribution)
- **Fix:** Both `rollForward`'s `held_roots` push and `buildChain`'s per-epoch synthesis now conditionally spread `{ refounder: value }` only when the value is not `undefined`, mirroring how every other optional `JoinMaterial` field already behaves (absent when unset, never an explicit `undefined` key).
- **Committed in:** 8fffd27c (Task 2 commit)

**2. [Rule 1 - Bug] Existing D-04 cascade test assertion needed updating for the new held_roots shape**
- **Found during:** Task 2 (per-epoch refounder attribution)
- **Issue:** `sync.test.ts`'s pre-existing "re-reads a known epoch's rekey plane; a late-arriving strictly-lower sibling cascades into N+2" test asserted `held_roots` entries without a `refounder` field — now failing since `buildChain`/`rollForward` correctly populate it for a real (non-genesis) epoch.
- **Fix:** Updated the assertion to expect `{ epoch: 1, key: bytesToHex(lowKey), refounder: memberPub }` (hand-traced from the test's own `rollForward(keys0, lowKey, 1, memberPub, [])` call) and `{ epoch: 0, key: material0.community_root, refounder: undefined }` for genesis.
- **Verification:** Test passes; the fix is a direct, hand-derived consequence of Task 2's own change, not a new behavior.
- **Committed in:** 8fffd27c (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs surfaced by, and test alignment required for, Task 2's own change)
**Impact on plan:** Both fixes were necessary to keep the existing test suite green and to make the new per-epoch refounder field behave correctly for the common (no-refounder) case. No scope creep — no architectural changes.

## Issues Encountered

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROTATE-12 and ROTATE-13 are both satisfied; Phase 8's rotation-robustness-consensus work is complete pending a final phase-level review.
- `foldMembers`' snapshot-authorization gate (`guestbook.ts:89`) now receives a genuinely per-epoch `refounder` from every caller in this chain (`syncEpoch` via `epochMaterial.refounder`), closing the forged-roster vector the moment any historical epoch's fold surfaces.
- No blockers for Phase 9.

---
*Phase: 08-rotation-robustness-consensus*
*Completed: 2026-07-19*

## Self-Check: PASSED

All created/modified files confirmed present on disk; all three task commits (f0ff2430, 8fffd27c, 8ed4c340) confirmed in git log.
