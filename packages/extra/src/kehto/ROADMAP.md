# applesauce-extra/kehto roadmap

Integrations that let an app already using applesauce host [Kehto](https://github.com/kehto/web) napplets with almost no setup:

```ts
const adapter = createKehtoShellAdapter({ pool, eventStore, signer: accounts.active$ });
const bridge = createShellBridge(adapter);
window.addEventListener("message", bridge.handleMessage);
```

Apps that build their own `ShellAdapter` can take only the registry: `createShellBridge({ ...adapter, services: createKehtoServices(ctx) })`.

`@kehto/services` handles NAP wire bookkeeping (correlation, per-window subscriptions, teardown) and delegates the real work to host callbacks. This folder supplies those callbacks from applesauce.

## Prior art

- `apps/examples/src/examples/napplet/loader.tsx` now uses `createKehtoShellAdapter`, retaining host prompts, browser resource policy, and UI services through overrides.
- `kehto-web/apps/playground/src/playground-relay-service.ts` wraps `RelayPool`, `RelayLiveness`, `EventStore` and `createAddressLoader` behind a `relay` service.

## Layers

1. **Foundation** (`foundation/`): applesauce → Kehto adapters with no Kehto runtime import.
   - `kehtoAccount$(ctx)` shares a lazy stream of coherent signer/pubkey pairs and clears the old account immediately on signer changes. The host configures its own event loader.
   - `relays.ts` selects relays from stored NIP-65 lists. `signer.ts` handles signing approval. `pool.ts` provides the store-backed subscribe, query and publish.
2. **Service integrations** (`services/<nap>.ts`): one `create<Nap>Options(ctx)` per NAP. Each returns the options for the matching `@kehto/services` factory and is unit-tested by calling its callbacks directly.
3. **Registry** (`index.ts`):
   - `createKehtoServices(ctx, { disable? })` returns a `ServiceRegistry`.
   - `createKehtoShellAdapter(ctx, { disable?, overrides? })` returns a complete `KehtoShellAdapter`, with the registry included; call `stop()` during host teardown.

`@kehto/runtime`, `@kehto/services` and `@kehto/shell` are optional peers. Only this subpath imports them.

## Context

`KehtoContext` accepts plain values or observables for anything that changes at runtime:

- `signer`: an `ISigner` or an observable of one. Pass `AccountManager.active$` so napplets follow account switches. Kehto's `AuthHooks.getSigner()` is synchronous, so the shell adapter keeps a snapshot of the resolved account.
- Configure `createEventLoaderForStore(eventStore, pool, { lookupRelays })` in the host before creating integrations.
- `fallbackRelays`: `string[]` or `Observable<string[]>`. These are used when a request has no outbox or relay hints. Services observe these settings directly; the shell keeps a snapshot for synchronous callbacks.
- `approve`: an optional host prompt for every napplet signing request. Signing is re-stamped with `created_at` after the prompt, because kehto rejects events older than 30 seconds.
- `decrypt`: defaults to true for relay and outbox reads with a signer; set false to keep ciphertext. Decryption failures preserve the original event, and stored signed events remain unchanged.
- `decryptionCache`: optional `EncryptedContentCache` for plaintext, keyed by `${pubkey}:${event.id}` to isolate accounts. Known encrypted event kinds and NIP-04 payloads are decrypted for the author or tagged recipient.
- `timeout`: how long reads wait for missing data before answering (default 4000ms).

## Tier 0: foundation

| Seam             | Kehto shape                                                                    | Applesauce source                                              | Status        |
| ---------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------- |
| Shell relay pool | `RelayPoolHooks` / `RelayPoolLike` (`subscription`, `request`, `publish`)      | `RelayPool.req` into the `EventStore`, `eventStore.filters()`  | done          |
| Cache            | `WorkerRelayLike` / `CacheAdapter`                                             | not needed: the store-backed pool already serves cached events | n/a           |
| Signer           | runtime `Signer` (NIP-07 shape: `getPublicKey`, `signEvent`, `nip04`, `nip44`) | `ctx.signer` (static or latest emitted) + `ctx.approve`        | done          |
| Auth             | `AuthHooks` (`getUserPubkey`, `getSigner(windowId?)`)                          | `kehtoAccount$`, `createKehtoSigner`                           | done          |
| Relay selection  | `selectRelayTier(filters)`                                                     | `selectOptimalRelays` over stored outboxes, user outboxes      | done          |
| Outbox pool      | `OutboxRelayPool` for kehto's `createRelayPoolOutboxRouter`                    | `RelayPool`                                                    | not planned\* |

\* The applesauce `OutboxRouter` in `services/outbox.ts` replaces kehto's router, so it shares the store and its batched loaders.

## Tier 1: read path

| NAP      | Kehto factory                                           | Applesauce source                                                                                             | Status |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| relay    | built-in runtime handler over `RelayPoolLike`           | `createKehtoRelayPool` (no `relay` service registered)                                                        | done   |
| outbox   | `createOutboxService` with an applesauce `OutboxRouter` | store loaders for kind 10002, `getOutboxes` / `getInboxes`, `eventStore.event()` for `getEvent`               | done   |
| count    | `createCountService`                                    | `RelayPool.count`, largest relay count wins                                                                   | done   |
| identity | `createIdentityService`                                 | `castUser` `profile$`, `contacts$`, `mutes$`, `profileBadges$`; list kinds via `eventStore.replaceable`; zaps | done   |

## Tier 2: write path

| NAP      | Kehto factory                                               | Applesauce source                                                         | Status |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| common   | `createCommonService` (follow, unfollow, react, report)     | `applesauce-actions` contacts and report, `ReactionFactory`               | done   |
| upload   | `createUploadService` (`Uploader`)                          | kehto `createHttpUploader` on the user's `blossomServers$`                | done   |
| lists    | `createListsService`                                        | NIP-51 definitions and composable public/hidden tag operations            | done   |
| resource | `createResourceService` (`blossom:` and `nostr:` resolvers) | blossom helpers with hash verification, `eventStore.event()` for `nostr:` | done   |
| dm       | `createDmService`                                           | wrapped-message and gift-wrap factories, shared encrypted store           | done   |

DM history is rebuilt from stored and relay-loaded gift wraps for the current account; plaintext is not added as standalone events to the shared store. Live DM subscriptions stay bound to the account that opened them and stop delivering after an account switch.

## Open questions

- **Identity `getBlocked`:** not mapped, since there is no clear NIP-51 source.
- **Scoped relays:** `openScopedRelay` and `publishToScopedRelay` are no-ops, so napplets always read through the shared pool.

## Out of scope

These are host or browser concerns rather than Nostr data: keys, media, notify, theme, config, fs, gamepad, serial, ble, webrtc, intent, link and cvm. Hosts add them through `overrides.services`.

## Stress testing

The migrated `napplet/loader.tsx` is the live harness. Automated tests cover encrypted DM round-trips, live subscription teardown, list privacy, and resource integrity and size limits. A read-only smoke run against `wss://relay.damus.io/` on 2026-10-24 opened 20 concurrent subscriptions: all received an event, reached EOSE, and closed on teardown. Full real-relay stress measurements remain manual verification targets:

- Subscription fan-out across many napplet windows sharing one pool
- Window-destroy teardown leaving no open relay subscriptions
- Store hit rate vs relay round-trips for repeated identity and outbox reads
- Publish latency and failure reporting through runtime-mediated signing
