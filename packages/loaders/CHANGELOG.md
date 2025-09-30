# applesauce-loaders

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
