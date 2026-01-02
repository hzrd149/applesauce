# Tag Operations

Tag operations are specialized functions designed to modify arrays of Nostr event tags. Unlike [event operations](./event-operations.md) which work on entire events, tag operations focus exclusively on transforming tag arrays. This makes them perfect for use with [`modifyPublicTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Operations.modifyPublicTags.html) and [`modifyHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Operations.modifyHiddenTags.html) event operations, allowing precise control over both public event tags and hidden encrypted tags on NIP-51 lists.

## Overview

A tag operation is a function that takes an array of tags and returns a modified version of that array. Tag operations are designed to be:

- **Composable**: Multiple tag operations can be chained together using `tagPipe()`
- **Pure**: Operations don't mutate the input array, they return new arrays
- **Focused**: Each operation handles one specific type of tag transformation
- **Async-aware**: Operations can be synchronous or asynchronous
- **Context-aware**: Operations can use relay hints and other context information

See all available tag operations in the [reference](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-core.Operations.TagOperations.html).

## Type Definition

```typescript
type TagOperation = (tags: string[][], context: EventFactoryContext) => string[][] | Promise<string[][]>;
```

Every tag operation receives:

- **`tags`**: The current array of tags to transform
- **`context`**: An `EventFactoryContext` containing optional signer, relay hints, emojis, and client information

## Usage with Event Operations

Tag operations are typically used within event operations via `modifyPublicTags` and `modifyHiddenTags`:

```typescript
// Modify public tags
const eventOp = modifyPublicTags(
  addPubkeyTag("npub1..."),
  setSingletonTag(["title", "My List"]),
  removeEventTag("event-id"),
);

// Modify hidden tags (requires signer)
const hiddenOp = modifyHiddenTags(addEventPointerTag("secret-event-id"), addPubkeyTag("secret-pubkey"));

// Use both in event creation
const event = await factory.build(
  { kind: 30000 }, // Follow set
  eventOp,
  hiddenOp,
);
```

## Core Patterns

### 1. Simple Tag Manipulation

These operations add, remove, or modify basic tags:

```typescript
// Add a pubkey tag with relay hint
export function addPubkeyTag(pubkey: string | ProfilePointer, replace = true): TagOperation {
  return async (tags, { getPubkeyRelayHint }) => {
    const pointer = typeof pubkey === "string" ? { pubkey: pubkey } : { ...pubkey };

    // Add relay hint if available
    if (getPubkeyRelayHint && pointer.relays?.[0] === undefined) {
      const hint = await getPubkeyRelayHint(pointer.pubkey);
      if (hint) pointer.relays = [hint];
    }

    // Remove existing matching tags if replace is true
    if (replace) tags = tags.filter((t) => !(t[0] === "p" && t[1] === pointer.pubkey));

    // Add new tag
    return [...tags, createPTagFromProfilePointer(pointer)];
  };
}

// Remove all matching tags
export function removePubkeyTag(pubkey: string): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === "p" && t[1] === pubkey));
}
```

### 2. Singleton Tag Operations

These operations ensure only one instance of a tag type exists using the [`ensureSingletonTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.ensureSingletonTag.html) helper function:

```typescript
// Set a singleton tag (only one allowed)
export function setSingletonTag(tag: [string, ...string[]], replace = true): TagOperation {
  return (tags) => ensureSingletonTag(tags, tag, replace);
}

// Remove all instances of a singleton tag
export function removeSingletonTag(tag: string): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag));
}
```

### 3. Name/Value Tag Operations

These operations handle tags with name-value pairs:

```typescript
// Add a name/value tag with optional custom matcher
export function addNameValueTag(
  tag: [string, string, ...string[]],
  replace = true,
  matcher?: (a: string, b: string) => boolean,
): TagOperation {
  return (tags) => {
    if (replace) return ensureNamedValueTag(tags, tag, true, matcher);
    else return [...tags, tag];
  };
}

// Remove matching name/value tags
export function removeNameValueTag(tag: string[]): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag[0] && t[1] === tag[1]));
}
```

### 4. Context-Aware Operations

These operations use the context to fetch relay hints or other information:

```typescript
// Add event tag with automatic relay hint
export function addEventPointerTag(id: string | EventPointer, replace = true): TagOperation {
  return async (tags, { getEventRelayHint }) => {
    const pointer = typeof id === "string" ? { id } : id;

    // Fetch relay hint from context if available
    if (getEventRelayHint && pointer.relays?.[0] === undefined) {
      const hint = await getEventRelayHint(pointer.id);
      if (hint) pointer.relays = [hint];
    }

    // Remove existing tags if replace is true
    if (replace) tags = tags.filter((t) => !(t[0] === "e" && t[1] === pointer.id));

    return [...tags, createETagFromEventPointer(pointer)];
  };
}
```

### 5. Specialized Operations

These operations handle specific use cases like bookmarks or relays:

```typescript
// Add relay tag with URL normalization
export function addRelayTag(url: string | URL, tagName = "relay", replace = true): TagOperation {
  url = normalizeURL(url).toString();
  return addNameValueTag([tagName, url], replace, (a, b) => isSameURL(a, b));
}

// Add bookmark tag (handles both events and articles)
export function addEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cannot be added to bookmarks`);

  return isReplaceable(event.kind) ? addCoordinateTag(getAddressPointerForEvent(event)) : addEventPointerTag(event.id);
}
```

## Custom Operations

### Basic Custom Operation

Here's how to create a simple operation that adds a custom tag:

```typescript
export function addCustomTag(value: string): TagOperation {
  return (tags) => {
    // Remove existing custom tags
    const filtered = tags.filter((tag) => tag[0] !== "custom");

    // Add new custom tag
    return [...filtered, ["custom", value]];
  };
}
```

### Conditional Tag Operation

Create operations that conditionally modify tags:

```typescript
export function addConditionalTag(condition: boolean, tag: [string, ...string[]]): TagOperation {
  return (tags) => {
    if (!condition) return tags;

    // Remove existing tags of this type
    const filtered = tags.filter((t) => t[0] !== tag[0]);

    // Add the new tag
    return [...filtered, tag];
  };
}
```

### Async Tag Operation with Context

Operations can be asynchronous and use context:

```typescript
export function addTagWithRelayHint(eventId: string): TagOperation {
  return async (tags, { getEventRelayHint }) => {
    // Fetch relay hint asynchronously
    const relayHint = await getEventRelayHint?.(eventId);

    // Create tag with or without relay hint
    const tag = relayHint ? ["e", eventId, relayHint] : ["e", eventId];

    return [...tags, tag];
  };
}
```

### Bulk Tag Operation

Handle multiple items at once:

```typescript
export function addMultiplePubkeyTags(pubkeys: string[]): TagOperation {
  return async (tags, context) => {
    let result = [...tags];

    // Add each pubkey tag
    for (const pubkey of pubkeys) {
      result = await addPubkeyTag(pubkey)(result, context);
    }

    return result;
  };
}
```

## Best Practices

### 1. Immutability

Always return new arrays, never mutate the input:

```typescript
// Good: Creates new array
return [...tags, newTag];

// Bad: Mutates input
tags.push(newTag);
return tags;
```

### 2. Filtering Before Adding

When replacing tags, filter first:

```typescript
// Good: Filter then add
const filtered = tags.filter((t) => t[0] !== "title");
return [...filtered, ["title", newTitle]];

// Avoid: Complex logic
return tags.map((t) => (t[0] === "title" ? ["title", newTitle] : t));
```

### 3. Handle Edge Cases

Check for invalid inputs:

```typescript
export function safeAddTag(tag: [string, ...string[]]): TagOperation {
  // Validate tag format
  if (!tag || tag.length < 2 || !tag[0] || !tag[1]) {
    throw new Error("Invalid tag format");
  }

  return (tags) => {
    return [...tags, tag];
  };
}
```

### 4. Use Helper Functions

Leverage existing helper functions:

```typescript
import { ensureSingletonTag } from "applesauce-core/helpers";

export function addUniqueTag(tag: [string, ...string[]]): TagOperation {
  // Replace any existing tags with the same name to ensure only one instance of the tag exists
  return (tags) => ensureSingletonTag(tags, tag, true);
}
```

## Composition

The `tagPipe()` function allows you to compose multiple tag operations into a single operation:

```typescript
function setupListTags(title: string, pubkeys: string[]): TagOperation {
  return tagPipe(
    // Set the title
    setSingletonTag(["title", title]),
    // Add all pubkeys
    ...pubkeys.map((pubkey) => addPubkeyTag(pubkey)),
    // Remove any old description
    removeSingletonTag("description"),
  );
}

// Use in event operation
const eventOp = factory.build(
  { kind: 30000 },
  // Use the modifyPublicTags to modify the public tags on the event
  modifyPublicTags(setupListTags("My Friends", ["npub1...", "npub2..."])),
);
```

## Integration with Hidden Tags

Tag operations work seamlessly with both public and hidden tags using the [`modifyPublicTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Operations.modifyPublicTags.html) and [`modifyHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Operations.modifyHiddenTags.html) event operations:

```typescript
// Create operations for both public and hidden tags
const publicTags = tagPipe(setSingletonTag(["title", "Public List"]), addPubkeyTag("public-user"));

const hiddenTags = tagPipe(addPubkeyTag("secret-user"), addPubkeyTag("other-user"));

// Apply to event
const event = await factory.build({ kind: 30000 }, modifyPublicTags(publicTags), modifyHiddenTags(hiddenTags));
```

This separation allows you to maintain public metadata while keeping sensitive information encrypted in hidden tags, perfect for NIP-51 lists and other privacy-focused applications.
