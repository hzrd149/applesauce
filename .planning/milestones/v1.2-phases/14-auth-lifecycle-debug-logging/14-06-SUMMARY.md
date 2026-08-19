---
phase: 14-auth-lifecycle-debug-logging
plan: 06
subsystem: testing
tags: [nip-42, debug, vitest, relay, applesauce-relay, oracle]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-01's RelayAuthWireRequest union and helpers/auth-log.ts formatters (truncateForLog/shortId/summarizeFilter(s)/describeWireRequest)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-03's shared debug-capture harness (captureDebugOutput/messagesOf/withDebugCapture)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-04's Relay.authLog :auth sub-namespace and the NIP-42 connection track (challenge/signing/sent/result/resetState invalidation)"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-05's operator-track line inventory (phase identity, blocked states, six terminal outcomes) in operators/auth-retry.ts"
provides:
  - "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts — the ALOG-01/ALOG-02 end-to-end oracle driving a real Relay against the mock WebSocket server, asserting on captured real debug output derived from scripted NIP-42 exchanges rather than from source strings"
  - "14-VALIDATION.md's Per-Task Verification Map filled in for all 20 tasks across the phase's 7 plans, with nyquist_compliant: true"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Oracle test derives its expected line sequence from a scripted NIP-42 wire exchange (CLOSED-then-AUTH-then-OK, or a deliberately silent/rejecting relay), never from the implementation's own template literals — every assertion computes its expected value (pubkey, shortId prefix, filter summary) from the test's own inputs"
    - "Per-test relay.eventTimeout/relay.keepAlive overrides scope a test's real-timer budget tightly so no long-lived real setTimeout or reconnect cycle outlives the test and bleeds into a later one"

key-files:
  created:
    - packages/relay/src/__tests__/auth-lifecycle-logging.test.ts
  modified:
    - .planning/phases/14-auth-lifecycle-debug-logging/14-VALIDATION.md

key-decisions:
  - "The successful-lifecycle test scripts CLOSED before AUTH (per the plan's literal exchange order) rather than AUTH before CLOSED (relay.test.ts's existing convention) — the onAuthRequired handler defensively awaits relay.challenge$ before signing so the test is correct under either wire order, which is itself the more realistic client implementation"
  - "The hung-signer/unresponsive-relay pair (D-09) uses a short per-request authTimeout (50ms) against a longer, test-scoped relay.eventTimeout (300ms default 10s) so the operator's own phase timeout — not event()'s internal OK-wait timeout — is what fires inside the assertion window, and the unresponsive-relay test adds a settle wait afterward so no dangling real timer survives into a later test"
  - "The retries-exhausted test (authRetries: 1) drives a real accept-then-refuse-again sequence rather than two immediate refusals, because isReqProgress only resets the consecutive counter on a non-OPEN value from the relay — the second refusal has to follow a successful phase to land on an already-spent budget, which is also the more realistic 'the relay changed its mind after auth' scenario"
  - "The ALOG-02 concurrent-attribution test gives the REQ and EVENT operations distinct single-pubkey waitForAuth requirements (userA/userB) rather than the shared default (any authenticated pubkey) — that is what makes 'resolving one operation's auth requirement leaves the other still blocked' genuinely observable rather than both auto-satisfying on the first AUTH accept"
  - "The concurrent-attribution test overrides relay.keepAlive to 10s (from the file's default 0) — at keepAlive:0, the connection can drop mid-auth-wait when two operations' internal defer/resubscribe cycles transiently pass through a zero-refCount moment (the pre-existing, out-of-scope gap 14-RESEARCH.md's Open Question 3 flagged), which cleared the AUTH challenge before the test's second relay.authenticate() call could use it"
  - "Wire keys for the D-06/ALOG-02 assertions are computed as the literal describeWireRequest prefix (\"REQ \" + shortId(id), \"EVENT \" + shortId(event.id)), not just the bare shortId, since two ids sharing an 8-character prefix would otherwise be ambiguous — chosen test ids (reqop-alog02 / evtop-alog02-...) were deliberately picked to diverge within the first 8 characters"
  - "14-VALIDATION.md's Per-Task Verification Map uses one row per task (Task ID formatted {plan}-T{n}) across all 7 plans/20 tasks, citing plan-level requirements per task (PLAN.md frontmatter did not sub-divide requirements per task) and threat refs only where a task's own secure behavior maps to a specific STRIDE register entry (T-14-01 truncation, T-14-02 no-signature-logged, T-14-05 debug-global-state restore)"

requirements-completed: [ALOG-01, ALOG-02]

coverage:
  - id: D1
    description: "A scripted successful NIP-42 exchange (REQ -> CLOSED auth-required -> AUTH challenge -> sign+send -> OK true -> REQ resend) produces a trace answering ALOG-01's three questions in order, with D-08's pubkey join key and D-06's kind-spelled/authors-counted filter summary, and the AUTH event's own signature never logged (T-14-02)"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts — 'ALOG-01: a scripted successful NIP-42 exchange...' (real Relay + mock WS server, real timers)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A hung signer (never resolves) and an unresponsive relay (AUTH sent, no OK) produce distinguishable traces via the signing line; a relay rejection carries its own message plus a terminal outcome line, with an oversized CLOSED reason/OK message bounded near AUTH_LOG_TEXT_LIMIT (T-14-01); a spent retry budget names the configured count"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts — 'D-09: a hung signer...' / 'D-09: a sent AUTH with no relay reply...' / 'T-14-01/D-09: an oversized CLOSED reason...' / 'the retries-exhausted outcome...'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe: temporarily removed authenticate()'s signing line, confirmed both D-09 tests fail (no longer distinguish the two silences), restored, confirmed green (see below)"
        status: pass
    human_judgment: false
  - id: D3
    description: "resetState()'s reconnect-invalidation line (D-12) is reported only when there was something to invalidate, driven by a real successful authentication (not out-of-band subject writes) for the positive case"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts — 'D-12: dropping a connection after a real successful authentication...' / 'D-12: dropping a connection that never authenticated...'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe: temporarily made resetState()'s invalidation line unconditional, confirmed the never-authenticated test fails, restored, confirmed green (see below)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two concurrent operations (a REQ and a publish) waiting on distinct pubkeys stay individually attributable in one shared log stream by wire key, and resolving only one operation's auth requirement leaves the other's own group showing it still blocked"
    requirement: "ALOG-02"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts — 'ALOG-02: two concurrent operations' lines stay individually attributable...'"
        status: pass
    human_judgment: false
  - id: D5
    description: "14-VALIDATION.md's Per-Task Verification Map is filled in from executed runs for all 20 tasks across the phase's 7 plans, with the ALOG-03 Manual-Only Verification grep sweep executed and its 11 hits individually dispositioned"
    requirement: "ALOG-01, ALOG-02, ALOG-03"
    verification:
      - kind: other
        ref: "grep -c 'nyquist_compliant: true' .planning/phases/14-auth-lifecycle-debug-logging/14-VALIDATION.md returns 1; grep -c '| TBD ' returns 0; every row has a non-empty Automated Command cell"
        status: pass
    human_judgment: false

duration: ~2h (including one mid-task stream stall; active work ~40min)
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 06: Auth Lifecycle Logging Oracle Summary

**A real-`debug`-output oracle in `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` drives a live `Relay` against the mock WebSocket server through scripted NIP-42 exchanges, proving ALOG-01's lifecycle/why-it-failed claim and ALOG-02's concurrent-attribution claim against captured `:auth`-namespace output rather than against implementation strings — plus `14-VALIDATION.md`'s Per-Task Verification Map filled in for the whole phase.**

## Performance

- **Duration:** ~2h wall clock (one mid-task stream stall interrupted the turn after Task 3's test additions were written but before the commit landed; the orchestrator confirmed no work was lost and the turn resumed cleanly). Active work across the three tasks: ~40min.
- **Completed:** 2026-08-11
- **Tasks:** 3/3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Created `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts`, reusing `relay.test.ts`'s exact setup (WS mock server, real `Relay`, `fetchInformationDocument` stub, `afterEach` cleanup) and the 14-03 `withDebugCapture`/`messagesOf` harness — no second capture mechanism, no logger injection seam added to `RelayOptions`, real timers throughout (Phase 13's D-20 convention).
- The successful-lifecycle test (Task 1) scripts a real REQ → CLOSED(auth-required) → AUTH(challenge) → sign+send → OK(true) → REQ-resend exchange and asserts, by matched-line-index ordering (not fixed array equality), that the challenge, signing, AUTH-sent, and result lines appear in that order; asserts D-08's pubkey join key between the connection track and the operation's wait-satisfied line; asserts D-06's kind-spelled/authors-counted filter summary end to end against a 3-author filter; asserts the AUTH event's own signature never appears in captured output (T-14-02).
- The four failure-mode groups (Task 2) each derive their expectation from what the scripted scenario physically does: the hung-signer/unresponsive-relay pair (D-09) proves the signing line is what makes the two otherwise-identical silences distinguishable; an oversized `CLOSED` reason and `OK` rejection message are proven bounded near `AUTH_LOG_TEXT_LIMIT` (T-14-01) alongside the relay's own rejection message and a terminal outcome line; the retries-exhausted test derives its expected budget from the `authRetries` value it configures, not a literal; the reconnect-invalidation pair (D-12) covers both the authenticated-drop and never-authenticated-drop cases via a real auth round trip, not out-of-band subject writes.
- The concurrent-attribution test (Task 3, ALOG-02) drives a REQ and a publish concurrently on one connection, each waiting on a distinct single pubkey, and proves their lines separate cleanly by wire key (computed via `shortId`, never transcribed), stay non-ambiguous, and that resolving only one operation's auth requirement leaves the other's own line group showing it is still blocked — not merely differently labelled.
- `14-VALIDATION.md`'s Per-Task Verification Map is filled in for all 20 tasks across the phase's 7 plans (14-01 through 14-07), the Wave 0 and Validation Sign-Off checklists are ticked, `nyquist_compliant: true` is set, and the ALOG-03 Manual-Only Verification grep sweep was executed with all 11 hits individually dispositioned.

## Task Commits

Each task was committed atomically:

1. **Task 1: Test file scaffold and the successful-lifecycle oracle (ALOG-01)** - `eb4895a8` (test)
2. **Task 2: The two failure modes must produce different output (ALOG-01's "why")** - `a07a34bb` (test)
3. **Task 3: Concurrent attribution end to end (ALOG-02) and the validation map** - `00f1af36` (test)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` - new file, 8 tests across 3 tasks: 1 successful-lifecycle oracle, 6 failure-mode oracles (hung signer, unresponsive relay, oversized-text rejection, retries-exhausted, 2× reconnect-invalidation), 1 concurrent-attribution oracle
- `.planning/phases/14-auth-lifecycle-debug-logging/14-VALIDATION.md` - Per-Task Verification Map completed (20 rows), Wave 0/Sign-Off checklists ticked, `nyquist_compliant: true`, Manual-Only Verification executed and pasted below

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- The successful-lifecycle test follows the plan's literal CLOSED-then-AUTH wire order; the `onAuthRequired` handler defensively waits on `relay.challenge$` rather than assuming `context.challenge` is already populated, which is correct under either wire order and is what a real client implementation would do.
- The hung-signer/unresponsive-relay pair uses a short phase `authTimeout` (50ms) against a longer, test-scoped `relay.eventTimeout` so the operator's own phase timeout is what fires inside the assertion window, not `event()`'s internal OK-wait timeout.
- The concurrent-attribution test gives the two operations distinct single-pubkey `waitForAuth` requirements so "resolving one leaves the other blocked" is genuinely observable, and overrides `relay.keepAlive` to avoid a pre-existing, out-of-scope connection-drop-at-low-keepAlive gap (14-RESEARCH.md Open Question 3) that this test's two-operation timing would otherwise have tripped.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Overrode `relay.keepAlive` in the ALOG-02 concurrent-attribution test**
- **Found during:** Task 3 verification (`pnpm vitest run .../auth-lifecycle-logging.test.ts`)
- **Issue:** With the file's default `relay.keepAlive = 0`, the second `relay.authenticate(userB)` call in the concurrent-attribution test threw `Have not received authentication challenge`. Root cause: two concurrent operations' internal defer/resubscribe cycles transiently drop the connection's refCount to zero at `keepAlive: 0`, closing and reopening the socket and clearing `challenge$` via `resetState()` before the test's second `authenticate()` call could use it — this is the pre-existing, out-of-scope "connection-drop-mid-auth-wait at very low `keepAlive`" gap 14-RESEARCH.md's Open Question 3 and Phase 13's `deferred-items.md` already flagged as a backlog candidate, not a defect introduced by this plan.
- **Fix:** Set `relay.keepAlive = 10_000` at the top of this one test, scoped to it alone (every other test in the file keeps the shared `beforeEach`'s `keepAlive = 0`), with a comment citing the known gap so a future reader does not mistake the override for arbitrary tuning.
- **Files modified:** `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` (test-only; no production file touched)
- **Verification:** `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` — 8/8 passing, run twice for stability.
- **Committed in:** `00f1af36` (Task 3's commit)

---

**Total deviations:** 1 auto-fixed (Rule 3, test-scoped, no production code touched)
**Impact on plan:** No scope creep — the fix is a one-line test-local timing override with a citation to the pre-existing gap it works around; it does not touch, mask, or claim to fix the underlying connection-drop-mid-auth-wait behavior, which remains out of this plan's scope per the plan's own prohibitions and 14-RESEARCH.md's explicit deferral.

## RED→GREEN Non-Vacuity Probes (Task 2, mandated by the plan)

Both probes were performed via the `Edit` tool directly on `packages/relay/src/relay.ts`, run, then reverted via `Edit` — never via `git stash` (prohibited in worktree mode; a concurrent agent, 14-07, was running in a sibling worktree at the time).

**Probe 1 — the hung-signer/unresponsive-relay pair (D-09):**
- **RED:** Temporarily removed `authenticate()`'s `this.authLog(\`Signing AUTH event for challenge...\`)` line. Ran `pnpm exec vitest run .../auth-lifecycle-logging.test.ts -t "D-09"` — both tests failed: `expected false to be true` on the `captured.some((l) => l.includes("Signing AUTH event"))` assertion in each. With the signing line gone, the hung-signer trace and the unresponsive-relay trace are identical (no signing, no sent, no result) — confirming the pair genuinely relies on that one line to distinguish the two scenarios.
- **GREEN:** Restored the signing line. Re-ran the same targeted tests — both passed. `git diff --stat packages/relay/src/relay.ts` confirmed empty before Task 2's commit.

**Probe 2 — the reconnect-invalidation pair (D-12):**
- **RED:** Temporarily removed `resetState()`'s `if (authenticatedCount > 0 || challengeHeld)` guard, making the invalidation line fire unconditionally. Ran `pnpm exec vitest run .../auth-lifecycle-logging.test.ts -t "D-12"` — the never-authenticated case failed: `expected true to be false` on the invalidation-line-absence assertion, since the (now unconditional) line fired even though nothing had authenticated.
- **GREEN:** Restored the guard. Re-ran the same targeted tests — both passed. `git diff --stat packages/relay/src/relay.ts` confirmed empty before Task 2's commit.

## Manual-Only Verification: ALOG-03 grep sweep (Task 3, mandated by 14-VALIDATION.md)

Command: `grep -rn "\.extend(" packages/loaders/src --include="*.ts" | grep -v __tests__`

```
packages/loaders/src/loaders/sync-loader.ts:248:  const log = logger?.extend("backward").extend(nanoid(8));
packages/loaders/src/loaders/sync-loader.ts:333:  const baseLog = (options.logger ?? baseLogger).extend("sync-loader");
packages/loaders/src/loaders/sync-loader.ts:346:    const log = baseLog.extend(nanoid(4));
packages/loaders/src/loaders/sync-loader.ts:396:        const requestLog = log.extend(url).extend("request");
packages/loaders/src/loaders/timeline-loader.ts:58:    const log = opts?.logger?.extend("backward").extend(nanoid(8));
packages/loaders/src/loaders/timeline-loader.ts:136:    const log = opts?.logger?.extend("forward").extend(nanoid(8));
packages/loaders/src/loaders/timeline-loader.ts:221:  const logger = opts?.logger?.extend("cache");
packages/loaders/src/loaders/timeline-loader.ts:241:  const logger = opts?.logger?.extend("relays");
packages/loaders/src/loaders/timeline-loader.ts:262:  const logger = opts?.logger?.extend(relay);
packages/loaders/src/loaders/timeline-loader.ts:446:  const logger = (opts?.logger ?? baseLogger).extend("timeline").extend(nanoid(4));
packages/loaders/src/loaders/timeline-loader.ts:474:  const logger = (opts?.logger ?? baseLogger).extend("outbox-timeline").extend(nanoid(4));
```

Per-hit disposition (11 hits, all clean):

| Line | Disposition |
|------|-------------|
| `sync-loader.ts:248` | Approved per-call correlation logger (`.extend(nanoid(8))`), function-entry scoped — not re-derived inside a repeatable callback |
| `sync-loader.ts:333` | Construction-time derivation, once per loader construction (`baseLog`) |
| `sync-loader.ts:346` | Approved per-call correlation logger (`.extend(nanoid(4))`) |
| `sync-loader.ts:396` | 14-02's D-18 fix target — `requestLog`, confirmed hoisted above the `switchMap` at line 601 (verified via direct read: `buildRelayStream`'s per-relay body, not the projector) |
| `timeline-loader.ts:58` | Approved per-call correlation logger (`.extend("backward").extend(nanoid(8))`) |
| `timeline-loader.ts:136` | Approved per-call correlation logger (`.extend("forward").extend(nanoid(8))`) |
| `timeline-loader.ts:221` | Construction-time, per operator-application derivation |
| `timeline-loader.ts:241` | Construction-time, per operator-application derivation |
| `timeline-loader.ts:262` | Construction-time, function-entry-scoped in `loadBlocksFromRelay` — not inside a re-enterable pipeline callback |
| `timeline-loader.ts:446` | Construction-time + approved per-call correlation (`.extend("timeline").extend(nanoid(4))`) |
| `timeline-loader.ts:474` | Construction-time + approved per-call correlation (`.extend("outbox-timeline").extend(nanoid(4))`) |

Zero hits inside a re-enterable reactive callback (`switchMap`/`mergeMap` projector). Confirms D-18/D-20 hold across the whole phase, consistent with 14-02-SUMMARY.md's own closeout.

## Issues Encountered

- **Cross-worktree note (14-07, not verified by this plan):** 14-07 landed in a sibling worktree during this plan's execution, making `event()`'s manufactured publish timeout set `PublishResponse.error` (D-11). 14-07's own report states the `authLog` call count is unchanged at 9 relay-side call sites, so it does not expect to perturb this plan's oracles. This plan's tests do not assert on `PublishResponse.error` and none of the 8 tests exercise `event()`'s internal manufactured-timeout branch directly (the D-09 unresponsive-relay test relies on the *operator's* phase timeout firing first, before `event()`'s own `eventTimeout` could manufacture a response) — so no interaction is expected, but this branch has not been verified against 14-07's actual landed diff since the two worktrees have not yet merged. Flagging per the orchestrator's request for confirmation at the post-merge gate.
- A pre-existing, out-of-scope gap (connection drop mid-auth-wait at low `keepAlive`, 14-RESEARCH.md Open Question 3) was encountered and worked around with a test-local `keepAlive` override rather than fixed — see Deviations above.

## Verification

- `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` — 8/8 passing, run twice for stability (identical results both times).
- `pnpm vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts packages/relay/src/__tests__/relay.test.ts packages/relay/src/__tests__/auth-retry.test.ts packages/relay/src/__tests__/group.test.ts` (Task 3's exact verify command) — 227/227 passing.
- `pnpm exec vitest run packages/relay` (whole-package run) — 291/291 passing, confirming no leaked-enable-state divergence between isolated and whole-package runs (RESEARCH Pitfall 4).
- `git status --porcelain packages/relay/src/relay.ts packages/relay/src/operators/auth-retry.ts` — empty at every commit point; no production file modified by this plan.
- Full-monorepo cross-package verification (build + `applesauce-loaders`/`applesauce-concord` non-regression) is the orchestrator's post-merge-gate responsibility per this plan's explicit instruction, not re-run here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ALOG-01 and ALOG-02 are now proven against real captured `debug` output for this phase's Wave 1-3 work (14-01, 14-03, 14-04, 14-05), plus this plan's own concurrent-attribution and failure-mode coverage.
- `14-VALIDATION.md` is complete for the whole phase (20/20 tasks), pending only the post-merge gate's confirmation that 14-07's landed diff (in a sibling worktree, not yet merged) does not perturb this plan's assertions — flagged above, no action expected but not independently re-verified against 14-07's actual commits.
- No blockers for phase closeout once the wave's worktrees merge.

## Self-Check: PASSED

- FOUND: `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts`
- FOUND: `.planning/phases/14-auth-lifecycle-debug-logging/14-VALIDATION.md`
- FOUND: `.planning/phases/14-auth-lifecycle-debug-logging/14-06-SUMMARY.md`
- FOUND: commit `eb4895a8` (Task 1)
- FOUND: commit `a07a34bb` (Task 2)
- FOUND: commit `00f1af36` (Task 3)
- FOUND: commit `eee5ff60` (SUMMARY)

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
