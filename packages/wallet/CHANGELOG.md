# applesauce-wallet

## 6.2.0

### Minor Changes

- d11e562: Upgrade `@cashu/cashu-ts` to v4 (proof amounts are now `Amount` value objects; `getDecodedToken` requires keyset ids)
- 1ef947d: Add `MintTokens` action for minting tokens into the wallet from a paid bolt11 mint quote
- f9bb8b5: Add `NutWallet` class in `applesauce-wallet/wallet` for loading and managing a NIP-60 Cashu wallet
- 1ef947d: Add an optional `getCashuWallet` provider option to the token actions so callers can supply a cached cashu `Wallet`
- fca98fc: Mirror token `del` ids to public tags so deleted token events can be computed without decrypting the content
- af12b87: Add a `CleanupDeletedTokens` action, `WalletDeletedTokensModel` model, and `NutWallet.cleanupDeletedTokens` method to detect and remove token events that newer token events have marked as deleted
- fca98fc: Add `WalletDeletedTokenIdsModel` and `getTokenDeletedIds` helper for reading deleted token ids from public tags with a fallback to the decrypted content
- af12b87: Add a `useDeleteEvents` option to `NutWallet` (with `setUseDeleteEvents`) and a `createDeleteEvents` option to the token actions to control whether the wallet loads, subscribes to and publishes NIP-09 delete events, letting a wallet completely ignore all kind 5 delete events with a single flag

### Patch Changes

- 0a58a0b: Batch the `ConsolidateTokens` action into a single delete event across all mints and skip mints that already have one token
- 2ed2e13: Make `NutWallet.unlocked$` and `Wallet.unlocked$` react to in-place unlock updates so the unlocked state is reflected after auto-unlock with no events left to decrypt
- 82550ee: Use the shared sync loader for wallet event backfills and automatically back up loaded wallet events to missing relays.
- af12b87: Fix `WalletTokensModel` and `WalletBalanceModel` double counting and showing replaced token events by reconciling each token's `del` field independently of timeline order and across delete chains
- Updated dependencies
  - applesauce-actions@6.2.0
  - applesauce-common@6.2.0
  - applesauce-core@6.2.0
  - applesauce-loaders@6.2.0

## 6.1.0

### Patch Changes

- d493ec2: Clarify naming of `Nutzap.pointer` to `Nutzap.zapPointer`
- Updated dependencies
  - applesauce-common@6.1.0
  - applesauce-core@6.1.0
  - applesauce-actions@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@6.0.0
  - applesauce-common@6.0.0
  - applesauce-actions@6.0.0

## 5.0.0

### Minor Changes

- 36e021a: Remove unused `@noble/hashes` dependency
- b698156: Add wallet and token event casts
- 6596b3d: Remove direct `nostr-tools` dependency
- 14a2201: Add support for NIP-87 cashu mint discovery

### Patch Changes

- Updated dependencies
  - applesauce-actions@5.0.0
  - applesauce-common@5.0.0
  - applesauce-core@5.0.0

## 4.0.0

### Major Changes

- 49e6c44: Rename all `isLocked` methods to `isUnlocked` for type casting
- 49e6c44: Update `getNutzapRecipient` to return `ProfilePointer` instead of `string` pubkey

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`
- f8fd5ec: Bump `cashu-ts` to `2.7`

### Patch Changes

- Updated dependencies
  - applesauce-core@4.0.0
  - applesauce-actions@4.0.0
  - applesauce-factory@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- Updated dependencies
  - applesauce-core@3.1.0
  - applesauce-actions@3.1.0
  - applesauce-factory@3.1.0

## 3.0.0

### Major Changes

- a9838cf: Reorganize exports and rename event operations

### Minor Changes

- 2517962: Add NIP-61 nutzap helpers, operations, blueprints, models, and actions

### Patch Changes

- 1420273: Make `getNutzapMint` return undefined on invalid URL
- Updated dependencies
  - applesauce-core@3.0.0
  - applesauce-factory@3.0.0
  - applesauce-actions@3.0.0

## 2.0.0

### Major Changes

- 1d28426: Rename "Queries" to "Models"

### Minor Changes

- 324b960: Bump `nostr-tools` to 2.13

### Patch Changes

- Updated dependencies
  - applesauce-core@2.0.0
  - applesauce-factory@2.0.0
  - applesauce-actions@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@1.0.0
  - applesauce-actions@1.0.0
  - applesauce-factory@1.0.0

## 0.12.0

### Minor Changes

- 2f99e8a: Add `CreateWallet` action
- 5e95ed5: Add `ConsolidateTokens` action
- 0c6251d: Add `UnlockWallet` action
- ad83de5: Add history event helpers
- 0dca3fb: Add `WalletBlueprint` blueprint
- 2f99e8a: Add `WalletBackupBlueprint` blueprint
- ede912c: Add `encodeTokenToEmoji` and `decodeTokenFromEmojiString` methods
- b553540: Add wallet history blueprints and operations
- d8d5fa7: Add animated QRCode helpers
- dcda34e: Add `RolloverTokens` action
- ad83de5: Add token event helpers

### Patch Changes

- 4aba6cc: Make private key optional in wallet event
- Updated dependencies
  - applesauce-actions@0.12.0
  - applesauce-core@0.12.0
  - applesauce-factory@0.12.0
