# applesauce-loaders

## 7.0.0

### Major Changes

- 48ad1a9: Replace page-based timeline loading with reactive finite-window coverage and buffered prefetch across relays.
- deac47f: Remove `createUserListsLoader`, its types, and the `COMMON_LIST_KINDS` and `COMMON_SET_KINDS` constants in favor of `createSyncLoader` for discovering user lists and sets.
- 4181efd: `createSocialGraphLoader` now returns `{ events$, status$ }` so apps can show crawl progress.

### Minor Changes

- 4a212ca: Bound `createTagValueLoader` to four concurrent batches and eight relay requests per batch by default with configurable `maxConcurrentBatches` and `relayConcurrency` options.
- dd87a02: Isolate cache and individual relay failures in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader`, reporting skipped failures through the optional `onError` callback.
- 4141179: Add `maxConcurrentBatches` and `stageTimeout` options to the event and address loaders to limit open relay requests and stop a slow relay from blocking fallback relays
- 6c4032e: Lower the default `bufferTime` of the event, address, and tag value loaders from 1000ms to 200ms
- a33c747: Add `createCountService` for loading shared, cached reaction and comment counts from trusted relays.
- 94faaab: Share compatible queued and running `createTagValueLoader` requests with replay for late callers under static relay routing, with `shareInflight: false` available to disable sharing.
- 4181efd: Cached follow lists are refreshed from relays during social graph loads.
- 4181efd: Load social graph batches concurrently with a new `concurrency` option.
- 4181efd: Limit how many social graph requests are open on each relay with a new `maxRequestsPerRelay` option.
- 55e3f83: Make high-level sync own authentication hooks while the sync loader preserves them across its paginated fallback.
- e36477f: Allow the sync loader to accept an observable of relay lists that starts relays as they are added and stops relays that are removed.
- f8eafec: Add a `liveness` option to the sync loader that records relays which fail before making progress.
- f8eafec: Report relays excluded by the pool's liveness sources with a new `"skipped"` sync loader relay state.
- 98875b1: Add `waitForAuth` support to the sync loader so auth-required relays wait for NIP-42 authentication and retry.
- 4a212ca: Limit cache and relay source lifetimes in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader` to a configurable `requestTimeout` of ten seconds by default, reporting timeouts through `onError` while preserving partial results.
- 202bfb6: Add a `liveness` option to timeline loaders that reports failing relays so they can be removed from the relay set.
- 202bfb6: Retry failing or unresponsive timeline relays with exponential backoff.
- 202bfb6: Add the prefetch `buffer` range to timeline loader statuses.

### Patch Changes

- df7c099: Fix address loader requesting unrelated addressable events when loading lists from several authors at once
- 2f0ce0a: Fix address loader sending every requested address to every relay hint in the batch instead of only its own relays
- 4e9ff9f: Reduce batch loader overhead when many requests are in flight by tracking joinable inputs per batch
- 5da26d4: Fix `DnsIdentityLoader` never retrying failed lookups or refreshing expired identities, and add an `errorExpiration` option for how long failures are kept
- df7c099: Fix `cache: false` being ignored when the same event was also requested with the cache enabled in the same batch
- df7c099: Fix one failing relay hint cancelling event requests to the other hinted relays
- df7c099: Fix event and address loaders skipping relays when the cache request throws
- 2f0ce0a: Fix event and address loaders returning nothing for some events when a relay limits how many results it sends
- 2f0ce0a: Fix event and address loaders keeping relay subscriptions open after unsubscribing or calling `stop()`
- 4141179: Fix event and address loaders opening a new relay request every time the same missing event is requested while one is already running
- a6931f5: Fix event and address loaders asking the same relay again when it appears in the relay hints, extra relays, or lookup relays
- 4141179: Fix event and address loaders not saving events to the event store when the requesting component unsubscribed before they arrived
- 2f0ce0a: Fix event and address loaders returning a cached event to only one of several components requesting it at the same time
- e904c48: Resume timeout tracking before a sync loader falls back to paginated requests so the fallback cannot hang indefinitely.
- 93bbad8: URL encode the name when fetching NIP-05 identities in `DnsIdentityLoader`
- 0028a38: Forward outbox map failures through relay filter subscriptions instead of reporting uncaught RxJS errors
- 18eb6dc: Keep outbox timeline coverage when follows or relay lists change instead of reloading every author on the relay
- 7e5248e: Avoid repeatedly shifting pending batches in concurrency-limited loaders
- 02d4d43: Preserve an explicit `since: 0` in filters built by `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader`.
- 051d7cc: Expose the negentropy fallback reason in per-relay sync loader status.
- f8eafec: Pass timeline request errors and start times to optional liveness classifiers after updating request bookkeeping.
- 4181efd: With `hints` enabled, the social graph loader sends each user only to their own hinted relays.
- 4181efd: The social graph loader only emits a follow list when it is newer than the one already loaded.
- c0d4a07: Avoid repeatedly shifting queued users when loading large social graphs
- 4181efd: The social graph loader recovers follow lists that relays silently drop from large multi-author requests.
- 4181efd: The social graph loader no longer fetches the starting user's follow list twice.
- 1be34ca: `SyncLoader` no longer leaves an auth-phase timer pending after a load is torn down or after a handler settles once its auth phase was already force-closed.
- 1be34ca: `SyncLoader`'s stall guard is now suspended for the full duration of a relay's auth phase even when the caller supplies no `onAuthRequired` handler.
- 5c93027: Fix the sync loader stopping early on relays that cap results by clamping pages to NIP-11 `max_limit` and paging until an empty page when the cap is unknown.
- 07589a4: Emit throttled intermediate progress snapshots during sync loading
- f8eafec: Count the NIP-77 support check against a relay's first progress timeout so an unreachable relay only times out once.
- 656eeec: Parse relationship tags once per arrival in `createTagValueLoader` instead of rescanning them for each waiting caller.
- 55beba6: Honor `TagValuePointer.force` in `cacheTagValueLoader` and `createTagValueLoader` by excluding forced pointers from cache queries and delivering only relay arrivals to forced callers in mixed batches.
- 656eeec: Reject invalid concurrency and timeout options in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader` to prevent stalled queues and timer overflow.
- 71eaa8f: Start explicit relay hints immediately in `relaysTagValueLoader` and `createTagValueLoader` while resolving observable `extraRelays` independently within `requestTimeout` and the shared relay concurrency limit.
- 02d4d43: Deduplicate tag values in each relay request filter built by `relaysTagValueLoader` and `createTagValueLoader`.
- f99350b: Fix timeline loaders skipping events that share a `created_at` with the oldest event of the previous page.
- 8f7f0f6: Make the observable returned by each timeline loader call complete once its page of events has loaded.
- acc7c2a: Fix timeline loaders permanently ignoring a relay when a page request is cancelled before it returns any events.
- f7f39a8: Speed up matching timeline events against loaded pages
- 903e157: Fix relay and cache timeline loaders dropping filter fields like `search` from their requests.
- 598fc9a: Fix outbox timeline loaders cancelling and re-sending in-flight relay requests whenever the outbox map updates.
- 17cc1cb: Keep loading timeline blocks from the remaining relays when one relay in a filter map fails.
- 7f18764: Fix timeline loaders skipping events between the newest loaded event and a window `until` when loading newer events.
- 6316d35: Fix timeline loaders never loading newer events again after one load returned no new events.
- 903e157: Fix timeline loaders skipping events from one filter when another filter on the same relay reaches further back in time.
- 9ebbfbc: Track timeline pagination independently for each relay to avoid skipping events when relay limits differ.
- 6f334ce: Fix a failing relay erroring the whole timeline loader call instead of being retried on the next call.
- 48ad1a9: Coalesce timeline window and buffer requests into direction-aware batches that reuse useful in-flight work.
- 8d4ed95: Fix backward timeline loaders skipping blocks when the window `since` is older than the loaded range.
- Updated dependencies
  - applesauce-core@7.0.0

## 6.2.0

### Minor Changes

- f4f08c2: Add a `signal` option plus `stop()` and `Symbol.dispose` methods to the batched event, address, tag-value, and unified loaders for deterministic teardown of in-flight upstream requests
- 4e7b7c9: Add `createSyncLoader` for loading a set of events from multiple relays using NIP-77 negentropy sync with a paginated request fallback

### Patch Changes

- f4f08c2: Fix the event, address, and tag-value loaders keeping a `bufferTime` interval alive forever (hanging the process on exit) by reference counting the batch engine so it only runs while a loader observable is subscribed
- Updated dependencies
  - applesauce-core@6.2.0

## 6.1.0

### Patch Changes

- b03c0d9: Fix timeline backwards loader not handling `until` correctly on filters
- Updated dependencies
  - applesauce-core@6.1.0

## 6.0.0

### Major Changes

- 5928c51: Update `createSocialGraphLoader` to take an upstream pool as first argument instead of an `AddressLoader`

### Minor Changes

- d856044: Update social graph loader to accept `since` date to limit returned contacts events

### Patch Changes

- Updated dependencies
  - applesauce-core@6.0.0

## 5.1.0

### Minor Changes

- 7f53801: Add `loadAsyncMap` method for parallel async loading

### Patch Changes

- Updated dependencies
  - applesauce-core@5.1.0

## 5.0.2

### Patch Changes

- 4f908b6: Fix incorrect types on unified event loader

## 5.0.0

### Minor Changes

- 6596b3d: Remove unused `nostr-tools` dependency

### Patch Changes

- Updated dependencies
  - applesauce-core@5.0.0

## 4.2.0

### Minor Changes

- 871c929: Update loaders to not return duplicate events by default
- 4f978f6: Rebuild timeline loaders to support forwards and backwards loading

### Patch Changes

- Updated dependencies
  - applesauce-core@4.2.0

## 4.0.0

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`

### Patch Changes

- Updated dependencies
  - applesauce-core@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- Updated dependencies
  - applesauce-core@3.1.0

## 3.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@3.0.0

## 2.1.0

### Minor Changes

- b652776: Update all loaders to accept observables for `extraRelays` option
- 230e6d2: Add `cache` option to address and event loader

### Patch Changes

- 937e23e: Fix loaders missing requests in FireFox
- Updated dependencies
  - applesauce-core@2.1.0

## 2.0.0

### Major Changes

- 9b165a0: Export loaders under `Loaders` namespace from root `import { Loaders } from "applesauce-loaders"`
- 8384565: Remove `CacheTimelineLoader` class
- 8384565: Remove `RelayTimelineLoader` class
- 8384565: Remove `ReplaceableLoader` class
- 7535052: Remove `UserSetsLoader` class
- 8384565: Remove `TimelineLoader` class
- e0e455a: Remove `SingleEventLoader` class

### Minor Changes

- f0ce2e5: Add zaps and reactions loaders
- 8384565: Add `createTimelineLoader` loader method
- 7535052: Add `createUserListsLoader` loader
- a1e5652: Add `createAddressLoader` method to create a pre-built address loader
- 324b960: Bump `nostr-tools` to 2.13

### Patch Changes

- aec8278: Fix `UserSetsLoader` making requests with no filters
- Updated dependencies
  - applesauce-core@2.0.0

## 1.0.0

### Major Changes

- 49bd6c1: Remove dependency on rx-nostr
- 54d73c4: Removed `RequestLoader` class

### Minor Changes

- 6aa9eb0: Add `extraRelays` array to common loaders

### Patch Changes

- Updated dependencies
  - applesauce-core@1.0.0

## 0.12.0

### Minor Changes

- 06263df: Add `RequestLoader.blossomServers` method

### Patch Changes

- Updated dependencies
  - applesauce-core@0.12.0

## 0.11.0

### Minor Changes

- f3de51a: Add `TagValueLoader` loader
- fcbc990: Export all loaders classes at root
- 2199f3b: Support async generators in generatorSequence operator
- f281dcd: Add `TimelineLoader` and `RelayTimelineLoader` loaders
- 6aeb923: Add `DnsIdentityLoader` loader
- bbb76a0: Add `UserSetsLoader` loader
- 68d8c03: Rename `replaceableRequest` to `addressPointersRequest`

### Patch Changes

- 1c35f41: Add `require` support in node v22
- Updated dependencies
  - applesauce-core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies
  - applesauce-core@0.10.0
