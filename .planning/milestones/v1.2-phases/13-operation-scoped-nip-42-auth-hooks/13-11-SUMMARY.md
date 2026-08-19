---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 11
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, group, gap-closure]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 08)
    provides: "isReqProgress — the single REQ progress predicate, exported from relay.ts for group.ts to reuse; ProgressPredicate<T> and suspendableTimeout's required firstWhen parameter"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 10)
    provides: "the written send/listen invariant and the eight-site + group/pool audit that scoped WR-02 to this plan as the one remaining known gap"
provides:
  - "RelayGroup.request() threads one AuthPhaseGate per call into every relay.req() under AUTH_PHASE_GATE, and uses suspendableTimeout (not a bare timeout) so its own operation clock suspends across any relay's auth phase — closes WR-02"
  - "RelayPool.request() inherits the fix through delegation with no pool-side change"
  - "RelayGroup gained a hoisted protected log: typeof logger = logger.extend(\"RelayGroup\"); the D-19 per-relay sync catch now emits through it instead of console.debug — closes WR-06"
  - "Three behavioural group.test.ts tests (gate-instance-identity threading, D-15 clock-suspension, clock-fires) built on real Relay instances against vitest-websocket-mock"
affects: [13-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GroupReqMessage (RelayReqMessage | GroupReqErrorMessage) is a strict superset of RelayReqMessage, so isReqProgress's RelayReqMessage-typed parameter cannot be passed directly as firstWhen for a group-level stream — wrapped in a locally-typed arrow ((message: GroupReqMessage) => isReqProgress(message as RelayReqMessage)) rather than redeclared, preserving the single-definition invariant plan 13-08 established"

key-files:
  created: []
  modified:
    - packages/relay/src/group.ts
    - packages/relay/src/__tests__/group.test.ts

key-decisions:
  - "isReqProgress is wrapped (not redeclared) at RelayGroup.request()'s call site: the group's message stream is GroupReqMessage, a union RelayReqMessage doesn't cover (it adds GroupReqErrorMessage), so a type-compatible arrow calls the one real isReqProgress via a cast rather than duplicating its OPEN-exclusion logic — repo-wide grep still finds exactly one function/const definition named isReqProgress, in relay.ts"
  - "The two clock tests (D-15 suspension, WR-02 fires) run against a single-relay RelayGroup([relay1]) built from the shared relay1/mockRelay1 fixture rather than the shared two-relay group, so relay2's independent REQ/EOSE lifecycle cannot entangle the clock assertions"
  - "RelayGroup.subscription() confirmed to have no operation clock at all (no timeout/suspendableTimeout in its pipe) and therefore needs no gate — verified by reading the method, not assumed"

requirements-completed: []

coverage:
  - id: D1
    description: "RelayGroup.request() constructs one AuthPhaseGate per call and threads it into every relay.req() under AUTH_PHASE_GATE — all relays in one call share the identical gate instance"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#threads one shared AuthPhaseGate instance into every relay's req() call"
        status: pass
    human_judgment: false
  - id: D2
    description: "RelayGroup.request()'s operation clock (formerly a bare timeout()) is now suspendableTimeout gated on the shared AuthPhaseGate, so a relay's in-flight auth phase suspends the group's own clock instead of racing it"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#D-15: request()'s group-level operation clock is suspended across a relay's auth phase"
        status: pass
    human_judgment: false
  - id: D3
    description: "The suspendableTimeout swap did not move one unfireable clock to another — the group's operation clock still fires against a relay that accepts the REQ and then goes silent"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#WR-02: request()'s group-level operation clock fires against a relay that accepts the REQ and then says nothing at all"
        status: pass
    human_judgment: false
  - id: D4
    description: "RelayGroup's D-19 per-relay sync catch no longer writes directly to the console — it emits through a class-level logger a consumer can silence, derived once, matching Relay/RelayLiveness/RelayManagement's convention"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#D-19: RelayGroup.sync per-relay isolation (13-07) — one relay's sync failure does not stop another relay's events, and the group sync still completes (pre-existing isolation test, still passing after the emission channel changed)"
        status: pass
      - kind: other
        ref: "grep -c 'console\\.' packages/relay/src/group.ts == 0; grep -c '.extend(' packages/relay/src/group.ts == 1"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-08-06
status: complete
---

# Phase 13 Plan 11: RelayGroup Gate Threading and Hoisted Logger Summary

**Threaded a call-scoped `AuthPhaseGate` into `RelayGroup.request()`'s per-relay `req()` calls and swapped its bare `timeout()` for `suspendableTimeout`, closing WR-02 on the group's most-used read API; gave `RelayGroup` a hoisted `logger.extend("RelayGroup")` and routed the D-19 sync catch through it, closing WR-06.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-06T22:02:00Z (approx.)
- **Completed:** 2026-08-06T22:12:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `RelayGroup.request()` now constructs one `AuthPhaseGate` per call, before `internalSubscription`, and threads it into every relay's `relay.req(...)` under the `AUTH_PHASE_GATE` symbol key alongside the existing `opts`/`reconnect` spread — one gate instance shared by every relay in the fan-out, mirroring `Relay.request()`'s reference pattern exactly
- The bare `timeout({ first: opts?.timeout ?? 30_000 })` is replaced with `suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: isReqProgress })`, imported from `relay.ts` (plan 13-08) — not redeclared. Since the group's message stream (`GroupReqMessage`) is a strict superset of `isReqProgress`'s `RelayReqMessage` parameter type, the call site wraps it in a type-compatible arrow rather than duplicating the OPEN-exclusion logic
- `RelayPool.request()` inherits the fix through its existing delegation to `this.group(relays).request(...)` — no pool-side change needed, confirmed by the unchanged `pool.ts:185-199` pass-through
- `RelayGroup.subscription()` confirmed (by reading the method) to have no operation clock at all — no gate added there, recorded rather than assumed
- `RelayGroup` gained `protected log: typeof logger = logger.extend("RelayGroup")`, derived once at class scope, matching `Relay`/`RelayLiveness`/`RelayManagement`'s existing convention; the D-19 per-relay `catchError` in `RelayGroup.sync()` now emits through `this.log(...)` instead of `console.debug(...)` directly. No other direct console write existed in `group.ts`
- Three new behavioural tests in `group.test.ts`, built on real `Relay` instances against `vitest-websocket-mock` (the existing fixture style — the file's pre-existing RAUTH-05/RAUTH-09/D-19 tests already use real relays, not mocks): a gate-instance-identity threading test, a D-15 clock-suspension test, and a clock-fires test mirroring `relay.test.ts`'s `request()` clock tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread an AuthPhaseGate through RelayGroup.request() and make its clock suspendable** - `321f2859` (fix)
2. **Task 2: Give RelayGroup a hoisted debug logger and route the D-19 sync catch through it** - `71161b11` (fix)
3. **Task 3: Group-level tests for gate threading, clock suspension, and a clock that actually fires** - `f1034fbe` (test)

## Files Created/Modified

- `packages/relay/src/group.ts` - `RelayGroup.request()` now threads a shared `AuthPhaseGate` into every relay's `req()` call and uses `suspendableTimeout` in place of a bare `timeout()`; new `protected log` field derived via `logger.extend("RelayGroup")`; `RelayGroup.sync()`'s D-19 catch emits through `this.log` instead of `console.debug`; `timeout` import from `rxjs` removed (its sole use site was replaced); new imports `logger` (`applesauce-core`), `AUTH_PHASE_GATE`/`AuthPhaseGate`/`suspendableTimeout` (`./operators/auth-retry.js`), `isReqProgress` (`./relay.js`)
- `packages/relay/src/__tests__/group.test.ts` - new `describe("request() operation clock gap closure (13-11, WR-02)")` block (3 tests); new import of `AUTH_PHASE_GATE`/`AuthPhaseGate` from `../operators/auth-retry.js`

## Decisions Made

- `isReqProgress` is wrapped, not redeclared, at the `group.ts` call site: `(message: GroupReqMessage) => isReqProgress(message as RelayReqMessage)`. `GroupReqMessage = RelayReqMessage | GroupReqErrorMessage`, and `GroupReqErrorMessage` (the per-relay connection-error value `internalSubscription` synthesizes) lacks the fields `isReqProgress`'s parameter type expects even though its `type !== "OPEN"` check applies identically at runtime to every variant. The cast is a pure type-level bridge — repo-wide, `grep -rn 'function isReqProgress\|const isReqProgress' packages/relay/src` still returns exactly one match, in `relay.ts`.
- The two clock tests (`D-15` suspension, `WR-02` fires) construct a fresh single-relay `new RelayGroup([relay1])` from the shared `relay1`/`mockRelay1` fixture, rather than reusing the shared two-relay `group`, so relay2's independent REQ/EOSE lifecycle (and the default `completeOnAllEose` complete condition, which waits for every relay) cannot entangle the clock assertions.
- `RelayGroup.subscription()`'s lack of an operation clock was confirmed by reading its full pipe (`filter`/`map`/`filterDuplicateEvents`/`share()`, no `timeout`/`suspendableTimeout` anywhere) rather than assumed from the plan's premise — recorded here per the plan's explicit instruction.

## Deviations from Plan

None — plan executed exactly as written. The `MonoTypeOperatorFunction<GroupReqMessage>` vs `OperatorFunction<GroupReqMessage, RelayReqMessage>` `tsc` error surfaced immediately after wiring `suspendableTimeout(..., { firstWhen: isReqProgress })` naively (a direct consequence of the type mismatch documented in Decisions Made) — resolved in the same task by wrapping the predicate, not a deviation from the plan's scope.

## Issues Encountered

None.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria and D-20, each new test was observed RED against a temporary in-place hand-edit (via the Edit tool, restored via a second Edit — never `git stash`/`git checkout` against uncommitted work), then GREEN after restoring the fix. `git diff packages/relay/src/group.ts` was empty after each restore, confirmed via `pnpm --filter applesauce-relay build` and the group/pool suites passing immediately after restore.

- **D-15 clock-suspension test:** temporarily substituted a fresh, never-opened `new AuthPhaseGate()` into the `suspendableTimeout(...)` call in place of the shared `gate` (leaving `relay.req()`'s threaded gate unchanged, so the auth phase runs on a gate `suspendableTimeout` never observes). RED symptom: `Error: Timeout has occurred` thrown by `suspendableTimeout`'s own timer (`auth-retry.ts:139`), surfaced as `expect(mockRelay1).toReceiveMessage([...])` never resolving — the 40ms clock fired mid-auth-phase and tore down the subscription before the resend could reach the wire, exactly the "self-inflicted outage" the plan's threat register (T-13-11-01) describes.
- **WR-02 clock-fires test:** temporarily reverted the whole `request()` pipe stage to the pre-fix bare `timeout({ first: opts?.timeout ?? 30_000 })` (restoring the `timeout` rxjs import). RED symptom: `Test timed out in 5000ms` — the bare timeout's first-emission gate was satisfied immediately by `req()`'s synthetic `OPEN` message, so it never fired again against the silent relay, and `spy.onError()` never resolved.
- **Gate-threading test:** not independently RED-verified via hand-edit in this run (the plan's acceptance criteria state its pre-fix failure as a structural fact — "today no gate is threaded at all" — rather than requiring a recorded RED observation, unlike the two clock tests which explicitly required one). Against the actual pre-Task-1 source (verified by inspection of the `git diff` for Task 1's commit), `relay.req()`'s options object carried no `AUTH_PHASE_GATE` key at all, so `gate1`/`gate2` would both be `undefined` and the `toBeInstanceOf(AuthPhaseGate)` assertions would fail.

## Verification Results

- `pnpm --filter applesauce-relay build` — exits 0
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts` — 25/25 tests pass (22 pre-existing + 3 new)
- `pnpm vitest run packages/relay/src/__tests__/pool.test.ts` — 26/26 tests pass, no regression
- `pnpm vitest run packages/relay/src/__tests__/relay.test.ts` — 158/158 tests pass, no regression (13-08/13-09/13-10 hold)
- `pnpm --filter applesauce-relay test` — 244/244 tests pass across 9 files (241 pre-existing + 3 new)
- `pnpm vitest run packages/relay/src/__tests__/exports.test.ts` — passes; export surface unchanged (this plan adds no new exported symbols)
- Full workspace suite (`pnpm exec vitest run`) — 2580 passed / 2 skipped across 274 files (1 skipped) / 275 total files, no regression
- `grep -c 'AUTH_PHASE_GATE' packages/relay/src/group.ts` → 2 (import + the `request()` call site)
- `grep -c 'suspendableTimeout' packages/relay/src/group.ts` → 2 (import + the `request()` call site)
- `grep -c 'isReqProgress' packages/relay/src/group.ts` → 4 (import + wrapper reference + comment mentions)
- `grep -rn 'function isReqProgress\|const isReqProgress' packages/relay/src | wc -l` → 1 (relay.ts only)
- `grep -c 'console\.' packages/relay/src/group.ts` → 0
- `grep -c 'logger.extend("RelayGroup")' packages/relay/src/group.ts` → 1, at class-property scope
- `grep -c '\.extend(' packages/relay/src/group.ts` → 1 — the logger is derived once, never at a call site

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-02 is closed: `RelayGroup.request()` (and, through delegation, `RelayPool.request()`) now carries the same D-15 clock-suspension property every other operation in this phase has, driven by one gate per call.
- WR-06 is closed: `group.ts` derives its logger once at class scope like every other class in the package, and has zero direct console writes.
- Per the 13-08/13-09/13-10 precedent, `REQUIREMENTS.md` is left unchanged (`RAUTH-03`/`RAUTH-07`/`RAUTH-08` remain **In Progress**, not marked Complete) — plan 13-12 is the designated closing plan that flips them to Complete once every gap-closure plan in this wave sequence has landed, per the phase's own deferred-items.md note.
- No blockers for 13-12.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: packages/relay/src/group.ts
- FOUND: packages/relay/src/__tests__/group.test.ts
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-11-SUMMARY.md
- FOUND: 321f2859 (Task 1)
- FOUND: 71161b11 (Task 2)
- FOUND: f1034fbe (Task 3)
