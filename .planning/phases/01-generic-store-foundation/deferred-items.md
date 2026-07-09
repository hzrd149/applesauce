# Deferred Items — Phase 1: Generic store foundation

Discoveries made during plan execution that are out of scope for the plan that found them (per the executor's Scope Boundary rule) are logged here rather than fixed inline.

## 1. `applesauce-relay` fails to build against genericized `EventMemory<E>` (found during 01-04) — ✅ RESOLVED

**Resolution (post-merge integration fix, autonomous orchestrator):** The break was wider than relay — it also hit `applesauce-loaders` (`address-loader.ts`, `event-loader.ts`, `tag-value-loader.ts`, `timeline-loader.ts`). Applied the suggested fix: explicit `new EventMemory<NostrEvent>()` at all six `filterDuplicateEvents(... ?? new EventMemory())` call sites across `packages/relay/src/group.ts` (×2) and the four loaders. Full workspace build and `applesauce-core` tests (592/592) green afterward. Changeset `event-memory-nostrevent-callsites.md` (loaders + relay, patch). `common/gift-wrap.ts`'s bare `new EventMemory()` was left untouched — it resolves to the `NostrEvent` default correctly and is rumor-typing territory for Phase 4.


- **Found during:** Plan 01-04, Task 2 downstream-build sanity check (`pnpm --filter applesauce-relay build`).
- **Symptom:** `packages/relay/src/group.ts:260` and `:277` — `filterDuplicateEvents(opts?.eventStore ?? new EventMemory())` fails to type-check with:
  ```
  error TS2345: Argument of type 'IAsyncEventStoreActions<NostrEvent> | IEventStoreActions<NostrEvent> | EventMemory<StoreEvent>' is not assignable to parameter of type 'IAsyncEventStoreActions<NostrEvent> | IEventStoreActions<NostrEvent>'.
    Type 'EventMemory<StoreEvent>' is not assignable to type 'IEventStoreActions<NostrEvent>'.
      The types returned by 'add(...)' are incompatible between these types.
        Property 'sig' is missing in type 'StoreEvent' but required in type 'NostrEvent'.
  ```
- **Root cause (not yet fixed):** `new EventMemory()` used bare (no explicit type argument) inside a contextually-typed position (`filterDuplicateEvents(...)`, whose parameter type is the bare/default-`NostrEvent` union `IEventStoreActions | IAsyncEventStoreActions`) appears to have TypeScript infer the class's generic parameter as its *constraint* (`StoreEvent`) rather than its *default* (`NostrEvent`) under this specific contextual-typing shape. This is a consequence of `EventMemory` becoming generic in Plan 01-03 (`EventMemory<E extends StoreEvent = NostrEvent>`), not of anything changed in Plan 01-04.
- **Why deferred, not fixed here:** Plan 01-04's `files_modified` and verification scope are limited to `applesauce-core` (`event-store.ts`, `async-event-store.ts`, the new test, and changesets). `packages/relay/src/group.ts` is a different package, untouched by this plan, and the break predates this plan's commits (it was introduced when `EventMemory` was genericized in Plan 01-03, which asserted downstream packages "verified to still build clean" — that assertion did not catch this specific call site). Per the Scope Boundary rule, out-of-scope discoveries are logged, not auto-fixed.
- **Suggested fix (for whichever later phase/plan owns `applesauce-relay`):** Either explicitly instantiate `new EventMemory<NostrEvent>()` at both call sites in `group.ts`, or adjust `filterDuplicateEvents`/`mapEventsToStore` to accept a properly bound generic so contextual inference resolves correctly.
- **Verification that this does not affect Phase 1 core work:** `pnpm --filter applesauce-core build` and `pnpm --filter applesauce-core test` (592/592) are both green. Re-ran `applesauce-common` and `applesauce-relay`/`applesauce-react` builds individually after the combined run aborted on the `applesauce-relay` failure: `applesauce-common` and `applesauce-react` both build clean in isolation; only `applesauce-relay` (`group.ts`) is affected.
