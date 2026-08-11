---
phase: 14-auth-lifecycle-debug-logging
plan: 04
subsystem: auth
tags: [nip-42, debug, rxjs, typescript, applesauce-relay]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-01's RelayAuthWireRequest union, helpers/auth-log.ts formatter (describeWireRequest/truncateForLog), and per-method describeRequest thunks"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-03's shared debug-capture harness (captureDebugOutput/messagesOf/withDebugCapture)"
provides:
  - "Relay.authLog — a per-relay :auth sub-namespace Debugger, derived once in the constructor after the url is folded in"
  - "The four relay-side auth-refusal lines (req/count/event/negentropy) rerouted onto authLog with request-describing summaries, replacing the fixed bucketed text"
  - "The full NIP-42 connection track on authLog: challenge received, signing, AUTH sent, result — joined by the full pubkey"
  - "resetState()'s guarded auth-invalidation line, naming the dropped authenticated-pubkey count and whether a challenge was held"
  - "authRetryOperator's shared authRetry config now injects authLog (not the base logger) — plan 14-05's operation track lands on the same namespace without touching relay.ts again"
affects: [14-05, 14-06, 14-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Class-field-plus-constructor-re-derivation for a sub-logger: the field initializer runs before the url is folded into the base logger, so the constructor must re-derive authLog on the line immediately after this.log = this.log.extend(url) or every relay's auth lines collide on one namespace"
    - "Read state BEFORE a guarded clear runs, when the log line needs to describe what is about to be dropped (resetState's authenticatedCount/challengeHeld locals)"

key-files:
  created: []
  modified:
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/relay.test.ts
    - .planning/phases/14-auth-lifecycle-debug-logging/deferred-items.md

key-decisions:
  - "authLog declared as a class field (this.log.extend(\"auth\")) AND re-derived in the constructor right after this.log = this.log.extend(url) — the field initializer runs before the constructor body, off the pre-url this.log, so without the re-derivation every relay's auth lines would collide on one url-less namespace"
  - "The four refusal lines share one phrasing template (\"Relay refused {describeWireRequest(...)} — authentication required: {truncateForLog(reason)}\") so req/count/event/negentropy read as the same event class from output alone"
  - "The signing line lives in authenticate() (the only place signing happens) rather than auth(), and the sent/result lines live in auth() rather than event()'s generic send path — so a consumer who signs their own AUTH event and calls auth() directly still sees the send and the outcome (D-10)"
  - "resetState() reads authenticatedCount (Object.keys(authentications$.value).length) and challengeHeld (challenge$.value !== null) before any of the method's seven guarded clears run, then logs one line only when either is non-zero/true — a never-authenticated reconnect stays silent"

requirements-completed: [ALOG-01]

coverage:
  - id: D1
    description: "Relay.authLog is a dedicated, per-relay :auth sub-namespace, additive under the base relay glob and isolating under its own narrow glob"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (:auth sub-namespace (14-04) > D-13: an auth line is visible under the broad relay glob / D-13: the auth line is still visible under the narrow auth glob...)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The two bucketed one-shot log subscriptions are deleted, and the four relay-side refusal lines (req/count/event/negentropy) are rerouted onto authLog with a request-describing summary (D-06) instead of fixed text"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (:auth sub-namespace (14-04) > D-04/D-06: the bucketed auth-required line is gone, replaced by a line describing the actual refused REQ)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full NIP-42 connection track — challenge received, signing, AUTH sent, result — is logged on authLog, joined by the full pubkey, with the relay's own OK message as the result's why"
    requirement: "ALOG-01"
    verification:
      - kind: manual_procedural
        ref: "DEBUG=applesauce:Relay:wss://test:auth pnpm vitest run packages/relay/src/__tests__/relay.test.ts -t \"RAUTH-01/RAUTH-03: invokes onAuthRequired\" (captured sequence pasted below in Verification)"
        status: pass
    human_judgment: true
    rationale: "The existing suite exercises authenticate()/auth() extensively and none of it regressed, and the additive-namespace tests assert on the challenge line's content, but no dedicated test asserts on the signing/sent/result lines' exact prose — content correctness for those three lines was confirmed by the manual captured-output smoke test only, not a unit assertion."
  - id: D4
    description: "resetState() logs one guarded auth-invalidation line naming the dropped authenticated-pubkey count and whether a challenge was held, only when there was something to invalidate"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (:auth sub-namespace (14-04) > D-12: resetState stays silent... / D-12: resetState names the invalidated auth state...)"
        status: pass
    human_judgment: false

duration: 87min
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 04: Relay :auth Sub-Namespace and NIP-42 Connection-Track Logging Summary

**`Relay` now derives a per-relay `:auth` sub-namespace, retires its last two bucketed-flag log readers, reroutes four relay-side refusal lines onto request-describing summaries, and logs the full NIP-42 connection track (challenge → signing → sent → result) plus a guarded reconnect-invalidation line.**

## Performance

- **Duration:** ~87 min
- **Completed:** 2026-08-11
- **Tasks:** 3/3
- **Files modified:** 3 (2 source, 1 phase-support doc)

## Accomplishments

- Added `Relay.authLog`, a class field derived once in the constructor immediately after the url is folded into the base logger — the re-derivation is load-bearing (a comment in the code explains why) and mirrors `management.ts`'s existing derive-and-store precedent (D-13/D-20).
- Deleted the two internal one-shot `internalSubscriptions` reading `authRequiredForRead$`/`authRequiredForPublish$` — the last internal readers of those subjects (D-04). The public observables, all four write sites, `resetState()`'s two guarded clears, and the `status$` composition are untouched, and `authRequiredForRead$`/`authRequiredForPublish$` remain public API.
- Injected `authLog` into `authRetryOperator`'s shared `authRetry` config, and rerouted the four relay-side auth-refusal lines (`req()`, `count()`, `event()`, `negentropy()`) onto `authLog` with a request-describing summary built from `describeWireRequest`/`truncateForLog` (D-06), replacing the fixed bucketed text.
- Logged the full NIP-42 connection track on `authLog`: challenge received (in `ListenForChallenge`'s `tap`), signing (in `authenticate()`, before `signer.signEvent()` — the only line separating a hung signer from an unresponsive relay, D-09), AUTH sent (in `auth()`, before the send), and result (in `auth()`'s existing `tap`, accepted/rejected plus the relay's own OK message as the why) — all joined by the full 64-character pubkey (D-08).
- Added a guarded `resetState()` invalidation line, reading the authenticated-pubkey count and whether a challenge was held before the method's existing clears run, firing only when either is non-empty (D-12).
- Added a `:auth sub-namespace (14-04)` describe block to `relay.test.ts` with 5 tests, all run inside `withDebugCapture`: two additive-namespace tests (broad glob sees both an auth line and an ordinary line; narrow glob sees only the auth line), one pinning D-04's bucketed-line deletion against the new request-describing refusal line, and two `resetState` invalidation tests (silent when nothing to invalidate, one line naming the count and the challenge when there was).

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive the auth sub-namespace, delete the bucketed readers, and reroute the four refusal lines** - `28e1c396` (feat)
2. **Task 2: The connection track — challenge, signing, sent, result** - `2352e10c` (feat)
3. **Task 3: resetState auth-invalidation line and the namespace/deletion tests** - `dc9a59c8` (feat)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/relay.ts` - `authLog` field + constructor re-derivation; two bucketed-log subscriptions deleted; `authRetryOperator`'s `log:` config switched to `authLog`; four refusal lines rerouted with `describeWireRequest`/`truncateForLog` summaries; challenge/signing/sent/result connection-track lines added; `resetState()`'s guarded invalidation line added
- `packages/relay/src/__tests__/relay.test.ts` - new `:auth sub-namespace (14-04)` describe block (5 tests) using the 14-03 `withDebugCapture` harness
- `.planning/phases/14-auth-lifecycle-debug-logging/deferred-items.md` - new file, logging one out-of-scope pre-existing flaky test found during Task 2 verification

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- `authLog` is both a class field and re-derived in the constructor, because the field initializer runs before the url is folded into `this.log` — skipping the re-derivation would collide every relay's auth lines onto one url-less namespace.
- All four refusal lines share one phrasing template so they read as the same event class regardless of which method (`req`/`count`/`event`/`negentropy`) produced them.
- The signing line lives in `authenticate()` (the only place signing happens) and the sent/result lines live in `auth()` (not `event()`'s generic send path), so a consumer who signs their own AUTH event and calls `auth()` directly still sees the full track (D-10).
- `resetState()` reads its two invalidation facts before any of its seven guarded clears run, and logs conditionally — a never-authenticated reconnect stays silent, matching D-12's intent.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed in the source changes themselves.

One out-of-scope discovery was logged (not fixed) per the scope-boundary rule — see Issues Encountered.

## Issues Encountered

- **Pre-existing flaky test (out of scope, logged not fixed):** `D-15: publish's timeout is suspended across the auth phase` intermittently fails with an unhandled `Error: Timeout has occurred` from `operators/auth-retry.ts:140`. Reproduced identically with `relay.ts` reverted to its Task 1 committed state (i.e. zero Task 2 edits applied), both filtered and unfiltered — confirmed unrelated to this plan's changes, and pre-existing timing sensitivity in a real-timer-based test racing a 40ms handler delay against a 20ms timeout option. Logged to `.planning/phases/14-auth-lifecycle-debug-logging/deferred-items.md` rather than fixed, since none of this plan's tasks touch that test's scenario.
- **Acceptance-criteria grep counts vs. actual counts (plan-authoring imprecision, same pattern as 14-01's documented off-by-ones, not a code defect):**
  - Task 1's `authRequiredForRead$`/`authRequiredForPublish$` grep was expected to return exactly 2 after deleting the internal subscriptions; it returns 4 both before and after my edit's effect is subtracted (declaration line + assignment + `status$` entry + one pre-existing comment mentioning the field name, none of which are internal *subscription* readers). Verified semantically instead: `grep -n` shows no remaining `.pipe(`/`.subscribe(` chain reading either subject — the actual requirement ("every internal subscription is gone") holds.
  - Task 1's `receivedAuthRequiredForReq`/`receivedAuthRequiredForEvent` grep was expected to return 4 each; actual is 5 and 6 respectively, because the plan's count didn't account for the identifier appearing twice on one line inside the switch/guard bodies (once in the condition, once in the `.next(...)` call). Confirmed by direct code inspection that no write, clear, or guard was touched by this plan — the counts are identical whether or not my edits are applied, since I never modified these identifiers' surrounding lines.
  - Task 3's `if (this\.` grep inside `resetState()` was expected to return 7 (matching all seven guarded clears); actual is 6, because one of the seven clears (`if (Object.keys(this.authentications$.value).length > 0) ...`) starts with `if (Object`, not `if (this.`, so it never matched the literal pattern even before this plan's edit. Confirmed by direct reading of the method body that all seven original clears are present, unmodified, and in their original order.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `Relay.authLog` is in place and injected into `authRetryOperator`'s shared config — plan 14-05 can add the operation-track lines directly against `config.log` in `operators/auth-retry.ts` without touching `relay.ts` again, exactly as this plan's `key_links` intended.
- `RelayGroup`'s status$/loaders consumers were re-verified green (`pnpm --filter applesauce-loaders test`: 126/126; `pnpm --filter applesauce-concord test`: 559/559) — the `status$` composition this plan promised not to change stayed unchanged.
- No blockers for 14-05/14-06/14-07.

## Verification

- `pnpm --filter applesauce-relay build` exits 0.
- `pnpm --filter applesauce-relay test` — 272/272 passed (10 files), run twice for stability.
- `pnpm --filter applesauce-loaders test` — 126/126 passed (non-regression check).
- `pnpm --filter applesauce-concord test` — 559/559 passed (non-regression check).
- **RED→GREEN non-vacuity probes (Task 3, mandated by the plan), all performed via temporary `Edit`-tool changes and reverted — never via `git stash`:**
  1. **Test 2 (bucketed line gone) RED:** temporarily restored `this.authLog(\`Auth required for REQ\`)` in place of the request-describing line in `req()`'s CLOSED branch. The new test failed: `AssertionError: expected true to be false` on `captured.some((l) => l.includes("Auth required for REQ"))`.
  2. **Test 2 GREEN:** restored the request-describing line; the test passed again.
  3. **Test 3 (invalidation guard) RED:** temporarily dropped the `if (authenticatedCount > 0 || challengeHeld)` guard in `resetState()` so the line fired unconditionally. The "stays silent when nothing to invalidate" test failed: `AssertionError: expected true to be false` on the invalidation-line-absence assertion.
  4. **Test 3 GREEN:** restored the guard; the test passed again.
- **Manual smoke** — ran with the narrow auth glob set in the environment, capturing the real emitted sequence for a full onAuthRequired → sign → resend → accept round trip plus a subsequent invalidation on disconnect and a NEG-OPEN refusal:
  ```
  DEBUG=applesauce:Relay:wss://test:auth pnpm vitest run packages/relay/src/__tests__/relay.test.ts -t "RAUTH-01/RAUTH-03: invokes onAuthRequired"

  applesauce:Relay:wss://test:auth Relay sent NIP-42 auth challenge: challenge-1
  applesauce:Relay:wss://test:auth Relay refused EVENT 00007641 kind=1 — authentication required: auth-required: need to authenticate
  applesauce:Relay:wss://test:auth Auth required: EVENT 00007641 kind=1 — auth-required: need to authenticate
  applesauce:Relay:wss://test:auth Signing AUTH event for challenge challenge-1, waiting on signer
  applesauce:Relay:wss://test:auth Sending AUTH event for pubkey 1445a7fe20f16907b110e4a52e5e83974df1205ff796fab87bed2bc623e11046
  applesauce:Relay:wss://test:auth Relay accepted AUTH for 1445a7fe20f16907b110e4a52e5e83974df1205ff796fab87bed2bc623e11046: 
  applesauce:Relay:wss://test:auth Invalidating auth state on reset: dropping 1 authenticated pubkey, and the held challenge
  applesauce:Relay:wss://test:auth Relay refused NEG-OPEN V9LRv9ZX kinds=[1] — authentication required: auth-required: need to authenticate
  applesauce:Relay:wss://test:auth Auth required: NEG-OPEN V9LRv9ZX kinds=[1] — auth-required: need to authenticate
  ```
  This reads as prose an operator can follow: a challenge arrives, the first EVENT is refused (both this plan's refusal line and the shared `authRetryOperator`'s own line, now sharing the same `:auth` namespace since Task 1 injected `authLog` into its config), the AUTH event is signed and sent, the relay accepts it, a later reconnect invalidates the one authenticated pubkey and the held challenge, and a subsequent NEG-OPEN is refused the same way an EVENT was. The two `"Auth required: ..."` lines are `authRetryOperator`'s own log call (`operators/auth-retry.ts`, rerouted by Task 1's `log: this.authLog` change) — a different line from this plan's four refusal lines, confirming the injection point plan 14-05 will build on already works.

## Self-Check: PASSED

- FOUND: `packages/relay/src/relay.ts` (authLog field, constructor re-derivation, refusal lines, connection track, resetState line)
- FOUND: `packages/relay/src/__tests__/relay.test.ts` (`:auth sub-namespace (14-04)` describe block)
- FOUND: `.planning/phases/14-auth-lifecycle-debug-logging/deferred-items.md`
- FOUND: commit `28e1c396` (Task 1)
- FOUND: commit `2352e10c` (Task 2)
- FOUND: commit `dc9a59c8` (Task 3)
- FOUND: `.planning/phases/14-auth-lifecycle-debug-logging/14-04-SUMMARY.md`

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
