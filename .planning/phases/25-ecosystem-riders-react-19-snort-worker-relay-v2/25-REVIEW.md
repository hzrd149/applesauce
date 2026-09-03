---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
reviewed: 2026-09-03T16:10:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - .changeset/common-falsy-app-data.md
  - .changeset/core-stamp-comment.md
  - .changeset/wallet-lock-relays.md
  - .github/workflows/test.yml
  - apps/examples/package.json
  - apps/examples/src/examples/cache/worker-relay.tsx
  - apps/examples/src/examples/database/worker-relay.tsx
  - apps/examples/src/routes/example.tsx
  - packages/common/src/helpers/__tests__/app-data.test.ts
  - packages/common/src/helpers/app-data.ts
  - packages/core/src/operations/event.ts
  - packages/react/package.json
  - packages/react/src/__tests__/rendering-fixtures.tsx
  - packages/react/src/hooks/__tests__/use-$.test.tsx
  - packages/react/src/hooks/__tests__/use-observable-state.test.tsx
  - packages/react/src/hooks/use-observable-state.ts
  - packages/react/src/providers/__tests__/providers.test.tsx
  - packages/wallet/src/helpers/__tests__/wallet.test.ts
  - packages/wallet/src/helpers/wallet.ts
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-09-03T16:10:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

The scoped React lifecycle, worker-relay examples, cache helpers, operations, tests, workflow, manifests, and changesets were reviewed at standard depth. The observable replacement path can lose values before its passive effect subscribes, and the asynchronous example loader can retain or install stale route state after navigation.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Observable replacements have an unsubscribed window that loses emissions

**File:** `packages/react/src/hooks/use-observable-state.ts:93-107`
**Issue:** On a `state$` identity change, the layout effect only changes `state$Ref`; the replacement observable is not subscribed until the later passive effect. During that interval, the old subscription is still active but its callbacks are rejected by the updated ref, while the new source has no subscription at all. Any hot-source emission from a parent/child layout effect or another task before passive effects run is permanently lost. The existing replacement test does not expose this because Testing Library's `rerender` flushes effects before returning. This is a data-loss bug in the hook's core contract.
**Fix:** Move replacement subscription setup and cleanup into an isomorphic layout effect, or implement the hook with `useSyncExternalStore` and an adapter that subscribes during React's external-store lifecycle. Add a regression component whose layout effect emits on the replacement source during the same commit and assert that the value is observed.

## Warnings

### WR-01: Asynchronous example loading is not reset, cancelled, or rejected safely

**File:** `apps/examples/src/routes/example.tsx:34-50`
**Issue:** When the route changes, the effect leaves the previous `Component`, source, and metadata in state while starting new promises. A slower promise from the previous example can then resolve after the new one and overwrite the current route with the wrong component/source. Additionally, either rejected promise is unhandled, leaving the page stuck on stale content or a spinner. This is readily triggered by navigating between examples while dynamic chunks are still loading.
**Fix:** Clear route-specific state when `example` changes, add an effect-local cancellation flag (or request generation token), ignore completions after cleanup, and handle both promise rejections by setting a visible load error. Prefer awaiting `Promise.all([example.load(), example.source()])` so component, source, and metadata are committed atomically only for the active example.

---

_Reviewed: 2026-09-03T16:10:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
