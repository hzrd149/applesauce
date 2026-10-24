# applesauce-extra/kehto roadmap

Integrations that let an app already using applesauce host [Kehto](https://github.com/kehto/web) napplets with almost no setup:

```ts
const services = createKehtoServices({ pool, eventStore, signer: accounts.active$, lookupRelays: lookupRelays$ });
const bridge = createShellBridge({ ...adapter, services });
```

`@kehto/services` handles NAP wire bookkeeping (correlation, per-window subscriptions, teardown) and delegates the real work to host callbacks. This folder supplies those callbacks from applesauce.

## Prior art

- `apps/examples/src/examples/napplet/loader.tsx` hand-wires every service on applesauce: store-backed `RelayPoolLike`, signer approval, identity via `castUser`, a custom `OutboxRouter` on store loaders, common via actions, Blossom upload and resource. It is the first consumer to migrate to `createKehtoServices` and the main source to extract integrations from.
- `kehto-web/apps/playground/src/playground-relay-service.ts` wraps `RelayPool`, `RelayLiveness`, `EventStore` and `createAddressLoader` behind a `relay` service.

## Layers

1. **Foundation** (`foundation/`): pure applesauce → Kehto shape adapters. They never import Kehto at runtime.
2. **Service integrations** (`services/<nap>.ts`): one `create<Nap>Options(ctx: KehtoContext)` per NAP. Each returns the options object for the matching `@kehto/services` factory and is unit-tested by calling its callbacks directly.
3. **Registry** (`index.ts`):
   - `createKehtoServices(ctx, overrides?)` calls the `@kehto/services` factories and returns a `ServiceRegistry`. A service is skipped when its context is missing (no `signer` → no identity, common or lists).
   - `createKehtoShellHooks(ctx)` supplies the `relayPool` and `auth` parts of the shell's `ShellAdapter`.

`@kehto/runtime`, `@kehto/services` and `@kehto/shell` are optional peers. Only this subpath imports them.

## Context

`KehtoContext` accepts plain values or observables for anything that changes at runtime:

- `signer`: an `ISigner` or an observable of one. Pass `AccountManager.active$` so napplets follow account switches. Kehto's `AuthHooks.getSigner()` is synchronous, so the integration keeps the latest emitted signer internally.
- `lookupRelays`: `string[]` or `Observable<string[]>`. These are passed through to the store's loaders (`createEventLoaderForStore` / address loader `lookupRelays`) for profile and relay-list lookups.
- `fallbackRelays`: `string[]` or `Observable<string[]>`. These are used when a request has no outbox or relay hints. Kehto's `selectRelayTier()` and outbox planning are synchronous or one-shot, so the integration reads the latest emitted value.

## Tier 0: foundation

| Seam | Kehto shape | Applesauce source | Status |
| --- | --- | --- | --- |
| Shell relay pool | `RelayPoolHooks` / `RelayPoolLike` (`subscription`, `request`, `publish`, `count`) | `RelayPool` | todo |
| Outbox pool | `OutboxRelayPool` (`subscribe`, `publish`, `isAvailable`) | `RelayPool` | todo |
| Cache | `CacheAdapter` / `createCacheService` (`query`, `store`, `isAvailable`) | `EventStore.getByFilters`, `add` | todo |
| Signer | runtime `Signer` (NIP-07 shape: `getPublicKey`, `signEvent`, `nip04`, `nip44`) | `ctx.signer` (static or latest emitted) | todo |
| Auth | `AuthHooks` (`getUserPubkey`, `getSigner(windowId?)`) | `ctx.signer`, caching the active pubkey on each emission | todo |

The signer adapter needs a host approval hook (`approve(windowId, template)`). It must also re-stamp `created_at` after the prompt, because kehto rejects events older than 30 seconds.

## Tier 1: read path

| NAP | Kehto factory | Applesauce source | Status |
| --- | --- | --- | --- |
| relay | `createRelayPoolService` | `RelayPool.subscription`, store dedupe, `fromRelay` seen-relay tracking | todo |
| outbox | `createOutboxService` with an applesauce `OutboxRouter` | store loaders for kind 10002, `getOutboxes` / `getInboxes`, `eventStore.event()` for `getEvent`; compare against `createRelayPoolOutboxRouter` | todo |
| count | `createCountService` | `RelayPool.count` | todo |
| identity | `createIdentityService` | `castUser` `profile$`, `contacts$`, `mutes$`, `profileBadges$`; list kinds via `eventStore.replaceable`; zaps | todo |

## Tier 2: write path

| NAP | Kehto factory | Applesauce source | Status |
| --- | --- | --- | --- |
| common | `createCommonService` (follow, unfollow, react, report) | `applesauce-actions` contacts and report, reaction factory | todo |
| lists | `createListsService` | actions `lists`, `bookmarks`, `follow-sets`, `pins` | todo |
| upload | `createUploadService` (`Uploader`) | blossom helpers and actions | todo |
| resource | `createResourceService` (`blossom:` and `nostr:` resolvers) | blossom helpers with hash verification, `eventStore.event()` for `nostr:` | todo |
| dm | `createDmService` | `wrapped-messages` actions, gift-wrap models | todo |

## Out of scope

These are host or browser concerns rather than Nostr data: keys, media, notify, theme, config, fs, gamepad, serial, ble, webrtc, intent, link and cvm.

## Stress testing

Each tier is stress tested locally against real relays (these runs are not committed). Once relay and identity land, a napplet-hosting example in `apps/examples` follows. Targets:

- Subscription fan-out across many napplet windows sharing one pool
- Window-destroy teardown leaving no open relay subscriptions
- Cache hit rate vs relay round-trips for repeated identity and outbox reads
- Publish latency and failure reporting through runtime-mediated signing
