---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
plan: 03
subsystem: examples
tags: [worker-relay, web-worker, sqlite, opfs, react]

requires:
  - phase: 25-01
    provides: React 19 examples baseline and approved dependency state
provides:
  - Both worker-relay examples compile and initialize against @snort/worker-relay 2.0.1
  - Actionable worker initialization, cache query, search, import, and clear recovery states
  - Browser-verified preservation of cache-relay.db and relay.db workflows
affects: [applesauce-examples, phase-26-release-coordination]

tech-stack:
  added: ["@snort/worker-relay@2.0.1"]
  patterns: [settled worker initialization gate, operation-specific retry state, non-destructive OPFS migration]

key-files:
  created: []
  modified:
    - apps/examples/package.json
    - apps/examples/src/examples/cache/worker-relay.tsx
    - apps/examples/src/examples/database/worker-relay.tsx
    - apps/examples/src/routes/example.tsx
    - pnpm-lock.yaml

key-decisions:
  - "Initialize each worker relay through a retained promise and render its route only after readiness, so failures settle into an actionable reload state instead of rejecting module evaluation."
  - "Keep the existing cache-relay.db and relay.db names and rely on worker-relay's migration path without clearing or replacing OPFS data."

patterns-established:
  - "Async example initialization resolves through explicit ready/error route wrappers before database-backed children mount."
  - "Operation errors preserve rendered results and expose retry controls owned by the failed operation."

requirements-completed: [ECO-03]

coverage:
  - id: D1
    description: Both examples compile against locked worker-relay 2.0.1 without removed init options or promise-dependent metadata usage.
    requirement: ECO-03
    verification:
      - kind: integration
        ref: "pnpm install --frozen-lockfile && pnpm --filter applesauce-examples build"
        status: pass
    human_judgment: false
  - id: D2
    description: Existing OPFS cache and database content remains queryable across the v2 migration and all interactions remain usable.
    requirement: ECO-03
    verification:
      - kind: manual
        ref: "Browser smoke of cache/worker-relay and database/worker-relay routes"
        status: pass
    human_judgment: true
  - id: D3
    description: Initialization and operation failures settle into exact actionable recovery states without erasing existing results.
    requirement: ECO-03
    verification:
      - kind: other
        ref: "Exact-copy and recovery-control structural audit plus browser smoke"
        status: pass
    human_judgment: true

duration: 8min
completed: 2026-09-03
status: complete
---

# Phase 25 Plan 03: Worker Relay v2 Example Migration Summary

**Both browser worker integrations now run on worker-relay 2.0.1 with non-destructive OPFS continuity, settled initialization, and operation-specific recovery controls.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-09-03T15:30:59Z
- **Completed:** 2026-09-03T15:38:15Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Upgraded only `applesauce-examples` to `@snort/worker-relay` 2.0.1 and removed both obsolete `insertBatchSize` options while preserving worker imports and database names.
- Added visible initialization, cache load, database search, import, and clear recovery states with the UI contract's exact messages and retry labels.
- Preserved already-rendered results across operation failures, added the accessible `Open Event` row action name, and retained zero-result messages.
- Passed the full TypeScript/Vite build and human browser smoke against both real worker/OPFS routes.

## Task Commits

1. **Task 1: Confirm @snort/worker-relay v2 package identity** - human-approved before installation
2. **Task 2: Migrate both worker integrations and preserve recovery behavior** - `8dcf95a3` (feat)

## Files Created/Modified

- `apps/examples/package.json` - Moves the private example app to the approved worker-relay v2 range.
- `apps/examples/src/examples/cache/worker-relay.tsx` - Removes the v1 option and adds settled initialization plus cache-query retry behavior.
- `apps/examples/src/examples/database/worker-relay.tsx` - Removes the v1 option and adds initialization and operation-specific recovery controls.
- `apps/examples/src/routes/example.tsx` - Uses the React 19-compatible `ReactElement` type for dynamically loaded examples.
- `pnpm-lock.yaml` - Locks worker-relay 2.0.1 and its v2 transitive dependency graph.

## Decisions Made

- Worker initialization is retained as a module-level promise, but route content mounts only after it fulfills; rejection renders the required reload recovery UI.
- Existing OPFS database identities remain unchanged and no reset, migration screen, version badge, or storage-clearing shortcut was introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored the examples build under React 19 types**
- **Found during:** Task 2 full examples build
- **Issue:** `apps/examples/src/routes/example.tsx` referenced the removed global `JSX.Element` namespace, blocking the mandated build on the Phase 25 React 19 baseline.
- **Fix:** Replaced it with React's exported `ReactElement` type without changing route behavior.
- **Files modified:** `apps/examples/src/routes/example.tsx`
- **Verification:** `pnpm --filter applesauce-examples build` passed.
- **Committed in:** `8dcf95a3`

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking issue).
**Impact on plan:** The minimal type-only correction enabled the required full build; runtime routing and public APIs are unchanged.

## Authentication Gates

None. The package-legitimacy gate was explicitly approved before dependency installation.

## User Verification

The cache and database worker-relay routes were approved in a real browser with existing OPFS data, including initialization, live/cache loading, import/search/detail/export/clear flows, empty and error states, and responsive content behavior.

## Issues Encountered

- The build emits existing Vite/plugin deprecation, sourcemap, and chunk-size warnings; none were introduced by the worker-relay migration and they do not prevent the build.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ECO-03 is complete. Both ecosystem riders are now verified and Phase 25 is ready for closeout.

## Known Stubs

None.

## Self-Check: PASSED

All five modified files exist, commit `8dcf95a3` is present, the frozen install and full examples build pass, the v2 structural/copy audits pass, and both real browser/OPFS routes received human approval.

---
*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Completed: 2026-09-03*
