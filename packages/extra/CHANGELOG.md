# applesauce-extra

## 7.0.0

### Minor Changes

- 48e431c: Add `applesauce-extra/nspam`, `/vertex`, `/primal`, `/open-ranking` and `/remote-monitor-relay-liveness` entry points so each module can be imported on its own
- 5dac2ce: Add a `staleAsOffline` option that treats reports active NIP-66 monitors stopped refreshing as offline.
- f816ca8: Add monitor-backed relay liveness with trusted publishers, expiring observations, and explicit negative consensus.
- 48e431c: Add `NspamClassifier` and the `filterSpam` operator for hiding reply spam with the on-device nspam model

### Patch Changes

- 0028a38: Avoid reparsing relay URLs for each monitor observation
- Updated dependencies
  - applesauce-core@7.0.0

## 6.2.0

### Minor Changes

- 054e7c4: Add `OpenRanking` client for searching profiles on an Open Ranking provider with optional Nostr Web Token authentication

### Patch Changes

- 9b5928e: Cache the `OpenRanking` Nostr Web Token so scoring many pubkeys only requests a single signature until the token expires
- Updated dependencies
  - applesauce-core@6.2.0

## 6.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@6.0.0

## 5.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@5.0.0

## 4.1.0

### Minor Changes

- 220b4b5: Add `Vertex` class
- 220b4b5: Add `PrimalCache` class

### Patch Changes

- ae2ec5c: Fix primal user search returning non events
- ae2ec5c: Fix vertex authenticating multiple times
- Updated dependencies
  - applesauce-core@4.1.0
  - applesauce-relay@4.1.0
  - applesauce-signers@4.1.0
