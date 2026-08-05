---
phase: 03-rumorstore-verification
reviewed: 2026-07-09T05:07:33Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/core/src/event-store/rumor-store.ts
  - packages/core/src/event-store/index.ts
  - packages/core/src/casts/cast.ts
  - packages/core/src/observable/cast-stream.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-09T05:07:33Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the RumorStore verification class and the Phase-2 WR-01 split of `castEvent` into a sig-gated
public form plus an internal loose `performCast`. The three focus areas hold up:

1. **RumorStore constructor genuinely forces `verifyRumor`.** `Omit<EventStoreOptions<Rumor>,
   "verifyEvent">` blocks a caller from passing `verifyEvent` in the options literal, and the
   spread order in `super({ ...options, verifyEvent: verifyRumor })` places `verifyEvent` *after*
   the spread — so even a caller who smuggles a `verifyEvent` through a widened (non-literal)
   options variable at runtime is overridden by `verifyRumor`. The construction-time lock is sound.
   The verify step is active (base `add()` calls `this.verifyEvent(event)`), confirmed by the
   RUMOR-03 tests (correct id accepted, incorrect id rejected).

2. **The sig-gate is restored correctly and the `as unknown as`/`as` bridges do not mask a real
   error.** `CastEventInput<T> = T extends { sig: string } ? NostrEvent : StoreEvent` pins a
   signed cast's input to `NostrEvent` (a sig-less `Rumor` is not assignable → compile error),
   while a rumor/sig-less cast keeps a loose `StoreEvent` input. C is inferred solely from `cls`
   (the conditional-typed `event` param is not an inference site), which is the intended behavior.
   The `event as StoreEvent` in the public `castEvent` is a *widening* — both branches of
   `CastEventInput` are subtypes of `StoreEvent` — so it is a legitimate bridge, not a masked
   error. The WR-01 regression guard (`@ts-expect-error` in `rumor-cast.test.ts:78`) confirms a
   rumor is rejected for a signed-only cast.

3. **No runtime behavior change for existing signed-event `castEvent` callers.** `performCast`'s
   body is byte-for-byte the pre-split `castEvent` body (memoization, `getParentEventStore`
   fallback, `CASTS_SYMBOL` map handling); the new public `castEvent` only delegates. The stream
   operators correctly route through the loose, runtime-guarded `performCast`.

Two documentation-vs-behavior mismatches on RumorStore's stated guarantees, and one stale
`@internal` comment, are below. No BLOCKER-level defects found.

## Warnings

### WR-01: RumorStore's "cannot be overridden by callers" claim is defeated by the inherited public `verifyEvent` setter

**File:** `packages/core/src/event-store/rumor-store.ts:5-12`
**Issue:** The class JSDoc states `verifyEvent` "is locked to `verifyRumor` and **cannot be
overridden by callers**." That is true only for the *constructor* path. `EventStore` exposes a
public `set verifyEvent(method)` (`event-store.ts:99-104`), which `RumorStore` inherits unchanged.
A caller can disable or replace rumor verification at runtime:

```ts
const store = new RumorStore();
store.verifyEvent = () => true;        // accepts any rumor, valid id or not
store.verifyEvent = undefined;         // disables verification entirely (only logs a warn)
```

This directly undercuts the phase's stated goal ("a caller cannot bypass it"). The integrity
guarantee that is the entire reason RumorStore exists can be silently switched off post-construction.

**Fix:** Either soften the doc to say the verifier "cannot be set via the constructor," or actually
lock it by overriding the setter in `RumorStore`:

```ts
export class RumorStore extends EventStore<Rumor> {
  constructor(options?: Omit<EventStoreOptions<Rumor>, "verifyEvent">) {
    super({ ...options, verifyEvent: verifyRumor });
  }
  // Enforce the documented lock at runtime.
  override set verifyEvent(_method: undefined | ((event: Rumor) => boolean)) {
    throw new Error("RumorStore.verifyEvent is locked to verifyRumor and cannot be changed");
  }
  override get verifyEvent() {
    return verifyRumor;
  }
}
```

### WR-02: kind-5 delete rumors bypass verifyRumor, so the "verifies each rumor" claim is false for deletions

**File:** `packages/core/src/event-store/rumor-store.ts:4-8` (guarantee) via inherited `event-store.ts:234-239`
**Issue:** The class doc says RumorStore "verifies **each** rumor by recomputing its event hash."
But the inherited `EventStore.add()` short-circuits delete events to the `DeleteManager` and returns
*before* the `verifyEvent` step:

```ts
add(event: E, fromRelay?: string): E | null {
  if (event.kind === kinds.EventDeletion) {
    this.deletes.add(event);   // <-- no verifyRumor() here
    return event;
  }
  ...
  if (this.verifyEvent && this.verifyEvent(event) === false) return null; // never reached for kind 5
```

Consequently a kind-5 rumor with an **incorrect id/hash** is still accepted and still triggers
removal of matching stored rumors. Combined with the migration doc's accepted "integrity but not
authorization" property (a rumor has no signature binding `pubkey`), any actor can craft a kind-5
rumor to delete legitimate rumors, and its own hash integrity is never even checked. The RUMOR-05
test (`rumor-store.test.ts:82-100`) exercises this delete path with a delete rumor that happens to
carry a valid id, but nothing in the code requires that — the test would pass just the same with a
bogus id.

Note this is inherited base-`EventStore` behavior, not introduced by this phase's diff; the defect
is that RumorStore re-documents a blanket "each rumor is hash-verified" guarantee its inherited
`add()` does not honor for deletions.

**Fix:** Narrow the doc to exclude delete events, or (preferred, since RumorStore's whole purpose is
integrity) verify delete rumors before handing them to the DeleteManager — e.g. override `add()` in
RumorStore to run `verifyRumor(event)` for kind-5 events before calling `super.add()`, returning
`null` on failure.

## Info

### IN-01: `performCast`'s `@internal` comment is inaccurate — it is also used by `castEvent`

**File:** `packages/core/src/casts/cast.ts:37`
**Issue:** The comment reads `@internal loose, runtime-guarded — used only by
castEventStream/castTimelineStream`, but the public `castEvent` (line 68) also delegates to
`performCast`. The "used only by" wording is misleading for future maintainers reasoning about who
depends on the loose path.

**Fix:** Reword to e.g. `@internal loose, runtime-guarded — the shared implementation behind
castEvent and the castEventStream/castTimelineStream operators`.

---

_Reviewed: 2026-07-09T05:07:33Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
