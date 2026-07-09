# Codebase Concerns

**Analysis Date:** 2026-07-09

## Tech Debt

### Type Safety: `castEvent` input does not exclude rumors from signed-only casts

**Issue:** Phase 2 widened `castEvent`'s first parameter from `NostrEvent` to `StoreEvent` to enable casting unsigned rumors. The `CastEventInput<T>` type conditional attempts to gate input narrowness based on whether a cast's declared event type `T` carries `sig: string`, but the implementation still accepts a `Rumor` where a signed-only cast reads `event.sig` at runtime.

**Files:** `packages/core/src/casts/cast.ts:35,38-50` (`CastEventInput` type and `performCast` function)

**Impact:** A rumor passed to a signed-only cast at runtime will read `undefined` from the missing `sig` field instead of throwing a compile error. This is a latent `TypeError` for code passing rumors directly to casts that expect signatures.

**Fix approach:**
- Phase 3/4 must decide whether to tie `castEvent`'s input to the cast's declared `EventCast<T>` type (stricter, rejecting rumors for signed casts) or split the public API into `castEvent` (signed) and `castRumor` (unsigned).
- Keep stream operators (`castEventStream`/`castTimelineStream`) loose since they are runtime-guarded with try/catch over a generic `StoreEvent` stream.
- Referenced in deferred items: `.planning/milestones/v1.0-phases/02-generic-models-casts/deferred-items.md` WR-01.

---

### Return Type Hiding: `getHashtagTag` masks possible `undefined`

**Issue:** `getHashtagTag()` casts its `.find()` result as `["t", string]`, hiding the fact that `.find()` returns `undefined` when no tag is found. A caller doing `getHashtagTag(event)[1]` will crash with `TypeError: Cannot read property '1' of undefined` when the event has no matching hashtag.

**Files:** `packages/common/src/helpers/hashtag.ts:9`

**Impact:** Pre-existing (predates Phase 4). Inconsistent with the sibling `getEmojiTag` (`packages/common/src/helpers/emoji.ts:14-22`), which correctly returns `["emoji", ...] | undefined`. Any caller using the array access pattern on a missing tag crashes.

**Fix approach:** Change return type to `["t", string] | undefined`, audit all call sites (`getHashtagTag` callers must handle `undefined`), and align with the correct pattern used by `getEmojiTag`. This is a breaking API change (minor/patch bump) suitable for a dedicated correctness fix, not included in Phase 4's zero-behavior-change scope.

---

### Cosmetic Type Artifacts (Low Priority)

**Files:**
- `packages/core/src/event-store/event-models.ts` — `profile()` has dead normalization code (pre-existing)
- `packages/core/src/casts/base.ts` — stale "until Wave 2" bridge-cast comments
- `packages/relay/src/observable/cast-timeline-stream.ts` — a no-op `defined()` call

**Impact:** Code clarity only; no functional impact.

---

## Unsafe Type Casts Introduced by Generics Work

### EventMemory Generic Type Bridges

**Issue:** `EventMemory<E>` provides a generic event store, but helper functions like `insertEventIntoDescendingList()` (used in `getTimeline()` and `add()`) are hardcoded to accept `NostrEvent[]` from nostr-tools, not the generic `E`. The class uses localized `as unknown as NostrEvent` bridges to call these functions.

**Files:** 
- `packages/core/src/event-store/event-memory.ts:74-76,98-99` (localized casts in `getTimeline()` and `add()`)
- `packages/core/src/event-store/delete-manager.ts` (similar bridge pattern)

**Impact:** Type-safe at call sites (EventMemory<E> correctly returns E-typed events), but fragile if upstream nostr-tools changes the `NostrEvent` shape or if `insertEventIntoDescendingList` gains requirements beyond `{created_at}`. The cast is safe only because the function reads only fields present in both `Rumor` and `NostrEvent` (id, created_at, pubkey).

**Safe modification:** These bridges are intentional; document them as stable (the read-only field access is safe). If nostr-tools adds mutations or new required fields, re-evaluate.

---

### Turso Database Unsafe Casts

**Issue:** The Turso WASM and native drivers cast database result objects as `any` to access the `.count` field, which is not typed by the Turso SDK.

**Files:**
- `packages/sqlite/src/turso-wasm/methods.ts:40,91,131` (three `(result as any).count` accesses)
- `packages/sqlite/src/turso/methods.ts:55,125,165` (three more)

**Impact:** Silently fails if the database library changes its result shape. No runtime validation; typos in property names would pass type-checking.

**Fix approach:** Either type the result objects from the Turso SDK correctly or wrap database queries in a helper that validates the `.count` field exists before accessing it.

---

## Performance Bottlenecks

### Relay Health State Reset May Be Too Aggressive

**Issue:** `RelayLiveness.recordSuccess()` unconditionally resets a relay's state back to "online" and clears the failure count, even if the relay was recently offline. A transient single success after sustained outage immediately marks it "online" again.

**Files:** `packages/relay/src/liveness.ts:267-279` (TODO comment at line 267)

**Impact:** In high-churn networks or with flaky relays, rapid failure/success cycles cause aggressive state transitions, potentially masking a genuinely dead relay behind temporary recoveries.

**Improvement path:** Add hysteresis — require N consecutive successes to transition from "offline" → "online" (mirroring the failure count behavior), or implement a cooldown before accepting success after recent failures. Revisit the backoff logic and test with realistic relay failure patterns.

---

### Large Complex Files

**Files and line counts:**
- `packages/relay/src/relay.ts` (1365 lines) — handles request, subscription, and publish logic; consider extracting subscription management or message handling
- `packages/core/src/event-store/__tests__/event-memory.test.ts` (1173 lines) — comprehensive but monolithic; split into separate test modules per feature (timeline, replaceable, filters)
- `packages/wallet/src/wallet/nut-wallet.ts` (1095 lines) — token management; complex state handling
- `packages/concord/src/client/community.ts` (893 lines) — community protocol; significant conditional logic

**Impact:** Harder to review, modify, and reason about. Increased risk of hidden bugs in large conditional branches.

---

### EventMemory Tag Indexing via LRU Cache

**Issue:** `EventMemory<E>` caches tag indexes in an LRU (`this.tags = new LRU<Set<E>>()`), meaning old tag indexes are evicted. If the same tag is queried again after eviction, a new index is built from scratch.

**Files:** `packages/core/src/event-store/event-memory.ts:21`

**Impact:** For very large event stores with many distinct tags and high query diversity, LRU thrashing can cause repeated index rebuilds. No performance data on the breakpoint.

**Improvement path:** Profile tag query patterns; if LRU thrashing is observed, switch to a bounded map with explicit eviction policy or a bloom filter for negative queries.

---

## Known Missing Features

### NIP-17 Wrapped Messages Lack Relay Hints

**Issue:** `setConversation()` and `setParent()` operations in wrapped-message operations don't support relay hints (the optional relay URL in tags).

**Files:** `packages/common/src/operations/wrapped-message.ts:19,34` (both marked TODO)

**Impact:** Relay hints are optional in NIP-17, so the current implementation is spec-compliant; however, without hints, recipients may not efficiently discover where to fetch referenced events. Not a blocker, but a usability gap.

**Fix approach:** Add optional `relayHints?: string[]` parameters to `setConversation()` and `setParent()`; include them in the tag output.

---

### Operations Not Refactored to Use `modifyPublicTags`

**Issue:** Some operations in `reaction.ts` and `share.ts` should be refactored to use the shared `modifyPublicTags` helper for consistency and maintainability.

**Files:** 
- `packages/common/src/operations/reaction.ts:11` (TODO)
- `packages/common/src/operations/share.ts:12` (TODO)

**Impact:** Code duplication; harder to maintain consistent tag-mutation patterns. Not a bug, but a code-quality concern.

**Fix approach:** Audit these files, extract tag-mutation patterns, and rewrite them using `modifyPublicTags`.

---

### Media Attachment Duplicate Detection Not Implemented

**Issue:** `addMediaAttachment()` doesn't check for or merge duplicate media tags.

**Files:** `packages/common/src/operations/media-attachment.ts:11` (TODO)

**Impact:** Multiple identical media attachments can be added to a draft, bloating event size.

**Fix approach:** Implement duplicate detection (match on URL and/or hash), merge or skip duplicates.

---

## Security Considerations

### Signature Verification Can Be Disabled with `verifyEvent: undefined`

**Issue:** `EventStore({ verifyEvent: undefined })` disables signature verification and logs a console warning. This is intentional (noted in Phase 1's deferred items AR-01), but security-relevant.

**Files:** `packages/core/src/event-store/event-store.ts:99-103` (setter warns); `packages/core/src/event-store/__tests__/verify-event-option.test.ts` (test proves behavior)

**Impact:** Developers constructing an `EventStore` with `verifyEvent: undefined` bypass all signature validation. This is safe only if the event source is fully trusted (e.g., local database, verified relay).

**Current mitigation:** Console warning at construction time. Must be called out in migration and release notes for v1.0.

---

### Event Object Mutation via `verifiedSymbol`

**Issue:** The `verifiedSymbol` (from nostr-tools' `finalizeEvent`) is cached on event objects to memoize verification results. This relies on event objects being treated as immutable after creation (or careful cache invalidation).

**Files:** `packages/core/src/event-store/__tests__/verify-event-option.test.ts:16` (test deletes the symbol to force re-verification)

**Impact:** If a library or application mutates event objects after storage, the memoization cache becomes stale. No known instances, but fragile against future code that accidentally mutates.

**Safe modification:** Treat events as immutable after adding to a store. Document this assumption.

---

## Relay Selection and Connectivity

### Relay Selection Can Exceed `maxRelaysPerUser`

**Issue:** `selectRelays()` in relay-selection.ts has a TODO indicating that the algorithm can return more relays than `maxRelaysPerUser` allows.

**Files:** `packages/core/src/helpers/relay-selection.ts:89` (TODO)

**Impact:** Users might be published to more relays than configured, increasing privacy leak surface if `maxRelaysPerUser` is a hard limit.

**Fix approach:** Enforce the limit strictly; if the algorithm overshoots, trim or re-weight the selection.

---

### Event Pointer Merging May Not Be Optimal

**Issue:** `packages/loaders/src/helpers/event-pointer.ts` has a TODO suggesting `mergeRelaySets` might be a better approach for merging relay hints from multiple pointers.

**Files:** `packages/loaders/src/helpers/event-pointer.ts:11` (TODO)

**Impact:** Relay set merging might be inefficient or incomplete; low priority unless relay discovery performance becomes a bottleneck.

---

## Test Coverage Gaps

### Intentional Empty Catch Blocks for Best-Effort Parsing

**Issue:** 37 `catch {}` blocks exist in the codebase, mostly for best-effort tag parsing (e.g., threading.ts, common helpers). These are intentional and documented.

**Files:** Most common in `packages/common/src/helpers/threading.ts:104,114` (noted as "best-effort" in deferred items IN-02)

**Impact:** Errors during parsing are silently ignored. If a tag parser throws unexpectedly, the error is swallowed. Safe for parsing hostile data, but could hide bugs if parser implementation changes.

**Safe modification:** These are intentional; no action needed. Document the pattern in coding guidelines.

---

### Large Test Files Can Hide Untested Paths

**Issue:** Test files like `event-memory.test.ts` (1173 lines) and `relay.test.ts` (1670 lines) are monolithic. Untested conditional branches or edge cases may be buried.

**Files:**
- `packages/relay/src/__tests__/relay.test.ts` (1670 lines)
- `packages/core/src/event-store/__tests__/event-memory.test.ts` (1173 lines)

**Impact:** Harder to audit coverage; easier to miss test gaps when reviewing large files.

**Fix approach:** Split into smaller modules organized by feature (e.g., relay subscription tests, relay publication tests, event-memory timeline tests).

---

## Generics-Induced Type System Fragility

### `EventStore<Rumor>` Without Explicit `verifyEvent`

**Issue:** Creating `new EventStore<Rumor>()` without explicitly providing `verifyEvent: verifyRumor` will silently drop every rumor because the default verifier (`coreVerifyEvent as unknown as (event: E) => boolean`) runs nostr-tools' signature check against an unsigned event.

**Files:** `packages/core/src/event-store/event-store.ts:91` (default verifier bridge)

**Impact:** Rumor stores created without explicit `verifyEvent` lose all events. **This was a Phase 1 WR-01 deferred item; Phase 3 (RumorStore) corrected it by providing `verifyEvent: verifyRumor` in the RumorStore constructor** (`packages/core/src/event-store/rumor-store.ts:17-18`). **However, direct `EventStore<Rumor>()` construction remains a footgun.**

**Current state:** Documented in deferred items; Phase 3 mitigated by introducing `RumorStore` as the preferred constructor. Direct `EventStore<Rumor>()` is now a documented anti-pattern.

**Safe modification:** Strongly recommend `RumorStore` over `new EventStore<Rumor>()`. Add a runtime warning if an `EventStore<Rumor>` is constructed without explicit `verifyEvent`.

---

## Dependency Concerns

### TypeScript and Tooling Versions

**Issue:** Project uses TypeScript 5.9.3 (latest) and Vitest 4.1.6. No known breaking issues, but large TypeScript versions introduce subtle type narrowing changes that may affect generic type inference.

**Files:** `package.json` (devDependencies)

**Impact:** Unlikely but possible; any future TypeScript patch that changes generic inference rules could break the `CastEventInput` conditional or other type-level logic.

**Mitigation:** Monitor TypeScript changelogs; consider pinning to a major.minor version if generics-heavy code becomes fragile.

---

### `nostr-tools` Pinned to `~2.19`

**Issue:** `applesauce-core` pins `nostr-tools` to `~2.19` (any 2.19.x, but not 2.20+). The `verifiedSymbol` and `insertEventIntoDescendingList` APIs are relied upon; any API change in 2.20+ could break the codebase.

**Files:** `packages/core/package.json:106`

**Impact:** Deferred upgrades accumulate technical debt. Security patches in future nostr-tools versions may not be available.

**Mitigation:** Plan a `nostr-tools` upgrade path; test thoroughly (generics-related type bridges are sensitive to dependency changes).

---

## Fragile Areas

### Delete Manager Type Bridge

**Issue:** Similar to EventMemory, `delete-manager.ts` uses `as unknown as NostrEvent` bridges when calling nostr-tools helpers.

**Files:** `packages/core/src/event-store/delete-manager.ts` (mentioned in Phase 1 deferred items IN-02 as "fragile against future upstream changes")

**Impact:** Same as EventMemory; safe today, but breaks if nostr-tools changes field requirements.

**Safe modification:** These bridges are safe because they only read stable fields. Document as intentional and stable.

---

### Relay Group Operator Composition

**Issue:** `packages/relay/src/group.ts` heavily uses RxJS operators (1365 lines, 30+ operator imports). Complex operator chains can hide memory leaks (subscriptions not cleaned up) or error-handling gaps.

**Files:** `packages/relay/src/group.ts` (entire file)

**Impact:** Hard to audit subscription lifecycle; any missed unsubscribe could cause memory leaks under high churn.

**Safe modification:** Add subscription leak detection tests; use `takeUntil` or similar cleanup patterns consistently.

---

### Concord Invite and Direct Invite Protocol Complexity

**Issue:** `packages/concord/src/` implements complex Nostr-based protocol operations (community creation, invites, direct invites). The key derivation (`packages/concord/src/helpers/keys.ts`, 593 lines) and crypto operations are critical.

**Files:** `packages/concord/src/helpers/keys.ts`, `packages/concord/src/helpers/crypto.ts`, `packages/concord/src/client/community.ts`

**Impact:** Cryptographic bugs could compromise privacy or authentication. High scrutiny required.

**Safe modification:** Any changes to key derivation, encryption, or signing must include test vectors and independent review.

---

## Performance and Scaling Limits

### In-Memory Event Store Has No Bounds

**Issue:** `EventMemory<E>` stores all events in memory indefinitely. No configurable size limit, eviction policy, or warning at capacity.

**Files:** `packages/core/src/event-store/event-memory.ts` (entire class)

**Impact:** Long-running applications with high event volumes can exhaust heap. No graceful degradation.

**Improvement path:** Add optional `maxSize` and `maxAgeMs` options; implement LRU eviction for events and per-author event limits. Monitor heap usage in tests.

---

### RxJS Subscription Churn in Relay Pool

**Issue:** `RelayPool` and `Relay` create many subscriptions dynamically. Under high filter churn (many rapid filter changes), subscription creation/teardown could become a bottleneck.

**Files:** `packages/relay/src/relay.ts`, `packages/relay/src/pool.ts`

**Impact:** Unclear breakpoint; needs profiling under realistic load (1000s of filters, 100s of relays).

---

---

*Concerns audit: 2026-07-09*
