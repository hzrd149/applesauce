# applesauce-actions

## 4.0.0

### Minor Changes

- f8fd5ec: Bump `nostr-tools` to `2.17`
- d802905: Add actions for NIP-78 app data events

### Patch Changes

- Updated dependencies
  - applesauce-core@4.0.0
  - applesauce-factory@4.0.0

## 3.1.0

### Minor Changes

- 3ede999: Bump `nostr-tools` to `2.15`

### Patch Changes

- Updated dependencies
  - applesauce-core@3.1.0
  - applesauce-factory@3.1.0

## 3.0.0

### Minor Changes

- b681e97: Allow article kinds to be added and removed from pin list
- f137e71: Add NIP-52 calendar actions

### Patch Changes

- Updated dependencies
  - applesauce-core@3.0.0
  - applesauce-factory@3.0.0

## 2.3.0

### Minor Changes

- 5e38452: Update contacts actions not to throw when event missing
- 5e38452: Update blossom actions not to throw when event is missing
- 5e38452: Update mailbox actions to not throw when event missing

### Patch Changes

- 5e38452: Fix bookmark actions using wrong kind
- bb9fe08: Fix `SendWrappedMessage` action not creating gift wrap for user when a single recipient is provided
- Updated dependencies
  - applesauce-factory@2.3.0
  - applesauce-core@2.3.0

## 2.1.0

### Patch Changes

- c58facb: Fix `UnbookmarkEvent` action requiring bookmark set identifier
- Updated dependencies
  - applesauce-core@2.1.0

## 2.0.0

### Minor Changes

- 324b960: Bump `nostr-tools` to 2.13

### Patch Changes

- Updated dependencies
  - applesauce-core@2.0.0
  - applesauce-factory@2.0.0

## 1.1.0

### Minor Changes

- b7ff4f6: Add `SetListMetadata` action

### Patch Changes

- Updated dependencies
  - applesauce-factory@1.1.0

## 1.0.0

### Minor Changes

- 1624ca1: Add search relays actions
- 1624ca1: Add dm relays actions
- 0bf55cb: Add mailbox actions
- 3de9928: Support multiple pubkeys in follow set actions
- 3de9928: Add `CreateFollowSet` and `UpdateFollowSetInformation` actions
- 4e0943d: Add mute list actions
- 1624ca1: Add relay sets actions
- 1624ca1: Add blocked relays actions
- d8dc5c2: Only provide sync event store methods to actions
- 1624ca1: Add favorite relays actions
- 61ac09a: Add blossom server list actions

### Patch Changes

- Updated dependencies
  - applesauce-core@1.0.0
  - applesauce-factory@1.0.0

## 0.12.0

### Minor Changes

- 685b2ae: Add `AddUserToFollowSet` and `RemoveUserFromFollowSet` actions
- 37fdfd8: Add profile actions
- 75d7254: Add contact list actions
- bb6f775: Add NIP-51 pins actions
- bb6f775: Add NIP-51 bookmark actions

### Patch Changes

- Updated dependencies
  - applesauce-core@0.12.0
  - applesauce-factory@0.12.0
