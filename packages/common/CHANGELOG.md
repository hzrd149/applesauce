# applesauce-common

## 6.0.1

### Patch Changes

- 4a00f90: Fix `NoteFactory.create()` not accepting options

## 6.0.0

### Minor Changes

- 7610a4f: Add NIP-58 badge helper getters and casts.
- 04f7b9e: Add helpers for parsing BUD-10 blossom URIs
- 23542dc: Add `CodeSnippetFactory` and code snippet operations for NIP-C0 (kind 1337)
- 6fd5545: Add missing factory methods, fix bugs in reply factories, and add `LiveStreamFactory`, `CalendarEventRSVPFactory`, and `PicturePostFactory`
- 2fa73ca: Add `StreamChatMessageFactory`, `GroupThreadFactory`, `DateBasedCalendarEventFactory`, `TimeBasedCalendarEventFactory` factory classes; add `group()` and `meta()` methods to `CommentFactory`; export `GROUP_THREAD_KIND` from helpers
- ef96ec4: Add operations and factories for NIP-58 badges
- 23542dc: Add `NIP51RelayListFactory`, `NIP51UserListFactory`, and `NIP51ItemListFactory` base classes for NIP-51 list factories, and update specific list factories to extend them.
- 0d02fcb: Add `ZapRequestFactory` and `ZapFactory` factories
- 75fa9dd: Add helpers and casts for NIP-30 emoji packs and favorites

### Patch Changes

- c9c0aba: Fix stale symbol caches leaking between EventFactory chain steps
- bbd41e7: Normalize `blossomServers` string inputs by adding `https://` when missing
- a3153e4: Move `castEvent`, `castPubkey`, `EventCast`, `PubkeyCast`, `User`, `castUser`, and `ChainableObservable` to `applesauce-core/casts`; `applesauce-common` re-exports all of them and augments `User` with Nostr-specific observable getters via prototype
- Updated dependencies
  - applesauce-core@6.0.0

## 5.2.0

### Minor Changes

- fc83574: Add `user.blossomServesr$` to user cast
- b75703f: Add support for address field in `emoji` tag

### Patch Changes

- be2c857: Add support for `EventPointer` and `AddressPointer` in `RepliesModel`
- Updated dependencies
  - applesauce-core@5.2.0

## 5.1.0

### Minor Changes

- 3065c27: Add `CodeSnippet` cast for NIP-C0 code snippets
- d649153: Add support for NIP-75 zap goals

### Patch Changes

- 86a49ce: Fix `User` chainable observables not synchronously emitting values
- Updated dependencies
  - applesauce-core@5.1.0

## 5.0.0

### Major Changes

- 6431c21: Remove "hashtags" and "urls" from bookmark lists and sets
- b5519f5: Update `getListTags` to only read public tags by default

### Minor Changes

- 1d24f17: Add NIP-29 group management helpers and blueprints
- aa40cf6: Add cast system with `User`, `Note`, `Profile`, `Zap`, and `Comment` for casting events to classes
- eb68078: Bump `nostr-tools` to `2.19`
- d788f94: Remove dependency on nostr-tools

### Patch Changes

- Updated dependencies
  - applesauce-core@5.0.0
