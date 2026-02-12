# Promise Chaining Guide - Applesauce v2.0

## Quick Reference

All event and tag operations are now **context-free** and fully compatible with promise `.then()` chains!

## Basic Patterns

### 1. Direct Promise Chaining

```typescript
const event = await Promise.resolve(draft)
  .then(setContent("Hello Nostr!"))
  .then(modifyPublicTags(addProfilePointerTag(pubkey, "wss://relay.damus.io")))
  .then(stamp(signer))
  .then(sign(signer));
```

### 2. Pipe Helper

```typescript
import { pipe } from "applesauce-core/helpers/pipeline";

const event = await pipe(
  draft,
  setContent("Hello Nostr!"),
  modifyPublicTags(addProfilePointerTag(pubkey, relayHintFn)),
  stamp(signer),
  sign(signer),
);
```

### 3. Array Reduce

```typescript
const operations = [setContent("Hello"), modifyPublicTags(addProfilePointerTag(pubkey)), stamp(signer), sign(signer)];

const event = await operations.reduce((promise, operation) => promise.then(operation), Promise.resolve(draft));
```

### 4. EventFactory Pattern (Recommended)

```typescript
import { EventFactory } from "applesauce-core/factories/event";

const event = await EventFactory.fromKind(1)
  .as(signer)
  .content("Hello Nostr!")
  .modifyPublicTags(addProfilePointerTag(pubkey))
  .sign();
```

## Common Operations

### Adding Tags with Relay Hints

```typescript
// Static relay hint
addProfilePointerTag(pubkey, "wss://relay.damus.io");

// Dynamic relay hint (function)
addProfilePointerTag(pubkey, async (pk) => myRelayLookup(pk));

// No relay hint
addProfilePointerTag(pubkey);

// With custom replace behavior
addProfilePointerTag(pubkey, relayHint, false); // don't replace existing
```

### Event Pointer Tags

```typescript
// Event pointer with relay hint
addEventPointerTag(eventId, async (id) => getEventRelay(id));

// Address pointer with relay hint
addAddressPointerTag(addressString, async (pubkey) => getPubkeyRelay(pubkey));
```

### Signing Operations

```typescript
// Stamp (add pubkey)
.then(stamp(signer))

// Sign (add id and signature)
.then(sign(signer))

// Or both at once with sign (stamp is called internally)
.then(sign(signer))
```

### Hidden Tags

```typescript
// Modify hidden tags (encrypted)
.then(modifyHiddenTags(signer,
  addProfilePointerTag(pubkey),
  addEventPointerTag(eventId)
))
```

### Encrypted Content

```typescript
// Encrypt content for a pubkey
.then(setEncryptedContent(recipientPubkey, "secret message", signer))

// With specific encryption method
.then(setEncryptedContent(recipientPubkey, "secret", signer, "nip44"))
```

## Real-World Examples

### Creating a Note with Reply

```typescript
import { pipe } from "applesauce-core/helpers/pipeline";
import { setContent, stamp, sign } from "applesauce-core/operations";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { addEventPointerTag, addProfilePointerTag } from "applesauce-core/operations/tag/common";

const note = await pipe(
  { kind: 1, content: "", tags: [], created_at: unixNow() },
  setContent("Great post!"),
  modifyPublicTags(
    addEventPointerTag(parentEvent.id, "wss://relay.damus.io"),
    addProfilePointerTag(parentEvent.pubkey, "wss://relay.damus.io"),
  ),
  stamp(signer),
  sign(signer),
);
```

### Creating a Reaction

```typescript
const reaction = await pipe(
  { kind: 7, content: "+", tags: [], created_at: unixNow() },
  modifyPublicTags(addEventPointerTag(event.id, getEventRelay), addProfilePointerTag(event.pubkey, getPubkeyRelay)),
  stamp(signer),
  sign(signer),
);
```

### Gift Wrapping a Message

```typescript
import { giftWrap } from "applesauce-common/operations/gift-wrap";

const wrapped = await pipe(
  { kind: 14, content: "Secret message", tags: [], created_at: unixNow() },
  modifyPublicTags(addProfilePointerTag(recipientPubkey)),
  giftWrap(recipientPubkey, signer),
);
```

### Building with EventFactory (Recommended)

```typescript
import { EventFactory } from "applesauce-core/factories/event";
import { ProfileFactory } from "applesauce-core/factories/profile";

// Simple note
const note = await EventFactory.fromKind(1).as(signer).content("Hello Nostr!").sign();

// Profile update
const profile = await ProfileFactory.modify(existingProfile)
  .as(signer)
  .name("Alice")
  .about("Developer")
  .picture("https://example.com/avatar.jpg")
  .sign();

// Note with tags
const taggedNote = await EventFactory.fromKind(1)
  .as(signer)
  .content("Check out this profile!")
  .modifyPublicTags(addProfilePointerTag(somePubkey, getRelayHint))
  .sign();
```

## Migration from v1.x

### EventFactory Users

```typescript
// v1.x
const factory = new EventFactory({ signer, getPubkeyRelayHint });

// v2.0
const factory = new EventFactory({ signer });
factory.setRelayHints(getEventRelayHint, getPubkeyRelayHint);
// Or just: new EventFactory({ signer, getPubkeyRelayHint, getEventRelayHint })
```

### Operations in Actions

```typescript
// v1.x
modifyPublicTags(addProfilePointerTag(pubkey));

// v2.0
modifyPublicTags(addProfilePointerTag(pubkey, factory.services.getPubkeyRelayHint));
```

### Hidden Tags

```typescript
// v1.x
modifyHiddenTags(setSingletonTag(["test", "value"]));

// v2.0
modifyHiddenTags(factory.services.signer, setSingletonTag(["test", "value"]));
```

## Tips & Best Practices

### 1. Use EventFactory Pattern

The fluent EventFactory classes provide the best DX:

- Type-safe method chaining
- Cleaner code
- Better error messages

### 2. Bind Relay Hints Once

Instead of passing functions everywhere:

```typescript
factory.setRelayHints(getEventRelay, getPubkeyRelay);
// Then use factory.services.getPubkeyRelayHint in operations
```

### 3. Static Hints for Performance

If you already have relay hints, pass them as strings:

```typescript
addProfilePointerTag(pubkey, "wss://relay.damus.io");
// Instead of:
addProfilePointerTag(pubkey, async () => "wss://relay.damus.io");
```

### 4. Compose Operations

Build reusable operation chains:

```typescript
const addNoteMetadata = (content, mentions) =>
  pipe(setContent(content), modifyPublicTags(...mentions.map(addProfilePointerTag)));

// Use it
const note = await pipe(draft, addNoteMetadata("Hello!", [pubkey1, pubkey2]), stamp(signer), sign(signer));
```

### 5. Error Handling

Operations throw clear errors when dependencies are missing:

```typescript
try {
  await stamp()(draft); // Missing signer
} catch (e) {
  console.error(e.message); // "Missing signer"
}
```

## Advanced Patterns

### Conditional Operations

```typescript
const event = await pipe(
  draft,
  setContent(content),
  shouldAddTags ? modifyPublicTags(...tags) : (x) => x,
  hasRelay ? modifyPublicTags(addRelayTag(relay)) : (x) => x,
  stamp(signer),
  sign(signer),
);
```

### Parallel Operations

```typescript
// Create multiple events in parallel
const events = await Promise.all([
  pipe(draft1, setContent("1"), sign(signer)),
  pipe(draft2, setContent("2"), sign(signer)),
  pipe(draft3, setContent("3"), sign(signer)),
]);
```

### Operation Composition

```typescript
// Create higher-order operations
const withMetadata = (content, author) => (draft) =>
  pipe(draft, setContent(content), modifyPublicTags(addProfilePointerTag(author)));

// Use it
const event = await pipe(draft, withMetadata("Hello", authorPubkey), stamp(signer), sign(signer));
```

---

## Troubleshooting

### "Missing signer" Error

**Cause:** Operation requires signer but none provided  
**Fix:** Pass signer explicitly: `stamp(signer)` or `sign(signer)`

### "A spread argument must either have a tuple type..."

**Cause:** TypeScript being overly cautious with `modifyHiddenTags`  
**Impact:** None - builds and runs fine, just an LSP warning  
**Fix:** Can be ignored, or restructure to avoid spread

### Relay Hints Not Added

**Cause:** Forgot to pass relay hint function  
**Fix:** Pass as second parameter: `addProfilePointerTag(pubkey, getRelayHint)`

### Type Errors with Operations

**Cause:** Using old v1.x signature  
**Fix:** Check new signature in type hints or docs

---

## Resources

- **EventFactory Classes:** `packages/core/src/factories/`
- **Core Operations:** `packages/core/src/operations/`
- **Common Operations:** `packages/common/src/operations/`
- **Test Examples:** `packages/*/src/**/__tests__/*.test.ts`
- **Migration Plan:** `CONTEXT_FREE_MIGRATION.md`
- **Full Report:** `CONTEXT_FREE_REPORT.md`
- **Changeset:** `.changeset/context-free-operations.md`

---

**Version:** 2.0.0  
**Status:** ✅ Production Ready
