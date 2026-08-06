---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 12
subsystem: relay
tags: [rxjs, applesauce-relay, applesauce-loaders, nip-42, auth, gap-closure, changesets]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 08)
    provides: "CR-01/CR-04/WR-01 fixed at auth-retry.ts's source (ProgressPredicate<T>, isReqProgress, synchronous-throw-to-AuthHandlerError mapping)"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 09)
    provides: "req()'s per-attempt send/listen split (CR-02) and REQ-side wire-trace proofs"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 10)
    provides: "count()'s per-attempt send/listen split (CR-03) and the eight-site + group/pool audit"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 11)
    provides: "RelayGroup.request()'s AuthPhaseGate threading (WR-02) and hoisted logger (WR-06)"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 13)
    provides: "SyncLoader's unconditional auth-phase wrapper (WR-03) and leak-free auth-phase timer (WR-04)"
provides:
  - "Loader contract tests exercising all three RELAY_AUTH_ERROR_NAMES strings against the D-16 no-fallback guard, paired with the file's existing negative control"
  - "A paginated-path exact-call-count bound test pinning that SyncLoader adds no unbounded retry on top of relay.request()'s own terminal auth failure"
  - "Eight single-sentence changesets — one per distinct published fix landed by plans 13-08 through 13-11 and 13-13 — six applesauce-relay, two applesauce-loaders"
  - "RAUTH-03, RAUTH-07, and RAUTH-08 marked Complete in REQUIREMENTS.md, closing the gap-closure wave 13-VERIFICATION.md opened"
affects: [15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-package contract test via duck-typed error .name string, not an applesauce-relay import — D-06's package-decoupling constraint applied to test authoring, not just production code"

key-files:
  created: []
  modified:
    - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
    - .changeset/relay-auth-retry-bound-not-reset-by-req-open.md
    - .changeset/relay-auth-handler-sync-throw-mapped.md
    - .changeset/relay-auth-resend-req-count-observed.md
    - .changeset/relay-request-timeout-can-fire.md
    - .changeset/relay-group-request-timeout-suspended.md
    - .changeset/relay-group-logger-routing.md
    - .changeset/sync-loader-handlerless-stall-suspension.md
    - .changeset/sync-loader-auth-phase-timer-leak-fixed.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "req()'s CR-02 fix and count()'s CR-03 fix are described by ONE changeset ('resends the REQ and the COUNT'), not two — they are the same user-visible behavior class (a synchronous auth phase now resends and observes the reply) landing on two call sites in separate plans (13-09, 13-10), matching the plan's own artifacts_produced grouping"
  - "All eight new changesets are patch, not minor — every one restores a contract already documented and shipped as minor by plans 13-01..13-07 (bounded retries, authTimeout, D-15 suspension, D-19 isolation); none of the eight adds a new option, changes a default, or removes anything a consumer could depend on. The only prior minor-vs-patch precedent that applies here (relay-auth-timeout-bounded-wait) was minor because it introduced a new bounded-by-default behavior where none existed before — these eight fix cases where that already-documented default silently failed to hold"
  - "The two new loader-side D-16 tests (AuthRequiredError/AuthHandlerError names) were verified non-vacuous by temporarily narrowing RELAY_AUTH_ERROR_NAMES to only 'AuthTimeoutError' — both failed as expected (state read 'complete' instead of 'error'), then the source was restored via `git checkout --` (git diff empty, confirmed). The paginated-path bound test is a structural pin (paginatedRequest never had its own retry loop to remove), not a regression test for an open bug in this plan — its counterpart proof of the wire-level bound is plan 13-09's; recorded here rather than silently treated as equivalent to a RED-verified fix"

requirements-completed: [RAUTH-03, RAUTH-07, RAUTH-08]

coverage:
  - id: D1
    description: "SyncLoader's D-16 no-fallback guard is proven to fire for all three RELAY_AUTH_ERROR_NAMES strings (AuthRequiredError, AuthHandlerError, and the pre-existing AuthTimeoutError case), paired with the file's existing negative control for an unrecognised name"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-12: D-16 all-name coverage and the paginated path's own bound > errors the relay without falling back when negentropy sync fails with a AuthRequiredError name (D-16)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-12: D-16 all-name coverage and the paginated path's own bound > errors the relay without falling back when negentropy sync fails with a AuthHandlerError name (D-16)"
        status: pass
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > createSyncLoader > errors the relay without falling back when negentropy sync fails with an auth error name (D-16) (pre-existing, AuthTimeoutError)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The paginated request path does not layer its own unbounded retry on top of relay.request()'s own terminal (authRetries-exhausted) auth failure — exactly one request() call, not a ceiling"
    requirement: "RAUTH-08"
    verification:
      - kind: unit
        ref: "packages/loaders/src/loaders/__tests__/sync-loader.test.ts > 13-12: D-16 all-name coverage and the paginated path's own bound > does not add its own retry layer on top of the paginated path's own terminal auth failure"
        status: pass
    human_judgment: false
  - id: D3
    description: "Eight single-sentence changesets, one per distinct fix landed by plans 13-08 through 13-11 and 13-13, cover every published-package source change in the gap-closure wave"
    verification:
      - kind: other
        ref: "pnpm changeset status (no malformed-changeset error; applesauce-relay/applesauce-loaders both report pending bumps); git diff --stat .changeset/ shows 8 new files"
        status: pass
    human_judgment: false
  - id: D4
    description: "RAUTH-03, RAUTH-07, and RAUTH-08 are marked Complete in REQUIREMENTS.md (checkbox list and Traceability table) only after every phase-touched suite is green"
    requirement: "RAUTH-03, RAUTH-07, RAUTH-08"
    verification:
      - kind: unit
        ref: "pnpm --filter applesauce-relay test (244/244), pnpm --filter applesauce-loaders test (125/125), pnpm vitest run (full workspace, 2583 passed / 2 skipped)"
        status: pass
      - kind: other
        ref: "git diff --numstat .planning/REQUIREMENTS.md == 6 changed / 6 added lines"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 12: RAUTH-08 Loader Contract Tests, Changesets, and Requirement Ledger Closure Summary

**Added the two loader-side contract tests RAUTH-08's remaining gap needed (all three `RELAY_AUTH_ERROR_NAMES` strings exercised against the D-16 no-fallback guard, plus a paginated-path exact-call-count bound), wrote eight single-sentence changesets — one per distinct fix landed across plans 13-08 through 13-11 and 13-13 — and, only once every phase-touched suite ran green, flipped RAUTH-03/07/08 from In Progress to Complete against named tests and their recorded RED symptoms rather than against a suite that never exercised the defects.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-06T23:31:00Z (approx.)
- **Completed:** 2026-08-06T23:35:25Z
- **Tasks:** 3
- **Files modified:** 10 (1 test file, 8 new changesets, 1 planning doc)

## Accomplishments

- `sync-loader.test.ts` gained a new `describe("13-12: D-16 all-name coverage and the paginated path's own bound", ...)` block: an `it.each` covering `"AuthRequiredError"` and `"AuthHandlerError"` (the two of three `RELAY_AUTH_ERROR_NAMES` strings the file's pre-existing D-16 tests did not exercise — only `"AuthTimeoutError"` was covered before), plus a paginated-path test pinning that a `request()` mock rejecting with the exhausted-`authRetries` terminal error name (`"AuthRequiredError"`) is called exactly once, not looped
- Both new name-coverage cases were independently confirmed non-vacuous: temporarily narrowing `RELAY_AUTH_ERROR_NAMES` to `{"AuthTimeoutError"}` made both fail (`state` read `"complete"` instead of `"error"`), then the source was restored clean via `git checkout --`
- Eight new `.changeset/` files, one per distinct fix landed by plans 13-08 through 13-11 and 13-13 (six `applesauce-relay` patches, two `applesauce-loaders` patches), each a single sentence with no bullets or code fences, validated by `pnpm changeset status` reporting no malformed changeset
- `.planning/REQUIREMENTS.md` updated with exactly six changed lines: RAUTH-03/07/08 checked in the requirement list and flipped to `Complete` in the Traceability table, only after `applesauce-relay` (244/244), `applesauce-loaders` (125/125), each of the five individually-named test files, both package builds, and the full workspace suite (2583 passed / 2 skipped, up from 13-11's 2580 by exactly the 3 tests this plan added) all ran green

## Task Commits

Each task was committed atomically:

1. **Task 1: Loader contract tests for the paginated bound and the D-16 no-fallback guard** - `161c815c` (test)
2. **Task 2: One single-sentence changeset per distinct published fix** - `1be34ca0` (docs)
3. **Task 3: Verify the whole phase green, then close RAUTH-03, RAUTH-07 and RAUTH-08** - `3d640d78` (docs)

## Files Created/Modified

- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` - new `describe("13-12: D-16 all-name coverage and the paginated path's own bound", ...)` block (3 tests: 2 via `it.each`, 1 standalone), placed after the file's existing 13-13 describe block per the file's established append-only-at-the-end convention for gap-closure additions
- `.changeset/relay-auth-retry-bound-not-reset-by-req-open.md` - CR-01 (13-08): `req()`/`request()`/`subscription()` auth-required retries now correctly bounded by `authRetries`
- `.changeset/relay-auth-handler-sync-throw-mapped.md` - CR-04 (13-08): a synchronously-throwing `onAuthRequired` handler now maps to `AuthHandlerError`
- `.changeset/relay-auth-resend-req-count-observed.md` - CR-02 + CR-03 (13-09, 13-10): a synchronous auth phase now resends the REQ/COUNT and observes the reply
- `.changeset/relay-request-timeout-can-fire.md` - WR-01 (13-08/13-09): `request()`'s own operation timeout can now actually fire
- `.changeset/relay-group-request-timeout-suspended.md` - WR-02 (13-11): `RelayGroup.request()`'s timeout now suspends across a relay's auth phase
- `.changeset/relay-group-logger-routing.md` - WR-06 (13-11): `RelayGroup` diagnostics now route through the package's debug logger
- `.changeset/sync-loader-handlerless-stall-suspension.md` - WR-03 (13-13): `SyncLoader`'s stall guard suspends for a handler-less caller too
- `.changeset/sync-loader-auth-phase-timer-leak-fixed.md` - WR-04 (13-13): `SyncLoader`'s auth-phase timer no longer outlives its phase or the run
- `.planning/REQUIREMENTS.md` - RAUTH-03/07/08 checked and marked `Complete`; nothing else touched

## Decisions Made

- `req()`'s CR-02 fix (13-09) and `count()`'s CR-03 fix (13-10) are described by **one** changeset, not two — they are the same user-visible behavior class (a synchronous auth phase now genuinely resends and observes the reply) landing on two call sites across two plans, matching the plan's own `artifacts_produced` grouping (six `applesauce-relay` changesets listed, not seven)
- All eight new changesets use `patch`, not `minor` — every one restores a contract already documented and shipped as `minor` by plans 13-01 through 13-07 (bounded retries, `authTimeout`, D-15 suspension, D-19 isolation); none of the eight adds a new option, changes a default, or removes anything a consumer could depend on. `relay-auth-timeout-bounded-wait` (13-01/13-02's precedent) was `minor` because it introduced a new bounded-by-default behavior where none existed before — these eight instead fix cases where that already-shipped default silently failed to hold in practice
- The two new loader-side D-16 tests were verified non-vacuous empirically (narrow `RELAY_AUTH_ERROR_NAMES`, observe both fail, restore). The paginated-path bound test is recorded as a **structural pin**, not a RED-verified regression test — `paginatedRequest` never had its own retry loop to remove, so there is no pre-fix state to revert to; the wire-level bound it pins on is proven RED→GREEN by plan 13-09's own tests

## Deviations from Plan

None — plan executed exactly as written. Task 1's non-vacuity verification (temporarily narrowing `RELAY_AUTH_ERROR_NAMES`) was not explicitly required by this plan's acceptance criteria but follows the phase's standing D-20 Verification Standard; recorded as an addition in the interest of rigor, not a deviation from scope.

## Issues Encountered

None.

## Non-Vacuity Verification (RED → GREEN)

- **D-16 all-name coverage (`AuthRequiredError`/`AuthHandlerError` cases):** temporarily changed `RELAY_AUTH_ERROR_NAMES` to `new Set(["AuthTimeoutError"])`. RED symptom: both new test cases failed with `AssertionError: expected 'complete' to be 'error'` — the guard no longer recognized either name, so the negentropy failure incorrectly fell back to the paginated request and completed instead of erroring. Restored via `git checkout -- packages/loaders/src/loaders/sync-loader.ts`; `git diff` confirmed empty afterward.
- **Paginated-path bound test:** not independently RED-verified via hand-edit in this run — `paginatedRequest` (sync-loader.ts) has no retry loop of its own to temporarily break; the bound it pins on is a property of the injected `request` function's own return value, already proven RED→GREEN at the wire level by plan 13-09's `T-13-09-01` test. Recorded here per the same precedent 13-11 set for its gate-instance-identity test (a structural fact stated rather than an independently reverted RED).

## Verification Results

- `pnpm vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` — 39/39 pass (36 pre-existing + 3 new)
- `pnpm --filter applesauce-loaders build` — exits 0
- `git diff packages/loaders/package.json` — empty, no dependency added
- `pnpm --filter applesauce-relay test` — 244/244 pass across 9 files
- `pnpm --filter applesauce-loaders test` — 125/125 pass across 16 files
- `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — 158/158 pass
- `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts` — 16/16 pass
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts` — 25/25 pass
- `pnpm vitest run packages/relay/src/__tests__/pool.test.ts` — 26/26 pass
- `pnpm --filter applesauce-relay build` and `pnpm --filter applesauce-loaders build` — both exit 0
- `pnpm vitest run` (full workspace) — 274 passed / 1 skipped (275 files), 2583 passed / 2 skipped (2585 tests) — no regression, up from 13-11's 2580/2 by exactly this plan's 3 new tests
- `git diff --numstat .planning/REQUIREMENTS.md` — 6 lines changed, 6 lines added
- `grep 'RAUTH' .planning/REQUIREMENTS.md | grep -c 'Complete'` — 9 (all nine RAUTH rows now Complete)
- `pnpm changeset status` — reports pending `minor` bumps for `applesauce-relay`/`applesauce-loaders` (already pending from 13-01..13-07's changesets); no malformed-changeset error

## Requirement Closure Evidence (RAUTH-03 / RAUTH-07 / RAUTH-08)

Per the plan's explicit instruction, a flip justified only by "suite green" repeats 13-VERIFICATION.md's own root-cause mistake. Each requirement below is mapped to the specific test(s) that close it and the RED symptom each was validated against, drawn from this plan's own Task 1 work plus the four upstream plans this wave sequence comprised:

- **RAUTH-03** ("After the handler resolves, the operation waits ... bounded by authRetries"):
  - CR-01 (unbounded retry via OPEN resetting the D-08 counter) — `auth-retry.test.ts#does not let a non-progress bookkeeping value reset the consecutive counter (CR-01)` (13-08). RED: `AssertionError: expected 6 to be 2` (subscribeCount hit the fixture's 5-subscription cap instead of exhausting at 2).
  - CR-02 (req() drops the resend under a synchronous handler) — `relay.test.ts#CR-02: a synchronously-resolving auth phase produces a real REQ resend whose reply is observed` (13-09). RED: `Error: expect(WS).toReceiveMessage(expected) — ... didn't receive anything in 1000ms`.
  - CR-03 (count() resends into a dead listen stream) — `relay.test.ts#CR-03: a synchronously-resolving auth phase produces a real COUNT resend whose reply is observed` (13-10). RED: `AssertionError: expected true to be false` on `spy.receivedComplete()` immediately after the second COUNT frame.
- **RAUTH-07** ("available on all eight operations ... through RelayPool/RelayGroup"):
  - Inherits the RAUTH-03 fixes above (req/count are 2 of the 4 originally-broken sites; event()/sync() were already correct per 13-05/13-06).
  - WR-01 (request()'s clock never fires) — `auth-retry.test.ts#still fires after the budget when firstWhen rejects the first emission (WR-01)` (13-08) and `relay.test.ts#WR-01: request()'s operation clock fires against a relay that accepts the REQ and then says nothing at all` (13-09). RED: `AssertionError: expected undefined to be an instance of Error` (13-08) / `Test timed out in 5000ms` (13-09).
  - WR-02 (RelayGroup.request() never threads a gate/suspendable clock) — `group.test.ts#WR-02: request()'s group-level operation clock fires against a relay that accepts the REQ and then says nothing at all` (13-11). RED: `Test timed out in 5000ms`.
  - 13-10's eight-site + group/pool audit found no further violation beyond the then-known WR-02 gap, which 13-11 closed.
- **RAUTH-08** ("SyncLoader threads onAuthRequired/authTimeout/authRetries into both paths"):
  - Paginated-path bound: inherited from RAUTH-03's req()/request() fixes above (13-08/13-09), pinned at the loader boundary by this plan's `sync-loader.test.ts > 13-12 > does not add its own retry layer ...` test (structural pin, see Non-Vacuity Verification).
  - D-16 guard bypass via CR-04 (synchronous throw escaping AuthHandlerError mapping) — closed at the source by `auth-retry.test.ts#maps a synchronously-throwing handler to the handler error, carrying the thrown value as cause (CR-04)` (13-08). RED: `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` on `errors.handler`.
  - D-16 guard's own name-coverage gap (only `"AuthTimeoutError"` tested pre-13-12) — closed by this plan's Task 1, RED-verified above.
  - WR-03 (handler-less stall-guard suspension) — `sync-loader.test.ts > 13-13 ... > suspends the stall guard for a handler-less caller when the relay requires auth (WR-03)` (13-13). RED: `AssertionError: expected [] to deeply equal [ {content: "a", ...} ]`.
  - WR-04 (auth-phase timer leak) — `sync-loader.test.ts > 13-13 ... > clears the auth-phase timer when the run is torn down before the phase closes (WR-04)` and `... > does not arm a fresh timer when a handler settles after its phase was already force-closed (WR-04)` (13-13). RED: `AssertionError: expected 1 to be +0` (both).

No item raised in `13-VERIFICATION.md`'s Gaps Summary was left unaddressed: CR-01/02/03/04, WR-01/02/03/04/06 are each closed at a named plan with a recorded RED symptom, and the paginated path's own bound is pinned at the loader boundary as this plan's remaining scope required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RAUTH-01 through RAUTH-09 are all now `Complete` in `.planning/REQUIREMENTS.md` — the phase's own requirement set is fully satisfied, closing the wave sequence 13-VERIFICATION.md opened (13-08 through 13-13 plus this plan).
- Phase 14 (ALOG — auth lifecycle observability) and Phase 15 (CAUTH — Concord stream-auth cleanup, hard-blocked on RAUTH landing first) can both proceed: the operation-scoped auth hooks are now genuinely bounded, correctly resend, correctly map errors, and correctly suspend clocks on every one of the eight operations plus `RelayPool`/`RelayGroup`/`SyncLoader`.
- No blockers. This was the phase's designated closing plan; no further gap-closure plan is scoped for Phase 13.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*
