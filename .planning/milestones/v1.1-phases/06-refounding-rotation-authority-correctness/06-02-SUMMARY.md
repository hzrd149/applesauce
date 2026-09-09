---
phase: 06-refounding-rotation-authority-correctness
plan: 02

# Dependency graph
requires:
  - phase: 06-01
provides:
  - Epoch-scoped Guestbook plane store keying (`guestbook@<epoch>`) so a Refounding's new epoch reads only its own Joins/Leaves/Kicks/Snapshots
  - A live `observed` set scoped to current-epoch guestbook + channel stores only (control/dissolved/rekey excluded)
  - A D-03 retention trim disposing stale-epoch guestbook stores once their epoch leaves `held_roots`
  - Regression tests proving a Refounding-excluded member cannot be resurrected by a prior-epoch Join, prior-epoch observed authorship, or a keep-list built from the folded member set
  - A documented, deliberately-deferred public-channel observation residual (Open Question 1) pinned by a regression test for Phase 7
affects: [07-channel-keying, 08-rotation-robustness, 09-permission-grant-folds]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-epoch RumorStore keying: `planeStoreKey` keys a protocol plane's store by epoch only where the underlying address itself rotates with the epoch AND that plane's history must not bleed across a Refounding (guestbook); planes whose address is stable (channel) or whose fold/compaction depends on a single persistent store (control) stay un-partitioned."
    - "Narrowing `observed` composition is fail-safe: dropping a plane from the live observed set can only shrink the Complete Memberlist, never resurrect a removed member — safe to apply conservatively without a full spec audit of every consumer."

key-files:
  created:
  modified:

key-decisions:
  - "D-01/D-02: fixed ROTATE-04 (H02) via epoch-scoped store keying (guestbook@<epoch>), not a timestamp-floor heuristic — matches CORD-02 §5's 'the Guestbook rides the epoch' structural model."
  - "Live observed = current-epoch guestbook + channel stores only; control/dissolved/rekey excluded (conservative, fail-safe narrowing that avoids entangling the control-plane fold, per Claude's Discretion resolution in 06-CONTEXT.md)."
  - "helpers/guestbook.ts's foldMembers left untouched (Pitfall 3) — the `!c` forward-observation admit is spec-correct in isolation; the fix is one layer up, at the routing/observed-composition layer."
  - "D-03 retention trim added to adoptRefounding, disposing guestbook@<epoch> stores whose epoch is neither current nor in held_roots — currently a no-op in production since held_roots grows unboundedly (no compaction step yet), verified via a test that manually truncates held_roots to simulate a future compaction precondition."
  - "Open Question 1 (public-channel observed residual) resolved as: acknowledge and pin via a regression test, not fix — channel epoch-keying is explicitly Phase 7 territory."

patterns-established:

requirements-completed: [ROTATE-04, ROTATE-02]

coverage:
  - id: D1
    description: "A member with a prior-epoch Join, not kept through a Refounding, is absent from the Complete Memberlist"
    requirement: "ROTATE-04"
    verification:
      - kind: integration
        status: pass
    human_judgment: false
  - id: D2
    description: "A member with only prior-epoch observed authorship (no Join), not kept, is absent after a Refounding"
    requirement: "ROTATE-04"
    verification:
      - kind: integration
        status: pass
    human_judgment: false
  - id: D3
    description: "The NEW epoch's guestbook snapshot seeds the memberlist, not the prior epoch's"
    requirement: "ROTATE-04"
    verification:
      - kind: integration
        status: pass
    human_judgment: false
  - id: D4
    description: "A keep list built from the folded state.members cannot re-admit a member a prior Refounding dropped (D-04)"
    requirement: "ROTATE-04"
    verification:
      - kind: integration
        status: pass
    human_judgment: false
  - id: D5
    description: "A guestbook store whose epoch ages out of held_roots is disposed and removed (D-03 retention trim)"
    requirement: "ROTATE-02"
    verification:
      - kind: integration
        status: pass
    human_judgment: false
  - id: D6
    description: "foldMembers' forward-observation !c admit is characterized as spec-correct and unmodified by this fix"
    verification:
      - kind: unit
        status: pass
    human_judgment: false
  - id: D7
    description: "Open Question 1: public-channel observed residual pinned as a known, deferred-to-Phase-7 regression fixture"
    verification:
      - kind: integration
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-07-16
status: complete
---

# Phase 6 Plan 2: Guestbook Epoch-Scoping & Memberlist Correctness Summary

**Epoch-keyed Guestbook plane stores (`guestbook@<epoch>`) and a scoped live `observed` set close the ROTATE-04 memberlist-resurrection defect (H02), leaving `foldMembers` untouched per CORD-02 §5's "the Guestbook rides the epoch."**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-16T19:44:00Z
- **Completed:** 2026-07-16T20:02:57Z
- **Tasks:** 2
- **Files modified:** 6 (+ 1 changeset created)

## Accomplishments

- `client/community.ts` routes all Guestbook store access (eager construction, the `guestbookStore` getter, `rewireState`) through a new `guestbookPlaneKey()` helper resolving the CURRENT epoch, and scopes the live `observed` set to current-epoch guestbook + channel stores only (control/dissolved/rekey excluded).
- A D-03 retention trim in `adoptRefounding` disposes+deletes any `guestbook@<epoch>` store whose epoch is no longer current nor held in `material.held_roots`.
- `helpers/guestbook.ts`'s `foldMembers` is completely unmodified — confirmed via `git diff --stat`.
- Regression coverage: a ROTATE-04 test proving a prior-epoch Join or prior-epoch observed authorship cannot resurrect an excluded member; a reworked new-epoch-snapshot test proving the NEW epoch's snapshot (not the old one) seeds membership; a D-04 keep-list footgun test; a D-03 store-disposal test; a `foldMembers` forward-observation characterization test; and an explicitly-deferred Open Question 1 residual test for the public-channel observation gap.

## Task Commits

Each task was committed atomically:

1. **Task 1: Epoch-scope the guestbook plane + scope the live observed set (D-01/D-02)** - `e64b287d` (fix)
2. **Task 2: D-03 retention trim, D-04 keep-list guard test, Open-Question-1 residual test + changeset** - `ac27262a` (fix)

**Plan metadata:** (this commit, following)

## Files Created/Modified


## Decisions Made

- Epoch-scoping (D-01/D-02), not a timestamp heuristic, per CORD-02 §5's structural "the Guestbook rides the epoch" model — matches 06-CONTEXT.md's locked decisions.
- Live `observed` narrowed to current-epoch guestbook + channel stores only; control/dissolved/rekey excluded — a conservative, fail-safe choice (narrowing observed can only shrink the memberlist, never resurrect a removed member) that avoids entangling the control-plane fold with observed-authorship semantics (kept clear of Phase 8/9 territory).
- `helpers/guestbook.ts` left untouched — confirmed by `git diff --stat` showing no changes to that file across both commits.
- The D-03 retention trim was added even though no production code currently ages entries out of `held_roots` (that's future compaction work); the trim's contract is proven correct via a test that manually simulates the precondition, so the trim is ready the moment a future compaction step exists.
- The Open Question 1 public-channel observation residual is deliberately NOT fixed this phase — a regression test pins the current (undesirable but out-of-scope) behavior with an explicit Phase-7 deferral comment, per the plan's own scope boundary (no channel epoch-keying this phase).

## Deviations from Plan

None - plan executed exactly as written. The reworked `:515` test's exact mechanism (manually injecting the refounder's new-epoch snapshot rumor via `community.guestbookStore.add(...)` rather than relying on `buildRefounding`'s `snapshotWraps` being echoed through the test's inert `fakePool`) was a judgment call within the plan's own instruction to "rework the test," consistent with the plan's stated goal ("proves the NEW epoch's snapshot... seeds the memberlist") and the acceptance criteria, using the same store-injection pattern already established elsewhere in this test file (e.g. `community.controlStore.add(rumorFromTemplate(...))`).

## Issues Encountered


## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROTATE-04 (memberlist correctness) and the store half of ROTATE-02 are proven by regression tests independently reasoned from the snapshot-seeding rule, not read back from the implementation.
- The Open Question 1 public-channel residual is explicitly flagged for Phase 7 (channel epoch-keying) with a pinned regression test — Phase 7 planning should treat closing it as in-scope.
- Plan 06-03 (AUTH-01/AUTH-02 authority guards) is unblocked and has no dependency on this plan's changes.

---
*Phase: 06-refounding-rotation-authority-correctness*
*Completed: 2026-07-16*

## Self-Check: PASSED

All files created/modified confirmed present on disk; both task commits (`e64b287d`, `ac27262a`) confirmed in git log.
