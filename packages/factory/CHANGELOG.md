# applesauce-factory

## 0.11.1

### Patch Changes

- bf53581: Add a few more tests

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
