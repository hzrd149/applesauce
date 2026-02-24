# applesauce-common

## 5.2.0

### Minor Changes

- fc83574: Add `user.blossomServesr$` to user cast

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
