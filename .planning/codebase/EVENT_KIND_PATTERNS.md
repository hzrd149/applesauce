<!-- refreshed: 2026-07-08 -->
# Event Kind Patterns

**Analysis Date:** 2026-07-08

## Purpose

This document maps the recurring layers built around Nostr event kinds in Applesauce and the boundaries between those layers. The important pattern is that most pieces remain small and functional: helpers parse, operations transform drafts, factories compose operations, models query the store, casts expose typed read surfaces, and actions orchestrate user workflows.

## Public Surface Pattern

`packages/core/src/index.ts` exports generic primitives directly and then exposes the major namespaces as `Helpers`, `Models`, `Operations`, and `Factories`. This makes core the package for reusable event mechanics rather than NIP-specific behavior.

`packages/common/src/index.ts` exports the same namespaces plus `Observable` and `Casts`, then imports `./models/__register__.js` for side-effect model registration. This makes common the package for NIP-specific event-kind behavior layered over core.

| Package | Role | Public entry |
|---------|------|--------------|
| `applesauce-core` | Generic event-store, helper, operation, factory, model, and cast infrastructure | `packages/core/src/index.ts` |
| `applesauce-common` | NIP/event-kind-specific helpers, casts, models, operations, factories, and observable helpers | `packages/common/src/index.ts` |
| `applesauce-actions` | User workflows that read store state, sign events, and publish | `packages/actions/src/index.ts` |

## Layer Responsibilities

| Layer | Primary responsibility | Should avoid | Examples |
|-------|------------------------|--------------|----------|
| Helpers | Parse events/tags, validate kind-specific structure, construct pointers/tags, cache derived values on events | Signing, publishing, store orchestration, UI state | `packages/common/src/helpers/comment.ts`, `packages/common/src/helpers/zap.ts`, `packages/common/src/helpers/bookmark.ts` |
| Operations | Return `EventOperation`s that immutably transform event drafts or tags | Creating full workflow decisions, publishing, reading relays | `packages/common/src/operations/comment.ts`, `packages/common/src/operations/zap.ts`, `packages/core/src/operations/tags.ts` |
| Factories | Provide fluent builders around operations for create/modify flows | Parsing existing event relationships except through helpers/operations | `packages/common/src/factories/note.ts`, `packages/common/src/factories/reaction.ts`, `packages/common/src/factories/bookmark-list.ts` |
| Models | Convert event-store state into reactive `Observable` queries | Signing, network publishing, direct tag mutation | `packages/common/src/models/comments.ts`, `packages/common/src/models/reactions.ts`, `packages/common/src/models/zaps.ts` |
| Casts | Wrap one event/pubkey with typed getters and store-backed observable relationships | Mutating events, signing, publishing | `packages/common/src/casts/note.ts`, `packages/common/src/casts/comment.ts`, `packages/common/src/casts/zap.ts` |
| Actions | Orchestrate app-level workflows using signer, current user, event store, factories, and publish method | Low-level tag parsing or reusable operation logic | `packages/actions/src/actions/comment.ts`, `packages/actions/src/actions/bookmarks.ts`, `packages/actions/src/actions/contacts.ts` |

## Core Functional Kernel

The main functional kernel is `EventOperation` plus `TagOperation` composition.

- `packages/core/src/factories/event.ts` defines `EventFactory`, a promise-like builder that chains `EventOperation`s and returns new factory instances from `chain()`.
- `blankEventTemplate(kind)` creates minimal drafts and automatically adds a random `d` tag for addressable kinds.
- `toEventTemplate(event)` converts signed events back into editable drafts for modify flows.
- `packages/core/src/operations/tags.ts` exposes `modifyPublicTags`, `modifyHiddenTags`, and `modifyTags` as immutable draft transformations.
- `EventFactory.modifyPublicTags()` and `EventFactory.modifyHiddenTags()` keep tag mutation behind operations instead of allowing direct mutation by factory consumers.

Example boundary:

```ts
export function setPreimage(preimage: string): EventOperation {
  return includeSingletonTag(["preimage", preimage], true);
}
```

`packages/common/src/operations/zap.ts` does not sign or publish. It only returns a transformation that `ZapFactory` can compose.

## Helpers Pattern

Helpers are the lowest event-kind-specific layer. They usually define:

- A kind constant or `KnownEvent` alias when `nostr-tools` does not already provide a named kind.
- Type guards like `isValidComment`, `isValidZap`, `isValidBookmarkList`.
- Pointer extractors like `getCommentRootPointer`, `getReactionEventPointer`, `getZapEventPointer`.
- Tag constructors like `createCommentTagsFromCommentPointer`.
- Cache symbols used with `getOrComputeCachedValue` to avoid reparsing the same event.
- Hidden/unlocked parsing helpers when an event kind has encrypted hidden tags.

Representative files:

- `packages/common/src/helpers/comment.ts` owns NIP-22 pointer parsing and validation for kind `1111` comments.
- `packages/common/src/helpers/zap.ts` owns zap request extraction, bolt11 parsing, sender/recipient derivation, and zap validation.
- `packages/common/src/helpers/bookmark.ts` owns public and hidden bookmark parsing and hidden unlock notification.
- `packages/common/src/helpers/reaction.ts` owns reaction target pointer extraction from `e`, `a`, `p`, and `k` tags.

Not every event kind gets a helper file. There is no `packages/common/src/helpers/note.ts`; kind 1 notes use generic core helpers plus `packages/common/src/helpers/threading.ts` where the real reusable parsing lives.

## Operations Pattern

Operations are reusable mutations expressed as pure-ish functions returning `EventOperation`. They are the main boundary that keeps tag construction separate from factory API design.

Common shapes:

- Direct content update: `setReaction()` in `packages/common/src/operations/reaction.ts` returns a draft with a new `content` value.
- Public tag update: `setRequest()` in `packages/common/src/operations/zap.ts` uses `modifyPublicTags(tagPipe(...))`.
- Pointer tag update: `setParent()` in `packages/common/src/operations/comment.ts` delegates tag creation to helpers.
- Thread tag update: `setThreadParent()` in `packages/common/src/operations/note.ts` computes root/reply tags without publishing.

The preferred modern style is visible in `packages/common/src/operations/zap.ts` and `packages/common/src/operations/list.ts`: build tag-level operations, pass them through `modifyPublicTags`, and return a new draft. `packages/common/src/operations/reaction.ts` contains a TODO noting some older code still manually clones `draft.tags`; that is a recognized refactor target.

## Factories Pattern

Factories make operations ergonomic for consumers while keeping the implementation composable.

Common shapes:

- `static create(...)` starts from `blankEventTemplate(kind)`.
- `static modify(event)` starts from `toEventTemplate(event)` for replaceable/list events.
- Instance methods call `this.chain(operation)` or `this.modifyPublicTags(tagOperation)`.
- Factories may apply multiple operations with `pipeFromAsyncArray` when one fluent method needs several transformations.
- Factories sign only at the end through inherited `.sign(signer)` or `.as(signer)`.

Examples:

- `NoteFactory.create()` and `NoteFactory.reply()` in `packages/common/src/factories/note.ts` compose text, metadata, NIP-10 tags, mentions, hashtags, and zap splits.
- `ReactionFactory.create()` in `packages/common/src/factories/reaction.ts` composes parent tags and reaction content.
- `CommentFactory.create()` in `packages/common/src/factories/comment.ts` composes NIP-22 parent tags and text content.
- `BookmarkListFactory.modify()` in `packages/common/src/factories/bookmark-list.ts` uses `toEventTemplate(event)` and exposes public/hidden bookmark updates through tag operations.

Factories do not choose relay routes, load missing user state, or decide whether an existing event should be created or modified. Those decisions belong to actions or app code.

## Casts Pattern

Casts are typed read façades. They validate the event in the constructor, expose synchronous getters backed by helpers, and expose reactive relationships through the store.

Common shapes:

- Constructor guard: `if (!isValidZap(event)) throw new Error("Invalid zap")`.
- Synchronous helper-backed getters: `Zap.amount`, `Comment.rootPointer`, `Reaction.reactedPointer`.
- Store-backed observables wrapped in `this.$$ref()` to memoize relationship streams per cast instance.
- Relationship streams cast related events with `castTimelineStream()` or direct `store.event()`/`store.replaceable()` calls.

Examples:

- `packages/common/src/casts/note.ts` exposes thread references, replies, comments, zaps, shares, and reactions.
- `packages/common/src/casts/comment.ts` exposes root/parent relationships plus replies, zaps, and reactions.
- `packages/common/src/casts/zap.ts` exposes sender/recipient users, parsed payment data, and zapped event lookup.
- `packages/common/src/casts/bookmarks.ts` exposes public and hidden bookmark pointers plus note/article relationship streams.

Casts do not mutate their source events except for explicit unlock-style helper paths such as hidden bookmark unlocking, where the helper also calls `notifyEventUpdate()` so the event store can react.

## Models Pattern

Models are reactive store queries. They accept explicit parameters, return `Model<T>`, and let `EventStore` own subscription/caching behavior.

Core model primitives in `packages/core/src/models/base.ts` include:

- `EventModel(pointer)` for one event.
- `ReplaceableModel(pointer)` for the latest replaceable event.
- `TimelineModel(filters)` for sorted arrays.
- `FiltersModel(filters)` for streams.

Common models compose those primitives around event-kind relations:

- `ReactionsModel(event)` in `packages/common/src/models/reactions.ts` uses `buildCommonEventRelationFilters({ kinds: [kinds.Reaction] }, event)`.
- `CommentsModel(parent)` in `packages/common/src/models/comments.ts` supports full events and lightweight `CommentPointer`s.
- `EventZapsModel(pointer)` in `packages/common/src/models/zaps.ts` filters timeline results through `isValidZap`.

Some common models register convenience methods on `EventModels.prototype` and augment `applesauce-core/event-store` types. `packages/common/src/models/__register__.ts` imports only selected modules for side-effect registration.

## Actions Pattern

Actions are the workflow layer. They receive an `ActionContext` from `ActionRunner` containing store, signer, current user cast, publish function, and helper `run`/`sign` methods.

Typical action flow:

- Read current user state from casts/models, usually with bounded `$first()` timeouts.
- Decide create vs modify for replaceable events.
- Use a factory to produce and sign the event.
- Choose relay targets from user outboxes or related users' inboxes.
- Publish through the runner.

Examples:

- `CreateComment()` in `packages/actions/src/actions/comment.ts` reads parent author inboxes and current user outboxes, creates a `CommentFactory`, signs it, and publishes to merged relays.
- `FollowUser()` in `packages/actions/src/actions/contacts.ts` loads or creates a contacts factory, modifies contacts, signs, and publishes to outboxes.
- `BookmarkEvent()` in `packages/actions/src/actions/bookmarks.ts` chooses bookmark list vs bookmark set, modifies public or hidden tags through the factory, signs, and publishes.
- `UpdateProfile()` in `packages/actions/src/actions/profile.ts` loads the current profile and outboxes, modifies the core `ProfileFactory`, signs, and publishes.

Actions intentionally do not expose low-level tag operations. They are app-level convenience workflows over factories and casts.

## Event-Kind Layering Examples

| Feature | Helpers | Operations | Factories | Casts | Models | Actions |
|---------|---------|------------|-----------|-------|--------|---------|
| Kind 1 note | Threading helpers in `packages/common/src/helpers/threading.ts` | `packages/common/src/operations/note.ts` | `packages/common/src/factories/note.ts` | `packages/common/src/casts/note.ts` | `RepliesModel`, `ReactionsModel`, `CommentsModel`, `EventZapsModel` | No publish-note action; apps use factory directly |
| Kind 7 reaction | `packages/common/src/helpers/reaction.ts`, emoji helper | `packages/common/src/operations/reaction.ts` | `packages/common/src/factories/reaction.ts` | `packages/common/src/casts/reaction.ts` | `packages/common/src/models/reactions.ts` | No reaction action; apps use factory directly |
| Kind 1111 comment | `packages/common/src/helpers/comment.ts` | `packages/common/src/operations/comment.ts` | `packages/common/src/factories/comment.ts` | `packages/common/src/casts/comment.ts` | `packages/common/src/models/comments.ts` | `packages/actions/src/actions/comment.ts` |
| Kind 9735 zap receipt | `packages/common/src/helpers/zap.ts` | `packages/common/src/operations/zap.ts` | `packages/common/src/factories/zap.ts` | `packages/common/src/casts/zap.ts` | `packages/common/src/models/zaps.ts` | No generic zap action; zap flow spans LNURL/payment concerns |
| NIP-51 bookmarks | `packages/common/src/helpers/bookmark.ts` | `packages/common/src/operations/tag/bookmarks.ts`, list ops | `packages/common/src/factories/bookmark-list.ts`, `bookmark-set.ts` | `packages/common/src/casts/bookmarks.ts` | `BookmarksModel` family | `packages/actions/src/actions/bookmarks.ts` |

## Boundary Rules

- Put parsing and validation in helpers when it can be reused by casts, models, operations, factories, or actions.
- Put event draft changes in operations when they are reusable or protocol-specific.
- Put fluent consumer ergonomics in factories, not in operations.
- Put reactive store queries in models, not in casts or actions.
- Put typed object navigation in casts, not in helpers.
- Put signer, current-user, relay-routing, create-vs-modify, and publish decisions in actions or app code.
- Add a layer only when the event kind needs it; simple event kinds can skip helpers, casts, models, or actions.
- Prefer `modifyPublicTags` and tag operations over direct draft tag mutation for new code.
- Keep functions deterministic and side-effect-light; explicit exceptions are signing/encryption, event-store notification for unlocked hidden content, model registration side effects, and publishing through actions.

## Design Implications For New Event-Kind Work

When adding support for a new NIP or event kind, start with the smallest useful surface:

1. Add helpers if consumers need validation, pointer extraction, parsed tag data, or cached derived values.
2. Add operations for reusable tag/content transformations.
3. Add factories when consumers need a fluent create/modify API.
4. Add casts when consumers need typed read/navigation behavior from event instances.
5. Add models when consumers need reactive relations or timelines from the event store.
6. Add actions only when there is a real user workflow involving existing store state, signer, relay routing, and publish behavior.

This keeps protocol logic simple, testable, and mostly functional while still allowing higher-level packages to compose the pieces into ergonomic SDK APIs.
