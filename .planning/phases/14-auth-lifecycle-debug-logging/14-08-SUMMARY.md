---
phase: 14-auth-lifecycle-debug-logging
plan: 08
subsystem: auth
tags: [nip-42, debug, security, log-injection, vitest, relay, applesauce-relay, gap-closure]

# Dependency graph
requires:
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-01's helpers/auth-log.ts formatters (truncateForLog/shortId/summarizeFilter(s)/describeAuthRequirement/describeWireRequest) and 14-04's Relay.authLog :auth connection track"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-06's auth-lifecycle-logging.test.ts end-to-end oracle (debug-capture.ts harness) and relay.test.ts's :auth sub-namespace (14-04) suite"
  - phase: 14-auth-lifecycle-debug-logging
    provides: "14-REVIEW.md's CR-01/WR-01/WR-02/WR-03/WR-04 findings with exact file:line locations and empirical repro"
provides:
  - "truncateForLog neutralizes debug/util format specifiers (% doubling) and control characters (\\xHH escaping) at the single shared chokepoint every relay-supplied string flows through, closing CR-01 (a BLOCKER: data destruction + CWE-117 log forging) for all seven existing sinks and any future one"
  - "auth-lifecycle-logging.test.ts proves both CR-01 vectors against real captured debug output from a live Relay, not just against the formatter in isolation"
  - "event()'s auth-required refusal line fires on every refusal (WR-01), resetState()'s invalidation line counts only actually-authenticated pubkeys (WR-02), the AUTH-sent line fires only once the write actually reaches the socket (WR-03), and the auth-log formatters are total -- non-throwing (WR-04)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A diagnostic formatter's neutralization step lives at the shared chokepoint every caller already flows through (truncateForLog), not duplicated at each of the seven call sites -- makes an entire defect class unrepresentable rather than patched per-instance"
    - "A log line asserting a specific moment (a write, a count, a first-vs-repeat event) is verified by constructing a test scenario that would only pass if the line fires at that exact moment, not by a substring check on the line's text alone"
    - "A diagnostic formatter degrades to a fixed fallback string on malformed/poisoned input rather than throwing, since it is reachable from inside a socket map/tap/catchError where a thrown error would drop the whole subscription"

key-files:
  created: []
  modified:
    - packages/relay/src/helpers/auth-log.ts
    - packages/relay/src/helpers/__tests__/auth-log.test.ts
    - packages/relay/src/relay.ts
    - packages/relay/src/__tests__/auth-lifecycle-logging.test.ts
    - packages/relay/src/__tests__/relay.test.ts

key-decisions:
  - "CR-01's control-character regex is built via `new RegExp(\"[\\\\u0000-\\\\u001f\\\\u007f]\", \"g\")` from a string literal rather than a `/…/` regex literal -- this codebase's authoring tools (Write/Edit) silently rewrote a `/…/` character class spanning the control-character range into raw, invisible control bytes embedded directly in the source file (confirmed via `od -c`); the string-literal-constructed form survives verbatim"
  - "WR-03's regression test drives a genuinely not-ready gate by poking the protected `_ready$` subject directly rather than through a real unclean close, after a real-close attempt entangled with the relay's own reconnect/resetState machinery (which also clears the challenge and produced an unrelated unhandled-rejection); an active req() subscription plus a raised `keepAlive` keeps the underlying socket open across the poke so only the `waitForReady` gate under test is exercised"
  - "auth() no longer requires `this.challenge` to be set when testing WR-03 directly -- confirmed by reading auth()'s own body (it never reads `this.challenge`, only authenticate() does), which is what let the regression test call `relay.auth(event)` directly across a state where resetState() would have cleared the challenge"

requirements-completed: [ALOG-01, ALOG-02]

coverage:
  - id: D1
    description: "CR-01 (BLOCKER): truncateForLog neutralizes debug/util format specifiers and control characters at the shared formatter, so relay-controlled text can neither destroy its own log line's content nor forge an additional line, for every existing sink and any future one"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/helpers/__tests__/auth-log.test.ts -- 'doubles every % ...' / 'escapes control characters as \\xHH ...' / 'leaves ordinary printable text ...'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe via Edit-tool revert/restore of truncateForLog's body (see below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both CR-01 vectors (format-specifier destruction, newline forging) are proven end-to-end against real captured debug output from a live Relay + mock WebSocket server, not just against the formatter in isolation -- closing the gap that let T-14-01/D-09's 'x'.repeat(...)-only oracle miss both"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/auth-lifecycle-logging.test.ts -- 'CR-01: a challenge containing debug format specifiers survives verbatim...' / 'CR-01: a CLOSED reason containing a newline cannot forge a second captured line'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe via Edit-tool revert/restore of truncateForLog's body, against the end-to-end oracle (see below)"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-01: event()'s auth-required refusal is logged on every refusal (not just the first per connection), matching req()/count()/negentropy()'s existing per-refusal logging"
    requirement: "ALOG-02"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/relay.test.ts -- 'WR-01: event()'s auth-required refusal is logged on every refusal, not just the first on a connection'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe via Edit-tool revert/restore of the one-shot guard (see below)"
        status: pass
    human_judgment: false
  - id: D4
    description: "WR-02: resetState()'s invalidation line names the count of actually-authenticated pubkeys (response.ok === true), not every AUTH attempt including never-answered/rejected ones"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/relay.test.ts -- 'WR-02: resetState's invalidation line names the count of actually-authenticated pubkeys, not every AUTH attempt'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe via Edit-tool revert/restore of the count expression (see below)"
        status: pass
    human_judgment: false
  - id: D5
    description: "WR-03: the AUTH-sent line reflects a write that actually reached the socket, moved from auth()'s eager call into event()'s control defer immediately before the actual write"
    requirement: "ALOG-01"
    verification:
      - kind: integration
        ref: "packages/relay/src/__tests__/relay.test.ts -- 'WR-03: the AUTH-sent line reflects a write that actually reached the socket, not one merely queued behind a not-ready gate'"
        status: pass
      - kind: other
        ref: "RED->GREEN non-vacuity probe via Edit-tool revert/restore of the log-line placement (see below)"
        status: pass
    human_judgment: false
  - id: D6
    description: "WR-04: the auth-log formatters (truncateForLog, formatKinds, summarizeFilter(s), describeWireRequest) and receivedAuthRequiredFor are total -- a defect in a diagnostic formatter degrades the log line, never the operation"
    requirement: "ALOG-01"
    verification:
      - kind: unit
        ref: "packages/relay/src/helpers/__tests__/auth-log.test.ts -- 'does not throw when kinds is present but not an array' / 'does not throw when a filter's kinds is present but not an array' / 'degrades to a fallback string instead of throwing on an unrecognized verb' / 'does not throw when String(value) itself throws'"
        status: pass
      - kind: unit
        ref: "packages/relay/src/__tests__/relay.test.ts -- 'WR-04: receivedAuthRequiredFor degrades silently on an unrecognized verb rather than throwing into the subscription'"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-08-11
status: complete
---

# Phase 14 Plan 08: Harden Auth Log Against Hostile Relay Input, Align New Lines With Assertions Summary

**Neutralized relay-controlled text at `truncateForLog` (the single shared chokepoint) against `debug`'s printf-style format-specifier parsing and CWE-117 newline log forging, verified empirically against the real `debug@4.4.3` package before and after the fix, then closed four warnings where a shipped log line asserted something the code did not actually establish (one-shot-per-connection refusal logging, a misleading AUTH-attempt count, a premature AUTH-sent line, and non-total diagnostic formatters).**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-11
- **Tasks:** 3/3
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments

- **CR-01 (BLOCKER) closed at the shared formatter.** Reproduced the empirical bug from 14-REVIEW.md first (`node` script against the real `debug@4.4.3` in this workspace), confirming both vectors: a `%o`/`%O`-bearing challenge renders as `chal-undefined-undefined-100%-%s`, and a reason containing an embedded newline plus a fabricated `Relay accepted AUTH for <attacker-pubkey>: ok` fragment renders as two physical lines, one byte-identical to a genuine connection-track line. `truncateForLog` now doubles every `%` (debug's own `%`-replacement pass then collapses `%%` back to a literal `%`, leaving `%%o`/`%%O`/`%%s` untouched since debug only recognizes single-`%` specifiers) and escapes control characters (0x00-0x1F, 0x7F) as `\xHH`, applied once at the chokepoint every one of the seven relay.ts sinks already flows through.
- **Both vectors proven end-to-end**, not just at the formatter, in `auth-lifecycle-logging.test.ts` against real captured `debug` output from a live `Relay` + mock WebSocket server -- closing the exact gap 14-REVIEW.md identified (the existing T-14-01/D-09 oracle only exercised `"x".repeat(...)`). The forging-vector oracle explicitly documents and avoids the vacuous check the plan warned about: a bare substring assertion on the forged text would pass in both the buggy and fixed versions (the capture harness records one array entry per `debug()` call regardless of any newline inside that entry's own string), so the oracle instead asserts the one relevant entry stays exactly one physical line.
- **WR-01/WR-02/WR-03 realigned three log lines with what they actually establish**, each backed by a purpose-built regression test and a RED->GREEN non-vacuity probe: `event()`'s refusal line now fires per-refusal (not one-shot per connection); `resetState()`'s invalidation line now counts `authenticatedPubkeys` (`response.ok === true`) instead of every entry in the AUTH-attempts map; the "Sending AUTH event" line moved into `event()`'s `control` defer immediately before the actual `this.socket.next(...)` write, so a reconnect armed mid-flight no longer produces a line that outran the write it claims happened.
- **WR-04 made the diagnostic formatters total.** `truncateForLog` no longer lets a poisoned `String(value)` escape (relevant at `auth-retry.ts`'s two handler-error call sites, where `value` is whatever a caller's `onAuthRequired` threw); `formatKinds`/`summarizeFilters` guard non-array `kinds` instead of throwing from inside a socket `map`/`tap`; `describeWireRequest`'s and `receivedAuthRequiredFor`'s type-system-unreachable `default` branches degrade to a fallback instead of throwing into the subscription, keeping the compile-time exhaustiveness check without the runtime throw.

## Task Commits

Each task was committed atomically:

1. **Task 1: Neutralize relay-supplied text at the shared formatter (CR-01)** - `b95b5768` (fix)
2. **Task 2: Prove it end-to-end against real debug output (CR-01)** - `c1a14985` (test)
3. **Task 3: Make the four new lines match what they assert (WR-01, WR-02, WR-03, WR-04)** - `808f4dd5` (fix)

_Plan metadata commit deferred: this is a worktree-isolated parallel executor; STATE.md/ROADMAP.md updates are owned by the orchestrator after the wave completes._

## Files Created/Modified

- `packages/relay/src/helpers/auth-log.ts` - `truncateForLog` neutralizes `%` and control characters (CR-01) and no longer throws on a poisoned `String(value)` (WR-04); `formatKinds`/`summarizeFilters` guard non-array `kinds` (WR-04); `describeWireRequest`'s `default` branch degrades to a fallback string instead of throwing (WR-04)
- `packages/relay/src/helpers/__tests__/auth-log.test.ts` - unit coverage for CR-01's two vectors directly against the formatter, plus WR-04's non-throwing behavior on malformed/poisoned input
- `packages/relay/src/relay.ts` - `event()`'s refusal `tap` drops its one-shot guard (WR-01); `resetState()` counts `authenticatedPubkeys` instead of every AUTH-attempt entry (WR-02); the "Sending AUTH event" line moved from `auth()` into `event()`'s `control` defer, guarded to the AUTH-verb path (WR-03); `receivedAuthRequiredFor`'s `default` branch returns instead of throwing (WR-04)
- `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` - two new end-to-end oracles proving CR-01's specifier and forging vectors against real captured `debug` output from a live `Relay`
- `packages/relay/src/__tests__/relay.test.ts` - four new regression tests (WR-01, WR-02, WR-03, WR-04) in the existing `:auth sub-namespace (14-04)` describe block

## Decisions Made

See `key-decisions` in frontmatter. In summary:
- CR-01's control-character regex is constructed via `new RegExp("[\\u0000-\\u001f\\u007f]", "g")` from a plain string, not a `/…/` regex literal -- this codebase's own file-authoring tools were observed to silently rewrite a `/…/` character class spanning the control-character range into raw, invisible control bytes embedded directly in the source (confirmed with `od -c` on the written file: the visible `[ -]` in a subsequent read was actually `[\0-\x1f\x7f]` in raw bytes). The string-literal-constructed form survives verbatim and stays reviewable, greppable ASCII.
- WR-03's regression test drives the not-ready gate by poking the protected `_ready$` subject directly. A first attempt drove a real unclean `server.close()` to arm the relay's genuine reconnect machinery, but that entangled with `resetState()` (which also clears the challenge, forcing `auth()` to be used instead of `authenticate()`) and produced an unrelated unhandled `EmptyError` from a different in-flight subscription's `lastValueFrom`. Poking `_ready$` directly, with an active `req()` subscription and a raised `keepAlive` keeping the socket open across the poke, isolates exactly the `waitForReady` mechanism WR-03 is about.
- `auth()` does not read `this.challenge` (only `authenticate()` does) -- confirmed by reading its body before relying on it, which is what allowed the WR-03 test to call `relay.auth(event)` directly in a state where the challenge is irrelevant to the mechanism under test.

## Deviations from Plan

None - plan executed exactly as written. All four warnings and the one blocker were fixed within the file set the plan specified (`files_modified` in frontmatter); no file outside that set was touched. No architectural changes were needed.

## Issues Encountered

- **Sandboxed environment lacked `node_modules`.** The worktree had no `node_modules` at all (a fresh git worktree, not yet `pnpm install`-ed). Ran `pnpm install --frozen-lockfile --prefer-offline` (fast, resolved entirely from the existing local pnpm store) before any verification could run.
- **`applesauce-core`/`applesauce-signers` had no built `dist/`.** `tsc --noEmit -p packages/relay` initially reported ~28 errors, all `Cannot find module 'applesauce-core/...'`/`'applesauce-signers/...'` — pre-existing missing build artifacts unrelated to this plan's changes, not a regression. Built both packages once (`pnpm --filter applesauce-core build`, `pnpm --filter applesauce-signers build`), after which `tsc --noEmit -p packages/relay` and the full `pnpm exec vitest run packages/relay` suite were clean.
- **A file-authoring-tool artifact silently corrupted a raw control-character regex literal twice** before being traced to its root cause (see Decisions Made above) and worked around by constructing the pattern via `new RegExp(...)` from a string instead of a `/…/` literal.
- **WR-03's first regression-test design (a genuine `server.close()`-driven reconnect) produced a 5000ms test timeout, then an unhandled `EmptyError` rejection** on the second attempt, both traced to the interaction between the real reconnect/resetState machinery and the rest of the test's setup rather than to the WR-03 fix itself. Resolved by switching to a direct `_ready$` poke (see Decisions Made above), which passed cleanly and reproducibly.

## RED->GREEN Non-Vacuity Probes (mandated by the plan)

All probes were performed via the `Edit` tool directly on the relevant source file, run, then reverted via `Edit` -- never via `git stash` (prohibited in worktree mode; agent 14-09 was running concurrently in a sibling worktree at the time).

**Probe 1 -- CR-01 at the formatter (Task 1), against `helpers/__tests__/auth-log.test.ts`:**
- **RED:** Reverted `truncateForLog`'s body to its pre-fix form (length-bounding only, no neutralization). Ran the two new CR-01 unit tests: both failed --
  - specifier vector: `expected 'chal-%o-%O-100%-%s' to be 'chal-%%o-%%O-100%%-%%s'`
  - forging vector: `expected 'denied\n  t:auth Relay accepted AUTH for deadbeef: ok' not to contain '\n'`
- **GREEN:** Restored the fix. Reran the full `auth-log.test.ts` file: 22/22 passing. `git diff --stat` confirmed empty before Task 1's commit.

**Probe 2 -- CR-01 end-to-end (Task 2), against `__tests__/auth-lifecycle-logging.test.ts`:**
- **RED:** Reverted `truncateForLog`'s body again. Ran the two new end-to-end CR-01 tests: both failed, reproducing the exact empirical symptoms from 14-REVIEW.md against real captured `debug` output --
  - specifier vector: challenge line rendered as `...chal-undefined-undefined-100%-%s` instead of containing the literal `chal-%o-%O-100%-%s`
  - forging vector: `expected [ …(2) ] to have a length of 1 but got 2` (the refusal line's own text split into two physical lines on the raw embedded newline)
- **GREEN:** Restored the fix. Reran the full `auth-lifecycle-logging.test.ts` file: 10/10 passing. `git diff --stat` confirmed empty before Task 2's commit.

**Probe 3 -- WR-01 (Task 3), against `relay.test.ts`:**
- **RED:** Restored the old `&& !this.receivedAuthRequiredForEvent.value` guard on `event()`'s refusal `tap`. Ran the WR-01 test: failed with `expected [ Array(1) ] to have a length of 2 but got 1` -- only the first of two refusals produced a line.
- **GREEN:** Removed the guard again. Reran: passed.

**Probe 4 -- WR-02 (Task 3), against `relay.test.ts`:**
- **RED:** Reverted `resetState()`'s count expression to `Object.keys(this.authentications$.value).length`. Ran the WR-02 test: failed -- `expected '...' to contain 'dropping 0 authenticated pubkeys'`, actual line read `dropping 1 authenticated pubkey, and the held challenge` (a `response: null` AUTH attempt miscounted as authenticated).
- **GREEN:** Restored `this.authenticatedPubkeys.length`. Reran: passed.

**Probe 5 -- WR-03 (Task 3), against `relay.test.ts`:**
- **RED:** Reverted `event()`'s `control` defer to its pre-fix body (no log line) -- the pre-fix eager line in `auth()` was already removed by this point in Task 3, so this isolates "does the line fire at the correct moment" down to "does it fire at all when only placed at the write site". Ran the WR-03 test: failed at the final assertion -- `expected false to be true` (the "Sending AUTH event" line never appeared).
- **GREEN:** Restored the line inside `control`'s defer. Reran: passed.

All four full-suite/typecheck confirmations (`pnpm exec vitest run packages/relay`, `pnpm exec tsc --noEmit -p packages/relay`) were re-run clean after every restore, and again after Task 3's final commit -- 307/307 passing (run twice for stability), zero `tsc` errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-01 (the phase's one BLOCKER) and all four in-scope warnings (WR-01 through WR-04) from 14-REVIEW.md are closed, each with dedicated regression coverage and a RED->GREEN non-vacuity probe.
- WR-05, WR-06, WR-08, and IN-01 through IN-05 remain deliberately out of scope per this plan's explicit prohibitions -- backlogged, not forgotten.
- `packages/loaders/` (ALOG-03/WR-07) is untouched, per this plan's prohibition -- owned by plan 14-09 in a sibling worktree.
- The known pre-existing flaky test `D-15: publish's timeout is suspended across the auth phase` in `relay.test.ts` was not touched and did not fail during any run of this plan's work (passed cleanly both stability-check runs).
- No blockers for phase closeout once this wave's worktrees merge; cross-package verification (build + `applesauce-loaders`/`applesauce-concord` non-regression, and confirming 14-09's landed diff in `packages/loaders/` does not perturb anything here) is the orchestrator's post-merge-gate responsibility, not re-run here.

## Self-Check: PASSED

- FOUND: `packages/relay/src/helpers/auth-log.ts`
- FOUND: `packages/relay/src/helpers/__tests__/auth-log.test.ts`
- FOUND: `packages/relay/src/relay.ts`
- FOUND: `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts`
- FOUND: `packages/relay/src/__tests__/relay.test.ts`
- FOUND: commit `b95b5768` (Task 1)
- FOUND: commit `c1a14985` (Task 2)
- FOUND: commit `808f4dd5` (Task 3)

---
*Phase: 14-auth-lifecycle-debug-logging*
*Completed: 2026-08-11*
