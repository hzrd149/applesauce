---
id: SEED-007
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-007: Gift wrap ingestion service

## Captured Idea (verbatim)

> A "gift wrap ingestion" service or class needs to be considered, there are many
> things that need to or would like to read gift wraped events and to avoid duplicating
> the decryption and syncing between all clients and services in an app it would be good
> to have single stateful service that would handle the ingestion gift wrapped events.
> this should also be useful on a traditional server backend to allow for ingesting a
> single users gift warpped events into a database like async event store with a async
> database backend

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-007` to add context._

**The duplication this seed predicts is not hypothetical — it is already in the repo,
in at least five places.** That is the strongest argument for the seed and the reason
it likely precedes [[SEED-005]] and [[SEED-006]] rather than following them.

Three independent kind-1059 subscriptions, each with its own filter:

| Site | Filter |
|------|--------|
| `packages/common/src/models/wrapped-messages.ts:20` | `store.timeline({ kinds: [GiftWrap], "#p": [self] })` |
| `packages/common/src/models/gift-wrap.ts:11` | `store.timeline({ kinds: [GiftWrap], "#p": [pubkey] })` |
| `packages/concord/src/client/invite-watcher.ts:459` | `{ kinds: [GiftWrap], "#p": [this.pubkey] }` |

And wrap-level dedup built **twice inside concord alone**, with near-identical
comments:

- `packages/concord/src/client/sync.ts:72` — _"Wrap-level store: dedups kind-1059 wraps
  and doubles as the NIP-77 local store."_
- `packages/concord/src/client/community.ts:102` — _"Wrap-level store for kind-1059
  dedup + the NIP-77 negentropy local store."_

So an app running concord alongside wrapped DMs today opens multiple overlapping
`#p`-on-self 1059 subscriptions and dedups the same wraps in separate stores. This is
the concrete cost the service removes.

**The server half is better supported than the idea assumes.** `AsyncEventStore`,
`AsyncRumorStore` and `AsyncDeleteManager` all exist in `packages/core/src/event-store/`,
and `packages/sqlite` already ships **five** database backends (`better-sqlite3`, `bun`,
`libsql`, `native`, `turso`), each with its own `event-database.ts`. The
"async event store with an async database backend" combination is shipped, not
speculative — the missing piece is only the ingestion loop on top of it.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-007` to estimate effort.

Sequencing note worth weighing at promotion: [[SEED-005]] and [[SEED-006]] both need a
decrypt-and-sync layer. If this service lands first, both become thinner — they consume
ingested rumors rather than each owning a subscription. If they land first, this becomes
a refactor of two fresh clients instead of a foundation for them.

## Existing Substrate

**Unwrap primitives** — `packages/common/src/helpers/gift-wrap.ts`,
`packages/core/src/helpers/gift-wrap.ts`
`unlockGiftWrap`, `unlockSeal`, `lockGiftWrap`, `isGiftWrapUnlocked`, `isSealUnlocked`,
`getGiftWrapSeal`, `getSealRumor`, `getGiftWrapRumor`, plus the `SealSymbol` /
`RumorSymbol` / `GiftWrapSymbol` unwrap cache and `internalGiftWrapEvents` (`EventMemory`)

**Partial precedent — persistence of unwrapped content** —
`packages/common/src/helpers/encrypted-content-cache.ts`
`persistEncryptedContent`, `EncryptedContentCache`, `markEncryptedContentFromCache`,
`isEncryptedContentFromCache`, `EncryptedContentFromCacheSymbol`. It already walks
gift → seal → rumor and filters on `kind === GiftWrap && isEncryptedContentUnlocked`.
This is the closest thing to the proposed service today — it caches unwrap *results*
but owns no subscription and no lifecycle. Worth reading before designing, and possibly
absorbing.

**Decrypted-output stores** — `RumorStore extends EventStore<Rumor>`,
`AsyncRumorStore extends AsyncEventStore<Rumor>` (`packages/core/src/event-store/`)

**Server-side backends** — `packages/sqlite/src/{better-sqlite3,bun,libsql,native,turso}/event-database.ts`,
plus `packages/sqlite/src/relay.ts`

**Lifecycle reference models** — `packages/concord/src/client/` (multi-class stack over
gift-wrapped content; see [[SEED-006]]) and `NutWallet` (`packages/wallet/src/wallet/nut-wallet.ts`,
single-class `start()`/`stop()`/`dispose()` contract; see [[SEED-005]]).

## Design Constraints Found at Capture Time

1. **Kind 1059 is commonly NIP-42 gated.** `packages/concord/src/client/relay-auth.ts:5-6`
   records that relays gate kind 1059 behind NIP-42 — ditto's default is
   `AUTH_KINDS=4,1059` — and that every `authors` entry in a 1059 REQ must be a derived
   per-stream identity there. An ingestion service subscribing to 1059 inherits this:
   auth is on the critical path of the very kind it ingests, not an edge case. Relevant
   both in-browser and on a server.
2. **Consumers want different slices of the same stream.** Concord's invite-watcher has
   a `scanUntagged` mode that widens from a narrow direct-invite filter to all
   `#p`-on-self wraps (`invite-watcher.ts:459`). A single ingestion service has to serve
   both the "give me everything addressed to me" and "give me this narrow slice"
   shapes without forcing every consumer onto the widest subscription.
3. **Dedup already doubles as the NIP-77 negentropy local store** in concord (both
   comments above). Consolidating wrap-level stores must not break negentropy sync,
   which reads that store as its local set.

## Open Questions (for enrichment, not decided here)

1. **Where does it live?** It is needed by `common` (models), `concord` (client) and
   any server backend, so `packages/core` or a new package are the plausible homes —
   `common` would create a dependency direction concord may not want.
2. **What does it emit?** Rumors into a `RumorStore`/`AsyncRumorStore`, or an observable
   consumers subscribe to, or both. The store-backed shape is what makes the server
   case work.
3. **Who owns the signer and the failure policy?** Unwrap needs an
   `EncryptedContentSigner`; a long-running server ingestor needs a defined behavior for
   wraps it cannot decrypt (skip, retry, quarantine) that a browser client may not.

## Notes

_Captured via one-shot seed capture. Enrich with trigger, why, and scope at your convenience._
