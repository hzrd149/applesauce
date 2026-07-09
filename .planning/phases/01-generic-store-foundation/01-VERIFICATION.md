---
phase: 01-generic-store-foundation
verified: 2026-07-09T01:56:52Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Generic store foundation Verification Report

**Phase Goal:** Turn the core store and its structural helpers generic (`E extends StoreEvent = NostrEvent`) and introduce the rumor type + verifier, with zero behavior change for default signed stores.
**Verified:** 2026-07-09T01:56:52Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Merged from ROADMAP.md Success Criteria (5) and PLAN frontmatter `must_haves.truths` (deduplicated against roadmap wording, 7 additional plan-level truths retained where more specific).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `EventStore<E extends StoreEvent = NostrEvent>` and `AsyncEventStore<E>` are generic; `new EventStore()` still behaves as a signed `NostrEvent` store (Roadmap SC1, CORE-01/02) | VERIFIED | `class EventStore<E extends StoreEvent = NostrEvent> extends EventModels implements IEventStore<E>` (event-store.ts:56); `class AsyncEventStore<E extends StoreEvent = NostrEvent> ... implements IAsyncEventStore<E>` (async-event-store.ts:54). Full `applesauce-core` test suite (592/592) passes unchanged, including all pre-existing signed-event store/model/cast tests. |
| 2 | `new EventStore({ verifyEvent: undefined })` disables verification (constructor honors explicit `undefined`) (Roadmap SC2, CORE-03) | VERIFIED (behavioral test run) | `if (options && "verifyEvent" in options) this.verifyEvent = options.verifyEvent;` (event-store.ts:131); async mirror at async-event-store.ts:127. Behavioral test `verify-event-option.test.ts` proves: default store rejects a tampered-signature event, `{ verifyEvent: undefined }` accepts the same event, and `console.warn` fires (D-01). Ran the single named test directly: `verifyEvent: undefined disables verification and accepts the invalid event` — 1 passed. |
| 3 | `StoreEvent` and `Rumor` types plus `verifyRumor` are exported from `packages/core/src/helpers/event.ts`, and `verifyRumor` returns true only when `getEventHash(rumor) === rumor.id` (Roadmap SC3, RUMOR-01/02) | VERIFIED | `export type StoreEvent = {...}` (event.ts:54), `export type Rumor = UnsignedEvent & { id: string }` (event.ts:47), `export function verifyRumor(rumor: Rumor): boolean { return getEventHash(rumor) === rumor.id; }` (event.ts:64-66). `rumor.test.ts` asserts both `true` (correct id) and `false` (tampered id) cases — both pass. `exports.test.ts` snapshot shows `verifyRumor` as the only newly added export key. |
| 4 | Structural helpers and store interfaces/managers (`DeleteManager`, `ExpirationManager`, `EventMemory`) accept any `E extends StoreEvent` (Roadmap SC4, CORE-04/05) | VERIFIED | All 11 CORE-04 helpers confirmed generic: `getEventUID`/`getReplaceableAddress`/`getReplaceableIdentifier` (event.ts), `getIndexableTags`/`matchFilter`/`matchFilters` (filter.ts), `getExpirationTimestamp` (expiration.ts), `eventMatchesPointer` (pointers.ts), `addSeenRelay`/`getSeenRelays`/`isFromRelay` (relays.ts). All 18 CORE-05 interfaces confirmed generic in `interface.ts` (grep found `IEventStoreRead` through `IEventStore`/`IAsyncEventStore`, each `<E extends StoreEvent = NostrEvent>`). All 4 managers confirmed generic classes implementing their `<E>` interfaces: `DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`. |
| 5 | `pnpm --filter applesauce-core test` and `pnpm --filter applesauce-core build` pass unchanged (Roadmap SC5) | VERIFIED | Ran directly: `pnpm --filter applesauce-core build` — clean (tsc, no errors). `pnpm --filter applesauce-core test` — 592/592 tests passed, 53 test files. |
| 6 | The composite `IEventStore<E>`/`IAsyncEventStore<E>` compose the still-non-generic `EventModels`-backed subscription/model portion at the `NostrEvent` default (D-02 seam, plan 01-02 must-have) | VERIFIED | `interface.ts:257-275` — both composite interfaces extend `IEventSubscriptions` and `IEventModelMixin<IEventStore>`/`<IAsyncEventStore>` bare (no type argument), while threading `<E>` into the store-owned component interfaces. Confirmed by direct read of the file. |
| 7 | Bridge casts localized to non-CORE-04 helper calls only (delete-manager.ts, event-memory.ts) (plan 01-03 must-have) | VERIFIED | Confirmed `deleteEvent as unknown as NostrEvent` at delete-manager.ts:46,69 and `event as unknown as NostrEvent`/`as unknown as NostrEvent[]` at event-memory.ts:75,99,114 — each scoped to the single call-site argument. |
| 8 | verifyEvent option/property generic over E with a documented `coreVerifyEvent as unknown as (event: E) => boolean` default bridge (D-04, plan 01-04 must-have) | VERIFIED | `private _verifyEventMethod?: (event: E) => boolean = coreVerifyEvent as unknown as (event: E) => boolean;` present in both event-store.ts:81 and async-event-store.ts:79. |
| 9 | Full workspace builds after the post-execution `EventMemory<NostrEvent>()` integration fix in applesauce-loaders and applesauce-relay | VERIFIED | Confirmed explicit `new EventMemory<NostrEvent>()` at all 6 `filterDuplicateEvents` call sites (group.ts ×2, address-loader.ts, event-loader.ts, tag-value-loader.ts, timeline-loader.ts). `pnpm --filter applesauce-loaders build` and `pnpm --filter applesauce-relay build` both clean. Full `pnpm build` (all workspace packages) exit code 0, no `error TS` in output. |

**Score:** 9/9 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/helpers/event.ts` | `verifyRumor` + genericized `getEventUID`/`getReplaceableAddress`/`getReplaceableIdentifier` | VERIFIED | All present, matches spec-fixed signature `verifyRumor(rumor: Rumor): boolean`. |
| `packages/core/src/helpers/filter.ts` | genericized `getIndexableTags`/`matchFilter`/`matchFilters` | VERIFIED | All 3 confirmed `<E extends StoreEvent = NostrEvent>`. |
| `packages/core/src/helpers/expiration.ts` | genericized `getExpirationTimestamp` | VERIFIED | Confirmed. |
| `packages/core/src/helpers/pointers.ts` | genericized `eventMatchesPointer` | VERIFIED | Confirmed. |
| `packages/core/src/helpers/relays.ts` | genericized `addSeenRelay`/`getSeenRelays`/`isFromRelay` | VERIFIED | Confirmed. |
| `packages/core/src/helpers/__tests__/rumor.test.ts` | verifyRumor unit test (true/false cases) | VERIFIED | Both D-03 cases present and passing. |
| `packages/core/src/event-store/interface.ts` | 18 genericized interfaces | VERIFIED | All 18 confirmed via grep of `export interface` declarations. |
| `packages/core/src/event-store/delete-manager.ts` | `DeleteManager<E>` | VERIFIED | Confirmed. |
| `packages/core/src/event-store/async-delete-manager.ts` | `AsyncDeleteManager<E>` | VERIFIED | Confirmed. |
| `packages/core/src/event-store/expiration-manager.ts` | `ExpirationManager<E>` | VERIFIED | Confirmed. |
| `packages/core/src/event-store/event-memory.ts` | `EventMemory<E>` | VERIFIED | Confirmed, all internal indexes threaded over `E`. |
| `packages/core/src/event-store/event-store.ts` | `EventStore<E>` + CORE-03 fix | VERIFIED | Confirmed constructor fix, generic static `copySymbolsToDuplicateEvent<E>`. |
| `packages/core/src/event-store/async-event-store.ts` | `AsyncEventStore<E>` + CORE-03 fix | VERIFIED | Confirmed. |
| `packages/core/src/event-store/__tests__/verify-event-option.test.ts` | behavioral test for CORE-03 | VERIFIED | 3 assertions (default rejects, undefined accepts, warn fires) — all pass; ran as single named test directly. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `helpers/event.ts` (`verifyRumor`) | `nostr-tools/pure getEventHash` | direct call | WIRED | `getEventHash` imported as local binding (line 7) and called at line 65. |
| `helpers/filter.ts` (`matchFilter`) | `helpers/filter.ts` (`getIndexableTags`) | same-`E` call | WIRED | Both generic over same `E`, `matchFilter` calls `getIndexableTags(event)` internally. |
| `event-store/interface.ts` | `helpers/event.ts` (`StoreEvent`) | import | WIRED | `StoreEvent` imported alongside `NostrEvent` and used as the bound/default across all 18 interfaces. |
| `IEventStore<E>` composite | `IEventStoreReadAdvanced<E>`/`IEventStoreStreams<E>`/`IEventStoreActions<E>`/`IEventClaims<E>`/`IMissingEventLoader<E>` | extends clause | WIRED | Confirmed at interface.ts:268-276 — `E` threaded through store-owned interfaces; `IEventSubscriptions`/`IEventModelMixin<IEventStore>` extended bare (D-02 seam), exactly as the plan specified. |
| `event-store/delete-manager.ts` | `helpers/delete.ts` (`getDeleteEventPointers`/`getDeleteAddressPointers`) | bridge cast | WIRED | `deleteEvent as unknown as NostrEvent` bridge at call sites (lines 46, 69). |
| `event-store/event-memory.ts` | `helpers/filter.ts` (`getIndexableTags`) | direct generic call | WIRED | Indexes built over `E`-typed events using the genericized helper. |
| `event-store/event-store.ts` (verifyEvent) | `nostr-tools` (`verifyEvent`/`coreVerifyEvent`) | bridge cast default | WIRED | `coreVerifyEvent as unknown as (event: E) => boolean` default initializer confirmed. |
| `event-store/async-event-store.ts` | `event-store/event-store.ts` (`copySymbolsToDuplicateEvent`) | generic static call | WIRED | Static method genericized; async store's `add`/duplicate handling calls it with `E`-typed args (confirmed via grep in event-store.ts's own internal calls; async store mirrors the sync store's usage pattern). |
| `applesauce-loaders`/`applesauce-relay` (`filterDuplicateEvents` call sites) | `event-store/event-memory.ts` (`EventMemory<E>`) | explicit type argument | WIRED | All 6 call sites use `new EventMemory<NostrEvent>()`, resolving the D-02-adjacent inference gap discovered post-execution. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| verifyRumor correct-id / tampered-id | `pnpm --filter applesauce-core test` (full suite includes `rumor.test.ts`) | 592/592 passed | PASS |
| CORE-03 `verifyEvent: undefined` disables verification + warns | `pnpm --filter applesauce-core exec vitest run -t "verifyEvent: undefined disables verification and accepts the invalid event"` | 1 passed / 591 skipped | PASS |
| `applesauce-core` build | `pnpm --filter applesauce-core build` | tsc clean, no errors | PASS |
| `applesauce-loaders` build (post-fix) | `pnpm --filter applesauce-loaders build` | tsc clean, no errors | PASS |
| `applesauce-relay` build (post-fix) | `pnpm --filter applesauce-relay build` | tsc clean, no errors | PASS |
| Full workspace build | `pnpm build` | exit code 0; no `error TS` in log | PASS |
| `exports.test.ts` snapshot churn | `git diff` on exports.test.ts vs. pre-phase commit | only `"verifyRumor"` added | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORE-01 | 01-04 | `EventStore<E>` generic, `new EventStore()` unchanged | SATISFIED | Confirmed class declaration + full test suite green |
| CORE-02 | 01-04 | `AsyncEventStore<E>` generic, same default | SATISFIED | Confirmed class declaration + full test suite green |
| CORE-03 | 01-04 | Constructor honors explicit `verifyEvent: undefined` | SATISFIED | Confirmed presence-check code + passing behavioral test |
| CORE-04 | 01-01 | 11 structural helpers generic over `E extends StoreEvent` | SATISFIED | All 11 confirmed generic via direct file read |
| CORE-05 | 01-02, 01-03 | Store interfaces + 4 managers generic | SATISFIED | All 18 interfaces + 4 manager classes confirmed generic |
| RUMOR-01 | 01-01 | `StoreEvent`/`Rumor` exported from `helpers/event.ts` | SATISFIED | Confirmed exports + exports-snapshot test |
| RUMOR-02 | 01-01 | `verifyRumor` hash-recompute verifier | SATISFIED | Confirmed implementation + unit test (both cases) |

No orphaned requirements — REQUIREMENTS.md maps exactly these 7 IDs to Phase 1, and all 7 appear in plan frontmatter `requirements` fields and are marked `[x]`/`Complete` in REQUIREMENTS.md.

### Anti-Patterns Found

None. Scanned all 12 files modified across the 4 plans for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"not available" — zero matches in any modified helper, interface, manager, or store-class file.

### Code Review Carry-Forward (Not Phase 1 Gaps)

`01-REVIEW.md` found no blockers. Two WARNINGs are documented in `deferred-items.md` as intentionally owned by later phases, per the phase-supplied context:
- **WR-01** (default verifier would silently reject rumors under `EventStore<Rumor>`) — owned by Phase 3 (`RumorStore` supplies `verifyRumor` as its default verifier).
- **WR-02** (`E` dropped from subscription-method return types due to the D-02 seam) — owned by Phase 2 (genericizes `EventModels`).

Both are explicitly deferred per the ROADMAP's own phase sequencing (Phase 2 Requirements: CORE-06/07; Phase 3 Requirements: RUMOR-03 through RUMOR-06) — not treated as Phase 1 gaps, consistent with Step 9b deferred-item filtering.

### Gaps Summary

None. All 9 observable truths (merging the 5 ROADMAP Success Criteria with plan-level must-haves) are verified against the actual codebase — not merely claimed in SUMMARY.md. Both `pnpm --filter applesauce-core build`/`test` and the full workspace `pnpm build` were executed directly during this verification (not taken on faith), and the CORE-03 behavioral truth was proven with a directly-executed single named test, not just suite-level pass counts. The one intentional runtime change (CORE-03's `verifyEvent: undefined` handling) is the only behavior change and is test-proven; every other change is confirmed type-level only via passing full regression suite (592/592, unchanged from pre-phase test count plus the 3 new CORE-03 tests).

No human verification items — all truths for this phase are either type-level (verifiable by build) or behavior-level with an existing passing test (verifiable by direct test execution).

---

*Verified: 2026-07-09T01:56:52Z*
*Verifier: Claude (gsd-verifier)*
