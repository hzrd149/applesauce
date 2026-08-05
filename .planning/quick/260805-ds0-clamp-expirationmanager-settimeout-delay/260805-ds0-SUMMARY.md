---
phase: quick-260805-ds0
plan: 01
subsystem: infra
tags: [setTimeout, timers, event-store, nostr-wallet-connect, nip-40, denial-of-service]

# Dependency graph
requires: []
provides:
  - "ExpirationManager.scheduleNextCheck(): single owner of timer/nextCheck, clamping the setTimeout delay to Node's 32-bit limit"
  - "ExpirationManager stale-bookkeeping fix: timer state is always cleared on fire, even with no remaining expirations"
  - "WalletConnect.waitForPaid(): no-expiry invoices skip the timeout operator instead of passing Infinity; expiry timer clamped to the 32-bit limit"
affects: [applesauce-core event-store, applesauce-wallet-connect]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single private helper (scheduleNextCheck) as sole owner of paired timer/nextCheck instance fields, replacing duplicated inline clear-and-arm blocks"
    - "Clamp untrusted-input-driven setTimeout delays to MAX_TIMER_DELAY (2_147_483_647) rather than passing the raw delta"

key-files:
  created:
    - packages/wallet-connect/src/__tests__/wait-for-paid.test.ts
    - .changeset/clamp-expiration-timer-delay.md
    - .changeset/clear-stale-expiration-timer-state.md
    - .changeset/wait-for-paid-timer-fixes.md
  modified:
    - packages/core/src/event-store/expiration-manager.ts
    - packages/core/src/event-store/__tests__/expiration-manager.test.ts
    - packages/wallet-connect/src/wallet-connect.ts

key-decisions:
  - "Fixed all three timer defects (D1, D2, D3) in one quick task rather than core-only, per locked CONTEXT.md decision"
  - "One shared private scheduleNextCheck() helper in ExpirationManager instead of two parallel Math.min call sites, so the clamp can't regress at one site only"
  - "nextCheck stores the true target expiration, not the capped wake time, so track()'s early-exit guard keeps working correctly"
  - "MAX_TIMER_DELAY declared locally (not exported) in both packages to avoid forcing a minor bump on a patch release"
  - "wallet-connect's notification-branch expiry timer is clamped only (not chunk-re-armed like the core manager) since it rejects rather than re-arming and cannot hot-loop"

patterns-established:
  - "Untrusted numeric input (NIP-40 expiration, NWC expires_at) that drives a setTimeout delay must be clamped to MAX_TIMER_DELAY before scheduling"

requirements-completed: [D1, D2, D3]

coverage:
  - id: D1
    description: "ExpirationManager clamps far-future NIP-40 expiration timer delays to Node's 32-bit setTimeout limit and still expires them via chunked re-arm"
    requirement: "D1"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/expiration-manager.test.ts#far-future expirations"
        status: pass
    human_judgment: false
  - id: D2
    description: "ExpirationManager clears stale timer bookkeeping on every fire, so a forget()-then-track() sequence across a fired timer still schedules"
    requirement: "D2"
    verification:
      - kind: unit
        ref: "packages/core/src/event-store/__tests__/expiration-manager.test.ts#stale timer bookkeeping (D2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "waitForPaid() no longer times out immediately for invoices with no expiry, and its expiry timer is clamped to the 32-bit limit"
    requirement: "D3"
    verification:
      - kind: unit
        ref: "packages/wallet-connect/src/__tests__/wait-for-paid.test.ts#waitForPaid"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-08-05
status: complete
---

# Quick Task 260805-ds0: Clamp setTimeout Delays Summary

**Clamped and consolidated `ExpirationManager`'s uncapped `setTimeout` delay (the production 16 GB syslog / disk-exhaustion bug), fixed its stale timer bookkeeping, and fixed two related timer defects in `WalletConnect.waitForPaid()` — three patch changesets, all regression-tested.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-08-05
- **Tasks:** 3
- **Files modified:** 7 (2 source + 2 test in `applesauce-core`, 1 source + 1 new test file in `applesauce-wallet-connect`, 3 changesets)

## Accomplishments
- `ExpirationManager` no longer schedules a `setTimeout` delay above Node's 32-bit signed limit (`2_147_483_647` ms, ~24.8 days) — a far-future NIP-40 `expiration` tag now re-arms in capped chunks instead of triggering a `TimeoutOverflowWarning` hot loop that filled a production host's disk with syslog output.
- Timer scheduling in `ExpirationManager` now happens at exactly one place (`scheduleNextCheck()`), replacing two duplicated inline clear-and-arm blocks that let the same defect exist twice.
- Fixed a second, independent `ExpirationManager` defect: timer bookkeeping (`this.timer` / `this.nextCheck`) is now cleared on every fire, even when nothing remains to expire — previously a `forget()`-then-fired-timer sequence left stale state that silently blocked all later `track()` calls.
- `WalletConnect.waitForPaid()` no longer rejects with `TimeoutError` almost immediately for invoices with no `expires_at` (was passing `Infinity` to `simpleTimeout`, which clamps to ~1 ms); the timeout operator is now skipped entirely when there's no expiry.
- `waitForPaid()`'s notification-branch expiry timer is now clamped to the same 32-bit limit.
- Three single-sentence `patch` changesets added (two for `applesauce-core`, one for `applesauce-wallet-connect`).

## Task Commits

Each task was committed atomically (TDD RED confirmed for tasks 1 and 2 before the GREEN implementation commit):

1. **Task 1: Clamp and consolidate ExpirationManager timer scheduling (D1 + D2)** - `187930b9` (fix)
2. **Task 2: Fix waitForPaid timer handling in wallet-connect (D3)** - `3f6f4bd3` (fix)
3. **Task 3: Add three patch changesets and run the full affected suites** - `1b6b2976` (docs)

_Note: RED-phase test failures were confirmed interactively (not committed separately) before each GREEN commit, per the plan's TDD instruction; each task's single commit contains both the new tests and the passing implementation._

## Files Created/Modified
- `packages/core/src/event-store/expiration-manager.ts` - Added `MAX_TIMER_DELAY`; introduced `scheduleNextCheck()` as sole owner of `timer`/`nextCheck`; fixed stale bookkeeping in `emitNotifications()`
- `packages/core/src/event-store/__tests__/expiration-manager.test.ts` - Added far-future (D1-a/b), boundary (D1-c), and stale-bookkeeping (D2) regression tests; all 11 pre-existing tests pass unmodified
- `packages/wallet-connect/src/wallet-connect.ts` - Added local `MAX_TIMER_DELAY`; skip `simpleTimeout` entirely when there's no expiry (was passing `Infinity`); clamp the notification-branch expiry timer
- `packages/wallet-connect/src/__tests__/wait-for-paid.test.ts` - New file; regression tests for both `waitForPaid` defects
- `.changeset/clamp-expiration-timer-delay.md` - `applesauce-core` patch
- `.changeset/clear-stale-expiration-timer-state.md` - `applesauce-core` patch
- `.changeset/wait-for-paid-timer-fixes.md` - `applesauce-wallet-connect` patch

## Decisions Made
- Single shared `scheduleNextCheck()` helper (not two parallel `Math.min` call sites) per locked CONTEXT.md decision, so the clamp can't regress at only one call site again.
- `nextCheck` stores the true target expiration rather than the capped wake time, with an inline comment warning against a future regression — `track()`'s early-exit guard depends on this.
- `MAX_TIMER_DELAY` declared locally in each package (not exported from `applesauce-core`) to avoid forcing a minor version bump on what ships as a patch release.
- `waitForPaid()`'s expiry-timer fix is clamp-only, not a ported chunked re-arm — that callback rejects rather than re-arming so it cannot hot-loop, and the locked D3 decision was clamp-only.

## Deviations from Plan

None - plan executed exactly as written. All three tasks, including the TDD RED/GREEN sequencing and the `<done>` revert checks, were followed as specified.

## Issues Encountered
- Initial `wait-for-paid.test.ts` D3-a test omitted `{ pollInterval: 1000 }` from the `waitForPaid()` call, causing the test to time out against the default 5000 ms poll interval while advancing only 1500 ms of fake time. Fixed by passing the option explicitly, matching the plan's behavior spec. Not a deviation from the plan — a test-authoring correction made before the RED/GREEN gate was evaluated.

## User Setup Required

None - no external service configuration required.

## Orchestrator verification (independent of the executor)

Beyond the unit suites, the original field reproduction was run end-to-end against the
real built `packages/core/dist`, using the exact scenario from both reports (one event,
365-day NIP-40 expiration, real timers, no relay or websocket):

| Build | Result |
|---|---|
| Post-fix `dist` | **0** `TimeoutOverflowWarning` in 1.5 s |
| Same `dist` with only the `Math.min(...)` clamp removed | **1180** warnings in 1.5 s (~143 KB of output) |

The unclamped run emitted `TimeoutOverflowWarning: 31536000010 does not fit into a 32-bit
signed integer` — the same fingerprint as the field report's `29906643010`, differing only
in the expiration distance. ~787 warnings/sec at 2 lines each matches the ~107 KB/s
measured on the downed production host. This confirms the fix addresses the reported
defect and that the reproduction is genuinely sensitive to it, rather than passing
vacuously.

Full suites re-run independently: `pnpm vitest run packages/core packages/wallet-connect`
— 55 files / 619 tests, all pass.

## Follow-up (out of scope for this task)

**1. Backlog Phase 999.10.** (`.planning/phases/999.10-applesauce-core-expiration-timer-overflow/`)
in `.planning/ROADMAP.md` on the `concord` branch is resolved by this work (D1 and D2
above) but is unreachable and cannot be ticked off from `fix/clamp-settimeout-delays`.
**Action needed:** close it out when `concord` next merges `master`.

**2. STATE.md "Quick Tasks Completed" row was not written.** The entire `.planning/` tree
except `quick/` and `debug/` lives on `concord`; there is no `.planning/STATE.md` on
`master`. Creating one here would fork project planning state across two branches, so the
normal quick-task STATE.md update was deliberately skipped rather than faked. **Action
needed:** add the row for `260805-ds0` when this merges into `concord`.

## Next Phase Readiness
- All three timer defects are fixed, tested, and changesetted; downstream `nsite-gateway` (hzrd149/nsite-gateway#28) is unblocked once this ships in a patch release.
- No blockers. Nothing further required from this quick task.

---
*Phase: quick-260805-ds0*
*Completed: 2026-08-05*

## Self-Check: PASSED

All 7 claimed files found on disk. All 3 task commit hashes (`187930b9`, `3f6f4bd3`, `1b6b2976`) found in git log.
