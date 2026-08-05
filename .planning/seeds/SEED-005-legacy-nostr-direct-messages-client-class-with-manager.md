---
id: SEED-005
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-005: Legacy direct messages need a Client class + Manager

## Captured Idea (verbatim)

> Legacy nostr direct messages needs a proper Client class with a manager class. that
> allows downstream apps to easily integrate legacy direct messages without needing to
> manage lifecycle and state management / syncing. in a similar way to how the NIP-60
> cashu wallet client allows apps to easily use the cashu wallet without needing to
> manage all the complexities

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-005` to add context._

Capture-time finding: legacy DMs already have a **complete primitive layer and no
stateful layer at all**. Helpers, models, factories, operations and actions all exist
and are exported — what is missing is precisely the thing that owns lifecycle,
subscription and sync state. So this is additive on top of working primitives, not a
rewrite of them.

That also means the gap is real rather than cosmetic: today every consuming app has to
assemble the same subscription/decrypt/group wiring by hand out of the model functions
below, and each app owns that lifecycle bug-for-bug.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-005` to estimate effort.

## Reference Model — `NutWallet` (the named analog)

`packages/wallet/src/wallet/nut-wallet.ts` → `export class NutWallet` (~1080 lines),
re-exported via `packages/wallet/src/wallet/index.ts` alongside `loading.ts` and
`types.ts`. Its shape is the template to mirror:

**Injected, readonly deps:** `pubkey`, `signer`, `pool`, `eventStore`, `couch`
**Config flags:** `autoUnlock`, `useDeleteEvents`
**Protected internals:** `user: User`, `actions: ActionRunner`, `log: Debugger`
**Lifecycle:** static create → `await start()` → `stop()` → `dispose()`, with
`loadingSub` / `autoUnlockSub` subscription fields torn down on stop
**Granular state as `BehaviorSubject`s:** `started$`, `loading$`, `loaded$`,
`syncing$`, `error$`, `operations$`, `negentropy$`
**Derived public observables:** `mints$`, `tokenRelayCoverage$`, `staleTokens$`,
`staleTokenCount$`, `relayStatus$`

Note this matches the house style already recorded for status observables — granular
single-value `$` fields, with composite status derived from them rather than stored.
Follow that here rather than inventing a single monolithic `state$`.

**Manager analog:** `packages/accounts/src/manager.ts` → `export class AccountManager`.
Other `*Manager` precedents: `ConcordInviteManager`, and `DeleteManager` /
`ExpirationManager` / `AsyncDeleteManager` in `packages/core/src/event-store/`.

## Breadcrumbs — what already exists for legacy DMs

**Helpers** — `packages/common/src/helpers/legacy-messages.ts`
`LegacyMessage`, `UnlockedLegacyMessage`, `isLegacyMessageUnlocked`,
`getLegacyMessageCorrespondent` (aliases `getLegacyMessageReceiver`,
`getLegacyMessageCorraspondant` — note the misspelled legacy alias),
`getLegacyMessageSender`, `getLegacyMessageParent`, `isValidLegacyMessage`

**Models** — `packages/common/src/models/legacy-messages.ts`
`LegacyMessagesGroups`, `LegacyMessagesGroup`, `LegacyMessageThreads`,
`LegacyMessageReplies`

**Factory** — `packages/common/src/factories/legacy-message.ts`
`LegacyMessageFactory`, `LegacyMessageTemplate`

**Operations** — `packages/common/src/operations/legacy-message.ts`

**Actions** — `packages/actions/src/actions/legacy-messages.ts`
`SendLegacyMessage`, `ReplyToLegacyMessage`
and `packages/actions/src/actions/direct-message-relays.ts`
`AddDirectMessageRelay`, `RemoveDirectMessageRelay`, `NewDirectMessageRelays`

## Open Questions (for enrichment, not decided here)

1. **Where does it live?** The primitives are split across `packages/common` (helpers,
   models, factories, operations) and `packages/actions` (actions), while the reference
   `NutWallet` sits in its own `packages/wallet`. A DM client has no obvious existing
   home — new package vs. `common` is a real decision.
2. **Does it cover NIP-17 too?** Wrapped messages are now captured separately as
   [[SEED-006]], which reads as an intent to keep the two clients distinct — so this
   question is "confirm the split", not "decide from scratch". Still worth confirming
   deliberately: `packages/common/src/models/wrapped-messages.ts` has the identical
   shape of gap (`WrappedMessagesModel`, `WrappedMessagesGroups`, `WrappedMessagesGroup`,
   `WrappedMessageThreads`, `WrappedMessageReplies` — models only, no client), and apps
   typically render legacy and wrapped threads in one inbox, so the conversation/thread
   seam may want to span both even if sync and network layers stay separate. Note the
   wrapped side has substantially more substrate to build on (gift-wrap unwrap caching,
   `RumorStore`) — see [[SEED-006]] — so the two are not symmetric in effort.
3. **What is the Manager's unit?** `AccountManager` manages accounts; the DM Manager's
   equivalent (per-correspondent client? per-identity? one manager owning all threads?)
   is unspecified in the captured idea.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
