---
phase: 14-auth-lifecycle-debug-logging
plan: 05
subsystem: auth
tags: [nip-42, rxjs, typescript, logging, applesauce-relay]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "RelayAuthWireRequest wire-verb union, describeWireRequest/describeAuthRequirement formatters, AuthRetryConfig.satisfiedPubkeys (14-01)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "debug-capture harness precedent for restore-safe output assertions (14-03, not directly used here — this plan asserts via the operator's own injected log spy instead)"
provides:
  - "packages/relay/src/operators/auth-retry.ts's per-phase line set: one line per D-14 blocked state and one per terminal outcome, each prefixed with the D-05 wire-key request label"
  - "the known-inventory ordered line set a single successful auth phase emits (below), for 14-06's end-to-end sequence oracle"
affects: [14-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "phaseLine(text) local closure per runPhase invocation — one prefix (`${requestLabel} — `), one call shape, shared by every blocked-state and outcome line in a phase"
    - "request label and its phaseLine helper hoisted above both terminal early returns so even a short-circuit path (opted out, retries exhausted) still carries the D-05 wire-key attribution"

key-files:
  created: []
  modified:
    - packages/relay/src/operators/auth-retry.ts
    - packages/relay/src/__tests__/auth-retry.test.ts

key-decisions:
  - "config.buildContext(signal.reason) hoisted to the first statement of runPhase (above the waitForAuth:false and retries-exhausted early returns) so requestLabel is available to every outcome, not just phases that actually run"
  - "phaseLine declared as a named `function phaseLine(text: string): void` (not an arrow assigned to a const) so its own declaration line is self-documenting and greppable identically to its call sites"
  - "the phase counter (`phase n/N`) is a plain string built once per runPhase call from the post-increment `consecutive` value and threaded through call-site text arguments — it is not baked into phaseLine itself, because the two early-return outcomes (opted out, retries exhausted) must carry the request label but explicitly no phase counter"
  - "handler-failure lines (sync throw, promise rejection) render `cause` through truncateForLog(cause) directly rather than pulling `.message` off an assumed Error shape — truncateForLog already coerces any value via String(), keeping the T-14-01 truncation mitigation intact for a non-Error thrown value too"
  - "the D-07 counter-reset tap gets a comment recording the no-line decision rather than a written invariant elsewhere in the file, mirroring D-19's decision (Phase 13/14) against maintained invariant comments that go stale — this one is co-located with the code it explains"

requirements-completed: [ALOG-02]

coverage:
  - id: D1
    description: "Every state D-14 enumerates (phase begin, handler invoked/absent, handler resolved-and-waiting) and every terminal outcome (opted out, retries exhausted, wait satisfied, handler threw, handler rejected, per-phase timeout) emits exactly one attributable line"
    requirement: ALOG-02
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts — 'authRetry — operation track logging (14-05)' describe block, one test per outcome path"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two concurrent operations against distinct wire requests produce individually attributable lines in one shared log stream"
    requirement: ALOG-02
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts — 'ALOG-02: two concurrent operations...' test, expectations derived from describeWireRequest rather than hardcoded"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-08's wait-satisfied line names every pubkey that satisfied the wait, or says so explicitly when the list is empty"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts — two 'D-08' tests (multi-pubkey array requirement, empty-list boolean requirement)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-07's consecutive-counter reset emits no line of its own, and the per-line phase counter restarting at 1 is what makes the reset observable"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts — 'D-07: the consecutive-counter reset...' test"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe: temporarily replaced the `consecutive`-derived phase counter with a non-resetting lifetime counter, confirmed the D-07 test failed, reverted, confirmed green again (see below)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 05: Auth-Retry Operator Track — Phase Identity and Outcome Lines Summary

**`operators/auth-retry.ts` now emits one attributable line per D-14 blocked state and one per terminal outcome, every line prefixed with the D-05 wire-key request label, proven distinguishable across two concurrent operations sharing one log stream.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-11
- **Tasks:** 3/3
- **Files modified:** 2

## Accomplishments

- Hoisted `config.buildContext(signal.reason)` to the top of `runPhase`, above both terminal early returns, and derived `requestLabel`/`phaseLine` from it so even the opted-out (RAUTH-06) and retries-exhausted outcomes — which never enter a phase — still carry the D-05 wire-key attribution.
- Added a `phaseLine(text)` helper that is the single point routing through the injected `config.log?.(...)`, prefixing every line with `${requestLabel} — `.
- Logged all three D-14 blocked states: phase begins (`entering phase n/N`), handler invoked-or-absent (an explicit if/else, not one ambiguous line), and handler-resolved-now-waiting (naming the requirement via `describeAuthRequirement`).
- Logged all six terminal outcomes: opted out, retries exhausted, wait satisfied (D-08's `config.satisfiedPubkeys()` join key, read at the moment the wait resolves), synchronous handler throw, asynchronous handler rejection (kept as two distinct lines per CR-04), and per-phase timeout.
- Recorded D-07's "no line for the counter reset" decision as a comment at the reset `tap`, rather than logging it — the per-line phase counter restarting at 1 on the next phase is what makes the reset observable instead.
- Added 11 new tests: one per outcome path, the ALOG-02 two-operation attribution test, two D-08 tests (multi-pubkey and empty-list), and the D-07 reset/restart test — all in a new `authRetry — operation track logging (14-05)` describe block driving the operator directly with an injected `log` spy.
- Performed and recorded both mandated RED→GREEN non-vacuity probes (see below).

## Task Commits

Each task was committed atomically:

1. **Task 1: Phase identity and the blocked-state lines** - `ff38feea` (feat)
2. **Task 2: Outcome lines — satisfied, timed out, rejected, exhausted, opted out** - `970d9d8b` (feat)
3. **Task 3: Operator-level line-set tests, including concurrent attribution** - `1fabdc17` (test)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/operators/auth-retry.ts` - hoisted `context`/`requestLabel`, added `phaseLine` helper, added the three D-14 blocked-state lines and the six terminal-outcome lines, added the D-07 no-log comment at the counter reset
- `packages/relay/src/__tests__/auth-retry.test.ts` - added the `authRetry — operation track logging (14-05)` describe block (11 tests) plus a `collectLines` test helper and a `describeWireRequest` import for independently-derived expectations

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- `context`/`requestLabel`/`phaseLine` are hoisted above both early returns so every outcome — even the two that never run a phase — carries the D-05 wire-key attribution.
- `phaseLine` is a named `function` declaration (not a const arrow) purely so its declaration is textually identical in shape to its call sites — a stylistic choice with no behavioral effect.
- The phase counter (`phase n/N`) is threaded through individual call-site text, not baked into `phaseLine` itself, because the opted-out and retries-exhausted lines must carry the request label but explicitly no phase counter (per the plan's own instruction).
- Handler-failure lines pass `cause` through `truncateForLog(cause)` directly (no `.message` extraction), keeping T-14-01's truncation mitigation correct even for a non-Error thrown value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Deferred the `truncateForLog` import to Task 2**
- **Found during:** Task 1 build verification (`pnpm --filter applesauce-relay build`)
- **Issue:** Task 1's action text implied keeping the existing `describeWireRequest, truncateForLog` import pair, but Task 1's own instruction (drop the reason from the phase-begin line; "must NOT restate the relay's reason") removes the only Task-1-scoped use of `truncateForLog`. With `truncateForLog` imported but unused, `tsc` fails on `TS6133` under this package's strict unused-locals setting, breaking Task 1's own mandated `pnpm --filter applesauce-relay build` verification.
- **Fix:** Task 1's commit imports only `describeAuthRequirement, describeWireRequest`; Task 2's commit re-adds `truncateForLog` to the same import statement at the point its two handler-failure lines actually use it.
- **Files modified:** `packages/relay/src/operators/auth-retry.ts` (both task commits)
- **Verification:** `pnpm --filter applesauce-relay build` exits 0 at both Task 1's and Task 2's commit points.
- **Committed in:** `ff38feea` (Task 1, import without `truncateForLog`), `970d9d8b` (Task 2, import restored)

**2. [Rule 3 - Blocking] Built `applesauce-core` and `applesauce-signers` before `applesauce-relay` in this fresh worktree**
- **Found during:** First `pnpm --filter applesauce-relay build` attempt (before any plan edits)
- **Issue:** `applesauce-core`/`applesauce-signers` had no `dist/` yet in this worktree, so `applesauce-relay`'s build failed with `Cannot find module 'applesauce-core/helpers/...'` — the same pre-existing condition 14-01's SUMMARY documented for its own worktree.
- **Fix:** `pnpm --filter applesauce-core build && pnpm --filter applesauce-signers build`, then `applesauce-relay` built clean.
- **Files modified:** none (build-order issue only, no source change)
- **Verification:** `pnpm --filter applesauce-relay build` exits 0 thereafter.
- **Committed in:** n/a (no commit; local build-cache state only)

---

**Total deviations:** 2 auto-fixed (both Rule 3, both mechanical — an import-ordering constraint across two atomic commits, and a monorepo build-order gap in a fresh worktree). No scope creep; no plan text or behavior beyond the plan's own instructions was touched.

## RED→GREEN Non-Vacuity Probes (Task 3, mandated by the plan)

**Probe 1 — ALOG-02 attribution test:**
- **RED:** Temporarily changed `phaseLine` to `config.log?.(text)` (dropping the `${requestLabel} — ` prefix). Ran `pnpm exec vitest run packages/relay/src/__tests__/auth-retry.test.ts -t "ALOG-02"` — the attribution test failed: `AssertionError: expected false to be true` at the `belongsToReq !== belongsToEvent` assertion, because with no label every line matched neither derived wire key.
- **GREEN:** Reverted `phaseLine` to `config.log?.(\`${requestLabel} — ${text}\`)`. Re-ran the same targeted test — passed. Full `auth-retry.test.ts` suite (27/27) re-confirmed green afterward.

**Probe 2 — D-07 counter-restart test:**
- **RED:** Added a `lifetimePhaseCounter` that increments alongside `consecutive` but never resets, and rendered `phase` from it instead of `consecutive`. Ran `pnpm exec vitest run packages/relay/src/__tests__/auth-retry.test.ts -t "D-07"` — failed: `expected 'REQ fake-req kinds=[1] — entering phase 2/1' to contain 'entering phase 1/1'` — proving the test does detect a non-resetting counter.
- **GREEN:** Reverted to `const phase = \`phase ${consecutive}/${authRetries}\`;` and removed the temporary `lifetimePhaseCounter`. Re-ran the same targeted test — passed. `git diff packages/relay/src/operators/auth-retry.ts` confirmed empty (no probe residue) before the Task 3 commit.

Both probes were performed via the Edit tool directly on `auth-retry.ts` (never via `git stash`, per the worktree-safety rules — a concurrent agent, 14-04, is running in a sibling worktree right now).

## Issues Encountered

None beyond the two auto-fixed deviations above.

## Verification

- `pnpm --filter applesauce-relay build` exits 0 at every task's commit point.
- `pnpm --filter applesauce-relay test` — 278 passed (10 files), including all 27 tests in `auth-retry.test.ts` (16 pre-existing + 11 new).
- `pnpm --filter applesauce-loaders test` — 126 passed (16 files), confirming `AuthPhaseGate`'s consumer (the loaders' stall guard) is unaffected — this plan touched no control flow, only added observation.

### Known-inventory line set for a single successful auth phase (for 14-06's oracle)

For a phase with a handler configured, resolved, and satisfied (e.g. by one pubkey `pk1`), in order, each line is `${requestLabel} — {text}`:

1. `entering phase 1/1`
2. `invoking the configured onAuthRequired handler (phase 1/1)`
3. `handler completed (phase 1/1) — now waiting for {describeAuthRequirement output}`
4. `wait satisfied (phase 1/1) — satisfied by pk1`

For a handler-absent phase, line 2 becomes `no onAuthRequired handler is configured — waiting on external auth state (phase 1/1)`, and line 3 still fires (the same code path resolves `handled$` to `of(undefined)` either way) before line 4.

The five outcome lines (`opted out`, `auth retry budget ... is exhausted`, `... threw synchronously`, `... promise rejected`, `... timed out after ...ms`) are documented at their call sites in `auth-retry.ts` and asserted individually in `auth-retry.test.ts`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 14-06 (the `:auth` namespace end-to-end sequence oracle) can build its scripted-scenario line inventory directly against the ordered line set documented above — no further changes to `auth-retry.ts` are needed for that plan to proceed.
- No blockers. This plan touched only `packages/relay/src/operators/auth-retry.ts` and its test file, per its declared `files_modified` scope; it did not touch `relay.ts` or `relay.test.ts` (owned by the concurrent 14-04 agent in this wave).

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
