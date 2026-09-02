---
phase: 13-operation-scoped-nip-42-auth-hooks
verified: 2026-08-07T09:20:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 6/9
  gaps_closed:
    - "RAUTH-03: retry bounded by authRetries — req()/count() reentrancy + OPEN-reset defects (CR-01/CR-02/CR-03 in round-2 numbering) fixed by 13-08..13-10; independently re-confirmed by code read of relay.ts req()/count()"
    - "RAUTH-07: available on all eight operations through Pool/Group — closed for req/count by 13-08..13-10, and the regression CR-02 (13-REVIEW.md, round-3 numbering) that reintroduced the WR-01 defect class at RelayGroup.request() via an `as RelayReqMessage` cast is now closed by 13-14, independently re-verified in this pass with a RED/GREEN revert-and-restore against the live test"
    - "RAUTH-08: SyncLoader threads options into both paths — threading confirmed genuine; the CR-04 (round-2 numbering) synchronous-throw escape from AuthHandlerError mapping is fixed in operators/auth-retry.ts (handler invocation now runs under the catchError)"
  gaps_remaining: []
  regressions: []
---

# Phase 13: Operation-Scoped NIP-42 Auth Hooks Verification Report

**Phase Goal:** NIP-42 authentication moves out of ambient, relay-wide cached flags
(`authRequiredForRead$`/`authRequiredForPublish$` as pre-blocking gates) and into the specific
operation that receives `auth-required:` — `req`, `request`, `subscription`, `count`, `publish`,
`event`, `sync`, and negentropy each expose `onAuthRequired`/`authTimeout`/`authRetries`, passed
through `RelayPool`/`RelayGroup` and threaded into `applesauce-loaders`' `SyncLoader` on both its
negentropy and paginated paths.

**Verified:** 2026-08-07T09:20:00Z
**Status:** passed
**Re-verification:** Yes — third round, after gap-closure plans 13-08..13-14

## Critical Input Disposition

This is the third verification pass on this phase. Round 1 (13-07's own validation) marked all nine
RAUTH requirements complete based only on the existing test suite. Round 2 (the prior
`13-VERIFICATION.md`, superseded by this file) independently reproduced live defects against the real
`Relay`/`vitest-websocket-mock` and reopened RAUTH-03/07/08 with concrete repros (unbounded `req()`
retries, dropped resends on `req()`/`count()` under a synchronous handler, a synchronous
`onAuthRequired` throw escaping `AuthHandlerError` mapping). Plans 13-08..13-13 closed those gaps. A
subsequent code review (`13-REVIEW.md`, gap-closure round) then found that plan 13-11 had
**reintroduced the identical defect class one layer up**: `RelayGroup.request()`'s `firstWhen`
predicate cast away `GroupReqErrorMessage` (`as RelayReqMessage`), so the group's own per-relay
`ERROR` bookkeeping value satisfied the first-emission gate and permanently cancelled the group's
operation clock (CR-02, this round's numbering) — the exact WR-01 "bookkeeping value counted as
progress" shape at a new site.

**This verifier's own findings, independent of all prior narration:**

1. Re-read `packages/relay/src/relay.ts`'s `req()`/`count()` implementations directly (not the
   SUMMARYs describing them) and confirmed the send/listen split described by 13-09/13-10 is real:
   both build the send side effect and terminating listen chain fresh inside one unshared `defer` per
   attempt, and `req()`'s `authRetryOperator` call passes `isReqProgress` (not `() => true`) as its
   progress predicate — this is the code-level fix for the round-2 CR-01 (OPEN resetting the D-08
   counter) and CR-02/CR-03 (dropped resend under a synchronous handler) findings.
2. Re-read `packages/relay/src/operators/auth-retry.ts` and confirmed `config.onAuthRequired?.(context)`
   now runs inside a `defer` whose result is piped through a `catchError` that maps both promise
   rejections and synchronous throws to `AuthHandlerError` — the fix for round-2's CR-04.
3. Independently verified the CR-02 (round-3) fix at `packages/relay/src/group.ts` — `isGroupReqProgress`
   is exported, narrows `GroupReqMessage` with an early `if (message.type === "ERROR") return false`
   before delegating to the unmodified `isReqProgress`, and `request()`'s `suspendableTimeout` call
   passes it directly with **no** `as RelayReqMessage` cast anywhere in the file (`grep -c` = 0).
4. **Did not stop at "the code looks right."** Temporarily reverted `group.ts`'s `firstWhen` to the
   pre-fix `(message: GroupReqMessage) => isReqProgress(message as RelayReqMessage)` and re-ran the
   CR-02 regression test in isolation: it failed with `Test timed out in 5000ms` — the exact hang the
   review reported (no error, no completion). Restored the fix from a clean backup, confirmed
   `git status --short packages/relay/src/group.ts` was empty, and re-ran the suite green (27/27).
   This test is not vacuous — it discriminates the defect it claims to catch.
5. Ran the full workspace suite (`pnpm vitest run`) fresh in this session: **2585 passed / 2 skipped /
   0 failed** across 274 files, matching the handoff claim exactly (not merely accepted from
   SUMMARY.md).
6. Ran `pnpm exec turbo build --filter='./packages/*'`: **14/14 successful**.

**On CR-01 (negentropy never sends its follow-up `NEG-MSG`) and CR-03 (`parseClosedError` walks the
prototype chain):** both are recorded in `13-REVIEW.md` as reproduced live defects, but the phase
history states these were audited as pre-existing (not this phase's work) and deliberately deferred to
backlog by explicit user decision on 2026-08-06. I confirmed both backlog entries exist —
`.planning/ROADMAP.md` § Phase 999.13 (negentropy hang, traced to `f649d6dd`, 2025-10-27) and § Phase
999.14 (prototype-chain lookup, traced to `6c806776`, an ancestor of this phase's first commit) — each
citing `13-REVIEW.md`'s CR-01/CR-03 findings and the deferral decision by name. **I agree with the
deferral.** Neither finding is reachable through the auth-required signal path this phase's success
criteria describe: CR-01 requires a multi-round negentropy negotiation unrelated to whether
`onAuthRequired`/`authTimeout`/`authRetries` are threaded or honored, and CR-03 is a general
`CLOSED`-reason-parsing defect that predates the phase and affects every `CLOSED` prefix, not
specifically `auth-required:`. Neither is re-raised as a phase-13 gap here.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | RAUTH-01: Handler receives operation-local context (relay, url, challenge, operation, requirement, missingPubkeys, reason) exactly when that operation itself receives `auth-required:` | ✓ VERIFIED | `buildAuthContext` (relay.ts:766-774) assembles all seven fields from `missingPubkeysFor`; unchanged since round 2 and unaffected by CR-02; `relay.test.ts` (158/158 green) asserts exact object shape on invocation |
| 2 | RAUTH-02: An operation not itself auth-required is never pre-blocked by an earlier unrelated operation | ✓ VERIFIED | Ambient `waitForAuth()` pre-block remains deleted at all four sites; ~carried forward unchanged from round 2, not implicated by any round-3 finding |
| 3 | RAUTH-03: After the handler resolves, the operation waits for `waitForAuth` and retries, bounded by `authRetries` (default 1) and `authTimeout` (default 30_000ms / false) | ✓ VERIFIED | `req()`'s `authRetryOperator` now passes `isReqProgress` (relay.ts:998) instead of `() => true`, so its synthetic `OPEN` no longer resets the D-08 counter; `req()`/`count()` build send+listen fresh per attempt inside one unshared `defer` (relay.ts:889-983), closing the dropped-resend defect; code-read confirmed directly, not from SUMMARY narration |
| 4 | RAUTH-04: `authTimeout` bounds the wait; `false` waits indefinitely | ✓ VERIFIED | Per-phase clock in `operators/auth-retry.ts`, independent of the retry-count fix; unaffected by any round-3 finding; `relay.test.ts` real-timer tests green |
| 5 | RAUTH-05: Two concurrent operations against the same relay each invoke their own handler independently, no relay-internal dedupe | ✓ VERIFIED | `relay.test.ts`/`group.test.ts` concurrent-handler tests green (27/27 in group.test.ts, 158/158 in relay.test.ts); not implicated by CR-02 (a single-operation clock defect) |
| 6 | RAUTH-06: `waitForAuth: false` rejects immediately with `AuthRequiredError`, handler never called; `event(…, "AUTH")` never invokes it | ✓ VERIFIED | Short-circuits unchanged since round 2; `relay.test.ts` tests green |
| 7 | RAUTH-07: Available on all 8 operations, passes through `RelayPool`/`RelayGroup` | ✓ VERIFIED | `req`/`count` fixed (see truth 3); `RelayGroup.request()` now threads `AuthPhaseGate` into `relay.req()` (group.ts:254-277) and its own `suspendableTimeout` uses `isGroupReqProgress` — total over `GroupReqMessage`, no cast (`grep -c 'as RelayReqMessage' group.ts` = 0). Independently RED/GREEN-verified in this pass (see Critical Input Disposition #4), not merely accepted from the SUMMARY |
| 8 | RAUTH-08: `SyncLoader` threads `onAuthRequired`/`authTimeout`/`authRetries` into negentropy and paginated paths identically | ✓ VERIFIED | Threading via `relayMethodOptions` (sync-loader.ts) genuine and tested (39/39 green); paginated path now inherits `req()`'s fixed retry/resend behavior; CR-04's synchronous-throw escape is closed in `auth-retry.ts`, so `RELAY_AUTH_ERROR_NAMES`'s no-fallback guard (sync-loader.ts:89, D-16) is no longer bypassable by that route |
| 9 | RAUTH-09: `authRequiredForRead$`/`authRequiredForPublish$` keep updating as informational status only | ✓ VERIFIED | `receivedAuthRequiredForReq`/`receivedAuthRequiredForEvent` still flip independent of retry outcome (relay.ts:931,1056,1147-1149,1262); `resetState()` clears both on disconnect (unchanged); not implicated by any round-3 finding |

**Score:** 9/9 truths verified (0 present-but-broken; 0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/relay/src/operators/auth-retry.ts` | Shared D-04 operator: handler invocation, retry counting, error mapping, gate suspension | ✓ VERIFIED | `authRetry`/`AuthPhaseGate`/`suspendableTimeout` all present; `onAuthRequired` invocation is under `catchError` (closes round-2 CR-04); `isProgress`/`firstWhen` are required (non-optional) parameters, forcing every call site to state its predicate explicitly |
| `packages/relay/src/relay.ts` (req/count/event/negentropy sites) | Four sites normalize the auth-required signal and delegate to the shared operator (D-02) | ✓ VERIFIED | All four call `authRetryOperator` with a real progress predicate (`isReqProgress` for req, `() => true` for count/event/sync — count/event/sync responses carry no bookkeeping value, so permissive is correct there); send/listen reentrancy fixed at all sites per 13-09/13-10/13-05 |
| `packages/relay/src/group.ts` | RelayGroup pass-through + D-15 gate threading on `request()` | ✓ VERIFIED | `request()` threads a shared `AuthPhaseGate` into `relay.req()` and uses `isGroupReqProgress` (total over `GroupReqMessage`, no cast) for its own `suspendableTimeout` — the CR-02 fix, independently RED/GREEN re-verified in this pass |
| `packages/relay/src/pool.ts` | RelayPool pass-through of all four options | ✓ VERIFIED | `pool.test.ts` (26/26 green) asserts call-argument forwarding; pool methods are pure one-line delegations to `RelayGroup`, confirmed by 13-14's own Task 2 audit and a fresh grep in this pass showing zero predicate/gate boundaries in `pool.ts` |
| `packages/loaders/src/loaders/sync-loader.ts` | Threads `onAuthRequired`/`authTimeout`/`authRetries` into negentropy + paginated paths; D-16 stall-guard suspension and no-fallback-on-auth guard | ✓ VERIFIED | Threading genuine and tested (39/39 green); D-16 guard (`RELAY_AUTH_ERROR_NAMES`) no longer bypassable via CR-04's route now that the handler-throw path is mapped upstream |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `Relay.req()` | `operators/auth-retry.ts::authRetry` | `this.authRetryOperator("read", opts, gate, isReqProgress)` (relay.ts:998) | ✓ WIRED | Progress predicate now discriminates the synthetic `OPEN` from real progress |
| `Relay.count()` | `operators/auth-retry.ts::authRetry` | `authOperator` (relay.ts:1022) | ✓ WIRED | Send/listen reentrancy fixed per attempt (CR-03, round-2 numbering) |
| `Relay.event()`/`publish()` | `operators/auth-retry.ts::authRetry` | `authRetryOperator("publish", ...)` | ✓ WIRED | Unchanged from round 2, still correct |
| `Relay.negentropy()`/`sync()` | `operators/auth-retry.ts::authRetry` | `NegentropyError` translation (D-02) | ✓ WIRED | Unchanged from round 2, still correct (multi-round hang is CR-01, deferred as pre-existing) |
| `RelayGroup.request()` | `Relay.req()` | `relay.req(filters, {...opts, reconnect, [AUTH_PHASE_GATE]: gate})` (group.ts:270-277) | ✓ WIRED | `AuthPhaseGate` now threaded (closes round-2's WR-02 gap); `isGroupReqProgress` closes CR-02 (round-3) |
| `SyncLoader` | `relay.request()` / `relay.sync()` | `relayMethodOptions` | ✓ WIRED | Both paths forward all three options; paginated path inherits `req()`'s now-fixed behavior |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-02 regression test is non-vacuous | Reverted `group.ts`'s `firstWhen` to the pre-fix cast, ran `pnpm vitest run packages/relay/src/__tests__/group.test.ts -t "CR-02"` | `Test timed out in 5000ms` (RED, matches the review's reported hang) | ✓ PASS (defect reproduced) |
| CR-02 fix restored | Restored `group.ts` from backup, `git status --short` empty, re-ran suite | 27/27 pass | ✓ PASS |
| Full workspace suite | `pnpm vitest run` | 2585 passed / 2 skipped / 0 failed, 274 files | ✓ PASS |
| Full monorepo build | `pnpm exec turbo build --filter='./packages/*'` | 14/14 successful | ✓ PASS |
| `relay.test.ts` | `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` | 158/158 pass | ✓ PASS |
| `pool.test.ts` | `pnpm vitest run packages/relay/src/__tests__/pool.test.ts` | 26/26 pass | ✓ PASS |
| `sync-loader.test.ts` | `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | 39/39 pass | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| RAUTH-01 | 13-01, 13-02 | Operation-local handler context | ✓ SATISFIED | Truth #1 |
| RAUTH-02 | 13-02, 13-04, 13-05, 13-06 | No pre-block by unrelated operation | ✓ SATISFIED | Truth #2 |
| RAUTH-03 | 13-01, 13-02, 13-04, 13-05, 13-06, 13-08, 13-09, 13-10, 13-12, 13-14 | Retry bounded by authRetries | ✓ SATISFIED | Truth #3; round-2 gap closed by 13-08..13-10 |
| RAUTH-04 | 13-01, 13-02, 13-05, 13-06 | authTimeout bounds the wait | ✓ SATISFIED | Truth #4 |
| RAUTH-05 | 13-02, 13-07 | Concurrent independence, no dedupe | ✓ SATISFIED | Truth #5 |
| RAUTH-06 | 13-01, 13-02, 13-06 | waitForAuth:false / AUTH short-circuit | ✓ SATISFIED | Truth #6 |
| RAUTH-07 | 13-01, 13-02, 13-05, 13-06, 13-07, 13-08, 13-09, 13-10, 13-11, 13-12, 13-14 | Available on all 8 ops, through Pool/Group | ✓ SATISFIED | Truth #7; round-2 gap closed by 13-08..13-10; round-3 regression (CR-02) closed by 13-14 |
| RAUTH-08 | 13-03, 13-06, 13-07, 13-08, 13-12, 13-13 | SyncLoader threads options into both paths | ✓ SATISFIED | Truth #8; round-2 gap closed |
| RAUTH-09 | 13-02, 13-06, 13-07 | Informational status flags | ✓ SATISFIED | Truth #9 |

No orphaned requirements — all nine RAUTH-01..09 IDs appear in at least one plan's `requirements:` frontmatter and are cross-referenced above.

### Anti-Patterns Found

Residual findings from `13-REVIEW.md`'s Warning tier (11 items) that were **not** addressed by plan
13-14 (whose explicit scope was CR-02 only) and remain open. None of these invalidate a phase-13 must-have
truth as stated in the roadmap's five success criteria — each is either a code-quality/documentation gap,
an orthogonal robustness edge case, or affects diagnostic bookkeeping rather than the auth-required
signal/retry/timeout contract itself. Listed for completeness and follow-up, not as blockers:

| File | Finding | Severity | Why non-blocking |
|------|---------|----------|-------------------|
| `packages/relay/src/relay.ts:955-969` | WR-01 (13-REVIEW numbering): a synchronous auth retry can wipe `req()`'s public `reqs$` tracking (last-writer-wins add/remove race) — confirmed still present by code read | ⚠️ Warning | Affects only the `reqs$` diagnostic `BehaviorSubject`, not message send/resend or retry bounding; review notes nothing in-package consumes `reqs$` today |
| `packages/relay/src/relay.ts:136-159`, `sync-loader.ts:83-90` | WR-02: no test pins the `AuthRequiredError`/`AuthHandlerError`/`AuthTimeoutError` `.name` strings that `SyncLoader`'s D-16 guard duck-types against — confirmed no such test exists | ⚠️ Warning | The guard works today (verified: CR-04's escape route is closed); this is a regression-prevention gap, not a current defect |
| `packages/relay/src/relay.ts:1182,1489` | WR-03: `event()`/`publish()`'s progress predicate is `() => true` with a comment ("PublishResponse carries no bookkeeping value") that is false for the synthetic timeout response — confirmed still present | ⚠️ Warning | Review's own analysis: the synthetic value also terminates the stream, so no unbounded retry loop results — invariant violated in comment/documentation sense only |
| `packages/loaders/src/loaders/sync-loader.ts:595-641` | WR-04: the negentropy `catchError`'s non-auth fallback path does not call `forceCloseAuthPhases()` before starting the paginated fallback — confirmed still present (only the terminal `finalize` calls it) | ⚠️ Warning | Narrow race: only manifests when a non-auth negentropy failure occurs while an auth phase is still open; does not violate D-16's "auth-required must not trigger fallback" guarantee, which is enforced separately via `RELAY_AUTH_ERROR_NAMES` |
| `packages/relay/src/relay.ts:1554-1573` | WR-05: `Relay.sync()`'s RECEIVE branch rejects with `EmptyError` when a relay EOSEs with zero events — confirmed still present (no `defaultValue`) | ⚠️ Warning | Orthogonal to auth threading; a pre-existing sync-correctness edge case in a call site this phase added `authOptions` to, not a defect in the auth behavior itself |
| `packages/relay/src/group.ts` | WR-06: `RelayGroup.request()`'s `timeout` has no documented wall-clock ceiling across N auth-gated relays | ⚠️ Warning | Still bounded (not infinite); a documentation gap, not a hang |
| `packages/relay/src/index.ts`, `exports.test.ts:24` | WR-07: `isReqProgress` is exported from the public barrel, contradicting the package's stated "not barrel-exported" convention for internal predicates | ℹ️ Info | API-surface hygiene only |
| `packages/relay/src/operators/auth-retry.ts:142-146` | WR-08: `suspendableTimeout`'s `arm()` does not clear a previously-armed timer | ℹ️ Info | Review states this path is currently unreachable (`gate.active$` is `distinctUntilChanged`) |
| `packages/relay/src/types.ts:169-176` | WR-09: stale doc on `RelayRequestOptions.timeout`; `timeout: 0` now silently disables the clock instead of firing immediately | ℹ️ Info | Documentation drift |
| `operators/auth-retry.ts` vs `sync-loader.ts` | WR-10: two near-duplicate suspendable-clock implementations have diverged undocumented | ℹ️ Info | Structural, by design (D-06 forbids sharing across the package boundary) |
| `packages/loaders/src/loaders/sync-loader.ts:248,611` | WR-11: `.extend()` called inline at log call sites instead of hoisted | ℹ️ Info | Code-style only |

No `TBD`/`FIXME`/`XXX` debt markers found in any phase-modified file (re-confirmed in this pass).

### Human Verification Required

None — all findings above were confirmed programmatically: code reading of the actual source (not
SUMMARY narration), fresh full-suite and full-build runs in this session, and an independent
revert-and-restore non-vacuity check on the CR-02 regression test.

### Gaps Summary

No gaps remain against the phase's five roadmap success criteria or RAUTH-01..09. The round-2 gaps
(RAUTH-03/07/08, reopened for `req()`/`count()` reentrancy and retry-counting defects plus a
synchronous-handler-throw escape) were genuinely closed by plans 13-08..13-13, independently confirmed
by direct code reading rather than trusting SUMMARY claims. The round-3 regression (CR-02: plan 13-11
reintroduced the identical "bookkeeping value counted as progress" defect class one layer up, in
`RelayGroup.request()`'s cast-defeated predicate) is closed by plan 13-14, independently re-verified in
this pass with a revert-and-restore RED/GREEN check that confirmed the regression test genuinely
discriminates the defect rather than passing vacuously against both states. CR-01 (negentropy hang) and
CR-03 (`parseClosedError` prototype pollution) are correctly excluded from this phase's scope per the
explicit user deferral decision, backed by git-blame provenance showing both predate this phase's first
commit, and neither is reachable through the `auth-required:` signal path this phase's requirements
describe. Eleven Warning/Info-tier findings from `13-REVIEW.md` remain open (13-14's scope was CR-02
only) — none of them, on independent review, invalidate a must-have truth; they are listed above as
follow-up debt, most naturally scoped to a future gap-closure plan or backlog promotion rather than
blocking this phase.

REQUIREMENTS.md's RAUTH-01..09 rows are all marked Complete, and this verification independently
confirms that status is now accurate (round 1's Complete marking was not — round 2 correctly reopened
three of them; this round closes them for real).

---

## Phase 24 Supersession Verification (2026-09-02)

Phase 13 plans 13-01 through 13-14 are historical and collectively superseded for negentropy/sync behavior by Phase 24.

- **RESID-03(A) VERIFIED:** the loader closes its open auth phase before fallback construction/subscription, allowing the fallback clock to re-arm; the named fallback timeout test passes.
- **RESID-03(B) VERIFIED:** zero-event RECEIVE EOSE completes without `EmptyError`; the named empty RECEIVE test passes.

_Verified: 2026-08-07T09:20:00Z_
_Verifier: Claude (gsd-verifier)_
