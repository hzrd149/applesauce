# COMMON-02 Audit: Targeted Cast Set

**Phase:** 04-common-package-rumor-support
**Requirement:** COMMON-02 — targeted `applesauce-common` casts (+ models/factories) operate over rumors while keeping `NostrEvent` defaults
**Date:** 2026-07-09

## Finding

The COMMON-02 targeted-cast set is **empty this phase**. No `applesauce-common` cast, model, or factory is applied to a rumor by any current consumer, so no cast file needed genericizing. Zero cast files changed.

## Supporting Evidence

1. **No `applesauce-common` cast references a rumor.** A repo-wide grep over `packages/common/src/casts` for `Rumor` returns zero matches (command and result below).
2. **The two concrete rumor consumers in this monorepo bypass `applesauce-common` casts entirely:**
   - `applesauce-concord`'s only rumor cast, `ConcordDirectInvite` (`packages/concord/src/casts/direct-invite.ts`), extends **`applesauce-core`'s `EventCast` directly** (`import { EventCast } from "applesauce-core/casts"`) and types its event as `DirectInviteRumor`, a type defined locally in concord — not derived from any `applesauce-common` cast or `XxxEvent` alias.
   - `applesauce-actions`' `wrapped-messages.ts` imports `Rumor` from `applesauce-common/helpers/gift-wrap` (a pre-existing NIP-59 helper, unrelated to this migration) and `castUser` from `applesauce-common/casts` — but `castUser`/`PubkeyCast` operates on a **pubkey string**, not an event, so it has no `StoreEvent`/rumor bound to genericize.
   - `applesauce-wallet` has zero `Rumor` references anywhere in its source.
3. **Every remaining `applesauce-common` cast is `EventCast<KnownEvent<K>>`-typed**, where `KnownEvent<K>` (`packages/core/src/helpers/event.ts`) is hardcoded to `NostrEvent`, not generic over `E extends StoreEvent`. Genericizing any of these ~30 casts without first reopening core's closed `KnownEvent` scope (Phases 1-3, CORE-01..07, already complete) would either require widening `KnownEvent` itself or diverging a cast's return type from its exported `XxxEvent` alias — both out of this phase's zero-behavior-change bound. These are correctly deferred to COMMON-F1/COMMON-F2.

## Conclusion

Because zero cast files changed, the `NostrEvent` defaults on every existing `applesauce-common` cast (via core's already-generic `EventCast<E extends StoreEvent = NostrEvent>` and `CastRefEventStore<E extends StoreEvent = NostrEvent>`) are trivially preserved. No new `EventCast<Rumor>` subclass was added speculatively — the pattern is already proven twice (core's RUMOR-06 test, concord's `ConcordDirectInvite`), and adding a third demonstration inside `applesauce-common` with no concrete consumer would be exactly the "high churn, low value" anti-pattern CONTEXT.md's Out-of-Scope table forbids.

Should a genuinely shared cross-app rumor kind emerge later (e.g. a `applesauce-common`-level NIP-17 message cast with more than one consumer), it becomes a COMMON-F1 candidate at that time, following the `EventCast<E extends StoreEvent = NostrEvent>` pattern already established in core.

## Re-runnable Evidence Command

```bash
grep -rln "Rumor" packages/common/src/casts
```

**Expected result:** empty output (no matches). Confirmed empty on 2026-07-09.
