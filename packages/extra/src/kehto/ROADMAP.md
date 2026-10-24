# applesauce-extra/kehto roadmap

Integrations that let an app already using applesauce host [Kehto](https://github.com/kehto/web) napplets with almost no setup:

```ts
const adapter = createKehtoShellAdapter({ pool, eventStore, signer: accounts.active$, lookupRelays: lookupRelays$ });
const bridge = createShellBridge(adapter);
window.addEventListener("message", bridge.handleMessage);
```

Apps that build their own `ShellAdapter` can take only the registry: `createShellBridge({ ...adapter, services: createKehtoServices(ctx) })`.

`@kehto/services` handles NAP wire bookkeeping (correlation, per-window subscriptions, teardown) and delegates the real work to host callbacks. This folder supplies those callbacks from applesauce.

## Prior art

- `apps/examples/src/examples/napplet/loader.tsx` hand-wires every service on applesauce: store-backed `RelayPoolLike`, signer approval, identity via `castUser`, a custom `OutboxRouter` on store loaders, common via actions, Blossom upload and resource. Most of this folder is extracted from it, and it is the first consumer to migrate.
- `kehto-web/apps/playground/src/playground-relay-service.ts` wraps `RelayPool`, `RelayLiveness`, `EventStore` and `createAddressLoader` behind a `relay` service.

## Layers

1. **Foundation** (`foundation/`): applesauce → Kehto adapters with no Kehto runtime import.
   - `createKehtoState(ctx)` tracks the latest signer, pubkey and fallback relays. It also wires `createEventLoaderForStore` with `lookupRelays` when the store has no loader.
   - `relays.ts` selects relays from stored NIP-65 lists. `signer.ts` handles signing approval. `pool.ts` provides the store-backed subscribe, query and publish.
2. **Service integrations** (`services/<nap>.ts`): one `create<Nap>Options(state)` per NAP. Each returns the options for the matching `@kehto/services` factory and is unit-tested by calling its callbacks directly.
3. **Registry** (`index.ts`):
   - `createKehtoServices(ctx | state, { disable? })` returns a `ServiceRegistry`.
   - `createKehtoShellAdapter(ctx | state, { disable?, overrides? })` returns a complete `ShellAdapter`, with the registry included.

`@kehto/runtime`, `@kehto/services` and `@kehto/shell` are optional peers. Only this subpath imports them.

## Context

`KehtoContext` accepts plain values or observables for anything that changes at runtime:

- `signer`: an `ISigner` or an observable of one. Pass `AccountManager.active$` so napplets follow account switches. Kehto's `AuthHooks.getSigner()` is synchronous, so the state keeps the latest emitted signer and its resolved pubkey.
- `lookupRelays`: `string[]` or `Observable<string[]>`. These are passed to the event loader the state creates. They are unused when the app already set `eventStore.eventLoader`.
- `fallbackRelays`: `string[]` or `Observable<string[]>`. These are used when a request has no outbox or relay hints. The latest emitted value is read synchronously.
- `approve`: an optional host prompt for every napplet signing request. Signing is re-stamped with `created_at` after the prompt, because kehto rejects events older than 30 seconds.
- `timeout`: how long reads wait for missing data before answering (default 4000ms).

## Tier 0: foundation

| Seam             | Kehto shape                                                                    | Applesauce source                                              | Status        |
| ---------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------- |
| Shell relay pool | `RelayPoolHooks` / `RelayPoolLike` (`subscription`, `request`, `publish`)      | `RelayPool.req` into the `EventStore`, `eventStore.filters()`  | done          |
| Cache            | `WorkerRelayLike` / `CacheAdapter`                                             | not needed: the store-backed pool already serves cached events | n/a           |
| Signer           | runtime `Signer` (NIP-07 shape: `getPublicKey`, `signEvent`, `nip04`, `nip44`) | `ctx.signer` (static or latest emitted) + `ctx.approve`        | done          |
| Auth             | `AuthHooks` (`getUserPubkey`, `getSigner(windowId?)`)                          | `KehtoState.getPubkey()`, `createKehtoSigner`                  | done          |
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
| lists    | `createListsService`                                        | actions `lists`, `bookmarks`, `follow-sets`, `pins`                       | todo   |
| resource | `createResourceService` (`blossom:` and `nostr:` resolvers) | blossom helpers with hash verification, `eventStore.event()` for `nostr:` | todo   |
| dm       | `createDmService`                                           | `wrapped-messages` actions, gift-wrap models                              | todo   |

## Open questions

- **Encrypted content:** the loader example decrypts NIP-04/44 events before napplets see them. The pool here passes events through unchanged, because decrypting with the user's signer for any napplet that can read is a policy decision for the host.
- **Identity `getBlocked`:** not mapped, since there is no clear NIP-51 source.
- **Scoped relays:** `openScopedRelay` and `publishToScopedRelay` are no-ops, so napplets always read through the shared pool.

## Out of scope

These are host or browser concerns rather than Nostr data: keys, media, notify, theme, config, fs, gamepad, serial, ble, webrtc, intent, link and cvm. Hosts add them through `overrides.services`.

## Stress testing

Each tier is stress tested locally against real relays (these runs are not committed). Migrating `napplet/loader.tsx` to `createKehtoShellAdapter` gives a live harness. Targets:

- Subscription fan-out across many napplet windows sharing one pool
- Window-destroy teardown leaving no open relay subscriptions
- Store hit rate vs relay round-trips for repeated identity and outbox reads
- Publish latency and failure reporting through runtime-mediated signing
