---
phase: quick-261009-kku
plan: 01
subsystem: react
tags: [react, hooks, rxjs, useObservableState]
key-files:
  modified:
    - packages/react/src/hooks/use-observable-state.ts
    - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
  created:
    - .changeset/observable-state-function-values.md
decisions:
  - Store observable values via the setState updater form so function values are never called by React
metrics:
  tasks: 2
  completed: 2026-10-09
status: complete
---

# Quick 261009-kku: useObservableState function values Summary

`useObservableState` now stores observable values through `setState(() => value)`, so function-valued emissions such as timeline loaders are returned by reference instead of being invoked as React updaters.

## Commits

- 866d9701: test - three failing regression tests (sync mount + later emission, async emission, source replacement)
- 7fffaa3b: fix - updater form at the source-change, missed-value, and `onValue` setter sites (values captured in a local const so the closure cannot read a later-mutated `latestValue`)
- Changeset commit: patch changeset for `applesauce-react` (see git log)

## Verification

- RED: 3 new tests failed before the fix; GREEN: all 10 tests in the file pass.
- Full `applesauce-react` suite: 7 files, 19 tests pass; `tsc --noEmit` clean.

## Deviations from Plan

- [Rule 3 - Blocking] The worktree had no built sibling packages, so the exports tests and `tsc` initially failed on unresolved `applesauce-core`/`applesauce-content`. Ran `pnpm --filter "applesauce-react^..." build` (build outputs are gitignored); no source change.

## Known Stubs

None.

## Self-Check: PASSED
