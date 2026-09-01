---
phase: 23-group-count-isolation
plan: 04
status: complete
subsystem: relay-count
---
# Phase 23 Plan 04: Group COUNT Isolation Summary

Types and focused tests prove scalar compatibility and progressive isolation.

## Verification

- Focused Group/Pool/count tests and relay build pass.

## combineLatest RED → GREEN Evidence

- Baseline: `518386ce`.
- Mutation: replace the explicit progressive accumulator in `RelayGroup.count()` with the historical `switchMap(relays => combineLatest(Object.fromEntries(relays.map(...))))` implementation.
- Command: `pnpm --filter applesauce-relay exec vitest run src/__tests__/group-count.test.ts -t 'emits a fast partial snapshot then a cumulative slow snapshot|isolates an offline relay as an outcome while preserving success' --reporter=verbose`.
- RED: fast/slow produced no partial snapshot before the slow result, and the offline inner error escaped instead of materializing a cumulative failure outcome.
- Restore: `git restore --source=HEAD -- packages/relay/src/group.ts`.
- GREEN: identical command passes both named tests; the restored focused file passes 3/3.

Runtime categories cover progressive settlement, mixed failure, normalized keys, shared terminal-empty replay, exact ID forwarding through existing Group tests, Pool parity, and cancellation through the explicit teardown path.

## Deviations from Plan

None.

## Self-Check: PASSED
