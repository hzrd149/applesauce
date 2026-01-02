# applesauce-wallet-connect

## 5.0.0

### Minor Changes

- 6596b3d: Remove direct `nostr-tools` dependency

### Patch Changes

- Updated dependencies
  - applesauce-common@5.0.0
  - applesauce-core@5.0.0

## 4.1.0

### Minor Changes

- 1e5e1eb: Support custom methods in `WalletConnect` and `WalletService` classes
- 5769b74: Add `acceptRelayHint` to `WalletConnect` and enable by default
- 5769b74: Add `overrideRelay` option to `WalletService.fromAuthURI`

### Patch Changes

- Updated dependencies
  - applesauce-core@4.1.0

## 4.0.0

### Major Changes

- 49e6c44: Rename all `isLocked` methods to `isUnlocked` for type casting

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`

### Patch Changes

- Updated dependencies
  - applesauce-core@4.0.0
  - applesauce-factory@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- e6d5613: Fix wallet classes not reconnecting to relays
- Updated dependencies
  - applesauce-core@3.1.0
  - applesauce-factory@3.1.0

## 3.0.0

### Minor Changes

- f2706a0: Add `WalletService` class
- b7575d4: Add support for `nostr+walletauth://` URIs
- f2706a0: Add `WalletConnect` class

### Patch Changes

- Updated dependencies
  - applesauce-core@3.0.0
  - applesauce-factory@3.0.0
