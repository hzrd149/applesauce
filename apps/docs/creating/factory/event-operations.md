# Event Operations

Event operations are the core building blocks of the event factory system. They provide a composable, functional approach to creating and modifying Nostr events by focusing on single-responsibility transformations.

## Overview

An event operation is a function that takes an event template and returns a modified version of that event. Operations are designed to be:

- **Composable**: Multiple operations can be chained together using `eventPipe()`
- **Pure**: Operations don't mutate the input, they return new objects
- **Focused**: Each operation handles one specific aspect of event creation/modification
- **Async-aware**: Operations can be synchronous or asynchronous

See all available event operations in the [reference](https://applesauce.build/typedoc/modules/applesauce-core.Operations.html).

## Type Definition

```typescript
type EventOperation = (draft: EventTemplate, context: EventFactoryContext) => EventTemplate | Promise<EventTemplate>;
```

Every event operation receives:

- **`draft`**: The current event template/draft to transform
- **`context`**: An `EventFactoryContext` containing optional signer, relay hints, emojis, and client information

## Core Patterns

### 1. Simple Property Operations

These operations modify basic event properties like content or timestamps:

```typescript
// Set event content
export function setContent(content: string): EventOperation {
  return async (draft) => {
    return { ...draft, content };
  };
}

// Update created_at timestamp
export function updateCreatedAt(): EventOperation {
  return (draft) => ({ ...draft, created_at: unixNow() });
}
```

### 2. Tag Manipulation Operations

These operations modify the event's tags array using the [`modifyPublicTags`](https://applesauce.build/typedoc/functions/applesauce-core.Operations.modifyPublicTags.html) and [`modifyHiddenTags`](https://applesauce.build/typedoc/functions/applesauce-core.Operations.modifyHiddenTags.html) event operations and some [tag operations](./tag-operations.md):

```typescript
// Include a singleton tag (only one instance allowed)
export function includeSingletonTag(tag: [string, ...string[]], replace = true): EventOperation {
  return modifyPublicTags(setSingletonTag(tag, replace));
}

// Include NIP-31 alt tag
export function includeAltTag(description: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["alt", description]));
}
```

### 3. Context-Aware Operations

These operations use the context to make decisions or fetch additional data:

```typescript
// Include reaction tags with relay hints
export function includeReactionTags(event: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    const eventHint = await ctx?.getEventRelayHint?.(event.id);
    const pubkeyHint = await ctx?.getPubkeyRelayHint?.(event.pubkey);

    // Add tags with relay hints if available
    tags = ensureEventPointerTag(tags, {
      id: event.id,
      relays: eventHint ? [eventHint] : undefined,
    });

    return { ...draft, tags };
  };
}
```

### 4. Composite Operations

These operations can combine multiple smaller operations using `eventPipe()` for example:

```typescript
// Set text content with automatic processing
export function setShortTextContent(content: string, options?: TextContentOptions): EventOperation {
  return eventPipe(
    setContent(content), // Set the content
    repairContentNostrLinks(), // Fix @mentions
    tagPubkeyMentionedInContent(), // Add "p" tags for mentions
    includeQuoteTags(), // Add "q" tags for quotes
    includeContentHashtags(), // Add "t" tags for hashtags
    options?.emojis ? includeContentEmojiTags(options.emojis) : skip(),
    options?.contentWarning !== undefined ? setContentWarning(options.contentWarning) : skip(),
  );
}
```

## Custom Operations

### Basic Custom Operation

Here's how to create a simple operation that adds a "title" tag:

```typescript
export function setTitle(title: string): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // Remove existing title tags
    tags = tags.filter((tag) => tag[0] !== "title");

    // Add new title tag
    tags.push(["title", title]);

    return { ...draft, tags };
  };
}
```

### JSON Content Merger Operation

Here's an example of a more complex operation that merges JSON data into existing JSON content:

```typescript
export function mergeJsonContent(jsonData: Record<string, any>): EventOperation {
  return (draft) => {
    let existingContent: Record<string, any> = {};

    // Try to parse existing content as JSON
    if (draft.content) {
      try {
        existingContent = JSON.parse(draft.content);
      } catch (error) {
        // If parsing fails, treat as empty object
        existingContent = {};
      }
    }

    // Merge the new data with existing content
    const mergedContent = { ...existingContent, ...jsonData };

    // Return draft with updated JSON content
    return { ...draft, content: JSON.stringify(mergedContent) };
  };
}

// Usage example:
const draft = await factory.modify(
  existingEvent,
  mergeJsonContent({
    version: "1.0",
    author: "Alice",
    tags: ["music", "art"],
  }),
);
```

### Context-Aware Custom Operation

Here's an operation that uses the context to conditionally add client information:

```typescript
export function includeClientTag(): EventOperation {
  return (draft, ctx) => {
    // Only add client tag if client info is available in context
    if (!ctx.client?.name) return draft;

    let tags = Array.from(draft.tags);

    // Remove existing client tags
    tags = tags.filter((tag) => tag[0] !== "client");

    // Add client tag with optional address
    const clientTag = ["client", ctx.client.name];
    if (ctx.client.address) {
      const { kind, pubkey, identifier } = ctx.client.address;
      clientTag.push(`${kind}:${pubkey}:${identifier}`);
    }

    tags.push(clientTag);

    return { ...draft, tags };
  };
}
```

### Async Custom Operation

Operations can be asynchronous when they need to perform I/O or complex computations:

```typescript
export function includeHashOfContent(): EventOperation {
  return async (draft) => {
    // Simulate async hash computation
    const hash = await computeHash(draft.content);

    let tags = Array.from(draft.tags);
    tags = tags.filter((tag) => tag[0] !== "content-hash");
    tags.push(["content-hash", hash]);

    return { ...draft, tags };
  };
}

async function computeHash(content: string): Promise<string> {
  // Your hash implementation here
  return "sha256:" + content.length.toString(); // Simplified example
}
```

## Best Practices

### 1. Single Responsibility

Each operation should focus on one specific transformation:

```typescript
// Good: Focused on one thing
export function setTitle(title: string): EventOperation {
  /* ... */
}

// Avoid: Doing too many things
export function setTitleAndContentAndTags(/* ... */) {
  /* ... */
}
```

### 2. Immutability

Always return new objects, never mutate the input:

```typescript
// Good: Creates new objects
return { ...draft, content: newContent };

// Bad: Mutates input
draft.content = newContent;
return draft;
```

### 3. Array Copying

When modifying tags, always copy the array first:

```typescript
// Good: Copy first
let tags = Array.from(draft.tags);
tags.push(newTag);

// Bad: Direct mutation
draft.tags.push(newTag);
```

### 4. Conditional Operations

Use `skip()` for conditional operations in pipes:

```typescript
eventPipe(
  setContent(content),
  shouldAddTitle ? setTitle(title) : skip(),
  // ... other operations
);
```

### 5. Error Handling

Handle errors gracefully if there error isn't critical, especially in async operations:

```typescript
export function safeJsonOperation(data: any): EventOperation {
  return (draft) => {
    try {
      const content = JSON.stringify(data);
      return { ...draft, content };
    } catch (error) {
      console.warn("Failed to serialize JSON data:", error);
      return draft; // Return unchanged on error
    }
  };
}
```

## Composition

The `eventPipe()` function allows you to compose multiple operations into a single operation:

```typescript
function setArticleContent(content: string): EventOperation {
  return eventPipe(
    // Set the content
    setShortTextContent(content),
    // Add an alt tag for accessibility
    includeAltTag("A long form article"),
    // Update the created_at timestamp
    updateCreatedAt(),
    // Add a client tag
    includeClientTag(),
  );
}

// Use in event factory
const event = await factory.build({ kind: 300023 }, setArticleContent("...content"));
```

Operations in a pipe are executed sequentially, with each operation receiving the result of the previous operation. The `eventPipe()` function handles both synchronous and asynchronous operations seamlessly.
