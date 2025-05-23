# applesauce-core

## 2.0.0

### Major Changes

- 856d6f9: Update `EventStore.update` to return `boolean` if event was updated
- 324b960: Removed `getPointerFromTag` method
- 856d6f9: Return `null` from `EventStore.add` when event is ignored by `verifyEvent`

### Minor Changes

- 225f619: Added `groupMessageEvents` helper
- e0e455a: Add `getReactionEventPointer` and `getReactionAddressPointer` helper methods
- e0e455a: Add `getSharedEventPointer` and `getSharedAddressPointer` helper
- 9b165a0: Add `ensureWebSocketURL` helper
- 0b74762: Support NIP-89 handler information in `getProfileContent`
- abaa340: Add report event helpers
- 324b960: Bump `nostr-tools` to 2.13
- e0e455a: Renamed `parseSharedEvent` to `getEmbededSharedEvent`
- e0e455a: Add `addRelayHintsToPointer` helper
- 85090f7: Allow `getDisplayName` to take kind 0 profile event and use NIP-19 npub as fallback
- 0b74762: Add NIP-89 application handler helpers
- a1919cd: Add `mapEventsToTimeline` operator
- d52d39a: Add `mapEventsToStore` operator
- 7c221e2: Add `getProfilePicture` helper method
- e0e455a: Add `getReactionEmoji` helper

### Patch Changes

- 0213ce5: Fix `GroupPointer.relay` missing protocol
- 8c789b2: Fix hashtags regexp matching hash in URL if it came after a `/`
- d505c5f: Use `\b` in token RegExp instead of `\s`
- 60e7ec8: Fix `CommentsQuery` not returning comments for newer versions of replaceable events

## 1.2.0

### Minor Changes

- ed6ad27: Add `mergeBlossomServers` method

### Patch Changes

- 7506bf7: Remove leading and trailing whitespace on display names

## 1.0.0

### Major Changes

- e4d9453: Convert queries to simple methods instead of `key`, and `run` fields

### Minor Changes

- 8aa3aea: Add `matchMutes` and `createMutedWordsRegExp` methods
- cb96f33: Add `mergeContacts` method
- 1624ca1: Add `getRelaysFromList` method
- 1624ca1: Add `FavoriteRelays`, `FavoriteRelaySets`, `SearchRelays`, and `BlockedRelays` queries
- cb96f33: Add `mergeBookmarks` method
- e548779: Add `type` field to comment pointers
- 1624ca1: Add `hidden` flag to common list helpers
- cb96f33: Add `QueryStore.contacts` and `QueryStore.mutes` methods
- cb96f33: Add `getContacts`, `getPublicContacts` and `getHiddenContacts` methods
- cb96f33: Add `mergeMutes` method
- cb96f33: Add `mergeEventPointers`, `mergeAddressPointers`, and `mergeProfilePointers` NIP-19 methods

### Patch Changes

- d8dc5c2: Break IEventStore interface into two parts

## 0.12.1

### Patch Changes

- a3b9585: Fix EventStore.inserts emitting when old replaceable events where added to the store

## 0.12.0

### Minor Changes

- 6882991: Add generic interface for `EventStore`
- e176601: Update `unlockHiddenTags` to return tags array
- 06263df: Rename `Database.getForFilters` to `Database.getEventsForFilters`
- 91621b5: Add gift-wrap helper methods
- 3780d5e: Add `setEventContentEncryptionMethod` method
- 91621b5: Add direct message helper methods
- 06263df: Add `blossomServers` method to the `QueryStore`
- 91621b5: Add hidden content helper methods
- 0c6251d: Tag events that are added to an `EventStore` with `EventStoreSymbol` symbol
- f92f10c: Add `normalizeToPubkey` and `normalizeToSecretKey` NIP-19 helpers
- 06263df: Add `EventStore.getTimeline` method

### Patch Changes

- 5e95ed5: Fix bug with EventStore.getAll not handling single filter

## 0.11.0

### Minor Changes

- 39ec450: Support multiple tag operations in `modifyEventTags`
- 34e8f80: Add `getSha256FromURL` helper
- 125d24f: Add `getReplaceableIdentifier` helper
- b4d3ac9: Add `processTags` helper
- 04902fd: Move applesauce-list helpers into core
- 39f5f06: Add `parseSharedEvent` helper
- c732ea0: Add `getPicturePostAttachments` helper
- 9d59a56: Add `verifyEvent` method to `EventStore`
- 5923047: Add `UserStatusQuery` and `UserStatusesQuery` queries
- 5923047: Add `getUserStatusPointer` helper
- 04902fd: Removed `modifyEventTags` method
- a05aa94: Add `decodeGroupPointer` and `encodeGroupPointer` helpers
- 9092aa8: Add `getDisplayName` helper and mark profiles `displayName` as deprecated
- 4dbb248: Change return type of `eventStore.events`, `eventStore.replaceableSet`, `MultipleEventsQuery`, and `ReplaceableSetQuery` from `Map` to a plain object
- 6aeb923: Add `parseNIP05Address` helper
- 96d318d: Add `mergeRelaySets` helper
- 46fac64: Add handle `fallback` and `thumb` when parsing `imeta` tags
- d22769e: Add `getBlossomServersFromList` helper method

### Patch Changes

- 1c35f41: Add `require` support in node v22

## 0.10.0

### Minor Changes

- 5882997: Add `getContentWarning` helper
- 304c912: Add support for keeping old versions of replaceable events
- 5882997: Add `getZapSplits` helper
- f5be45d: Add helpers for hidden tags
- 494e934: Add media attachment helpers
- 1a4176e: Remove `createDeleteEvent`
- 304c912: Remove `stringifyFilter` helper method
- 88841a4: Add `RepliesQuery` query
- 83d7c48: Change `queryStore.runQuery` to `createQuery` and to accept query arguments as rest arguments instead of returning new method
- 494e934: Add `CommentsQuery` query for NIP-22 comments
- 8a9beea: Add support for delete events
- 88841a4: Add `isEvent` method
- 375d3da: Add `replaceableSet` method to event store
- 7671525: Add `getPointerForEvent` method
- ad0cb76: Add NIP-22 comment helpers
- 32a94cd: Add `getPackName` and `getEmojis` for NIP-30 emoji packs

### Patch Changes

- 26264fc: Bump nostr-tools package
- 93acc43: Use Reflect.has instead of Object.hasOwn
- e99383c: Fix `matchFilter` method treating indexable tag filters as AND

## 0.9.0

### Minor Changes

- a14dbd9: Add `isValidZap` method
- 493aee0: Bump nostr-tools to 2.10
- a14dbd9: Add `isValidProfile` method
- 892cd33: Remove nrelay encoding
- 149625d: Add zap helpers and queries

### Patch Changes

- 81015c4: Fix getZapAddressPointer returning EventPointer

## 0.8.0

### Minor Changes

- 08d2abe: Add `shareLatestValue` observable operator for caching queries
- 0dae7f5: Replace zen-observable with rxjs

### Patch Changes

- 08d2abe: Fix hashtag regexp capturing whitespace before

## 0.7.0

### Minor Changes

- 7673403: Add `size` to database
- d11fbe8: export `LRU` helper class
- b96717c: Add `getValue` observable helper

## 0.6.0

### Minor Changes

- df7756c: Move mute helpers and queries to applesauce-lists
- 64c99e7: Add "events" query to event store
- df7756c: Add update method to event store
- df7756c: Add tag helpers

## 0.5.0

### Minor Changes

- b39a005: Move NIP-28 channel helpers to applesauce-channel package
- ebc5da7: Add promise helpers

## 0.4.0

### Minor Changes

- ec52c90: Add pointer helpers
- ec52c90: Add tag helpers
- ec52c90: Add thread queries and helpers

## 0.3.0

### Minor Changes

- 5cf2091: Add mute list helpers and queries
- 5cf2091: Add NIP-28 channel helpers and queries

## 0.2.0

### Minor Changes

- 220c22d: Handle replaceable and removed events in timelines

### Patch Changes

- 220c22d: Fix bug with timeline using same array
