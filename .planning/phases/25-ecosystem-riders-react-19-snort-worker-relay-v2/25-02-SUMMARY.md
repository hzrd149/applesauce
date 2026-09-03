---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
plan: 02
subsystem: testing
tags: [react, rxjs, vitest, testing-library, github-actions]

requires:
  - phase: 25-01
    provides: React 19 workspace baseline, jsdom renderer dependencies, and initial observable fixtures
provides:
  - Renderer-backed observable replacement, error, and exact teardown evidence
  - Public provider missing-context, replacement, and nesting evidence
  - Isolated React 18 and React 19 CI compatibility legs running one identical suite
affects: [applesauce-react, phase-26-release-coordination]

tech-stack:
  added: []
  patterns: [self-closing synchronous observable probe, effect-owned retained subscription, matching-major CI dependency swap]

key-files:
  created:
    - packages/react/src/hooks/__tests__/use-$.test.tsx
    - packages/react/src/providers/__tests__/providers.test.tsx
  modified:
    - packages/react/src/__tests__/rendering-fixtures.tsx
    - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
    - packages/react/src/hooks/use-observable-state.ts
    - .github/workflows/test.yml

key-decisions:
  - "Close the synchronous render probe immediately and create the retained subscription in the effect so React Strict Mode cannot orphan render-phase work."
  - "Use one four-package no-lockfile swap in each CI leg so React runtime and type majors cannot drift apart."

patterns-established:
  - "Lifecycle assertions count per-subscription teardown and aggregate active subscriptions instead of depending on a React-major-specific mount count."
  - "Provider contracts are exercised exclusively through public consumer hooks."

requirements-completed: [ECO-02]

coverage:
  - id: D1
    description: Observable hooks adopt replacement sources, isolate stale emissions and errors, and release every subscription exactly once.
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-react test -- use-observable-state.test.tsx use-$.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: Public provider hooks preserve missing-context errors and update across replacement and nesting changes.
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "pnpm --filter applesauce-react test -- providers.test.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: CI resolves matching React runtime and type majors separately for React 18 and React 19 before running the identical package suite.
    requirement: ECO-02
    verification:
      - kind: other
        ref: "local React 18/19 four-package swaps plus workflow structural assertion"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-09-03
status: complete
---

# Phase 25 Plan 02: React Dual-Major Lifecycle Contracts Summary

**Observable lifecycle and provider contracts now run unchanged under real React 18 and React 19 dependency sets, with Strict Mode subscriptions owned and released deterministically.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-03T15:25:12Z
- **Completed:** 2026-09-03T15:29:23Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Locked synchronous/asynchronous `use$` and `useObservableState` behavior across replacement, stale emissions, active errors, unmount, and Strict Mode.
- Proved all three public provider consumers preserve exact missing-provider errors and follow replacement and nearest-provider identities.
- Added isolated React 18/19 CI legs that swap all four runtime/type packages together and execute the identical package test command.

## Task Commits

1. **Task 1: Lock hook replacement, error, and teardown behavior** - `a5e4dd06` (test)
2. **Task 2: Prove public provider contracts and run one suite in two isolated CI legs** - `35f3e004` (fix)

## Files Created/Modified

- `packages/react/src/__tests__/rendering-fixtures.tsx` - Adds controlled errors, subscription identities, teardown accounting, and a resettable error boundary.
- `packages/react/src/hooks/__tests__/use-observable-state.test.tsx` - Covers replacement, stale-source isolation, error routing, and Strict Mode teardown.
- `packages/react/src/hooks/__tests__/use-$.test.tsx` - Covers direct and factory overload lifecycle behavior.
- `packages/react/src/hooks/use-observable-state.ts` - Makes the synchronous probe self-closing and the retained subscription effect-owned.
- `packages/react/src/providers/__tests__/providers.test.tsx` - Tests missing, replacement, and nesting contracts through public hooks.
- `.github/workflows/test.yml` - Adds matching-major React 18/19 compatibility legs.

## Decisions Made

- A render-phase observable subscription cannot safely be retained because React 18 Strict Mode may discard that render without running its effect cleanup; the probe therefore closes immediately.
- CI uses the exact same package test command in both matrix legs, with one atomic four-dependency swap per leg.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prevented React 18 Strict Mode subscription leak**
- **Found during:** Task 2 local React 18 compatibility proof
- **Issue:** React 18 invoked the eager state initializer for a discarded Strict Mode render, orphaning its retained observable subscription.
- **Fix:** Closed the synchronous render probe immediately and taught the effect to replace a closed probe with its owned retained subscription.
- **Files modified:** `packages/react/src/hooks/use-observable-state.ts`
- **Verification:** Full `applesauce-react` suite and build passed under both temporary React 18 and React 19 dependency sets.
- **Committed in:** `35f3e004`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug).
**Impact on plan:** The correction is the minimum lifecycle change needed to satisfy D-08 under both supported React majors; no public API changed.

## Issues Encountered

- The plan's `read_first` named `event-store-provider.tsx`; the repository's actual implementation is `store-provider.tsx`, which was read and tested.
- Testing Library does not forward hook `initialProps` into wrapper components; provider replacement controls were moved into rerendered closure state.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ECO-02 has behavioral coverage and a dual-major CI enforcement path. Phase 25 can proceed with the worker-relay v2 rider.

## Known Stubs

None.

## Self-Check: PASSED

All six created or modified files exist, both task commits are present, the full React suite passes on the restored React 19 baseline, both temporary major swaps passed locally, and the workflow contains every required matrix/swap token.

---
*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Completed: 2026-09-03*
