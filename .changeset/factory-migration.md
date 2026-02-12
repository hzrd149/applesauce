---
"applesauce-core": major
"applesauce-common": major
"applesauce-wallet": major
"applesauce-wallet-connect": major
"applesauce-actions": major
---

**BREAKING CHANGE**: Migrate from blueprint pattern to Promise-based factory pattern

## Summary

This release completely refactors the event creation API from the legacy blueprint pattern to a new Promise-based factory pattern. All blueprints have been migrated to factory classes that extend `EventFactory`.

## What Changed

### Removed

- `applesauce-core/event-factory` - The legacy EventFactory class and blueprint system
- All `*Blueprint` functions from `applesauce-common/blueprints`, `applesauce-wallet/blueprints`, and `applesauce-wallet-connect/blueprints`
- `EventFactory` class with services-based dependency injection

### Added

- `applesauce-core/factories` - New Promise-based EventFactory and all core factories
- `applesauce-common/factories` - All NIP-specific factory classes (Note, Reaction, Comment, Share, Poll, etc.)
- `applesauce-wallet/factories` - Wallet-related factory classes
- `applesauce-wallet-connect/factories` - Wallet-connect factory classes
- Factory classes: `NoteFactory`, `ReactionFactory`, `CommentFactory`, `ShareFactory`, `PollFactory`, `PollResponseFactory`, `TorrentFactory`, `HighlightFactory`, `ProfileFactory`, `DeleteFactory`, `MailboxesFactory`, and many more

### Migration Guide

#### Before (Old Pattern)

```typescript
import { EventFactory } from "applesauce-core/event-factory";
import { NoteBlueprint } from "applesauce-common/blueprints";

const factory = new EventFactory({ signer });

// Using blueprint
const note = await factory.create(NoteBlueprint, "Hello world");

// Or using prototype method
const note = await factory.note("Hello world");
```

#### After (New Pattern)

```typescript
import { NoteFactory } from "applesauce-common/factories";

// Direct factory usage (recommended)
const note = await NoteFactory.create("Hello world")
  .as(signer)
  .sign();

// Or using chainable methods
const note = await NoteFactory.create()
  .content("Hello world")
  .meta({ title: "My Note" })
  .as(signer)
  .sign();
```

### Temporary Backwards Compatibility

For gradual migration, the following are temporarily re-exported from core:
- `LegacyEventFactory` - The old EventFactory class
- `buildEvent`, `modifyEvent`, `createEvent` - Legacy functions

**Note**: These will be removed in a future version. Migrate to the new factory pattern.

## Benefits

1. **Type-safe**: Factory classes are fully typed with generics for event kinds
2. **Chainable**: All methods return `this` for fluent API
3. **Promise-based**: Factories extend Promise for seamless async/await
4. **Cleaner API**: No more services/context passing - use `.as(signer)` instead
5. **Better IDE support**: Auto-completion and type inference

## Updated Factories

- `ProfileFactory` - kind 0 metadata
- `DeleteFactory` - kind 5 delete events
- `MailboxesFactory` - kind 10002 relay lists
- `NoteFactory` - kind 1 short text notes
- `ReactionFactory` - kind 7 reactions
- `CommentFactory` - kind 1111 comments
- `ShareFactory` - kind 6/16 reposts
- `PollFactory` - kind 1068 polls
- `PollResponseFactory` - kind 1018 poll responses
- `TorrentFactory` - kind 2003 torrents
- `HighlightFactory` - kind 9802 highlights
- And 15+ more factories for various event kinds

See individual factory files for detailed API documentation.
