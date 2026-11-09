# applesauce-extra

## 7.1.0

### Minor Changes

- fd4acc5: Add persistent conversation drafts with staged file storage and revision-safe handoff to message publication
- 907a959: Add a signer-backed Cordn coordinator client with isolated account and ephemeral ContextVM identities over the shared relay pool.
- fbdf7fb: Add `applesauce-extra/kehto` service constructors and a shell adapter for hosting napplets over shared application resources
- 6f484b8: Add an account-scoped `GiftWrapReceiver` for cache-first inbox processing with shared reactive outcomes
- abfbc98: Add Kehto NIP-17 and NIP-04 messaging protocols with store-backed history and configurable client ownership
- 0253126: Add `createNdrMessageProtocol` for app-owned or protocol-owned NDR messaging clients in Kehto
- 7c888b6: Expose every module under `applesauce-extra/kehto/services/` as its own import path.
- a87e312: Add standalone legacy inbox and conversation receivers backed by a shared NIP-04 message decryptor
- fd4acc5: Add optional key/value persistence with restoration and discard of unpublished legacy conversation messages.
- a87e312: Add paginated legacy and wrapped conversation discovery with in-memory and IndexedDB conversation index stores
- a4f5040: Add account-scoped legacy and wrapped messaging clients with persistent decryption caching, relay authentication, and client-owned draft cleanup
- 374feac: Add `NdrMessagesClient` for double-ratchet direct chats, groups, and app-key device management at `applesauce-extra/messages/ndr`.
- 907a959: Add standalone NDR transport hooks with shared relay connections, verified event caching, and optional owner signing
- a4f5040: Add legacy conversations with explicit history loading, live watching, cached previews, and prepared message publication
- 73466cf: Add an optional Kehto browser host for running verified napplets
- 24ad6e9: Add composable Kehto ContextVM services with isolated per-window transports over a shared relay pool
- 056038e: Add wrapped conversations with caller-owned filtered queries over a shared rumor store and recipient-bound sending with explicit expiration

### Patch Changes

- 19a10c5: Allow ContextVM SDK 0.14.3 alongside the previously supported 0.13.10 release
- 600af2b: Deprecate the `Vertex` client and its related exports in favor of `OpenRanking` with the `https://ranking.vertexlab.io` provider.
- 19a10c5: Update runtime dependencies to their latest stable releases
- Updated dependencies
  - applesauce-core@7.1.0

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
