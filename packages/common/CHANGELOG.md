# applesauce-common

## 7.0.0

### Minor Changes

- 422ce62: Add `isValidSeal`, a type guard that checks an event is a NIP-59 seal with a valid id and signature.
- b4e6267: Add `getAppHandlersFilter` and `getAppRecommendationsFilter` for requesting handlers and recommendations for an event kind from relays.
- 7145a4d: Add `metadata` and `metadata$` to the `AppHandler` cast, falling back to the author's profile when the handler has no metadata.
- 696b860: Add a NIP-C7 chat message factory for building kind 9 chat messages and their replies.
- 557a8c1: Support NIP-59 rumors as the parent of a NIP-22 comment.
- 560e193: Add NIP-7D forum thread support with a thread factory, cast, helpers, and a title operation.
- 9624cde: Add full NIP-5A nsite support
- bfe3267: The NIP-10 reference, reaction emoji, hashtag, and content warning helpers now accept unsigned rumors as well as signed events.
- b4e6267: Add `getHandlerPlatforms` and `AppHandler.platforms` for detecting which platforms a handler has its own link templates for.
- 217f559: Add `Napplet`, `RootNapplet`, `NamedNapplet` and `NappletSnapshot` casts
- 217f559: Add `NappletFactory` for creating, snapshotting and modifying napplet manifests.
- 217f559: Add NIP-5D napplet helpers for validating and reading napplet manifest events.
- 217f559: Add NIP-5D napplet operations under `Operations.Napplet`.
- 4fca9f0: Add NIP-34 issue support for creating labeled issues and reading their metadata and comments
- 4fca9f0: Add NIP-34 patch support for publishing series and revisions with reactive patch relationships
- 4fca9f0: Add NIP-34 pull request support with typed creation, author updates, and reactive commit and clone information
- 4fca9f0: Add reactive issue, pull request, and patch collections to `GitRepository`
- 4fca9f0: Add NIP-34 thread status support with per-kind factories and maintainer-authorized, revision-aware status tracking
- 4fca9f0: Add `User.gitRepositories$` for discovering repositories announced by a user
- 60c1860: Add NIP-39 kind 10011 external identities helpers, cast, operations, factory, and `User.identities$`.
- 41e7deb: Add NIP-85 event, address and identifier assertion kind constants with `TRUSTED_ASSERTION_TAGS` and `createProviderTag`.
- 4e391be: Add NIP-89 app handler casts, models, operations and factory
- 4e391be: Add NIP-89 app recommendation casts, models, operations and factory
- 4e391be: Add `getClientTag` helper for parsing NIP-89 client tags
- 7145a4d: Add `client` and `client$` to the `Note` cast for reading and resolving its NIP-89 `client` tag.
- 60c1860: Add a `hashtags` getter to the `Profile` cast for NIP-24 `t` tags.
- 60c1860: Add `pictureMetadata` and `bannerMetadata` getters to the `Profile` cast that read NIP-24 `imeta` tags.
- bfe3267: `setReactionParent` and `ReactionFactory` now accept a lightweight `{ id, pubkey, kind }` pointer or a rumor in addition to a full signed event.
- 7145a4d: Add `RecommendedAppHandlersModel`, which ranks the handlers recommended for an event kind and returns each with the pubkeys recommending it.
- c3aac8b: Add `getRelayDiscoveryGeohashes` helper and `RelayDiscovery.geohashes` getter that return every NIP-66 `g` tag
- c3aac8b: Add `getRelayDiscoveryTypes` helper and `RelayDiscovery.types` getter for NIP-66 `T` relay type tags
- b4e6267: Allow `removeRecommendedHandler` and `AppRecommendationFactory.removeHandler` to take `null` to remove only the entry without a platform.
- 1bf75c3: Expose all NIP-56 report targets and their relationships through report, user, and note casts.
- 1bf75c3: Add NIP-56 report factories and composable operations for user, event, and blob targets.
- bfe3267: Reading a malformed gift wrap seal now returns undefined instead of throwing or permanently caching the failure.
- 4ba058d: Include NIP-22 comments in `ThreadModel` threads, with a `comments: false` option to exclude them.
- e9e8cf7: Add `getTorrentCategoryPathParts`, `isTorrentInfoHash` and the `Torrent.categoryPathParts` getter.
- e9e8cf7: Add `TorrentFactory.modify` and builder methods for removing torrent files, trackers, search tags, external identifiers and categories.
- e9e8cf7: Require `isValidTorrent` and the `Torrent` cast to have a 40 character hex V1 info hash in the `x` tag.
- a33c747: Expose reactive trusted provider selection by assertion kind and metric tag.
- 41e7deb: Add `TrustedProviderListFactory` and `TrustedProviders` operations for editing NIP-85 kind 10040 provider lists.
- b4e6267: Add `user.appHandlers$` and `user.appRecommendations$` for a user's published handlers and their recommendations across every kind.
- 217f559: Add `napplets$` and `napplet$` getters to the `User` cast.
- 4703c55: Add `UserStatus` cast with `status$` and `statuses$` on the `User` cast
- 4703c55: Add `UserStatusFactory` for building NIP-38 user status events
- 4703c55: Add `isValidUserStatus`, `getUserStatusType`, and `isUserStatusCleared` NIP-38 helpers
- 4703c55: Add `setStatusType`, `setStatusLink`, and `clearStatusLink` user status operations

### Patch Changes

- 823aae6: Cache `getHandlerSupportedKinds` results to avoid reparsing handler tags on repeated reads.
- a964d5a: Cache the muted words RegExp in `matchMutes` instead of rebuilding it for every event
- d680d58: Preserve valid falsy JSON values when parsing application data.
- 7145a4d: Stop the common `setClient` operation from adding a `client` tag to NIP-17 private messages by re-exporting the core implementation.
- 0028a38: Avoid reparsing web URLs when parsing external identifiers
- 0028a38: Avoid native URL parsing when extracting file hashes from ordinary URLs
- e6a8cb2: Move the gift wrap, seal, and rumor symbols into `applesauce-core` and re-export them from `applesauce-common`.
- 82fe273: Preserve complete normalized relay endpoints when group pointers round-trip through compatibility strings.
- 0028a38: Avoid reparsing relay URLs in group pointer conversions
- b4e6267: Accept unsigned drafts in the handler link helpers, since they only read tags.
- 7145a4d: Ignore non-numeric `k` tags in `getHandlerSupportedKinds`.
- bfe3267: The hidden-content unlock guards now report unlocked only after the hidden values are decrypted, so the matching unlock helpers no longer resolve undefined.
- 8cec242: Add the recipient `p` tag to messages created by `LegacyMessageFactory`.
- 03a7a87: Add a 10 second timeout to `getInvoice` LNURL callback requests
- 19031ac: `lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking.
- d3472bb: Refresh cached muted-word matching when words are replaced without changing the set size, following review of [#100](https://github.com/hzrd149/applesauce/pull/100) by [@mptfire](https://github.com/mptfire).
- 0028a38: Use string URL serialization in event operations
- 1bf75c3: Fix NIP-56 report parsing to validate target identities and preserve blob report reasons.
- ae1a4aa: Reject gift-wrap rumors whose id does not match their contents.
- e9e8cf7: Fix `setTorrentCategory` and `setTorrentCategoryPath` overwriting unrelated `i` tags such as external identifiers.
- e9e8cf7: Keep the size of zero-byte files when adding torrent file tags.
- 4703c55: Make `UserStatusModel` and `UserStatusesModel` ignore cleared statuses
- 4703c55: Fix `UserStatusModel` returning `null` for statuses without a link
- 422ce62: Gift wrap seals are now signature verified before they are trusted, so a seal with an invalid signature is no longer accepted as proof of authorship.
- Updated dependencies
  - applesauce-core@7.0.0

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
