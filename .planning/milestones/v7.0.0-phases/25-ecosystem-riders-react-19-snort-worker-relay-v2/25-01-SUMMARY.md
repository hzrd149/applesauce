---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
plan: 01
subsystem: testing
tags: [react-19, vitest, testing-library, jsdom, rxjs]
requires: []
provides:
  - React 19 workspace development baseline with dual-major published peer support
  - Renderer-backed synchronous and asynchronous useObservableState evidence
  - React 19-compatible examples build
affects: [25-02-react-lifecycle-matrix, react-ci]
tech-stack:
  added: ["@testing-library/react 16.3.3", "jsdom 30.0.1", "react-dom 19"]
  patterns: ["package-local jsdom renderHook tests", "controlled RxJS observable fixture"]
key-files:
  created:
    - packages/react/src/__tests__/rendering-fixtures.tsx
    - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
  modified:
    - packages/react/package.json
    - apps/examples/package.json
    - pnpm-lock.yaml
key-decisions:
  - "Keep the published React peer range at ^18.0.0 || ^19.0.0 while using React 19 for ordinary workspace development."
  - "Unwrap RelayPool group-sync messages at example call sites before applying event operators."
patterns-established:
  - "Rendering tests use Testing Library renderHook and act against the public hook in jsdom."
requirements-completed: [ECO-02]
coverage:
  - id: D1
    description: "useObservableState exposes synchronous values immediately and undefined until asynchronous emission under React 19."
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "packages/react/src/hooks/__tests__/use-observable-state.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "The committed React 19 workspace installation builds both applesauce-react and applesauce-examples."
    requirement: ECO-02
    verification:
      - kind: integration
        ref: "pnpm install --frozen-lockfile && pnpm --filter applesauce-react build && pnpm --filter applesauce-examples build"
        status: pass
    human_judgment: false
duration: 8min
completed: 2026-09-03
status: complete
---

# Phase 25 Plan 01: React 19 Rendering Baseline Summary

**React 19 workspace baseline with real jsdom-rendered observable lifecycle evidence and a green examples production build**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-03T14:50:45Z
- **Completed:** 2026-09-03T14:57:52Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Moved ordinary React package and examples development to matching React 19 runtime and type dependencies without weakening the React 18/19 peer contract.
- Proved synchronous first render and asynchronous initial-undefined behavior through Testing Library's real React DOM renderer.
- Restored the examples production build by updating React refs and existing relay sync examples to current observable message APIs.

## Task Commits

1. **Task 2 RED: Add observable rendering tests** - `074bebf6` (test)
2. **Task 2 GREEN: Establish React 19 rendering baseline** - `df3d56a0` (feat)
3. **Task 2 compatibility fix: Align examples with relay sync APIs** - `47b125f2` (fix)

## Files Created/Modified

- `packages/react/src/__tests__/rendering-fixtures.tsx` - Controlled observable fixture for renderer lifecycle tests.
- `packages/react/src/hooks/__tests__/use-observable-state.test.tsx` - Synchronous and delayed-emission rendering tests.
- `packages/react/package.json` - React 19 renderer/types plus Testing Library and jsdom development dependencies.
- `apps/examples/package.json` - Matching React 19 runtime and type ranges.
- `pnpm-lock.yaml` - Synchronized React 19 and rendering-test dependency graph.
- `apps/examples/src/examples/relay-discovery/attributes.tsx` - Nullable DOM ref typing for React 19.
- `apps/examples/src/examples/relay/completion-conditions.tsx` - Explicit subscription ref initial value.
- `apps/examples/src/examples/zap/live-graph.tsx` - Explicit force-graph ref initial value.
- `apps/examples/src/examples/negentrapy/mentions.tsx` - Extract received events from group sync messages.
- `apps/examples/src/examples/negentrapy/note-reactions.tsx` - Extract received events from group sync messages.
- `apps/examples/src/examples/negentrapy/relay-difference.tsx` - Consume negentropy rounds as an Observable.
- `apps/examples/src/examples/relay/multi-user-sync-auth.tsx` - Filter group sync results to received events.

## Decisions Made

- Retained `react: ^18.0.0 || ^19.0.0` as the published peer contract while making React 19 the package-local test and workspace baseline.
- Used a controlled RxJS Observable fixture and Testing Library `renderHook`/`act`; no custom root harness or local two-major matrix command was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated example refs for React 19 types**
- **Found during:** Task 2 examples build
- **Issue:** React 19 requires explicit ref initial values and propagates nullable DOM element types.
- **Fix:** Added explicit `undefined` initial values and corrected the nullable container ref prop.
- **Files modified:** `attributes.tsx`, `completion-conditions.tsx`, `live-graph.tsx`
- **Verification:** `pnpm --filter applesauce-examples build`
- **Committed in:** `df3d56a0`

**2. [Rule 3 - Blocking] Migrated stale relay example API usage**
- **Found during:** Task 2 examples build
- **Issue:** Four examples still treated group sync output as bare events or used the former callback/Promise negentropy API.
- **Fix:** Filtered and mapped received messages to events, and collected negentropy rounds with RxJS.
- **Files modified:** `mentions.tsx`, `note-reactions.tsx`, `relay-difference.tsx`, `multi-user-sync-auth.tsx`
- **Verification:** Full Plan 25-01 acceptance command, including examples production build.
- **Committed in:** `47b125f2`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 3)
**Impact on plan:** Compatibility fixes were required for the mandated React 19 examples build and did not alter public APIs.

## Issues Encountered

The first examples build exposed React 19 ref typing changes and stale relay API usage; both were corrected with focused compatibility edits after explicit authorization.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The renderer-backed tracer and React 19 baseline are ready for the broader lifecycle/provider matrix and React 18 CI leg in subsequent plans.

## Self-Check: PASSED

All created files and task commits were verified on disk and in git history.

---
*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Completed: 2026-09-03*
