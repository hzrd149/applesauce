---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
plan: 05
subsystem: react
tags: [react, rxjs, hooks, lifecycle, compatibility]
requires:
  - phase: 25-02
    provides: React 18/19 dependency-swap certification contract
provides:
  - Gapless observable replacement subscriptions during the React layout lifecycle
  - Ordered-sibling regression for same-commit hot replacement emissions
  - React 18 and React 19 full-suite certification evidence
affects: [applesauce-react, react-hooks, phase-25-verification]
tech-stack:
  added: []
  patterns: [isomorphic layout-effect subscription replacement, observable identity gating]
key-files:
  created: []
  modified:
    - packages/react/src/hooks/use-observable-state.ts
    - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
key-decisions:
  - "Retained observable replacement subscriptions are established in the existing isomorphic layout-effect seam."
  - "The render-time synchronous probe remains self-closing while observable identity gates isolate stale values and errors."
patterns-established:
  - "A hook-consuming sibling precedes a layout-effect emitter to test the deterministic same-commit replacement window."
requirements-completed: [ECO-02]
coverage:
  - id: D1
    description: "Hot replacement values emitted by a later sibling during the same commit are rendered without weakening stale-source isolation or teardown guarantees."
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "packages/react/src/hooks/__tests__/use-observable-state.test.tsx#subscribes to a replacement before a later sibling emits in the same commit"
        status: pass
      - kind: unit
        ref: "pnpm --filter applesauce-react test -- use-observable-state.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "The complete applesauce-react suite passes unchanged with matching React 18 and React 19 runtime/type majors."
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-react test (React 18 dependency selection)"
        status: pass
      - kind: integration
        ref: "pnpm --filter applesauce-react test (React 19 dependency selection)"
        status: pass
    human_judgment: false
duration: 3min
completed: 2026-09-03
status: complete
---

# Phase 25 Plan 05: Observable Replacement Gap Closure Summary

**Gapless layout-phase observable replacement with deterministic ordered-sibling coverage certified on React 18 and React 19**

## Performance

- **Duration:** 3 min
- **Started:** 2026-09-03T16:20:54Z
- **Completed:** 2026-09-03T16:23:01Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Moved retained replacement subscription setup into the isomorphic layout-effect lifecycle so later sibling layout emissions are observed.
- Added a renderer-backed ordering oracle that failed before the lifecycle correction and now proves the emitted replacement value renders before passive effects.
- Passed the identical 7-file, 16-test applesauce-react suite under matching React 18 and React 19 runtime/type sets, then restored a clean manifest and lockfile.

## Task Commits

1. **Task 1 RED: Expose the observable replacement commit gap** - `068a81a6` (test)
2. **Task 1 GREEN: Subscribe replacements during layout** - `3a106104` (fix)
3. **Task 2: Certify React 18 and React 19** - `61a878e2` (test)

## Files Created/Modified

- `packages/react/src/hooks/use-observable-state.ts` - Establishes retained subscriptions and callbacks during the isomorphic layout effect.
- `packages/react/src/hooks/__tests__/use-observable-state.test.tsx` - Proves ordered same-commit replacement emission while retaining error and teardown regressions.

## Decisions Made

- Reused the existing private subscription state and isomorphic layout-effect seam; no public overload or adapter contract changed.
- Kept the synchronous render probe self-closing and retained observable-identity checks for both values and errors.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The React 19 dependency-selection command resolved concrete latest versions into the temporary manifest. Restoring the committed `^19.0.0` ranges before the required frozen install produced a clean metadata diff as intended.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ECO-02 is directly certified under React 18 and React 19. ECO-03 remains satisfied by Plan 25-03, and Phase 25 is ready for verification closeout.

## Self-Check: PASSED

- Both modified source artifacts exist.
- Task commits `068a81a6`, `3a106104`, and `61a878e2` exist.
- React 18 and React 19 full-suite runs passed with clean committed dependency metadata.

---
*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Completed: 2026-09-03*
