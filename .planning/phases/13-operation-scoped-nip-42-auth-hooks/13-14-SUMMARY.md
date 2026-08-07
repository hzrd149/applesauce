---
phase: 13-operation-scoped-nip-42-auth-hooks
plan: 14
subsystem: relay
tags: [rxjs, applesauce-relay, nip-42, auth, group, gap-closure, code-review]

# Dependency graph
requires:
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 08)
    provides: "isReqProgress — the single REQ progress predicate, exported from relay.ts for group.ts to reuse; ProgressPredicate<T> and suspendableTimeout's required firstWhen parameter"
  - phase: 13-operation-scoped-nip-42-auth-hooks (plan 11)
    provides: "RelayGroup.request()'s AuthPhaseGate threading and suspendableTimeout wiring — the exact call site this plan's fix and regression tests build on"
provides:
  - "isGroupReqProgress(message: GroupReqMessage): boolean — total over GroupReqMessage with no cast, classifies GroupReqErrorMessage as not-progress, delegates the RelayReqMessage arm to isReqProgress — closes CR-02"
  - "RelayGroup.request()'s suspendableTimeout firstWhen passes isGroupReqProgress directly, replacing the `as RelayReqMessage` cast that defeated 13-08's required-predicate guardrail"
  - "A recorded audit (Task 2) of every predicate/gate/cast boundary in group.ts and pool.ts, finding no further live instance of the cast-then-delegate shape"
  - "Two RED-verified regression tests: the all-relays-fail/silent timeout defect, and a control proving the fix is not over-applied"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A group-level progress predicate narrows its own union with an early return (ERROR -> false) before delegating the remaining arm to the relay-layer predicate, rather than casting the parameter type down to what the relay-layer predicate accepts. The narrowing makes a future union arm a compile error at the call site instead of a silent 'counts as progress' default."

key-files:
  created: []
  modified:
    - packages/relay/src/group.ts
    - packages/relay/src/__tests__/group.test.ts
    - packages/relay/src/__tests__/exports.test.ts

key-decisions:
  - "isGroupReqProgress lives in group.ts (not relay.ts or a shared module) since it is specifically the GroupReqMessage-shaped predicate and the plan's artifacts spec names group.ts as its declaring file — mirrors where isReqProgress lives relative to RelayReqMessage in relay.ts"
  - "Task 1's compile-fail probe added a third arm directly to GroupReqMessage in types.ts (not a throwaway type alias) to prove the real union is what's guarded; reverted immediately after observing the tsc failure, git diff on types.ts confirmed empty"
  - "The CR-02 regression tests pass reconnect: false explicitly in request()'s opts, isolating the predicate defect from relay.req()'s own (unrelated) connection-retry backoff — without it, the default relay.requestReconnect (count 3, 1s/2s/3s delay) delays relay1's manufactured ERROR value past the test's 100ms timeout window entirely, so neither the buggy nor the fixed predicate is exercised by the ERROR value at all"
  - "The control test asserts the clock survives past its own timeout budget with no TimeoutError, rather than waiting for the whole observable to complete — request()'s default complete condition also depends on relay1's post-error OPEN/retry lifecycle, an unrelated concern that would entangle the CR-02-specific property under test"

requirements-completed: [RAUTH-03, RAUTH-07]

coverage:
  - id: D1
    description: "RelayGroup.request()'s operation clock is no longer cancelled by the group's own per-relay ERROR bookkeeping value — a group whose relays all error or fall silent now errors on its declared timeout instead of hanging forever (CR-02)"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#CR-02: errors on the declared timeout instead of hanging when one relay errors and the other falls silent"
        status: pass
      - kind: other
        ref: "grep -c 'as RelayReqMessage' packages/relay/src/group.ts == 0; pnpm --filter applesauce-relay build (compile-fail probe: adding a third GroupReqMessage arm breaks the isReqProgress(message) call inside isGroupReqProgress)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The fix is not over-applied — a relay's real progress (an EVENT) still cancels the clock and is delivered even when another relay in the same group has errored"
    requirement: "RAUTH-07"
    verification:
      - kind: unit
        ref: "packages/relay/src/__tests__/group.test.ts#control: a real EVENT from the surviving relay still cancels the clock and is delivered"
        status: pass
    human_judgment: false
  - id: D3
    description: "group.ts and pool.ts audited for every predicate/gate/cast boundary of the cast-then-delegate shape; no further live instance found beyond the CR-02 site this plan fixed"
    verification:
      - kind: other
        ref: "This SUMMARY's Task 2 audit table names every site inspected in both files with a per-site verdict"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-08-07
status: complete
---

# Phase 13 Plan 14: RelayGroup.request()'s Total Progress Predicate (CR-02) Summary

**Replaced the `as RelayReqMessage` cast at `RelayGroup.request()`'s `suspendableTimeout` call with `isGroupReqProgress` — a predicate total over `GroupReqMessage` with no cast — closing CR-02, the regression plan 13-11 reintroduced at the exact site plan 13-08's required-parameter guardrail was built to prevent.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-07T08:52:00Z (approx, prior plan-metadata commit)
- **Completed:** 2026-08-07T09:02:20Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- New module-scope `isGroupReqProgress(message: GroupReqMessage): boolean` in `group.ts`: an early `if (message.type === "ERROR") return false;` narrows the union before delegating the remaining `RelayReqMessage` arm to `isReqProgress` with no cast — TypeScript narrows `message` to `RelayReqMessage` after the early return, so the delegating call typechecks *because* the union is exhausted, not because of an assertion
- `RelayGroup.request()`'s `suspendableTimeout` call now reads `{ firstWhen: isGroupReqProgress }` — the inline arrow and the `as RelayReqMessage` cast that let `GroupReqErrorMessage`'s `type: "ERROR"` slip past `isReqProgress`'s `type !== "OPEN"` check are both gone
- Probe-verified the compile-time guardrail is real: temporarily added a third arm (`{ type: "PROBE" }`) to `GroupReqMessage` in `types.ts` and confirmed `pnpm --filter applesauce-relay build` failed at exactly the `isReqProgress(message)` call inside `isGroupReqProgress` (`TS2345`, missing `RelayReqClosedMessage` properties) — reverted, `git diff` on `types.ts` empty, build green again
- Task 2 audited every predicate/gate/cast boundary in `group.ts` and `pool.ts` (table below); found no further instance of the cast-then-delegate shape beyond the CR-02 site this plan fixed
- Two new regression tests in `group.test.ts`: the CR-02 defect (2-relay group, `timeout: 100`, relay1 errors and relay2 falls silent — must error on the declared timeout) and its control (relay1 still errors, but relay2's real EVENT before the deadline still cancels the clock and is delivered) — both built on real `Relay` instances against `vitest-websocket-mock`, matching the file's established construction
- `exports.test.ts`'s inline snapshot refreshed for the new `isGroupReqProgress` export — exactly one added entry, confirmed by inspecting the diff before applying `-u`
- One `applesauce-relay` patch changeset, single-sentence body per CLAUDE.md

## Task Commits

Each task was committed atomically:

1. **Task 1: Make the group's progress predicate total over GroupReqMessage (CR-02)** - `34e6d17b` (fix)
2. **Task 2: Audit group.ts and pool.ts for the same cast-then-delegate shape** - no commit (audit-only; found no further violation, so neither file needed a code change beyond Task 1's already-committed fix — `git diff` on `pool.ts` was empty throughout, satisfying the plan's own verification criterion)
3. **Task 3: RED-verified regression coverage for the group clock** - `0926171d` (test)

## Files Created/Modified

- `packages/relay/src/group.ts` - new `isGroupReqProgress(message: GroupReqMessage): boolean` module-scope predicate; `request()`'s `suspendableTimeout` call passes it directly, replacing the inline arrow + `as RelayReqMessage` cast; the 268-273 comment rewritten to state the correct ERROR-is-not-progress conclusion instead of the incorrect one that produced CR-02
- `packages/relay/src/__tests__/group.test.ts` - new `describe("request() CR-02 gap closure — the group's own ERROR bookkeeping must not satisfy the clock")` block (2 tests)
- `packages/relay/src/__tests__/exports.test.ts` - inline snapshot refreshed with the one new `isGroupReqProgress` export entry

## Decisions Made

- `isGroupReqProgress` declared in `group.ts`, matching the plan's artifacts spec and mirroring where `isReqProgress` lives relative to its own message type (`relay.ts`/`RelayReqMessage`) — the group-level predicate lives beside the group-level message union it narrows.
- Task 1's probe added a real third arm (`{ type: "PROBE" }`) directly to the actual `GroupReqMessage` union in `types.ts`, not a separate throwaway type, so the compile failure demonstrates the guardrail against the type the codebase actually uses — reverted immediately after observing the `tsc` failure, `git diff` on `types.ts` confirmed empty before proceeding.
- The two Task 3 tests explicitly pass `reconnect: false` in `request()`'s options. Without it, `relay.req()`'s own connection-retry backoff (`relay.requestReconnect` defaults to `{ count: 3, delay: count * 1000ms }`) delays relay1's manufactured `ERROR` value well past the test's 100ms clock budget — discovered empirically: an initial version of the defect test *passed* even against the reverted, pre-fix predicate, because the `ERROR` value never reached `firstWhen` within the assertion window at all, so neither the buggy nor the fixed predicate was actually being exercised. `reconnect: false` isolates the CR-02 property (does `ERROR` satisfy the clock's first-emission gate) from this unrelated relay-level retry-timing concern.
- The control test asserts the clock's own survival (no `TimeoutError` within a window past its 100ms budget) rather than waiting for `request()`'s whole observable to complete — the default complete condition (`completeOnAllEose`) also depends on relay1's post-error retry/OPEN lifecycle, which is out of this test's scope and would have entangled an unrelated concern with the property under test.

## Deviations from Plan

None — plan executed exactly as written. The `reconnect: false` addition to the Task 3 tests (see Decisions Made) was discovered during the plan's own mandated RED-verification step — the plan requires observing an actual pre-fix RED symptom, and the first draft of the defect test failed to produce one (it passed unexpectedly against the reverted predicate), so the test construction was corrected before the RED observation could be recorded. This is exactly the fail-fast case the RED-phase methodology (see TDD execution flow) exists to catch: a test that passes unexpectedly during RED means the construction, not the fix, needs correcting — not a scope change to Task 1's fix.

## Issues Encountered

- Initial construction of Task 3's defect test used `group.request()` with no explicit `reconnect` override. Against the reverted (pre-fix) predicate this test unexpectedly *passed* rather than hanging — diagnosed as `relay.requestReconnect`'s default connection-retry backoff (1s/2s/3s delays) preventing relay1's manufactured `ERROR` value from ever reaching the group's message stream within the test's 100ms timeout window, so the clock fired on schedule regardless of `firstWhen`'s behavior and neither the buggy nor fixed predicate was exercised. Fixed by passing `reconnect: false` explicitly (see Decisions Made); re-verified RED against the reverted predicate (5000ms timeout, matching CR-02's reported symptom) and GREEN against the fix, with the control test passing identically in both states as intended.

## Non-Vacuity Verification (RED → GREEN)

Per the plan's acceptance criteria and D-20, both new tests were observed against the pre-fix code via a temporary in-place hand-edit (Edit tool, restored via a second Edit — never `git stash`/`git checkout` against uncommitted work), then GREEN after restoring the fix. `git diff packages/relay/src/group.ts` was empty after restoring, confirmed via `pnpm --filter applesauce-relay build` and the full group suite passing immediately after restore.

- **CR-02 defect test:** temporarily restored `firstWhen: (message: GroupReqMessage) => isReqProgress(message as RelayReqMessage)` in place of `isGroupReqProgress`. RED symptom: `Error: Test timed out in 5000ms` on `await spy.onError()` — the manufactured `ERROR` message from relay1 satisfied `type !== "OPEN"` and permanently cancelled the clock, so no `TimeoutError` was ever raised against the silent relay2, exactly matching `13-REVIEW.md`'s CR-02 reproduction ("`receivedError() === false`, ... after 500ms with a 100ms timeout").
- **Control test:** same revert. The control passed identically in **both** the reverted and fixed states (relay2's real `EVENT` satisfies `isReqProgress`'s `type !== "OPEN"` check either way) — this is the intended non-result: it proves the fix does not over-apply into "nothing cancels the clock", per the plan's explicit purpose for this test (T-13-14-03 in the threat register).

## Verification Results

- `grep -c 'as RelayReqMessage' packages/relay/src/group.ts` → 0
- `grep -c 'export function isGroupReqProgress' packages/relay/src/group.ts` → 1
- `grep -c 'firstWhen: isGroupReqProgress' packages/relay/src/group.ts` → 1
- `pnpm --filter applesauce-relay build` → exits 0
- Compile-fail probe (Task 1): adding a third `GroupReqMessage` arm broke `tsc` at `isGroupReqProgress`'s `isReqProgress(message)` call; reverted, `git diff` on `types.ts` empty
- `pnpm vitest run packages/relay/src/__tests__/group.test.ts` → 27/27 pass (25 pre-existing + 2 new)
- `pnpm vitest run packages/relay/src/__tests__/exports.test.ts` → passes after `-u`; diff showed exactly one added entry (`isGroupReqProgress`)
- `pnpm vitest run` (full workspace) → **2585 passed / 2 skipped** across 274 files (1 skipped) / 275 total files — no regression
- `pnpm exec turbo build --filter='./packages/*'` → **14/14 successful**
- `git diff packages/relay/package.json` → empty (no new dependency)
- `git diff packages/relay/src/relay.ts` → empty — `isReqProgress` untouched
- Exactly one new file in `.changeset/` (`relay-group-request-error-not-progress.md`), single-sentence body, `applesauce-relay` at `patch`

## Audit: group.ts and pool.ts Predicate/Gate/Cast Boundaries (Task 2)

Searched both files for every place a predicate, gate, or message value crosses a layer boundary via an `as` cast, a non-null assertion (`!`), or an `any`. A site is a **finding** when the cast erases a union arm whose runtime values actually reach that code path (the CR-02 shape); **safe** when the cast is between structurally identical types, a `const` assertion for tuple typing, an accumulator-seed type annotation, or the erased possibility is guarded by a runtime check immediately preceding it.

| Site | Cast/assertion | Does it erase a union arm reachable at runtime? | Verdict |
|------|-----------------|--------------------------------------------------|---------|
| `group.ts:102,112,115` — `status$`'s `scan`/`switchMap` seed values | `{} as Record<string, RelayStatus>` (×3) | No — a type annotation on an empty-object accumulator seed for `scan`, not a narrowing of a discriminated union | **Safe** |
| `group.ts:139,145` — `add()`/`remove()` | `(this.relays$ as BehaviorSubject<Relay[]>)` | No — `relays$`'s declared type is `BehaviorSubject<Relay[]> \| Observable<Relay[]>`; `has()` (called immediately before, in both `add()` and `remove()`) throws if `this.controlled` (i.e. if `relays$` is the plain-`Observable` arm), so by the time the cast executes the `Observable`-only arm has already been excluded by a runtime check | **Safe** — guarded by a preceding runtime check, not asserted blind |
| `group.ts:163,200` — `internalSubscription`/`internalPublish`'s `upstream.get(relay)!` | Non-null assertion on `WeakMap.get()` | No — both sites are inside an `if (upstream.has(relay))` branch that checked presence immediately before | **Safe** — guarded immediately before |
| `group.ts:238,343` — `negentropy()`/`sync()`'s relay-support filtering | `[relay, await relay.getSupported()] as const` (×2) | No — a `const` assertion for tuple-literal typing (`readonly [Relay, number[] \| undefined]`), not a discriminated-union narrowing | **Safe** |
| `group.ts:274` (formerly 274-276, now the fixed line) — `request()`'s `suspendableTimeout` `firstWhen` | *(fixed by Task 1)* previously `(message: GroupReqMessage) => isReqProgress(message as RelayReqMessage)` | **Yes** — this was the CR-02 shape itself: `GroupReqMessage`'s `GroupReqErrorMessage` arm reaches this code path on every relay connection failure, a routine and common runtime condition | **Finding — this plan's own scope, fixed in Task 1** |
| `group.ts` — every other `suspendableTimeout`/`authRetry`/predicate call site | *(none)* | — | Confirmed by grep: `suspendableTimeout`/`AuthPhaseGate`/`firstWhen`/`isProgress` appear exactly once in the file (the fixed `request()` call site) — no other predicate/gate boundary exists in `group.ts` | **N/A — no other site** |
| `pool.ts:64,72,74` — `status$`'s `scan`/`switchMap` seed values | `{} as Record<string, RelayStatus>` (×3) | No — identical accumulator-seed pattern to `group.ts`'s `status$` | **Safe** |
| `pool.ts:112` — `group()`'s `ignoreOffline` relay-filter fallback | `of([] as Relay[])` | No — an empty-array type annotation, not a narrowing | **Safe** |
| `pool.ts:118` — `group()`'s per-relay ready signal | `startWith(null as Relay \| null)` | No — a `startWith` seed type annotation for a `Relay \| null` stream, not erasing a discriminated union arm | **Safe** |
| `pool.ts` — every method (`req`, `event`, `negentropy`, `publish`, `request`, `subscription`, `subscriptionMap`, `outboxSubscription`, `count`, `sync`) | *(none)* | — | All ten are one-line delegations to `this.group(relays).<method>(...)`; no predicate, gate, or message value crosses a boundary at all — confirmed by grep: `pool.ts` contains zero `suspendableTimeout`/`AuthPhaseGate`/`firstWhen`/`isProgress` occurrences | **N/A — pure pass-through, no boundary to audit** |

**Audit conclusion:** no further live instance of the cast-then-delegate shape was found in either file beyond the CR-02 site this plan's Task 1 already closed. `git diff packages/relay/src/pool.ts` is empty — no finding was scoped into this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-02 is closed: `RelayGroup.request()` (and, through delegation, `RelayPool.request()`) errors on its declared timeout when its relays all fail or fall silent, instead of hanging indefinitely on the group's own bookkeeping value.
- The fix is structural: `isGroupReqProgress` is total over `GroupReqMessage` with no cast, and the probe in Task 1 proves a future arm added to that union fails to compile at this call site rather than silently defaulting to "counts as progress".
- `isReqProgress` remains untouched (`git diff packages/relay/src/relay.ts` empty) — the OPEN rule still has exactly one definition across both layers, reused rather than restated.
- Task 2's audit found no further instance of the cast-then-delegate shape in `group.ts` or `pool.ts`; both tables above name every site inspected with a verdict, satisfying the plan's explicit "an audit that reports nothing found without naming what it looked at is not an audit" instruction.
- This is the phase's designated closing plan for CR-02 per the code review that reopened RAUTH-03/07; `requirements mark-complete` was run for `RAUTH-03`/`RAUTH-07` per this plan's frontmatter, since the review's specific regression (CR-02) is what those two requirements were reopened for.
- No blockers for the remaining phase 13 review findings (CR-01, CR-03, WR-01..11) — those are out of this plan's explicit scope (it closes CR-02 only) and remain tracked in `13-REVIEW.md` for a future gap-closure plan or backlog promotion.

---
*Phase: 13-operation-scoped-nip-42-auth-hooks*
*Completed: 2026-08-07*

## Self-Check: PASSED

- FOUND: packages/relay/src/group.ts
- FOUND: packages/relay/src/__tests__/group.test.ts
- FOUND: packages/relay/src/__tests__/exports.test.ts
- FOUND: .changeset/relay-group-request-error-not-progress.md
- FOUND: .planning/phases/13-operation-scoped-nip-42-auth-hooks/13-14-SUMMARY.md
- FOUND: 34e6d17b (Task 1)
- FOUND: 0926171d (Task 3)
