---
phase: 03-rumorstore-verification
verified: 2026-07-09T05:14:49Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: null
---

# Phase 3: RumorStore & verification — Verification Report

**Phase Goal:** Deliver the `RumorStore` convenience class with rumor verification and kind-5 delete handling, and prove the whole core migration with rumor-typed tests — the Part A gate for Common work.
**Verified:** 2026-07-09T05:14:49Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `RumorStore` accepts a correct-`id` rumor and rejects an incorrect-`id` rumor (`verifyRumor` non-overridable via constructor) | ✓ VERIFIED | `packages/core/src/event-store/rumor-store.ts:16-19` — `super({ ...options, verifyEvent: verifyRumor })`, `Omit<EventStoreOptions<Rumor>, "verifyEvent">` blocks constructor override. Test: `rumor-store.test.ts:19-34` (`add()` not-null for correct id, `null` for `"0".repeat(64)`). Ran `pnpm --filter applesauce-core test` — passes live. |
| 2 | `RumorStore.filters()` streams rumors, `timeline()` returns `Rumor[]`, `replaceable()` returns latest replaceable rumor, `getEvent()` returns a `Rumor` | ✓ VERIFIED | `rumor-store.test.ts:36-80` — `getEvent` (line 42), `filters` (51), `timeline` (62), `replaceable` (76) all exercised against a real `RumorStore`, all pass live. |
| 3 | Kind-5 delete rumors remove matching stored rumors | ✓ VERIFIED | `rumor-store.test.ts:82-100` — adds rumor, adds kind-5 delete rumor with `["e", rumor.id]` tag and recomputed id, asserts `getEvent(rumor.id)` is `undefined`. Passes live. Uses already-generic `DeleteManager<Rumor>` (Phase 1), no new delete logic in `rumor-store.ts`. |
| 4 | A custom `EventCast<Rumor>` works with `castEvent` against a real `RumorStore` (not a bare `EventStore`), and a signed-only cast rejects a rumor at compile time (`@ts-expect-error`) | ✓ VERIFIED | `rumor-cast.test.ts:54-69` — `castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore)` against `new RumorStore()`; asserts `instanceof`, `.text`, `.id`. `rumor-cast.test.ts:71-80` — `SignedOnlyCast extends EventCast<NostrEvent>` reading `.sig`; `// @ts-expect-error` line preceding `castEvent(rumor, SignedOnlyCast, store)`. Both pass live (a stale `@ts-expect-error` would fail the vitest/tsc run). |
| 5 | New rumor tests pass and `pnpm --filter applesauce-core test` + `build` are green (Part A proven, core half) | ✓ VERIFIED | Ran live: `pnpm --filter applesauce-core test` → 54 test files, **601/601 tests pass** (matches expected ~601: 592 pre-existing + 7 (rumor-store) + 2 (rumor-cast additions)). `pnpm --filter applesauce-core build` → clean `tsc`, exit 0. |
| 6 | Full `pnpm -r build` exits 0 (whole-workspace Part A proof, unblocking Phase 4) | ✓ VERIFIED | Ran live: `pnpm -r build` completed across `applesauce-core`, `applesauce-concord`, `applesauce-common`, `applesauce-wallet`, `applesauce-react`, `apps/examples` — captured `EXIT: 0`. No error/fail lines found in full build log. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/event-store/rumor-store.ts` | `RumorStore extends EventStore<Rumor>`, `verifyRumor`-locked | ✓ VERIFIED | Class present exactly as specified; JSDoc corrected post-review to accurately describe constructor-only lock and delete-bypass behavior (commit `3faa243e`). |
| `packages/core/src/event-store/index.ts` | re-exports `RumorStore` | ✓ VERIFIED | `export * from "./rumor-store.js"` present. |
| `packages/core/src/event-store/__tests__/rumor-store.test.ts` | RUMOR-03/04/05 coverage | ✓ VERIFIED | 7 test cases across 3 `describe` blocks, all passing live. |
| `.changeset/add-rumor-store.md` | minor changeset | ✓ VERIFIED | `"applesauce-core": minor`, single-sentence body. |
| `packages/core/src/casts/cast.ts` | `CastEventInput<T>`, `performCast` (@internal), sig-gated `castEvent` | ✓ VERIFIED | All three present exactly as specified (lines 35, 37-60, 62-69). `@internal` comment corrected post-review (IN-01) to note it's shared by `castEvent` too. |
| `packages/core/src/observable/cast-stream.ts` | operators call `performCast` | ✓ VERIFIED | Both `castEventStream`/`castTimelineStream` call `performCast` imported from `../casts/cast.js`; loose `StoreEvent` operator signatures unchanged. |
| `.changeset/sig-gated-cast-event-input.md` | minor changeset | ✓ VERIFIED | Present, correct format. |
| `packages/core/src/casts/__tests__/rumor-cast.test.ts` | RUMOR-06 real-store cast + `@ts-expect-error` probe | ✓ VERIFIED | Extended (not replaced) — 2 original bare-`EventStore` cases intact + 2 new cases (real `RumorStore` cast, compile-time negative probe). |
| `packages/core/src/__tests__/exports.test.ts` | regenerated snapshot incl. `RumorStore`/`performCast` | ✓ VERIFIED | Both present in the inline snapshot (`CastEventInput` correctly absent — type-only export, erased at runtime). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `rumor-store.ts` | `helpers/event.ts` | `verifyEvent: verifyRumor` injection | ✓ WIRED | Confirmed by grep and by RUMOR-03 accept/reject tests passing live. |
| `rumor-store.ts` | `event-store.ts` | `extends EventStore<Rumor>` | ✓ WIRED | Compiles clean; relies on the Phase-1 `"verifyEvent" in options` fix (confirmed present in `event-store.ts`). |
| `event-store/index.ts` | `rumor-store.ts` | barrel export | ✓ WIRED | `export * from "./rumor-store.js"` confirmed. |
| `cast-stream.ts` | `casts/cast.ts` | `import { performCast } from "../casts/cast.js"` | ✓ WIRED | Both operators call `performCast`, not the strict public `castEvent`; confirmed by grep and passing tests. |
| `casts/cast.ts` | `casts/event.ts` | `EventCast<infer T>` sig-gate | ✓ WIRED | `CastEventInput<T>` correctly gates on `sig: string`; `@ts-expect-error` regression probe passes live, confirming the gate is active (not just present). |
| `rumor-cast.test.ts` | `event-store/rumor-store.ts` | `import { RumorStore } from "../../event-store/rumor-store.js"` | ✓ WIRED | Real `RumorStore` instance used (not bare `EventStore`), confirmed by direct file read. |

### Behavioral Spot-Checks / Live Command Runs

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Core test suite (incl. new rumor tests) | `pnpm --filter applesauce-core test` | 54 test files, 601/601 pass | ✓ PASS |
| Core build type-checks | `pnpm --filter applesauce-core build` | clean `tsc`, no output | ✓ PASS |
| Targeted rumor test files | `pnpm --filter applesauce-core test -- rumor-store rumor-cast` | 601/601 pass (full suite, filter matched all) | ✓ PASS |
| Full workspace build (Part A proof) | `pnpm -r build` | exit code 0, no error lines in log | ✓ PASS |
| Debt-marker scan on all phase-touched files | `grep -E "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` on 7 modified/created files | no matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| RUMOR-03 | 03-01 | `RumorStore` accepts correct-id rumor, rejects incorrect-id rumor | ✓ SATISFIED | `rumor-store.test.ts:19-34`, passing live |
| RUMOR-04 | 03-01 | `filters()`/`timeline()`/`replaceable()`/`getEvent()` return `Rumor`-typed results | ✓ SATISFIED | `rumor-store.test.ts:36-80`, passing live |
| RUMOR-05 | 03-01 | Kind-5 delete rumors remove matching stored rumors | ✓ SATISFIED | `rumor-store.test.ts:82-100`, passing live |
| RUMOR-06 | 03-02, 03-03 | Custom `EventCast<Rumor>` works with `castEvent` against a rumor store | ✓ SATISFIED | `rumor-cast.test.ts:54-80` (real `RumorStore` + `@ts-expect-error` probe), passing live |

No orphaned requirements — REQUIREMENTS.md maps exactly RUMOR-03/04/05/06 to Phase 3, and all four appear in plan frontmatter `requirements:` fields.

### Anti-Patterns Found

None. Scanned all phase-created/modified files (`rumor-store.ts`, `event-store/index.ts`, `casts/cast.ts`, `observable/cast-stream.ts`, `rumor-store.test.ts`, `rumor-cast.test.ts`, `exports.test.ts`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches.

### Code Review Findings (03-REVIEW.md) — Resolution Confirmed

The prior code review found 2 warnings (WR-01, WR-02) and 1 info (IN-01), all JSDoc-accuracy issues (not logic defects):

- **WR-01** (RumorStore doc overclaimed runtime immutability of `verifyEvent`) — **Fixed.** Current JSDoc (`rumor-store.ts:6-9`) now says the verifier "cannot be supplied through the constructor options... though it remains reassignable via the inherited `verifyEvent` setter at runtime" — accurately scoped.
- **WR-02** (RumorStore doc overclaimed "verifies each rumor" for deletions) — **Fixed.** Current JSDoc (`rumor-store.ts:11-14`) now explicitly states "kind-5 delete rumors are applied without per-event verification" and explains the rationale (upstream protocol layer already verifies validity/authorization). This matches the migration doc's documented "Deletion Policy" — confirmed intentional, inherited base `EventStore` behavior, not a phase-introduced gap.
- **IN-01** (`performCast` `@internal` comment said "used only by" the stream operators, omitting `castEvent`) — **Fixed.** Current comment (`cast.ts:37`) reads "shared implementation — used by castEvent, castEventStream, and castTimelineStream."

Fix commit: `3faa243e docs(03): correct RumorStore + performCast JSDoc accuracy (code-review WR-01/WR-02/IN-01)`.

### Human Verification Required

None. All 6 must-have truths were verified against live command output (not SUMMARY.md claims), and none are behavior-dependent-but-untested — every state transition (accept/reject, kind-5 delete, cast instantiation, compile-time rejection) is directly exercised by a passing test that was run in this verification session.

### Gaps Summary

No gaps. All Phase 3 success criteria (ROADMAP.md criteria 1-5) are met by live-verified evidence:

1. Accept/reject via `verifyRumor` — verified.
2. `filters()`/`timeline()`/`replaceable()` — verified.
3. Kind-5 delete — verified (and its documented "no per-event verification" nuance from the code review is confirmed as intended base behavior per the migration doc, not a regression).
4. `EventCast<Rumor>` + `castEvent` against a real `RumorStore`, plus compile-time rejection of signed-only casts — verified.
5. Part A gate: `applesauce-core` test (601/601) + build green, AND full `pnpm -r build` exit 0 — verified live in this session.

All three prior code-review findings (WR-01, WR-02, IN-01) were confirmed fixed in the current codebase, not merely claimed fixed.

Phase 4 (`applesauce-common` genericization) may proceed.

---

_Verified: 2026-07-09T05:14:49Z_
_Verifier: Claude (gsd-verifier)_
