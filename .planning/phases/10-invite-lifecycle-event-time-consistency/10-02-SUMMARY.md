---
phase: 10-invite-lifecycle-event-time-consistency
plan: 02
subsystem: concord
tags: [time-encoding, ms-tag, event-ordering, memberlist-fold, applesauce-concord]

# Dependency graph
requires:
  - phase: 10-01
    provides: invite-bundle vsk fail-closed handling (unrelated file, same phase)
provides:
  - "One shared parseMs(tag) predicate that rumorMs (ordering) and hasMalformedMs (fold-drop) both route through"
  - "includeMs stamping created_at + ms tag from one splitTime read, closing the +1000ms round-vs-floor skew"
affects: [10-03, 10-04, 10-05, 10-06]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Shared validator consumed by two call sites that must never disagree (parseMs)", "Single clock-read decomposition choke point (includeMs -> splitTime)"]

key-files:
  created:
    - packages/concord/src/helpers/__tests__/stream.test.ts
  modified:
    - packages/concord/src/helpers/stream.ts
    - packages/concord/src/operations/channel.ts
    - packages/concord/src/operations/__tests__/chat.test.ts

key-decisions:
  - "parseMs's rejection of non-canonical forms rests entirely on the String(n) === tag round-trip after Number(tag) is range/integer-checked"
  - "includeMs keeps its ms: number = Date.now() signature; splitTime is called once inside the returned EventOperation closure, not hoisted outside it"
  - "Combined RED+GREEN into one commit per task rather than the strict two-commit TDD split, matching this project's tdd_mode: false config and the single-commit-per-task default in task_commit_protocol"

patterns-established:
  - "Shared predicate pattern: two consumers that must structurally agree (ordering vs fold-drop) both call one exported function rather than maintaining parallel parsers"

requirements-completed: [TIME-01, TIME-03]

coverage:
  - id: D1
    description: "parseMs is the single 0..999 canonical-string validator; rumorMs and hasMalformedMs both route through it and agree on every ms tag (valid, absent, or malformed)"
    requirement: "TIME-03"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/stream.test.ts#parseMs > it.each canonical table"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/stream.test.ts#parseMs > absent-tag conventions"
        status: pass
    human_judgment: false
  - id: D2
    description: "includeMs reads the clock once via splitTime and overrides both draft.created_at and the ms tag, eliminating the +1000ms round-vs-floor skew and propagating through bindToChannel and the Kick/JoinLeave factories"
    requirement: "TIME-01"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/stream.test.ts#splitTime > decomposes a >=500ms remainder without rounding up"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/stream.test.ts#splitTime > orders a …000700 rumor before a …001400 rumor"
        status: pass
      - kind: unit
        ref: "packages/concord/src/operations/__tests__/chat.test.ts#chat operations > includeMs overrides created_at from the same single clock read (TIME-01)"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-21
status: complete
---

# Phase 10 Plan 2: Time Encoding Correctness (parseMs unification + includeMs single clock read) Summary

**Unified `rumorMs`/`hasMalformedMs` on one `parseMs` canonical-string predicate and made `includeMs` decompose a single clock read into `created_at` + `ms` via `splitTime`, closing the +1000ms round-vs-floor skew.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-21T14:52:00+01:00
- **Completed:** 2026-07-21T14:56:00+01:00
- **Tasks:** 2
- **Files modified:** 4 (1 net-new)

## Accomplishments
- Added exported `parseMs(tag: string | undefined): number | null` in `helpers/stream.ts` — the single predicate for a valid 0..999 `ms` tag, rejecting non-canonical forms (`"007"`, `"0x10"`, `" 5"`, `"+1"`) via a `String(n) === tag` round-trip that the old `Number()`-only `hasMalformedMs` lacked
- Rewrote `rumorMs` and `hasMalformedMs` to both call `parseMs`, so ordering and membership-fold-drop are structurally unable to disagree about the same `ms` tag (T-10-05)
- `includeMs` now imports `splitTime` and computes `const { created_at, ms: remainder } = splitTime(ms)` once, overriding both `draft.created_at` and the `ms` tag from that single decomposition — no more dual-clock-read or round-vs-floor skew (T-10-06)
- Because `includeMs` is the choke point for `bindToChannel` (7 channel-plane sends in `community.ts`) and `KickFactory`/`JoinLeaveFactory` (`guestbook.ts`), the fix propagates to every consumer with zero other source edits

## Task Commits

Each task was committed atomically:

1. **Task 1: TIME-03 — one shared parseMs predicate (D-09)** - `98f33267` (test)
2. **Task 2: TIME-01 — includeMs single clock read overrides created_at (D-06/D-07)** - `9faac641` (fix)

**Plan metadata:** (final commit hash recorded below)

_Note: both tasks combined their test additions and implementation into a single commit each rather than a strict RED-then-GREEN two-commit split — see Decisions Made._

## Files Created/Modified
- `packages/concord/src/helpers/stream.ts` - Added `parseMs`; rewrote `rumorMs`/`hasMalformedMs` to consume it
- `packages/concord/src/helpers/__tests__/stream.test.ts` - **Net-new.** Table-driven `parseMs` agreement suite (Task 1) plus `splitTime` decomposition/reorder repro cases (Task 2)
- `packages/concord/src/operations/channel.ts` - `includeMs` now imports `splitTime` and overrides `draft.created_at` alongside the `ms` tag
- `packages/concord/src/operations/__tests__/chat.test.ts` - Extended with a case asserting `includeMs` overrides `created_at` from the same clock read

## Decisions Made
- `parseMs` computes `n = Number(tag)` then requires `Number.isInteger(n) && n >= 0 && n <= 999 && String(n) === tag` — the round-trip check is load-bearing (without it, `"007"` and `"0x10"` would incorrectly validate)
- `includeMs` keeps its existing `ms: number = Date.now()` signature (no breaking change) and performs the single `splitTime(ms)` call inside the returned `EventOperation` closure
- Combined each task's test file changes and implementation into one commit (rather than a strict RED/GREEN two-commit split) — consistent with this project's `tdd_mode: false` config and the plan-level `task_commit_protocol` default of one commit per task; both commits' test suites were verified green post-commit

## Deviations from Plan

None - plan executed exactly as written. `rumorMs`/`hasMalformedMs`/`includeMs` signatures are unchanged (as required); `operations/rekey.ts` and `helpers/rekey.ts` (the deferred identical defect) were not touched.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `parseMs` and the corrected `includeMs`/`splitTime` decomposition are now available for any later plan in this phase that touches invite lifecycle timing (10-03..10-06)
- `operations/rekey.ts`/`helpers/rekey.ts` still carry the identical dual-parser/round-vs-floor defect, deliberately deferred per this plan's prohibitions — flagged as a known follow-up, not a blocker for 10-03+
- `applesauce-concord` full suite green: 277/277 tests, 47/47 files; `tsc --noEmit` clean

---
*Phase: 10-invite-lifecycle-event-time-consistency*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: packages/concord/src/helpers/__tests__/stream.test.ts
- FOUND: packages/concord/src/helpers/stream.ts
- FOUND: packages/concord/src/operations/channel.ts
- FOUND: packages/concord/src/operations/__tests__/chat.test.ts
- FOUND commit: 98f33267
- FOUND commit: 9faac641
