---
id: SEED-006
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-006: Wrapped messages need Client + Conversation classes

## Captured Idea (verbatim)

> Wrapped messages need a proper Client and Conversation client classes that will
> handle all syncing, network, decryption lifecycle, media, etc. so that downstream
> apps can easily integrate wrapped direct messages without needing to manage all the
> complexities

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-006` to add context._

Capture-time findings, in order of how much they change the shape of the work:

**1. The `Conversation` half already has its identity primitive.**
`packages/common/src/helpers/messages.ts` exports `createConversationIdentifier`,
`getConversationIdentifierFromMessage`, `getConversationParticipants` and
`groupMessageEvents`. So "what is a conversation, and which one does this message
belong to" is already answered and tested — the class needs to own lifecycle around
that key, not invent it.

**2. The decryption lifecycle has real substrate, not just helpers.**
Beyond `unlockGiftWrap` / `unlockSeal` / `lockGiftWrap`, there is symbol-based
unwrap caching (`SealSymbol`, `RumorSymbol`, `GiftWrapSymbol` in
`packages/core/src/helpers/gift-wrap.ts`), an `internalGiftWrapEvents = new EventMemory()`
in `packages/common/src/helpers/gift-wrap.ts`, and **dedicated stores for decrypted
output**: `RumorStore` / `AsyncRumorStore` in `packages/core/src/event-store/`.
The client should sit on top of these rather than re-implementing unwrap-and-cache.

**3. Media is the genuinely unbuilt part.**
Blossom and attachment primitives exist — `operations/media-attachment.ts`,
`operations/blossom.ts`, `models/blossom.ts`, `factories/blossom-server-list.ts`,
`actions/blossom.ts` — but **nothing connects them to wrapped messages**. Of the four
concerns named in the idea (syncing, network, decryption lifecycle, media), the first
three have substrate to assemble; media is the one that needs design. Weight the
estimate accordingly.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-006` to estimate effort.

## Reference Model — `packages/concord/src/client/` (closest analog)

Concord is a stronger precedent here than the NIP-60 wallet cited in [[SEED-005]],
because it is already a multi-class client stack operating **over gift-wrapped
content** — it has `helpers/gift-wrap.ts` and `operations/gift-wrap.ts` of its own.
It is in-repo proof that this shape works for this problem:

| File | Role it plays |
|------|---------------|
| `client/client.ts` | top-level client, owns the set of things |
| `client/community.ts`, `client/private-channel.ts` | per-entity classes — the `Conversation` analog |
| `client/sync.ts`, `client/channel-sync.ts` | the syncing concern, split out |
| `client/storage.ts` | persistence concern, split out |
| `client/invite-watcher.ts` | long-lived network subscription with its own lifecycle |

Secondary analog: `NutWallet` (`packages/wallet/src/wallet/nut-wallet.ts`) for the
single-class lifecycle contract — `start()` / `stop()` / `dispose()`, granular
`BehaviorSubject` state, derived public observables. See [[SEED-005]] for that
breakdown; the house style is granular single-value `$` fields with composite status
derived, not a monolithic `state$`.

## Breadcrumbs — what already exists for wrapped messages

**Conversation helpers** — `packages/common/src/helpers/messages.ts`
`groupMessageEvents`, `getConversationParticipants`, `createConversationIdentifier`,
`getConversationIdentifierFromMessage`

**Message helpers** — `packages/common/src/helpers/wrapped-messages.ts`
`getWrappedMessageSubject`, `getWrappedMessageParent`, `getWrappedMessageSender`,
`getWrappedMessageReceiver` (plus misspelled alias `getWrappedMesssageSender` — the
same back-compat-typo pattern noted for legacy DMs in [[SEED-005]])

**Gift-wrap layer** — `packages/common/src/helpers/gift-wrap.ts` +
`packages/core/src/helpers/gift-wrap.ts`
`unlockGiftWrap`, `unlockSeal`, `lockGiftWrap`, `isGiftWrapUnlocked`, `isSealUnlocked`,
`isRumor`, `getGiftWrapRumor`, `getGiftWrapSeal`, `getSealRumor`, `getSealGiftWrap`,
`getRumorSeals`, `getRumorGiftWraps`, `UnlockedGiftWrapEvent`, `UnlockedSeal`,
`internalGiftWrapEvents`, and the three unwrap-cache symbols

**Decrypted-output stores** — `packages/core/src/event-store/`
`RumorStore extends EventStore<Rumor>`, `AsyncRumorStore extends AsyncEventStore<Rumor>`

**Models** — `packages/common/src/models/wrapped-messages.ts`
`WrappedMessagesModel`, `WrappedMessagesGroups`, `WrappedMessagesGroup`,
`WrappedMessageThreads`, `WrappedMessageReplies`
(also `packages/common/src/models/gift-wrap.ts`)

**Factory / Operations** — `WrappedMessageFactory`, `WrappedMessageTemplate`;
`setConversation`, `setSubject`, `setParent`

**Actions** — `packages/actions/src/actions/wrapped-messages.ts`
`SendWrappedMessage`, `ReplyToWrappedMessage`, `GiftWrapMessageToParticipants`

**Media primitives (unconnected to messages today)** —
`packages/common/src/operations/media-attachment.ts`,
`packages/common/src/operations/blossom.ts`, `packages/common/src/models/blossom.ts`,
`packages/common/src/factories/blossom-server-list.ts`,
`packages/actions/src/actions/blossom.ts`

## Open Questions (for enrichment, not decided here)

1. **One client over both DM kinds, or two?** [[SEED-005]] asks for the same thing for
   legacy (NIP-04) DMs, and these two seeds were captured separately — which reads as
   an intent to keep them separate. Worth confirming deliberately rather than by
   default: apps typically render legacy and wrapped threads in one inbox, so the
   `Conversation` seam in particular may want to span both even if the sync/network
   layers stay distinct.
2. **Where does it live?** Same open question as [[SEED-005]] — primitives are spread
   across `packages/common`, `packages/actions` and `packages/core`, while both
   reference models (`concord`, `wallet`) own their own package.
3. **What does "handles media" mean concretely?** Upload-on-send via blossom,
   decrypt-and-resolve on receive, caching, or all three. This is the part with no
   existing wiring, so it needs the most definition.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
