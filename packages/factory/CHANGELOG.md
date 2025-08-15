# applesauce-factory

## 3.0.0

### Major Changes

- a9838cf: Reorganize exports and rename event operations

### Minor Changes

- f137e71: Add NIP-52 calendar event operations
- 751e42d: Add operations and blueprints for NIP-84 highlights
- 49b9c30: Add NIP-53 stream operations and blueprints
- b681e97: Rename `removeCoordinateTag` to `removeAddressTag` and deprecate old export
- b681e97: Rename `addCoordinateTag` to `addAddressTag` and deprecate old export
- a19cda1: Add event operations for NIP-88 polls

### Patch Changes

- af4442b: Fix `pipeFromAsyncArray` not correctly preserving Symbols
- Updated dependencies
  - applesauce-core@3.0.0
  - applesauce-content@3.0.0

## 2.3.0

### Patch Changes

- bb9fe08: Fix wrapped message blueprint including "p" tags when pubkey is mentioned in the content
- Updated dependencies
  - applesauce-core@2.3.0
  - applesauce-content@2.3.0

## 2.0.0

### Major Changes

- 58d9c24: Replace `createMetaTagOperations` with `setMetaTags` event operation
- 58d9c24: Replace `createZapSplitOperations` with `setZapSplit` event operation
- 58d9c24: Replace `createTextContentOperations` with `setShortTextContent` event operation
- de32a5c: Remove static `EventFactory.runProcess` method and replace it with `build` and `modify` methods

### Minor Changes

- de32a5c: Add `blueprint` helper to simplify creating custom blueprints
- 62488e0: Add NIP-10 `expiration` option to common blueprints
- 9b165a0: Update `includeGroupHTag` event operation to include relay hint
- 471d3c7: Add `toRumor`, `sealRumor`, `wrapSeal`, and `giftWrap` event operations for NIP-59 gift wraps
- 4804784: Add NIP-17 wrapped messages blueprints and operations
- de32a5c: Move core `EventFactory` logic out into `build` and `modify` methods to allow it to be used without and instance
- 4804784: Add legacy NIP-04 message blueprints and operations
- 324b960: Bump `nostr-tools` to 2.13
- 62488e0: Add `splits` option to `ShareBlueprint`
- 471d3c7: Add `GiftWrapBlueprint`
- 62488e0: Add `setProtected` event operation
- 62488e0: Add NIP-70 `protected` option to common blueprints
- 62488e0: Add NIP-40 `setExpirationTimestamp` event operation
- 9b165a0: Add `createGroupHTagFromGroupPointer` helper

### Patch Changes

- Updated dependencies
  - applesauce-core@2.0.0
  - applesauce-content@2.0.0

## 1.2.0

### Patch Changes

- b611352: Only match NIP-19 mentions surrounded by whitespace
- Updated dependencies
  - applesauce-core@1.2.0
  - applesauce-content@1.2.0

## 1.1.0

### Minor Changes

- b7ff4f6: Add `removeSingletonTag` tag operation

### Patch Changes

- b7ff4f6: Fix `setListTitle`, `setListImage`, and `setListDescription` not removing tags

## 1.0.0

### Patch Changes

- Updated dependencies
  - applesauce-core@1.0.0
  - applesauce-content@1.0.0

## 0.12.2

### Patch Changes

- e4c6632: Fix `EventFactory.modify` copying symbols to new draft event

## 0.12.1

### Patch Changes

- 925bf01: Fix `addOutboxRelay` and `addInboxRelay` operations adding both inbox and outbox relays

## 0.12.0

### Minor Changes

- 685b2ae: Add `FollowSetBlueprint`
- dcda34e: Preserve unencrypted hidden content when building and signing an event
- 75d7254: Add `EventFactory.sign` method for signing events

### Patch Changes

- bf53581: Add a few more tests
- 4aba6cc: Allow undefined in `modifyPublicTags` and `modifyHiddenTags`
- Updated dependencies
  - applesauce-core@0.12.0
  - applesauce-content@0.12.0

## 0.11.0

### Minor Changes

- c732ea0: Add `createImetaTagForAttachment` helper
- c732ea0: Add `createFileMetadataTags` helper
- b267074: Rename `getRelayHint` to `getEventRelayHint` in `EventFactory`
- 041bacc: Add `includeHashtags` operation
- a05aa94: Add `includeGroupHTag` and `includeGroupPreviousTags` operations
- a05aa94: Add `GroupMessageBlueprint` blueprint
- 04902fd: Add `EventFactory.modify` and `EventFactory.modifyTags` methods
- d22769e: Add `addBlossomServerTag` and `removeBlossomServerTag` tag operations
- 0d11de0: Add mailbox tag operations
- c732ea0: Add `includeFileMetadataTags` operation
- c732ea0: Add `PicturePostBlueprint` blueprint
- a05aa94: Add `createGroupTagFromGroupPointer` helper
- b267074: Add replace option to common tag operations
- c732ea0: Add `FileMetadataBlueprint` blueprint

### Patch Changes

- 1d0bba9: Fix replaceable loader mixing parameterized replaceable and replaceable pointers
- 1d0bba9: Fix `includeContentHashtags` only including last hashtag
- 1c35f41: Add `require` support in node v22
- Updated dependencies
  - applesauce-core@0.11.0
  - applesauce-content@0.11.0

## 0.10.0

### Minor Changes

- 494e934: Add `includeClientTag` operation
- 5882997: Add `setContentWarning` operation
- 5882997: Add `includeLiveStreamTag` operation
- 66bdb7b: Add `includeEmojiTags` operation
- 5882997: Add `setZapSplit` operation
- 494e934: Add `includeSingletonTag` operation
- af489be: Add `ShareBlueprint`
- 682e602: Add `repairContentNostrLinks` operation
- 5882997: Add `LiveChatMessageBlueprint` blueprint
- 494e934: Add `includeContentHashtags` operation
- 682e602: Add `tagPubkeyMentionedInContent` operation

### Patch Changes

- Updated dependencies
  - applesauce-core@0.10.0
  - applesauce-content@0.10.0
