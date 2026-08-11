# Deferred Items — Phase 14 (auth-lifecycle-debug-logging)

Out-of-scope discoveries logged during execution, per the executor's scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).

## 14-04: Pre-existing flaky test — `D-15: publish's timeout is suspended across the auth phase`

- **File:** `packages/relay/src/__tests__/relay.test.ts`
- **Found during:** Task 2 verification (`pnpm vitest run packages/relay/src/__tests__/relay.test.ts`)
- **Symptom:** Intermittently fails with `Error: Timeout has occurred` thrown from
  `packages/relay/src/operators/auth-retry.ts:140` (the `suspendableTimeout`/`authTimeout` `with`
  callback), surfaced as an unhandled rejection after the test's own assertion already resolved.
- **Confirmed pre-existing and unrelated to this plan's changes:** reproduced identically with
  `packages/relay/src/relay.ts` reverted to its Task 1 (14-04) committed state — i.e. with zero
  Task 2 edits applied. Failed both filtered (`-t "D-15: ..."`) and unfiltered full-file runs at
  that state, then passed on a subsequent unfiltered run with no code changes in between —
  timing-dependent flakiness, not a regression introduced by 14-04.
  - This suite is entirely real-timer-based (per this file's existing convention noted in the
    14-04 plan), so the test's own `authTimeout: false` + a 40ms handler delay racing a 20ms
    `timeout` option is inherently sensitive to CI/sandbox scheduling jitter.
- **Action taken:** None — out of scope for 14-04 (no files this test's own scenario touches were
  modified by this plan's tasks). Left for a future test-hardening pass (e.g. fake timers, or a
  wider margin between the two timing constants) to pick up.
