# applesauce-common

## 6.3.0

### Minor Changes

- 422ce62: Add `isValidSeal`, a type guard that checks an event is a NIP-59 seal with a valid id and signature.
- 696b860: Add a NIP-C7 chat message factory for building kind 9 chat messages and their replies.
- 557a8c1: Support NIP-59 rumors as the parent of a NIP-22 comment.
- 560e193: Add NIP-7D forum thread support with a thread factory, cast, helpers, and a title operation.
- bfe3267: The NIP-10 reference, reaction emoji, hashtag, and content warning helpers now accept unsigned rumors as well as signed events.
- bfe3267: `setReactionParent` and `ReactionFactory` now accept a lightweight `{ id, pubkey, kind }` pointer or a rumor in addition to a full signed event.
- bfe3267: Reading a malformed gift wrap seal now returns undefined instead of throwing or permanently caching the failure.

### Patch Changes

- e6a8cb2: Move the gift wrap, seal, and rumor symbols into `applesauce-core` and re-export them from `applesauce-common`.
- bfe3267: The hidden content `is...Unlocked` guards now only report unlocked once the hidden values have actually been decrypted, so the matching `unlock...` helpers no longer resolve undefined.
- 19031ac: `lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking.
- 422ce62: Gift wrap seals are now signature verified before they are trusted, so a seal with an invalid signature is no longer accepted as proof of authorship.
- Updated dependencies
  - applesauce-core@6.3.0

## 6.2.0

### Minor Changes

- 277c355: Add support for generic blockchain address and tx external pointers
- 277c355: Add support for ISO country external pointers

### Patch Changes

- 0160979: Add helpers and a factory for creating and validating Nostr Web Tokens.
- e2c7799: Upgrade Noble and Scure crypto dependencies to their latest major versions.
- Updated dependencies
  - applesauce-core@6.2.0

## 6.1.0

### Minor Changes

- d493ec2: Add `upstream$`, `followers$` and `reactions$` to `GitRepository` cast
- ae34093: Add support for NIP-51 kind 10086 lookup relay lists
- 30601a1: Add `User.favoriteGitRepos$` property
- 30601a1: Add NIP-34 `GitRepositoryFactory`, `GitGraspListFactory`, and `FavoriteGitReposFactory` factories
- 30601a1: Add NIP-34 `GitRepository`, `GitGraspList`, and `FavoriteGitRepos` casts
- 30601a1: Add `User.gitAuthors$` property
- 30601a1: Add `User.graspServers$` property to get users NIP-34 grasp servers

### Patch Changes

- d493ec2: Fix `getGitRepositoryMaintainers` returning invalid pubkeys
- d493ec2: Rename `Reaction.pointer` to `Reaction.reactedPointer`
- d493ec2: Fix `getGitRepositoryMaintainers` not including repo event author
- 5549e74: Fix some factories missing text content options
- Updated dependencies
  - applesauce-core@6.1.0

## 6.0.2

### Patch Changes

- 85274e5: Fix sparse event pointer matching and direct note reply filtering

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
