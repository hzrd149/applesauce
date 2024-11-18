# applesauce-core

## 0.9.0

### Minor Changes

- a14dbd9: Add `isValidZap` method
- 493aee0: Bump nostr-tools to 2.10
- a14dbd9: Add `isValidProfile` method
- 892cd33: Remove nrelay encoding
- 149625d: Add zap helpers and queries

### Patch Changes

- 81015c4: Fix getZapAddressPointer returning EventPointer

## 0.8.0

### Minor Changes

- 08d2abe: Add `shareLatestValue` observable operator for caching queries
- 0dae7f5: Replace zen-observable with rxjs

### Patch Changes

- 08d2abe: Fix hashtag regexp capturing whitespace before

## 0.7.0

### Minor Changes

- 7673403: Add `size` to database
- d11fbe8: export `LRU` helper class
- b96717c: Add `getValue` observable helper

## 0.6.0

### Minor Changes

- df7756c: Move mute helpers and queries to applesauce-lists
- 64c99e7: Add "events" query to event store
- df7756c: Add update method to event store
- df7756c: Add tag helpers

## 0.5.0

### Minor Changes

- b39a005: Move NIP-28 channel helpers to applesauce-channel package
- ebc5da7: Add promise helpers

## 0.4.0

### Minor Changes

- ec52c90: Add pointer helpers
- ec52c90: Add tag helpers
- ec52c90: Add thread queries and helpers

## 0.3.0

### Minor Changes

- 5cf2091: Add mute list helpers and queries
- 5cf2091: Add NIP-28 channel helpers and queries

## 0.2.0

### Minor Changes

- 220c22d: Handle replaceable and removed events in timelines

### Patch Changes

- 220c22d: Fix bug with timeline using same array
