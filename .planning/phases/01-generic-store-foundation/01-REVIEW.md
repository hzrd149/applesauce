---
phase: 01-generic-store-foundation
reviewed: 2026-07-08T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - packages/core/src/event-store/async-delete-manager.ts
  - packages/core/src/event-store/async-event-store.ts
  - packages/core/src/event-store/delete-manager.ts
  - packages/core/src/event-store/event-memory.ts
  - packages/core/src/event-store/event-store.ts
  - packages/core/src/event-store/expiration-manager.ts
  - packages/core/src/event-store/interface.ts
  - packages/core/src/helpers/event.ts
  - packages/core/src/helpers/expiration.ts
  - packages/core/src/helpers/filter.ts
  - packages/core/src/helpers/pointers.ts
  - packages/core/src/helpers/relays.ts
  - packages/loaders/src/loaders/address-loader.ts
  - packages/loaders/src/loaders/event-loader.ts
  - packages/loaders/src/loaders/tag-value-loader.ts
  - packages/loaders/src/loaders/timeline-loader.ts
  - packages/relay/src/group.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This phase genericizes the event-store subsystem over `E extends StoreEvent = NostrEvent`
and adds a `verifyRumor` helper plus the intentional `"verifyEvent" in options` constructor
change. I focused the review on the three areas called out: accidental runtime changes,
unsound `as unknown as` bridges, and the correctness of the new verifier logic.

Findings, in brief:

- **The default-`NostrEvent` runtime path is preserved.** The constructor change from
  `if (options?.verifyEvent)` to `if (options && "verifyEvent" in options)` correctly leaves
  default callers (`new EventStore()`, `new EventStore({})`, `new EventStore({ verifyEvent: fn })`)
  behaving exactly as before, and correctly enables the one intended change: explicit
  `verifyEvent: undefined` now disables verification and routes through the warning setter.
- **`verifyRumor` is correct.** `getEventHash(rumor) === rumor.id` recomputes the id over the
  fields `getEventHash` reads (pubkey/created_at/kind/tags/content), all present on `Rumor`.
- The real defects are latent traps for the *new* generic capability (custom `E`), not the
  default path: an unsound default-verifier cast that silently drops every event in a
  non-`NostrEvent` store, and an incompletely-parameterized interface graph that drops `E`
  from all subscription return types. Both are WARNINGs because no default `NostrEvent` caller
  is affected, but they undermine the generic API this phase exists to establish.

No BLOCKERs were found: the zero-runtime-change goal for default signed-`NostrEvent` callers is met.

## Warnings

### WR-01: Default verifier cast silently drops every event in a non-`NostrEvent` store

**File:** `packages/core/src/event-store/event-store.ts:81` (and `packages/core/src/event-store/async-event-store.ts:79`)
**Issue:**
The default verifier is installed via an `as unknown as` bridge:

```ts
private _verifyEventMethod?: (event: E) => boolean = coreVerifyEvent as unknown as (event: E) => boolean;
```

`coreVerifyEvent` is nostr-tools' `verifyEvent`, hard-typed to `(e: NostrEvent) => boolean` and
implemented to check `event.sig` (schnorr signature). For the default `E = NostrEvent` this is
exactly correct and there is zero behavior change — good. But the whole point of this phase is to
enable stores like `EventStore<Rumor>` (rumors have no `sig`). For such a store, if the caller does
not pass `verifyEvent`, the default `_verifyEventMethod` stays `coreVerifyEvent`, and in `add()`:

```ts
if (this.verifyEvent && this.verifyEvent(event) === false) return null;
```

`coreVerifyEvent(rumor)` returns `false` (no signature to verify), so **every rumor is silently
dropped and `add()` returns `null`**. This is a data-loss trap for the exact capability the
genericization is meant to unlock, and the `as unknown as` cast is what hides the underlying
`(NostrEvent) => boolean` vs `(E) => boolean` mismatch from the compiler — precisely the kind of
unsound bridge that should not mask a real type/runtime error.

**Fix:** Only default to `coreVerifyEvent` when `E` is (or is assignable to) a signed event, and
otherwise default to `undefined` (or require the caller to supply a verifier such as `verifyRumor`).
A minimal runtime-safe approach is to leave the field undefined and let the constructor install the
core verifier only for the default case, or document that non-`NostrEvent` stores MUST pass an
explicit `verifyEvent`. At the very least, replace the `as unknown as` double-cast with a single,
localized, commented bridge that makes the `NostrEvent`-only assumption explicit and greppable:

```ts
// Safe ONLY for E = NostrEvent; non-signed E stores must pass an explicit verifyEvent (e.g. verifyRumor)
private _verifyEventMethod?: (event: E) => boolean =
  coreVerifyEvent as (event: NostrEvent) => boolean as (event: E) => boolean;
```

### WR-02: `IEventStore<E>` / `IAsyncEventStore<E>` drop `E` from all subscription return types

**File:** `packages/core/src/event-store/interface.ts` (composite interfaces near the file end; e.g. `IEventStore` / `IAsyncEventStore` extends clauses)
**Issue:**
`IEventSubscriptions` was made generic (`IEventSubscriptions<E extends StoreEvent = NostrEvent>`, its
`event`/`replaceable`/`filters`/`timeline` members return `E`), but the composite store interfaces
extend it (and `IEventModelMixin`) **without** the type argument:

```ts
export interface IEventStore<E extends StoreEvent = NostrEvent>
  extends
    IEventStoreReadAdvanced<E>,
    IEventStoreStreams<E>,
    IEventSubscriptions,                 // <- not IEventSubscriptions<E>
    IEventStoreActions<E>,
    IEventModelMixin<IEventStore>,       // <- not IEventModelMixin<IEventStore<E>>
    IEventClaims<E>,
    IMissingEventLoader<E> {}
```

Because the default is `NostrEvent`, a custom-`E` store is internally inconsistent: `add(event: E)` and
`getEvent(): E | undefined` are parameterized, but `timeline()` returns `Observable<NostrEvent[]>`,
`event()` returns `Observable<NostrEvent | undefined>`, etc. For the default `E = NostrEvent` there is
no observable effect (the reason it compiles), so this is not a BLOCKER, but it makes the generic
parameter on `IEventSubscriptions` effectively dead and produces silently-wrong types for exactly the
generic consumers this phase targets. This looks like intentional scope-limiting (the model/subscription
subsystem was not genericized), but the half-genericized interface is a maintainability/soundness trap.

**Fix:** Either (a) forward the type argument — `IEventSubscriptions<E>` and
`IEventModelMixin<IEventStore<E>>` — and genericize the model subsystem accordingly, or (b) if
subscriptions are deliberately out of scope, revert `IEventSubscriptions` to non-generic so the dropped
parameter is not misleading, and add a comment documenting that subscription outputs are always
`NostrEvent`.

## Info

### IN-01: Explicit `verifyEvent: undefined` is now a breaking behavior change for that input

**File:** `packages/core/src/event-store/event-store.ts:131` (and `packages/core/src/event-store/async-event-store.ts:127`)
**Issue:**
The `"verifyEvent" in options` change is the documented intentional CORE-03 change and is implemented
correctly. Worth recording explicitly for consumers: a call site that previously passed
`verifyEvent: undefined` used to keep the default `coreVerifyEvent` (verification ON); it now
**disables signature verification** (verification OFF), surfaced only by a `console.warn`. This is a
security-relevant semantic flip for that specific input. Default callers and callers passing a function
are unaffected.
**Fix:** No code change required; ensure this is captured in the changeset/migration notes so downstream
callers who pass `verifyEvent: undefined` (expecting "use default") are aware verification is now
disabled for them.

### IN-02: `as unknown as` bridges in event-memory / delete-manager are safe but fragile

**File:** `packages/core/src/event-store/event-memory.ts:76,97,114` and `packages/core/src/event-store/delete-manager.ts:44,68`
**Issue:**
The localized `event as unknown as NostrEvent` bridges into `insertEventIntoDescendingList`,
`getDeleteEventPointers`, and `getDeleteAddressPointers` are functionally safe today: I verified those
helpers read only `StoreEvent` fields (`id`, `created_at`, `tags`, `pubkey`) and never touch `sig`. So
no runtime bug. The risk is future fragility — if any of these upstream helpers ever start reading a
signed-only field, the double-cast will hide the breakage at compile time and it will only surface at
runtime for non-`NostrEvent` stores.
**Fix:** Keep the casts localized (already done) and the explanatory comments (already present). Optionally
add a narrow structural type (e.g. `Pick<StoreEvent, "id" | "created_at">[]`) at these call sites instead
of `as unknown as NostrEvent[]` so the compiler still checks the fields actually used.

---

_Reviewed: 2026-07-08T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
