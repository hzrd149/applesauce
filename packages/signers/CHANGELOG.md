# applesauce-signer

## 5.1.0

### Minor Changes

- 0cdd0ed: Add support for `switch_relays` and `ping` methods on nostr connect remote signer

### Patch Changes

- Updated dependencies
  - applesauce-core@5.1.0

## 5.0.0

### Minor Changes

- d788f94: Remove `@noble/hashes` and `@scure/base` dependency
- 6596b3d: Remove direct `nostr-tools` dependency

### Patch Changes

- Updated dependencies
  - applesauce-core@5.0.0

## 4.2.0

### Patch Changes

- 872115f: Verify `ExtensionSigner` and `NostrConnectSigner` return hex pubkey for `getPublicKey`
- Updated dependencies
  - applesauce-core@4.2.0

## 4.1.0

### Minor Changes

- 686176d: Rename `SimpleSigner` to `PrivateKeySigner` and keep old exports

### Patch Changes

- Updated dependencies
  - applesauce-core@4.1.0

## 4.0.0

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`

### Patch Changes

- 2d31507: fix `applesauce-signers` not exposing helpers
- Updated dependencies
  - applesauce-core@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- e6d5613: Fix nostr connect signers not reconnecting to relays
- 5285ee8: Fix `NostrConnectProvider` requiring secret on reconnect
- Updated dependencies
  - applesauce-core@3.1.0

## 3.0.0

### Major Changes

- 7b469b5: Remove `getRelays` method since its not longer listed in NIP-07
- 7b469b5: Remove syncronus API on some signers and accounts. every method now returns a Promise

### Minor Changes

- 4728e12: Add `NostrConnectProvider` class for the "remote signer" part of NIP-46
- 4728e12: Add `pool` option for nostr connect signer and provider to make it easier to use with `applesauce-relay`

### Patch Changes

- Updated dependencies
  - applesauce-core@3.0.0

## 2.0.0

### Minor Changes

- 82c7703: add `SimpleSigner.fromPrivateKey` static method
- c1f8f28: Allow `NostrConnectSigner.subscriptionMethod` to return `Observable<NostrEvent|string>` for better compatabilitiy with `applesauce-relay`
- 82c7703: Add `PasswordSigner.fromNcryptsec` static method
- c1f8f28: Allow `NostrConnectSigner.publishMethod` to return an `Observable<any>` for better compatabilitiy with `applesauce-relay`
- 82c7703: Add `PasswordSigner.fromPrivateKey` static method
- 324b960: Bump `nostr-tools` to 2.13
- c290264: Allow an `AbortSignal` to be passed into `NostrConnectSigner.waitForSigner`
- 82c7703: Add `ReadonlySigner.fromPubkey` method

### Patch Changes

- 29d5350: Make `NostrConnectSigner.close` cancel `.waitForSigner()` promise
- Updated dependencies
  - applesauce-core@2.0.0

## 1.2.0

### Patch Changes

- ed6ad27: Fix nostr-connect signer `publishMethod` expecting `Promise<void>` instead of `Promise<any>`
- Updated dependencies
  - applesauce-core@1.2.0

## 1.0.0

### Major Changes

- 40debfd: Update nostr connect signer to use observable like interface

### Patch Changes

- Updated dependencies
  - applesauce-core@1.0.0

## 0.12.0

### Minor Changes

- 0867a50: Cache the pubkey on `ExtensionSigner`

### Patch Changes

- fbaa2ab: Fix nostr connect signer not rejecting with Error
- Updated dependencies
  - applesauce-core@0.12.0

## 0.11.0

### Minor Changes

- e21a7b1: Switch Nostr Connect signer to use NIP-44 encryption by default
- 7ff73b8: Add `restore` method to `SerialPortSigner`
- e21a7b1: Remove dependency on `applesauce-net`

### Patch Changes

- 1c35f41: Add `require` support in node v22
- Updated dependencies
  - applesauce-core@0.11.0

## 0.10.0

### Minor Changes

- 81a6174: Add `ExtensionSigner` signer
- 82d68bb: Add `ReadonlySigner` signer

### Patch Changes

- 26264fc: Bump nostr-tools package
- Updated dependencies
  - applesauce-core@0.10.0
  - applesauce-net@0.10.0

## 0.9.0

### Minor Changes

- 493aee0: Bump `nostr-tools` to `2.10`
- 9e08fa3: Add `NostrConnectSigner.fromBunkerURI` method

### Patch Changes

- Updated dependencies
  - applesauce-core@0.9.0
  - applesauce-net@0.9.0

## 0.8.0

### Minor Changes

- 0dae7f5: Add nostr-connect signer

### Patch Changes

- Updated dependencies
  - applesauce-core@0.8.0
  - applesauce-net@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies
  - applesauce-core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies
  - applesauce-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies
  - applesauce-core@0.5.0
