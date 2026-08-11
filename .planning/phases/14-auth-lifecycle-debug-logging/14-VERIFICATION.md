---
phase: 14-auth-lifecycle-debug-logging
verified: 2026-08-11T14:52:28Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 14: Auth Lifecycle Debug Logging Verification Report

**Phase Goal:** An operator can tell from debug output where a NIP-42 auth attempt sits in its lifecycle — challenge received, AUTH sent, result — and why it succeeded or failed, with outcomes attributable to the specific operation that triggered them; every `Debugger` in `packages/loaders/` is derived once at class/module/context construction rather than `.extend()`-ed at a log call site.

**Verified:** 2026-08-11T14:52:28Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ALOG-01: an operator can trace a single NIP-42 auth attempt's lifecycle (challenge received → AUTH sent → result) and read why it succeeded or failed from log output alone | ✓ VERIFIED | `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts:64` scripts a real challenge→sign→send→OK exchange over a mock WS server and asserts strict line ordering (`challengeIdx < signedIdx < sentIdx < resultIdx`) plus the relay's own OK message text against real captured `debug` output (not implementation strings). Ran green (`pnpm exec vitest run packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` — 22/22 in that file). CR-01 (BLOCKER: hostile relay text could erase/forge log lines, defeating trust in the trace) is closed at the shared `truncateForLog` chokepoint (`packages/relay/src/helpers/auth-log.ts:47-64`), doubling `%` and `\xHH`-escaping control chars; covered both at the formatter (`auth-log.test.ts:140,149`) and end-to-end against real captured output (`auth-lifecycle-logging.test.ts:284,311`, including an assertion that a forged newline produces exactly one physical line, not a bare-substring check that a forge would pass anyway). |
| 2 | ALOG-02: retry/timeout/rejection lines identify the specific operation that triggered them; two concurrent operations stay distinguishable in a shared log stream | ✓ VERIFIED | `packages/relay/src/operators/auth-retry.ts:262-266`'s `phaseLine` prefixes every operation-track line with `describeWireRequest(context.request)` (e.g. `REQ a1b2c3d4` / `EVENT e5f6a7b8`), and the consecutive-retry counter lives in a per-subscription closure (not relay-scoped), so concurrent operations never share state (RAUTH-05). `auth-lifecycle-logging.test.ts:439` ("ALOG-02: two concurrent operations' lines stay individually attributable...") runs a REQ and a publish concurrently on one connection, filters captured lines by each operation's own wire key computed from the test's own ids (never a transcribed literal), asserts no line is ambiguous between the two, then authenticates only one of two distinct pubkeys and asserts the other operation's group is unchanged in size and still names its own waited-on pubkey — a genuine state-transition proof, not a labeling-only check. |
| 3 | ALOG-03: every `Debugger` in `packages/loaders/` is derived once per module load / class construction / context construction / function-or-operator invocation — never inside a re-enterable reactive callback (`switchMap`/`mergeMap` projector, per-item loop body); a per-call correlation logger with a generated suffix remains compliant | ✓ VERIFIED | Full repo sweep: `grep -rn "\.extend(" packages/loaders/src --include="*.ts" \| grep -v __tests__` → 11 hits (matches the count independently recorded in `14-VALIDATION.md`'s 2026-08-11 manual sweep). All 11 read at construction time — top level of `createSyncLoader`/`createTimelineLoader`/`createOutboxTimelineLoader`/`loadBlocksFromCache`/`loadBlocksFromRelays`/`loadBlocksFromRelay` (once per factory/function call), or inside a `return (source) => {...}` operator-application closure (once per `.pipe()` application, not per emitted item) — none sit inside a `switchMap`/`mergeMap` projector body or a per-item loop. WR-07 (the surviving gap after 14-02: `paginatedRequest` still derived two Debuggers per call from inside the switchMap-reachable `request$()`, and 14-02's guard counted only the `"request"` namespace so it couldn't see the violation) is closed: `backwardLog` is now hoisted to `buildRelayStream`'s top level (`sync-loader.ts:408`, unconditionally, once per relay, regardless of which loading path is used) and threaded into `paginatedRequest` as an already-derived `log` parameter (`sync-loader.ts:240-249`) — the internal `.extend()` call is gone. The regression guard (`sync-loader.test.ts:1089-1128`) was widened from filtering on the `"request"` namespace alone to asserting the total `extendCalls` count (6, with 4 positions checked by exact value) in a scenario where the negentropy path succeeds and `paginatedRequest` is never invoked — this is the scenario that specifically distinguishes "derived unconditionally once, regardless of path" from "derived only when the path is taken," and is what let the pre-fix per-call derivation hide from a `"request"`-only filter. Confirmed via code reading (the pre-fix shape, if reintroduced, would either move the "backward" derivation off buildRelayStream's unconditional top level, dropping the total from 6, or reappear as an internal `.extend()` inside `paginatedRequest`, which the type signature — `log?: debug.Debugger` used only as a call, never `.extend()`-ed — no longer permits); `14-09-SUMMARY.md` additionally documents an Edit-tool RED→GREEN revert/restore reproducing the exact pre-fix failure. `pnpm exec vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` — 40/40 green. `tsc --noEmit -p packages/loaders` clean. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/relay/src/helpers/auth-log.ts` | Shared, throw-safe formatter neutralizing relay-controlled text for every auth-log sink | ✓ VERIFIED | `truncateForLog` doubles `%` and escapes control chars (CR-01); `String(value)` wrapped in try/catch (WR-04); `formatKinds`/`summarizeFilter(s)` guard non-array input instead of throwing (WR-04); `describeWireRequest`'s `default` degrades to a fallback string instead of throwing. |
| `packages/relay/src/helpers/__tests__/auth-log.test.ts` | Covers the format-specifier vector and the newline-forging vector at the formatter | ✓ VERIFIED | Lines 140, 149 — both present and green. |
| `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | End-to-end oracle over real captured `debug` output for ALOG-01/ALOG-02, including both CR-01 vectors | ✓ VERIFIED | 22 tests, all green; asserts on values derived from the scripted exchange / the test's own inputs, not transcribed implementation strings. |
| `packages/relay/src/relay.ts` | Refusal/invalidation/AUTH-sent lines emitted at points matching what they assert (WR-01/02/03) | ✓ VERIFIED | `:1206-1218` refusal logged on every refusal (guard now only gates the idempotent flag write, not the log call); `:437-450` invalidation count uses `authenticatedPubkeys.length` (filters `response?.ok === true`), matching its own wording; `:1198-1203` AUTH-sent line moved inside the `control` defer, immediately before the socket write. |
| `packages/loaders/src/loaders/sync-loader.ts` | Every `Debugger` derived once per relay/run, never inside the re-enterable `switchMap` | ✓ VERIFIED | `requestLog`/`backwardLog` both hoisted to `buildRelayStream`'s top level; `paginatedRequest` takes an already-derived `log` parameter. |
| `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | Guard that would fail if `paginatedRequest` reintroduced an inline derivation | ✓ VERIFIED | Widened total-`extendCalls`-count assertion (`:1120`), exercised in the negentropy-succeeds scenario, which is the scenario that structurally distinguishes derive-once-per-relay from derive-only-when-path-taken. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `relay.ts` (7 sinks: challenge, CLOSED reason ×3, OK message ×2, AUTH-sent) | `helpers/auth-log.ts:truncateForLog` | Every relay-controlled string interpolation | ✓ WIRED | Confirmed all seven CR-01 sink locations from the code review still route through `truncateForLog` before interpolation; no site re-implements its own escaping. |
| `sync-loader.ts:buildRelayStream` | `paginatedRequest` | `backwardLog` passed as the `log` parameter | ✓ WIRED | `sync-loader.ts:622` passes `backwardLog` (derived at `:408`, outside the switchMap) into `paginatedRequest(request, url, filter, limit, backwardLog, relayMethodOptions)`. |
| `operators/auth-retry.ts:phaseLine` | `helpers/auth-log.ts:describeWireRequest` | `requestLabel` prefix on every operation-track line | ✓ WIRED | `auth-retry.ts:260-266` — `requestLabel` computed once per `runPhase` call from `config.buildContext`, prefixed on every subsequent `phaseLine` call in that phase. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Relay package auth-log + lifecycle oracle tests | `pnpm exec vitest run packages/relay/src/helpers/__tests__/auth-log.test.ts packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | 2 files, 36 tests passed | ✓ PASS |
| Relay package core suites (relay/auth-retry/group) | `pnpm exec vitest run packages/relay/src/__tests__/relay.test.ts packages/relay/src/__tests__/auth-retry.test.ts packages/relay/src/__tests__/group.test.ts` | 3 files, 226 tests passed | ✓ PASS |
| Loaders package sync-loader suite (incl. widened ALOG-03 guard) | `pnpm exec vitest run packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | 1 file, 40 tests passed | ✓ PASS |
| Relay package typecheck | `pnpm exec tsc --noEmit -p packages/relay` | clean, exit 0 | ✓ PASS |
| Loaders package typecheck | `pnpm exec tsc --noEmit -p packages/loaders` | clean, exit 0 | ✓ PASS |
| Relay package build | `pnpm --filter applesauce-relay build` | clean | ✓ PASS |
| Loaders package build | `pnpm --filter applesauce-loaders build` | clean | ✓ PASS |
| ALOG-03 repo-wide sweep | `grep -rn "\.extend(" packages/loaders/src --include="*.ts" \| grep -v __tests__` | 11 hits, all construction-time or approved per-call correlation loggers | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ALOG-01 | 14-01, 14-03, 14-04, 14-06, 14-07, 14-08 | Operator can trace lifecycle and read success/failure from log output alone | ✓ SATISFIED | See Truth #1 |
| ALOG-02 | 14-01, 14-05, 14-06, 14-08 | Retry/timeout/rejection lines attributable to the specific operation | ✓ SATISFIED | See Truth #2 |
| ALOG-03 | 14-02, 14-09 | Every `Debugger` in `packages/loaders/` derived once, never on a re-enterable path | ✓ SATISFIED | See Truth #3 |

`.planning/REQUIREMENTS.md` still shows ALOG-01/02/03 as unchecked (`- [ ]`) with status `Pending` in its traceability table (lines 30-32, 87-89), even though `ROADMAP.md` marks Phase 14 complete (line 56) and lists all three IDs against it. This is a documentation-sync gap in `REQUIREMENTS.md`, not a code gap — every ID is accounted for in the plan frontmatters (14-01 through 14-09) and the codebase evidence above satisfies each. Flagging for the orchestrator to update the checkboxes; not a phase blocker.

### Anti-Patterns Found

None. Swept `auth-log.ts`, `relay.ts`, `operators/auth-retry.ts`, `negentropy.ts`, `group.ts`, `sync-loader.ts`, `debug-capture.ts`, and `auth-lifecycle-logging.test.ts` for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` — the only hits were the legitimate constants `EMPTY_FILTER_PLACEHOLDER`/`EMPTY_FILTERS_PLACEHOLDER` in `auth-log.ts`, not debt markers.

### Deferred / Backlogged (not phase blockers, tracked separately)

These were explicitly reviewed, deliberately not fixed in-phase, and formally backlogged to `ROADMAP.md` Phase 999.16 by user decision on 2026-08-11 (confirmed present at `ROADMAP.md:339-351`):

- **WR-06** — `event()`'s manufactured auth-exhausted `PublishResponse` still omits `.error` (`relay.ts:1281-1285`), so the D-11 discriminator ("absence of `.error` means a genuine relay verdict") is not total. Confirmed still unfixed by direct read. This does **not** defeat ALOG-01 itself — the debug log line at the exhaustion point (`auth-retry.ts:279`: `"auth retry budget of N phase(s) is exhausted — giving up"`) is unambiguous from the log text alone — but `.changeset/relay-publish-timeout-marks-itself.md`'s claim ("callers can tell a client-side give-up from a relay rejection without inspecting the message") is not fully true while this path exists. Worth flagging to whoever ships the release notes, per ROADMAP's own note that this "gates changeset accuracy."
- **WR-05** (test-capture harness clobbers the process-wide `DEBUG` filter — test infra only), **WR-08** (`negentropySync` logs an unbounded filter/fingerprint — pre-existing, not new-code), **IN-01..IN-05** (two unbounded interpolations, a throwaway per-`Relay` Debugger, a duplicated error-name set, bare-digit oracle assertions, and a wrong-verb tap edge case) — all backlogged, none defeat a Phase 14 requirement.
- **D-15** — a pre-existing timing flake in `relay.test.ts` (`suspendableTimeout`/`authTimeout` racing under real timers), reproduced identically on pre-phase-14 code; recorded in `deferred-items.md`.

### Human Verification Required

None. All three roadmap truths were verifiable against real, passing behavioral tests plus direct code/wiring inspection.

### Gaps Summary

No gaps. The phase's own code review (`14-REVIEW.md`) found one BLOCKER (CR-01) and eight warnings; gap-closure plans 14-08 and 14-09 closed CR-01 and the four requirement-affecting warnings (WR-01 through WR-04, WR-07), each verified independently above against current code and passing tests rather than taken on SUMMARY claims. The remaining four warnings and five info findings were consciously scoped out to a backlog phase rather than silently dropped, and none of them defeat ALOG-01, ALOG-02, or ALOG-03 as currently worded.

---

_Verified: 2026-08-11T14:52:28Z_
_Verifier: Claude (gsd-verifier)_
