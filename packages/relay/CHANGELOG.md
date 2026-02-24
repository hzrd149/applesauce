# applesauce-relay

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
