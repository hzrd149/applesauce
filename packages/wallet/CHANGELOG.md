# applesauce-wallet

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
