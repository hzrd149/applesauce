---
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
plan: 04
subsystem: caching
tags: [event-cache, wallet, application-data, vitest, changesets]
requires: []
provides:
  - Accurate stamp cache documentation
  - Complete decrypted wallet cache removal on lock
  - Falsy-safe application-data parsing and caching
affects: [applesauce-core, applesauce-wallet, applesauce-common, release-coordination]
tech-stack:
  added: []
  patterns: [undefined-sentinel parsing, non-enumerable identity caching, lock-boundary cache deletion]
key-files:
  created:
    - .changeset/core-stamp-comment.md
    - .changeset/wallet-lock-relays.md
    - .changeset/common-falsy-app-data.md
  modified:
    - packages/core/src/operations/event.ts
    - packages/wallet/src/helpers/wallet.ts
    - packages/wallet/src/helpers/__tests__/wallet.test.ts
    - packages/common/src/helpers/app-data.ts
    - packages/common/src/helpers/__tests__/app-data.test.ts
key-decisions:
  - "Use Reflect.has for the application-data cache so cached null and other falsy values remain distinguishable from absence."
  - "Delete WalletRelaysSymbol directly at lockWallet's existing cleanup boundary alongside the other decrypted caches."
patterns-established:
  - "Parsed JSON failure checks compare explicitly with undefined rather than using truthiness."
requirements-completed: [ECO-02, ECO-03]
coverage:
  - id: D1
    description: "stamp documentation accurately describes the existing non-enumerable plaintext cache"
    verification:
      - kind: unit
        ref: "packages/core/src/operations/__tests__/event.test.ts#stamp"
        status: pass
    human_judgment: false
  - id: D2
    description: "lockWallet clears private-key, mint, and relay caches"
    verification:
      - kind: unit
        ref: "packages/wallet/src/helpers/__tests__/wallet.test.ts#clears every decrypted cache when locking"
        status: pass
    human_judgment: false
  - id: D3
    description: "application-data parsing preserves valid false, zero, null, and empty-string JSON values"
    verification:
      - kind: unit
        ref: "packages/common/src/helpers/__tests__/app-data.test.ts#getAppDataContent falsy values"
        status: pass
    human_judgment: false
duration: 3min
completed: 2026-09-03
status: complete
---

# Phase 25 Plan 04: Folded Cache Correctness Follow-ups Summary

**Wallet locking now removes every decrypted cache, application-data parsing preserves valid falsy JSON, and stamp documentation matches its hidden-cache behavior.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-09-03T14:42:26Z
- **Completed:** 2026-09-03T14:45:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Reconciled the `stamp` comment with its existing non-enumerable plaintext cache and added an isolated core changeset.
- Added a lock-boundary regression and cleared cached wallet relay metadata alongside private-key and mint caches.
- Added falsy-value and malformed-input regressions, then made plaintext, decrypted, and cached application data use the undefined failure sentinel consistently.

## Task Commits

1. **Task 1: Reconcile stamp documentation with its hidden cache** - `c7deb3ef` (docs)
2. **Task 2: Clear decrypted relay metadata when locking a wallet (RED)** - `3de3a5c1` (test)
3. **Task 2: Clear decrypted relay metadata when locking a wallet (GREEN)** - `993bbedf` (fix)
4. **Task 3: Preserve valid falsy application-data payloads (RED)** - `323fdc23` (test)
5. **Task 3: Preserve valid falsy application-data payloads (GREEN)** - `d680d58e` (fix)

## Files Created/Modified

- `packages/core/src/operations/event.ts` - Clarifies non-enumerable destination cache behavior in `stamp`.
- `packages/wallet/src/helpers/wallet.ts` - Removes cached relay metadata during wallet locking.
- `packages/wallet/src/helpers/__tests__/wallet.test.ts` - Proves all decrypted caches disappear at the lock boundary.
- `packages/common/src/helpers/app-data.ts` - Distinguishes valid falsy JSON values from the undefined parse-failure sentinel.
- `packages/common/src/helpers/__tests__/app-data.test.ts` - Covers false, zero, null, empty string, and malformed JSON.
- `.changeset/core-stamp-comment.md` - Core patch note for the comment correction.
- `.changeset/wallet-lock-relays.md` - Wallet patch note for relay-cache clearing.
- `.changeset/common-falsy-app-data.md` - Common patch note for falsy application-data parsing.

## Decisions Made

- Used property presence for cached application data because the cached value itself may validly be `null`, `false`, `0`, or an empty string.
- Kept wallet relay cleanup as a direct deletion at the existing lock boundary, avoiding an unnecessary abstraction.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The stamp comment had already been partially corrected during the original cache migration; it was tightened to state the input-read and destination-write behavior unambiguously without changing runtime code.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The three D-13 follow-ups are closed with focused regressions and independent package changesets. No blockers remain for Phase 25 release coordination.

## Self-Check: PASSED

- All eight created or modified files exist.
- Task commits `c7deb3ef`, `3de3a5c1`, `993bbedf`, `323fdc23`, and `d680d58e` exist in git history.
- All three focused test files pass together (15 tests).

---
*Phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2*
*Completed: 2026-09-03*
