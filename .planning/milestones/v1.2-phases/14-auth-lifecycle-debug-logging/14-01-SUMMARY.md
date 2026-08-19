---
phase: 14-auth-lifecycle-debug-logging
plan: 01
subsystem: auth
tags: [nip-42, rxjs, typescript, discriminated-union, applesauce-relay]

# Dependency graph
requires: []
provides:
  - "RelayAuthWireRequest/RelayAuthWireVerb exhaustive wire-verb union on RelayAuthContext.request"
  - "packages/relay/src/helpers/auth-log.ts internal formatter (truncateForLog/shortId/summarizeFilter/summarizeFilters/describeWireRequest/describeAuthRequirement)"
  - "negentropySync's caller-supplied id parameter; Relay.negentropy()'s stable negOpenId"
  - "Relay.receivedAuthRequiredFor(verb) as the sole D-03 verb-to-flag adapter"
  - "Relay.satisfiedPubkeysFor(requirement) and AuthRetryConfig.satisfiedPubkeys (D-08 join-key producer)"
affects: [14-02, 14-03, 14-04, 14-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exhaustive discriminated union with a never-typed default branch for both a data formatter (describeWireRequest) and a state adapter (receivedAuthRequiredFor)"
    - "Thunk-based context assembly (describeRequest: () => RelayAuthWireRequest) instead of a value captured at call time, so a long-lived subscription's current state is read lazily at auth-required time"
    - "Internal helper module importing only types from its sibling module to keep a one-way runtime value dependency (helpers/auth-log.ts -> types.ts only, never -> relay.ts)"

key-files:
  created:
    - packages/relay/src/helpers/auth-log.ts
    - packages/relay/src/helpers/__tests__/auth-log.test.ts
  modified:
    - packages/relay/src/types.ts
    - packages/relay/src/negentropy.ts
    - packages/relay/src/relay.ts
    - packages/relay/src/operators/auth-retry.ts
    - packages/relay/src/__tests__/auth-retry.test.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "D-01 premise re-verified before any code changed: packages/relay/package.json is still 6.2.1 and 14 changesets reference applesauce-relay, so this remains an unreleased-API edit"
  - "RelayAuthContext.request replaces the three-value RelayAuthOperation bucket with an exhaustive RelayAuthWireRequest union (REQ/COUNT/EVENT/NEG-OPEN), each branch carrying the actual id/filters/event the relay refused"
  - "auth-log.ts is internal-only (not barrel-exported from index.ts or operators/index.ts) and imports only types from ../types.js, mirroring operators/auth-retry.ts's one-way-dependency precedent"
  - "negentropySync's NEG-OPEN id moved from an internal per-call mint to a caller-supplied sixth positional parameter (defaulted for standalone callers) rather than a NegentropySyncOptions field, keeping it out of public sync() option surfaces (RESEARCH Pitfall 5)"
  - "Relay.negentropy() mints negOpenId once, before the runSync defer factory, so the id is stable across every auth retry of one negentropy() call (D-05)"
  - "receivedAuthRequiredFor(verb) is the single surviving read/publish mapping site (D-03); all four call sites (req/count/event/negentropy) route through it instead of writing their subject directly"
  - "authRetryOperator's first parameter became a describeRequest thunk, not a value, because req()'s filters can change over a subscription's life and the auth context must describe the request as it stood when the relay refused it"
  - "satisfiedPubkeysFor/satisfiedPubkeys added as a required (never optional/defaulted) AuthRetryConfig field, per the 13-08/CR-01 lesson that a permissive default lets a future call site silently omit the answer — unused beyond being threaded through in this plan; plan 14-05's operation track is its consumer"

patterns-established:
  - "Two independent never-typed exhaustiveness gates now exist for RelayAuthWireRequest/RelayAuthWireVerb: describeWireRequest (helpers/auth-log.ts) and receivedAuthRequiredFor (relay.ts) — both confirmed to fail to typecheck against a scratch fifth union member"

requirements-completed: [ALOG-01, ALOG-02]

coverage:
  - id: D1
    description: "RelayAuthContext.request carries the exact wire request (REQ/COUNT/EVENT/NEG-OPEN) a relay refused, replacing the three-value operation category"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (RAUTH-01 context-shape tests, updated for `request`)"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/auth-retry.test.ts (FAKE_CONTEXT/baseConfig against the new shape)"
        status: pass
    human_judgment: false
  - id: D2
    description: "describeWireRequest/summarizeFilter/summarizeFilters/truncateForLog render any wire request as a bounded, human-readable summary (D-06 shape, T-14-01 truncation)"
    requirement: "ALOG-02"
    verification:
      - kind: unit
        ref: "packages/relay/src/helpers/__tests__/auth-log.test.ts (19 tests: D-06 shape, kinds cap/elision, multi-filter union, EVENT/NEG-OPEN rendering, shortId, truncateForLog)"
        status: pass
    human_judgment: false
  - id: D3
    description: "negentropy()'s NEG-OPEN subscription id is minted once per call and stays stable across every auth retry"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts (RAUTH-01/RAUTH-03 sync tests asserting on the captured NEG-OPEN id)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A fifth RelayAuthWireRequest/RelayAuthWireVerb member is a compile error at both describeWireRequest and receivedAuthRequiredFor"
    verification:
      - kind: other
        ref: "manual scratch-copy exhaustiveness probe (see Verification section below), reverted after confirming both failure locations"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-09
status: complete
---

# Phase 14 Plan 01: Wire-Verb Auth Union and Shared Log Formatter Summary

**`RelayAuthContext.request` is now an exhaustive REQ/COUNT/EVENT/NEG-OPEN wire-verb union with a tested, bounded `describeWireRequest` formatter, and `negentropy()`'s NEG-OPEN id survives auth retries.**

## Performance

- **Duration:** 12 min
- **Completed:** 2026-08-09
- **Tasks:** 3/3
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- Replaced the retired three-value `RelayAuthOperation` bucket with `RelayAuthWireRequest`, an exhaustive discriminated union carrying the actual id/filters/event a relay refused, plus `RelayAuthWireVerb` derived from the union itself.
- Added `packages/relay/src/helpers/auth-log.ts`, an internal, type-only-dependent formatter module (`truncateForLog`, `shortId`, `summarizeFilter`, `summarizeFilters`, `describeWireRequest`, `describeAuthRequirement`) with 19 hand-derived unit tests covering the D-06 rendering rules and the T-14-01 truncation mitigation.
- Gave `negentropySync` a caller-supplied `id` parameter (default `nanoid()` for standalone callers) instead of an internal mint, and `Relay.negentropy()` now mints `negOpenId` once before the retry-resubscribed `runSync` defer, closing D-05.
- Added `Relay.receivedAuthRequiredFor(verb)` as the single D-03 adapter mapping a wire verb to the legacy `authRequiredForRead`/`authRequiredForPublish` flags, and `Relay.satisfiedPubkeysFor(requirement)` plus a required `AuthRetryConfig.satisfiedPubkeys` field for D-08.
- All four auth call sites (`req()`, `count()`, `event()`, `negentropy()`) now declare a per-method `describeRequest` thunk and pass it to the shared `authRetryOperator`/`receivedAuthRequiredFor` adapters instead of a string label.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire-verb union on RelayAuthContext and the shared auth-log formatter** - `20bb2558` (feat)
2. **Task 2: negentropy() owns its NEG-OPEN subscription id** - `ca536972` (feat)
3. **Task 3: Thread the wire request through Relay and the shared auth operator, with the D-03 verb-to-flag adapter** - `109215e5` (feat)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/helpers/auth-log.ts` - new internal formatter module (constants + 6 functions), type-only dependency on `types.ts`
- `packages/relay/src/helpers/__tests__/auth-log.test.ts` - 19 hand-derived unit tests for the formatter
- `packages/relay/src/types.ts` - `RelayAuthWireRequest`/`RelayAuthWireVerb` added, `RelayAuthOperation` removed, `RelayAuthContext.operation` replaced by `request`
- `packages/relay/src/negentropy.ts` - `negentropySync` gains a caller-supplied `id` parameter, internal mint removed
- `packages/relay/src/relay.ts` - `negOpenId` minted once in `negentropy()`; `buildAuthContext`/`authRetryOperator` retyped around `RelayAuthWireRequest`; `receivedAuthRequiredFor`/`satisfiedPubkeysFor` added; all four auth sites route through the new adapters via a `describeRequest` local
- `packages/relay/src/operators/auth-retry.ts` - `AuthRetryConfig.operation` removed, `satisfiedPubkeys` (required) added; the existing `config.log?.(...)` call now renders via `describeWireRequest`/`truncateForLog`
- `packages/relay/src/__tests__/auth-retry.test.ts` - `FAKE_CONTEXT`/`baseConfig` updated to the `request`-shaped context and the new required `satisfiedPubkeys` field
- `packages/relay/src/__tests__/relay.test.ts` - pre-existing `onAuthRequired` context assertions updated from `operation: "..."` to `request: { verb, ... }` (see Deviations)

## Decisions Made

- D-01's premise (unreleased, 14 pending changesets) was re-verified before touching any code; it still held, so the API widening proceeded as an unreleased-API edit.
- `authRetryOperator`'s first parameter became a thunk (`describeRequest: () => RelayAuthWireRequest`), not a value, because `req()`'s filters can change over a subscription's lifetime — the context handed to `onAuthRequired` must describe the request as it stood at refusal time, not the request's current state.
- `satisfiedPubkeysFor`/`satisfiedPubkeys` were added as required (never optional/defaulted) fields per the 13-08/CR-01 precedent, even though no call site in this plan invokes the value beyond threading it through — plan 14-05's operation track is the intended consumer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated pre-existing `relay.test.ts` assertions broken by the `operation` → `request` field rename**
- **Found during:** Task 3 verification (`pnpm vitest run ... relay.test.ts`)
- **Issue:** Six pre-existing test assertions in `packages/relay/src/__tests__/relay.test.ts` (not declared in this plan's `files_modified`) asserted `operation: "read" | "publish" | "sync"` on the `onAuthRequired` context. Removing `RelayAuthContext.operation` in Task 1/3 made every one of these assertions fail — a direct, in-scope consequence of this plan's own type change, not a pre-existing or unrelated failure.
- **Fix:** Rewrote each assertion to the equivalent `request: { verb, id/event, filters/filter }` shape, reading the actual id/event value captured at each test's own send site (e.g. the REQ id, the sent `mockEvent`, or the server-observed NEG-OPEN id) rather than inventing new values.
- **Files modified:** `packages/relay/src/__tests__/relay.test.ts`
- **Verification:** `pnpm vitest run packages/relay/src/__tests__/auth-retry.test.ts packages/relay/src/__tests__/relay.test.ts packages/relay/src/__tests__/group.test.ts packages/relay/src/__tests__/pool.test.ts` — 227 passed; full `pnpm --filter applesauce-relay test` — 265 passed.
- **Committed in:** `109215e5` (part of Task 3's commit)

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Necessary to keep the existing suite green after this plan's own type change; no scope creep — only the six assertions this plan's rename directly broke were touched.

## Issues Encountered

- Task 1's acceptance-criteria grep (`export (function|const) (...)` alternation) enumerates 9 distinct exported names but the plan's acceptance text states the count should be 10; actual grep output is 9, matching the artifacts table's own list of 6 functions + 3 constants. Treated as a plan-authoring off-by-one, not a code defect — every named export exists and is tested.
- Task 3's acceptance-criteria grep for the four `verb: "..."` literal declarations matches 5 lines, not 4, because it also matches the pre-existing, unrelated `event()` method signature (`verb: "EVENT" | "AUTH" = "EVENT"`). The four intended `describeRequest` locals are independently confirmed via `grep -c "const describeRequest"` (returns 4) and the exhaustiveness probe below. Treated as an imprecise acceptance regex, not a code defect.
- `pnpm --filter applesauce-relay build` initially failed with "Cannot find module 'applesauce-core/helpers/...'" — `applesauce-core` and `applesauce-signers` had no `dist/` yet in this fresh worktree. Built both dependencies first (`pnpm --filter applesauce-core build`, `pnpm --filter applesauce-signers build`); not a code issue, just missing build order in a clean checkout.

## Verification

- `pnpm --filter applesauce-relay build` exits 0.
- `pnpm --filter applesauce-relay test` — 265 passed (10 files).
- `pnpm --filter applesauce-loaders build` exits 0, confirming RESEARCH Pitfall 6: `SyncAuthContext` never had an `operation` field, so D-02 required zero loader type changes.
- Exhaustiveness probe: added a fifth `{ verb: "SCRATCH-PROBE"; id: string }` member to `RelayAuthWireRequest` in a scratch edit. `pnpm --filter applesauce-relay build` then failed at exactly two locations — `src/helpers/auth-log.ts:128` (`describeWireRequest`'s `never`-typed default) and `src/relay.ts:420` (`receivedAuthRequiredFor`'s `never`-typed default) — confirming both exhaustiveness gates. The scratch edit was reverted immediately after (`packages/relay/src/types.ts` restored to its committed state; `pnpm --filter applesauce-relay build` re-confirmed clean).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `RelayAuthWireRequest`/`RelayAuthWireVerb`, `helpers/auth-log.ts`'s formatters, `receivedAuthRequiredFor`, and `satisfiedPubkeysFor` are all in place for plans 14-02 through 14-05 (connection-track logging, operator-track logging, and the operation track) to consume without further type changes.
- No blockers. The one open thread is cosmetic: this plan's own acceptance-criteria grep counts (9 vs stated 10; 5 vs stated 4) are documented above as plan-authoring imprecision, not implementation gaps — every underlying artifact and behavior the criteria intended to check is present and tested.

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-09*
