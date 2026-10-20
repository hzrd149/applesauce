# applesauce-relay

## 7.0.0

### Major Changes

- ff72518: Change Relay.fetchInformationDocument to return a promise instead of an observable.
- e218b12: Remove the public EVENT/AUTH selector and make authenticate own bounded challenge acquisition and freshness.
- d2cb1fa: Make `event` a one-attempt raw interaction and move authentication, retry, reconnect, and timeout policy to publish.
- cb0240c: Make Group and Pool COUNT emit progressive per-relay success and failure outcomes.
- d084099: Make high-level group requests and subscriptions report total relay failure with every relay cause preserved.
- fe49af9: Group and pool `request()` now default to `RelayGroup.completeAfterIdle()` instead of completing five seconds after the first EOSE.
- e904c48: Replace callback-based negentropy with a raw Observable of negotiation rounds.
- 27e5991: Remove the `authRequiredForRead$` and `authRequiredForPublish$` observables and their `RelayStatus` fields, since auth-required refusals are now handled per request and watching `challenge$` is the way to authenticate proactively.
- 89a3989: Make req a one-interaction raw REQ primitive and move authentication, reconnect, and repeat policy to request and subscription.
- e904c48: Make sync own coordinated authentication, reconnect, bounded transfers, and explicit transfer outcomes.
- cec51d3: Preserve unchanged relay status subscriptions and emit complete pool status snapshots instead of intermediate empty or partial snapshots during membership changes
- 43a0248: Remove the deprecated `RelayPool.ignoreOffline` property and the `ignoreOffline` argument of `RelayPool.group()` in favor of the `ignoreUnhealthyRelays` operator

### Minor Changes

- e4d5977: Batch sync requests for missing events into REQs of up to 500 ids, configurable with `batchSize`
- ff72518: Allow relays and pools to cache NIP-11 information documents with a Keyv-compatible cache and configurable TTL.
- 585dc49: Add an `onSent` option to `Relay.count()` for measuring response latency separately from connection and authentication delays.
- 1899731: Add support for authenticating multiple users on a single relay connection with `authentications$`, `authenticatedPubkeys$`, and `isAuthenticated`
- 0156e2d: Add a `liveness` option to `RelayPool` that skips unhealthy relays and re-adds them to open subscriptions once they recover.
- 5dac2ce: Make relay liveness exclusions temporary and connectivity-aware with recoverable failures and managed pool lifecycles.
- 54d8400: An operation that previously waited indefinitely against an auth-required relay now fails with a timeout after 30 seconds by default, since `waitForAuth` no longer pre-blocks the operation on the relay-wide auth-required flags and the wait is instead bounded by the new `authTimeout` option — pass `authTimeout: false` to restore the previous indefinite wait for out-of-band authentication.
- c5dc2e5: The auth-required handler context now carries the exact NIP-01/NIP-77 request that triggered it, discriminated by wire verb (`REQ`/`COUNT`/`EVENT`/`NEG-OPEN`), replacing the previous read/publish/sync category.
- fe49af9: Add `RelayGroup.completeAfterIdle()`, a completion condition that keeps waiting while relays are still sending events after the first EOSE.
- 585dc49: Add NIP-45 HyperLogLog helpers for estimating unique event counts across relay results.
- f5eeb5e: Add validated COUNT responses with configurable retry and timeout options to `Relay.count()`.
- fe49af9: Add a `firstResponseTimeout` request option (default 10 seconds) that fails group relays which never send an EVENT or EOSE.
- 54d8400: Emit an attributed `relay-failed` result when one relay fails without ending sibling sync operations.
- 47ae6c0: Add `Relay.name$` observable that emits the NIP-11 relay name with a URL fallback
- 8bf9bae: Add a configurable noticeLimit that retains the latest 100 relay notices by default and supports disabling history with zero
- 54d8400: Move operation-scoped authentication callbacks to publish, request, count, and sync.
- 54d8400: Attach typed errors to relay rejection verdicts and RelayGroup-converted failures.
- 165a27b: Add `RelayPool.added$` and `RelayPool.removed$` aliases
- f816ca8: Expose a shared liveness source interface for local and monitor-backed relay filtering.
- 1899731: Add `waitForAuth` support to publish, request, count, and sync.
- e4d5977: Accept synchronous event stores in `NegentropyWriteStore` so a store written to during sync is typed as writeable

### Patch Changes

- db7ed4a: Prevent relay operations from starting a second authentication phase after an authentication retry has already failed.
- dbd2598: Fix `RelayLiveness` ending a relay's backoff early when a timer from an earlier failure fires
- 0028a38: Reuse normalized relay exclusions and cached eligibility decisions between liveness updates
- fe31def: Fix `RelayLiveness.revive()` not putting the revived relay into its max backoff period
- e4d5977: Reconnect negentropy sync when a RECEIVE transfer fails with a transport error instead of failing the whole sync
- 3edafc6: Reject overlong negentropy varints and invalid encoder inputs ([#101](https://github.com/hzrd149/applesauce/pull/101), thanks [@mptfire](https://github.com/mptfire)).
- bbf4adb: Fix negentropy varint encoding and decoding overflowing for values larger than 2^31
- 6734240: Use Set membership to reduce event lookup overhead when syncing array-backed stores
- ccc77fa: Stop sending unnecessary CLOSE messages when one-shot NIP-45 COUNT requests end.
- 1be34ca: A synchronously-throwing `onAuthRequired` handler now maps to `AuthHandlerError` identically to a rejected promise, instead of escaping as a raw, unmapped `Error`.
- c5dc2e5: NIP-42 auth activity is now logged to a dedicated `:auth` sub-namespace covering the challenge, signing, send, result, and per-operation retry lifecycle.
- e876bc3: Move the relay auth debug namespace from `applesauce:Relay:<url>:auth` to `applesauce:Relay:auth:<url>` so `applesauce:Relay:auth:*` filters every relay's auth trace at once.
- 1be34ca: A synchronous `onAuthRequired` handler resolving `req()` or `count()`'s auth phase now sends a real resend frame and observes its reply, instead of silently rejoining an already-terminated listen chain and completing with no results.
- 1be34ca: `req()`, `request()`, and `subscription()` auth-required retries are now correctly bounded by `authRetries` instead of being silently reset by the synthetic `OPEN` message emitted on every resubscribe.
- 25909a1: Treat unrecognized `CLOSED` prefixes that match JavaScript prototype properties as ordinary relay closures instead of invalid errors.
- 566758b: Convert WebSocket error events into a `RelayConnectionError` with the relay URL instead of surfacing `[object ErrorEvent]`
- ea8a6cb: Bound duplicate-only traffic in idle-aware request completion with a configurable progress timeout
- 168c683: Advance reconnect backoff for WebSocket errors and constructor failures that do not emit a close event by counting each pending recovery once, skipping clean closes, and marking the relay not ready before notifying error observers.
- 1be34ca: `RelayGroup` now routes its debug diagnostics through the package's shared debug logger instead of writing directly to the console, so a consumer can silence them like every other class in the package.
- 0926171: `RelayGroup.request()`'s operation clock no longer treats a relay's connection error as progress, so a group whose relays all fail or fall silent now errors on its declared timeout instead of hanging forever.
- 1be34ca: `RelayGroup.request()`'s operation timeout is now suspended for the duration of a relay's auth phase instead of racing it.
- 1065007: Reduce `RelayGroup` request and subscription overhead by only re-checking completion when a relay's status changes instead of on every event
- 81c2121: Stop `lastMessageAt$` emitting the same timestamp again for every message in a burst
- 8c23561: Make opening and closing relay subscriptions constant time by only rebuilding the `reqs$` record when it is observed or read
- c5dc2e5: Reject publish calls when their client-side timeout expires.
- 0420f75: Stop logging the auth invalidation line on reset when no authenticated pubkeys were dropped.
- 1be34ca: `request()`'s own operation timeout can now actually fire against an unresponsive relay, instead of being permanently cancelled by the synthetic `OPEN` message it previously treated as first progress.
- 48da0c0: Route relay messages to subscriptions by id instead of checking every message against every open subscription
- 5c93027: Re-request missing event ids in `Relay.sync()` until a round makes no progress so relays that cap REQ results no longer drop events.
- 5dac2ce: Require corroborating connectivity after the previous counted failure before classifying a relay as dead.
- 751d67a: Prefer optional sync-pair queries when preparing Negentropy reconciliation
- Updated dependencies
  - applesauce-core@7.0.0

## 6.2.1

### Patch Changes

- 189c914: Complete the internal `_ready$` source when `Relay.close()` is called so the watchTower cannot re-arm the reconnect timer after a terminal close.

## 6.2.0

### Minor Changes

- ede2462: Add `RelayPool.close()` to close and remove every relay in the pool for clean shutdown

### Patch Changes

- 4c492ab: Cancel the watchTower's `keepAlive` reset timer in `Relay.close()` so closing a relay no longer leaves a pending timer holding the event loop open for `keepAlive` milliseconds
- ede2462: Fix `Relay.close()` to cancel the pending reconnect timer and tear down internal state subscriptions so it no longer leaves timers running that keep the process alive
- 4e7b7c9: Mark events sent to a relay during a negentropy sync as seen on that relay
- e2c7799: Upgrade Noble and Scure crypto dependencies to their latest major versions.
- Updated dependencies
  - applesauce-core@6.2.0

## 6.0.3

### Patch Changes

- 6553450: Default `RelayPool.ignoreOffline` to `false` and deprecate the property. When the opt-in `ignoreOffline=true` path is used, `RelayPool.group` now waits for non-ready relays to become ready instead of dropping them.

## 6.0.2

### Patch Changes

- 45d7972: Fix RelayPool.relay() not emitting add$
- 77d5e42: Apply `reconnect` to REQ errors, limit `resubscribe`, and support numeric defaults

## 6.0.0

### Major Changes

- bca9737: Update `RelayPool` and `RelayGroup` to never return virtual EOSE on `req`, and `subscription`
- ef729d9: Remove `eoseTimeout` from `Relay`. request timeouts should be handled downstream
- 7f70ea6: Relay: `CLOSED` messages complete subscriptions instead of erroring
- bca9737: Remove `markFromRelay` operator
- bca9737: Remove `IRelay`, `IGroup` and `IPool` interfaces. too complex to make classes generic

### Minor Changes

- 474e259: Add `timeout` to `Relay.request`, `RelayGroup.request`, and `RelayPool.request` options

### Patch Changes

- 6c80677: Add a `waitForAuth` option to REQ flows so callers can disable auth waiting and receive auth-required errors directly.
- Updated dependencies
  - applesauce-core@6.0.0

## 5.2.0

### Minor Changes

- 9a133b3: Add `challenge` to relay status and pool status

### Patch Changes

- Updated dependencies
  - applesauce-core@5.2.0

## 5.1.0

### Minor Changes

- bb832f6: Add `Relay.authentcation$` observable for exposing the sent authentication event
- bb832f6: Add `Relay.status$` observable for easily subscribing to all status observables
- bb832f6: Add `Relay.authenticatedAs$` observable for accessing pubkey of authentication event
- f58a5c0: Add `enablePing` to `Relay` to monitor for unresponsive connections
- bb832f6: Add `Relay.reqs$` observable for tracking active REQs
- bb832f6: Add `RelayGroup` and `RelayPool` `status$` observables for relay statuses

### Patch Changes

- Updated dependencies
  - applesauce-core@5.1.0

## 5.0.0

### Major Changes

- 1ff4283: Remove `retries` option in request, subscription, and publish methods. use `reconnect` instead
- c2bd9a2: Lower default retry count from 10 to 3
- c2bd9a2: Ignore unreacheable (ready=false) relays by default in `request`, `subscription`, `publish` and `sync` in `RelayPool`

### Minor Changes

- 41499f9: Add `createEventLoaderForStore` method for easily creating the `EventStore.eventLoader` method using a relay pool or relay request method
- 1ff4283: Added `subscriptionReconnect`, `requestReconnect`, and `publishRetry` options to Relay and RelayPool class for default retry limits
- 41499f9: Add `createUnifiedEventLoader` for both event pointers and address pointers
- eb68078: Bump `nostr-tools` to `2.19`

### Patch Changes

- cc794a3: Fix `Relay.sync` and `RelayPool.sync` not adding events to event store
- d788f94: Remove direct imports from nostr-tools
- Updated dependencies
  - applesauce-core@5.0.0

## 4.4.2

### Patch Changes

- ccd87cc: Fix performance issues with shared observables

## 4.4.0

### Minor Changes

- 71019f3: Add type support for NIP-91 in filters sent to relays

### Patch Changes

- Updated dependencies
  - applesauce-core@4.4.0

## 4.2.0

### Minor Changes

- 363804d: Add `RelayPool.subscriptionMap` method
- 4f978f6: Add `RelayPool.outboxSubscription` for subscribing to an `OutboxMap` with a filter
- 136964d: Add support for dynamic relay groups

### Patch Changes

- f649d6d: Fix abort signal being ignored in `negentropySync` method
- Updated dependencies
  - applesauce-core@4.2.0

## 4.1.0

### Minor Changes

- 1caf5da: Support NIP-45 `COUNT` verb
- f45f84f: Add `RelayLiveness` class for tracking unhealthy relays

### Patch Changes

- Updated dependencies
  - applesauce-core@4.1.0

## 4.0.0

### Major Changes

- 52ba312: Add `.negentropy` and `.sync` methods to `Relay`, `RelayGroup` and `RelayPool`
- 997326a: Add `publishTimeout` to `Relay` and default to 30 seconds
- 52ba312: Update `RelayGroup` and `RelayPool` to deduplicate events by default

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`
- 7ac7b0c: Add `add$`, `remove$` signals to `RelayPool`

### Patch Changes

- 9e13abf: Add `eventStore` option to `RelayPool.request` and `RelayPool.subscription` to filter duplicate events
- Updated dependencies
  - applesauce-core@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- c0ab327: Fix `reconnect` option not handling socket errors correctly
- Updated dependencies
  - applesauce-core@3.1.0

## 3.0.0

### Major Changes

- eaf8bc7: Update `relay.publish` return `Promise<PublishResponse>` so `lastValueFrom` does not need to be used.
- eaf8bc7: Removed `IRelayState` and `Nip01Actions` interfaces
- eaf8bc7: Update `pool.publish` and `group.publish` to return `Promise<PublishResponse[]>` so `lastValueFrom` does not need to be used.
- eaf8bc7: Update `relay.authenticate` to return `Promise<PublishResponse>` so `lastValueFrom` does not need to be used.
- eaf8bc7: Update `relay.auth` to return `Promise<PublishResponse>` so `lastValueFrom` does not need to be used.

### Minor Changes

- 58659a8: Add `Relay.close` method for closing the socket
- 970fb03: Add `reconnect` option to `publish`, `request`, and `subscription` methods
- 58659a8: Add `RelayPool.remove` method for removing relays
- b4943cb: Allow `keepAlive`, `eoseTimeout`, and `eventTimeout` to be set when creating a `Relay` or `RelayPool`

### Patch Changes

- 970fb03: Fix `Relay.req` and `Relay.event` not completing when socket closed
- Updated dependencies
  - applesauce-core@3.0.0

## 2.3.0

### Minor Changes

- d638591: Expose `authRequiredForPublish` and `authRequiredForRead` observables on `Relay`
- 3f6dbb0: Add `Relay.authenticationResponse` to expose last AUTH response

### Patch Changes

- Updated dependencies
  - applesauce-core@2.3.0

## 2.1.1

### Patch Changes

- b446dd1: Fix bug with fetching NIP-11 document using wss URL

## 2.0.0

### Minor Changes

- 324b960: Bump `nostr-tools` to 2.13

### Patch Changes

- f8d833e: Fix bug with NIP-11 `auth_required` preventing connection
- d52d39a: Fix `toEventStore` not removing duplicate events
- Updated dependencies
  - applesauce-core@2.0.0

## 1.2.0

### Minor Changes

- 466cd6e: Allow `.req`, `.request`, and `.subscription` to take `filters` as an observable so they can be updated

### Patch Changes

- 63ed560: Normalize relay url to prevent duplicates
- Updated dependencies
  - applesauce-core@1.2.0

## 1.1.0

### Minor Changes

- ed0737a: Add `RelayPool.relays# applesauce-relay and `RelayPool.groups# applesauce-relay observables
- 589f7a2: Change type of `pool.publish` to be single results instead of an array
- 6b9e4cd: Add `RelayPool.blacklist` set
- 73f06ba: Add `Relay.notice# applesauce-relay observable

### Patch Changes

- 73f06ba: Make `Relay.message# applesauce-relay not trigger a connection

## 1.0.1

### Patch Changes

- e0f618b: Fix multiple `REQ` messages

## 1.0.0

### Minor Changes

- 829a041: Fetch relay NIP-11 document
- e81bc36: Add inclusive flag to `completeOnEose` operator
- a5d397b: Add client side negentropy sync
- f406837: Add reconnection logic
- cf4f4db: Add keepAlive timeout no relay (default 30s)
- 829a041: Support NIP-11 `auth_required` limitation
- f406837: Add `publish`, `subscription` and `request` methods to `Relay`, `RelayGroup` and `RelayPool`
- 2d07de6: Add `RelayGroup` class
- 778fcab: Add tests for `Relay`, `RelayGroup`, and `RelayPool`
- e81bc36: Add `toEventStore` operator

### Patch Changes

- 2d07de6: Fix reconnect bug with Relay class
- Updated dependencies
  - applesauce-core@1.0.0

## 0.12.0

### Patch Changes

- Updated dependencies
  - applesauce-core@0.12.0
