---
phase: 20-auth-family-re-layer
reviewed: 2026-08-31T16:36:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - .changeset/relay-auth-family-re-layer.md
  - apps/docs/loading/relays/relays.md
  - packages/extra/src/__tests__/vertex.test.ts
  - packages/loaders/src/loaders/__tests__/sync-loader.test.ts
  - packages/loaders/src/loaders/sync-loader.ts
  - packages/relay/src/__tests__/auth-lifecycle-logging.test.ts
  - packages/relay/src/__tests__/exports.test.ts
  - packages/relay/src/__tests__/group.test.ts
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/group.ts
  - packages/relay/src/relay.ts
  - packages/relay/src/types.ts
  - packages/relay/tsconfig.type-tests.json
  - packages/relay/type-tests/event-auth-types.ts
findings:
  critical: 3
  warning: 2
  info: 0
  total: 5
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-08-31T16:36:00Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The fixed EVENT/AUTH routing, classifier-name parity, public type break, documentation, and release metadata are internally consistent, and the submitted Relay and Extra focused suites pass. The high-level lifecycle is not safe to ship, however: abort/timeout races leave the raw AUTH operation alive, concurrent identical attempts defeat the claimed newest-attempt protection, and Vertex converts routine authentication rejection into an unhandled promise rejection. The tests omit each failing edge despite the phase plans and summaries claiming coverage.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01 [BLOCKER]: Abort and outer timeout do not cancel an in-flight AUTH exchange

**File:** `/home/user/Projects/applesauce/packages/relay/src/relay.ts:1497-1527`
**Issue:** `bounded()` is only `Promise.race([value, cancellation])`. Once `this.auth(event)` has subscribed through `lastValueFrom`, aborting or expiring the outer deadline rejects `authenticate()` but cannot unsubscribe the underlying `eventExchange`. Its socket listener remains active until `eventTimeout`, and a late matching `OK` still executes `auth()`'s `tap` at lines 1350-1366 and updates both authentication mirrors after the caller was told the operation was cancelled. This violates the whole-operation cancellation contract and the phase's explicit requirement to terminate waits and suppress late side effects. It also retains a listener for as long as the independent low-level timeout.
**Fix:** Keep the final exchange cancellable rather than converting it to an uncancellable Promise first. For example, expose an internal AUTH observable (or add a private attempt method) and apply `takeUntil(cancel$)` before `lastValueFrom`; gate bookkeeping on an operation token/cancellation state. Add real-wire tests that abort and time out after the AUTH frame is observed, then deliver a late `OK` and assert no response/state update and no live listener.

### CR-02 [BLOCKER]: Event IDs are not valid identities for concurrent AUTH attempts

**File:** `/home/user/Projects/applesauce/packages/relay/src/relay.ts:1332-1360`
**Issue:** Both newest-response guards compare `event.id`. Two separate `authenticate()` calls for the same signer, relay, challenge, and `created_at` second produce the same deterministic Nostr event and therefore the same ID. Both raw subscriptions then match the first `OK` for that ID, so an older reply can complete the newer logical call and pass both “latest” guards. The second reply is ignored. Thus separate calls are not independent and the advertised latest-attempt protection does not protect the exact concurrency case it was added for.
**Fix:** Allocate a unique in-memory attempt token for every `auth()` invocation and store/compare that token for keyed and deprecated mirrors. If identical wire events must be allowed concurrently, explicitly coordinate them (for example, serialize or deliberately coalesce by event ID with documented shared semantics); do not represent them as independent calls. Add a same-pubkey/same-event test that sends distinguishable outcomes and proves an older attempt cannot settle or overwrite the newer one.

### CR-03 [BLOCKER]: Vertex drops authentication failures as unhandled rejections

**File:** `/home/user/Projects/applesauce/packages/extra/src/vertex.ts:40-45`
**Issue:** `this.authenticate(this.signer).finally(...)` creates a new Promise that rejects whenever `authenticate()` rejects, but nothing observes that derived Promise. Phase 20 deliberately adds normal rejection paths for missing challenges, freshness exhaustion, abort, signer errors, and transport failures, so Vertex automatic authentication now routinely emits unhandled rejections (and can terminate Node processes under strict unhandled-rejection policy). The new compatibility test mocks only a successful result and cannot detect this path.
**Fix:** Consume the rejection while retaining guard cleanup, e.g. `void this.authenticate(this.signer).catch((error) => this.log/... ).finally(() => { authenticating = false; })`, or route it to an explicit Vertex error observable/callback. Add a rejecting `authenticate` test and assert the guard resets without an `unhandledRejection`.

## Warnings

### WR-01 [WARNING]: Public numeric policy accepts nonsensical retry and timeout values

**File:** `/home/user/Projects/applesauce/packages/relay/src/relay.ts:1462-1494`
**Issue:** `challengeRetries` and `timeout` are consumed without runtime validation. Negative, fractional, `NaN`, and infinite values produce undocumented behavior: negative retries fail on the first change, fractions are effectively rounded by comparison, `NaN` schedules an immediate timeout, and `Infinity` causes platform-specific timer clamping/warnings rather than disabling the deadline. These are public inputs and can silently change authentication policy.
**Fix:** Validate `challengeRetries` as a finite non-negative integer and `timeout` as `false` or a finite non-negative duration, rejecting invalid options before starting connection work. Document whether zero is permitted and test every boundary.

### WR-02 [WARNING]: Phase tests claim cancellation/concurrency coverage without exercising the failing boundaries

**File:** `/home/user/Projects/applesauce/packages/relay/src/__tests__/relay.test.ts:2065-2154`
**Issue:** The concurrency test only counts calls and resolves every duplicate-ID frame with the same success value; it never proves response isolation or newest-state behavior. The abort test stops during signing, before `auth()` creates its uncancellable subscription, and there is no abort/timeout-after-write test. Consequently the suite remains green while CR-01 and CR-02 violate D-08, D-09, and D-15, and the Phase 20 summary overstates its evidence.
**Fix:** Add adversarial real-wire cases for abort and outer timeout after the AUTH write, late replies, duplicate deterministic event IDs, opposite reply outcomes, and both keyed/deprecated mirror state. Assert promise settlement identity as well as frame counts and final state.

---

_Reviewed: 2026-08-31T16:36:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
