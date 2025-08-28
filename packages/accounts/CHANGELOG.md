# applesauce-accounts

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- Updated dependencies
  - applesauce-signers@3.1.0
  - applesauce-core@3.1.0

## 3.0.0

### Major Changes

- 7b469b5: Remove `getRelays` method since its not longer listed in NIP-07
- 7b469b5: Remove syncronus API on some signers and accounts. every method now returns a Promise

### Minor Changes

- bf00100: Verify event id matches on all `signEvent` calls
- 0a34c73: Add `ExtensionAccount.fromExtension` static method

### Patch Changes

- 7b469b5: Fix `PasswordAccount` not requesting unlock password for signing and encryption/decryption
- Updated dependencies
  - applesauce-core@3.0.0
  - applesauce-signers@3.0.0

## 2.0.0

### Minor Changes

- 324b960: Bump `nostr-tools` to 2.13

### Patch Changes

- Updated dependencies
  - applesauce-signers@2.0.0

## 1.0.0

### Major Changes

- 40debfd: Update nostr connect signer to use observable like interface

### Minor Changes

- d8dc5c2: Export `ProxySigner` class

### Patch Changes

- c92982d: Fix removing active account not clearing active observable
- Updated dependencies
  - applesauce-signers@1.0.0

## 0.12.0

### Minor Changes

- 6bd2607: Fix extension account missing nip04/nip44 interfaces

### Patch Changes

- Updated dependencies
  - applesauce-signers@0.12.0

## 0.11.0

### Minor Changes

- 2f382d4: Add request queue to base account class

### Patch Changes

- 1c35f41: Add `require` support in node v22
- Updated dependencies
  - applesauce-signers@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies
  - applesauce-signers@0.10.0
