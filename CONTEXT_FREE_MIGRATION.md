# Implementation Plan: Context-Free Event & Tag Operations

## Overview

Transform all event and tag operations from context-dependent to context-free curried functions, enabling flexible promise-chaining while maintaining the EventFactory class for blueprint convenience.

## Design Principles

1. **Curried operations** - Dependencies passed as parameters, not via context
2. **Hybrid relay hints** - Accept either `string` OR `(id: string) => Promise<string | undefined>`
3. **Optional signer** - Runtime error if needed but not provided
4. **EventFactory preserved** - Keeps class structure for blueprint method extensions
5. **Maximum flexibility** - Works with `.then()`, `pipe()`, `compose()`, and array patterns
6. **Existing pipe helpers** - Leverage `eventPipe()` and `tagPipe()`, make them context-free

## Architecture Changes

### Current Flow

```typescript
EventFactory.context → operations receive ctx → operations use ctx services
```

### New Flow

```typescript
Operations receive services directly → EventFactory orchestrates → No hidden dependencies
```

## Implementation Order

### Phase 1: Foundation (Days 1-5)

1. ✅ **Update type definitions** - Remove context from Operation types
2. ✅ **Refactor pipeline helpers** - Make `eventPipe()`, `tagPipe()` context-free, add `pipe()` helper
3. ✅ **Refactor core tag operations** - 3 operations with relay hints
4. ✅ **Refactor core event operations** - stamp, sign, encryption, emojis, client

### Phase 2: Core Systems (Days 6-10)

5. ✅ **Rebuild EventFactory methods** - buildEvent, modifyEvent, blueprint
6. ✅ **Rebuild EventFactory class** - Services-based instead of context
7. ✅ **Update modifyPublicTags/modifyHiddenTags** - No context parameter
8. ✅ **Write unit tests** - Test all operations work standalone and with promises

### Phase 3: Common Package (Days 11-15)

9. ✅ **Refactor common operations** - note, reaction, share, comment, zap-split, gift-wrap, wallet
10. ✅ **Update all blueprints** - Pass services to operations
11. ✅ **Update blueprint type definitions** - EventBlueprint accepts services
12. ✅ **Write integration tests** - Test blueprints with EventFactory

### Phase 4: Actions & Examples (Days 16-20)

13. ✅ **Update all actions** - Use factory.services for relay hints
14. ✅ **Update example apps** - Verify everything works
15. ✅ **Update loaders if needed** - Check for context dependencies
16. ✅ **E2E testing** - Full workflow tests

### Phase 5: Documentation & Release (Days 21-25)

17. ✅ **Migration guide** - Document breaking changes
18. ✅ **API documentation** - Update all operation docs
19. ✅ **Changelog** - Comprehensive v2.0.0 notes
20. ✅ **Create changeset** - Major version bump for all affected packages
21. ✅ **Final review** - Code review, test coverage check

## Breaking Changes Summary

### Type Signatures Changed

- `Operation<I, R>` - No longer accepts `context` parameter
- `TagOperation` - No longer accepts `context` parameter
- `EventOperation` - No longer accepts `context` parameter
- All tag operations with relay hints now accept hint parameter
- All event operations with signer now accept signer parameter

### Removed

- `EventFactoryContext` interface (replaced by `EventFactoryServices`)
- Context parameter from all operations
- Context parameter from `eventPipe()`, `tagPipe()`, `pipeFromAsyncArray()`

### Changed Behavior

- EventFactory.services is public (was context)
- Operations must receive dependencies explicitly
- Blueprints receive services, not context
- Runtime errors if signer/services missing (was optional/silent)

## Migration Examples

### Before

```typescript
const factory = new EventFactory({
  signer,
  getPubkeyRelayHint: (pk) => myHintFn(pk),
});

const event = await factory.build({ kind: 1, content: "hello" }, modifyPublicTags(addProfilePointerTag("abc123")));
```

### After

```typescript
const factory = new EventFactory({
  signer,
  getPubkeyRelayHint: (pk) => myHintFn(pk),
});

const event = await factory.build(
  { kind: 1, content: "hello" },
  modifyPublicTags(addProfilePointerTag("abc123", factory.services.getPubkeyRelayHint)),
);

// OR use operations standalone with .then()
const event = await pipe(
  { kind: 1, content: "hello", tags: [], created_at: unixNow() },
  modifyPublicTags(addProfilePointerTag("abc123", myRelayHintFn)),
  stamp(signer),
  sign(signer),
);

// OR with promise chaining
const event = await Promise.resolve({ kind: 1, content: "hello", tags: [], created_at: unixNow() })
  .then(modifyPublicTags(addProfilePointerTag("abc123", "wss://relay.com")))
  .then(stamp(signer))
  .then(sign(signer));
```

## Success Criteria

✅ All operations work without context  
✅ Operations chainable with `.then()`  
✅ Operations work with `pipe()` helper  
✅ EventFactory class preserved for blueprints  
✅ All tests passing  
✅ Documentation complete  
✅ Migration guide written  
✅ No performance regression
