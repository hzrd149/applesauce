# EventFactory

The `EventFactory` class is the main interface for creating, building, and modifying Nostr events. It provides a convenient wrapper around event operations and blueprints, making it easy to work with different types of Nostr events.

## Creating an EventFactory

The `EventFactory` is initialized with an `EventFactoryContext` that contains configuration options including signers, relay hints, and client information.

### Basic Usage

```typescript
import { EventFactory } from "applesauce-factory";

// Create with empty context (minimal setup)
const factory = new EventFactory();

// Create with signer
const factory = new EventFactory({
  signer: mySigner, // Any NIP-07 compatible signer
});
```

### With Full Context

```typescript
import { EventFactory } from "applesauce-factory";

const factory = new EventFactory({
  // Required for signing events
  signer: {
    getPublicKey: () => "your-pubkey",
    signEvent: (template) => signedEvent,
    nip04: { encrypt, decrypt }, // Optional NIP-04 support
    nip44: { encrypt, decrypt }, // Optional NIP-44 support
  },

  // Optional: Add client tag to events
  client: {
    name: "My Nostr App",
    address: { identifier: "my-app", pubkey: "app-pubkey" },
  },

  // Optional: Provide relay hints for tags
  getEventRelayHint: (eventId) => "wss://relay.example.com",
  getPubkeyRelayHint: (pubkey) => "wss://relay.example.com",

  // Optional: Custom emojis for text content
  emojis: [{ name: "custom", url: "https://example.com/emoji.png" }],
});
```

## Core Methods

### `create()` - Using Blueprints

The `create()` method uses pre-built blueprints to create common event types. Blueprints are pre-built sets of operations that can be used to create events.

There are two ways to call blueprints:

**Method 1: Pass blueprint constructor and arguments separately**

```typescript
// Create a short text note (kind 1)
const noteEvent = await factory.create(NoteBlueprint, "Hello Nostr!");

// Create a reaction event (kind 7)
const reactionEvent = await factory.create(ReactionBlueprint, eventToReactTo, "+");

// Create a reply to a note
const replyEvent = await factory.create(NoteReplyBlueprint, noteToReplyTo, "Hello back!");

// Create a comment (NIP-22)
const commentEvent = await factory.create(CommentBlueprint, articleToCommentOn, "Great article!");
```

**Method 2: Call blueprint method directly**

```typescript
// Create a short text note (kind 1)
const noteEvent = await factory.create(NoteBlueprint("Hello Nostr!"));

// Create a reaction event (kind 7)
const reactionEvent = await factory.create(ReactionBlueprint(eventToReactTo, "+"));

// Create a reply to a note
const replyEvent = await factory.create(NoteReplyBlueprint(noteToReplyTo, "Hello back!"));

// Create a comment (NIP-22)
const commentEvent = await factory.create(CommentBlueprint(articleToCommentOn, "Great article!"));
```

### `build()` - Build an event using operations

The `build()` method takes a starting template and builds an event using operations.

```typescript
const customEvent = await factory.build(
  // Start with a template
  { kind: 30023 },
  setContent("# My Article\n\nThis is my article content..."),
  // Include the "title" and "published_at" tags
  includeNameValueTag(["title", "My Article Title"]),
  includeNameValueTag(["published_at", "1234567890"]),
  // Include only one "d" tag
  includeSingletonTag(["d", "article-id"]),
);
```

### `modify()` - Updating Existing Events

The `modify()` method updates an existing event with a new `created_at` timestamp and operations.

```typescript
// Modify an existing event
const modifiedEvent = await factory.modify(
  existingEvent,
  // Replace the "title" and "published_at" tags
  includeNameValueTag(["title", "My Article Title"]),
  includeNameValueTag(["published_at", "1234567890"]),
);

// Modify tags specifically
const updatedEvent = await factory.modifyTags(existingEvent, addPubkeyTag("user_pubkey"));
```

## Event Lifecycle

### 1. Template → Signed

```typescript
// 1. Create template
const draft = await factory.build({
  kind: 1,
  content: "Hello Nostr!",
});

// 2. Sign the event (creates NostrEvent)
const signed = await factory.sign(draft);
```

### 2. Working with Operations

Operations are functions that modify events during creation or modification:

```typescript
import { setContent, addHashtags, addMentions, includeClientTag } from "applesauce-factory/operations";

const event = await factory.build(
  { kind: 1 },
  setContent("My post content"),
  addHashtags(["nostr", "bitcoin"]),
  addMentions(["npub1..."]),
  includeClientTag("My App", "naddr1..."),
);
```

## Helper Methods

The `EventFactory` includes convenient helper methods for common event types:

```typescript
// Short text note
const note = await factory.note("Hello World!", {
  hashtags: ["greeting"],
});

// Reply to a note
const reply = await factory.noteReply(noteToReplyTo, "Great post!");

// Reaction
const reaction = await factory.reaction(eventToReactTo, "🔥");

// Delete event
const deleteEvent = await factory.delete([eventToDelete, ...eventsToDelete], "I didn't mean to post my nsec1...");

// Share/repost
const share = await factory.share(eventToShare);

// Comment (NIP-22)
const comment = await factory.comment(articleToCommentOn, "Interesting perspective!");
```

## Advanced Features

### Encrypted Content

When working with encrypted content in events, the factory preserves plaintext content so the app wont need to decrypt it later:

```typescript
// Create a draft NIP-04 message
const draft = await factory.build(
  { kind: 4 },
  setEncryptedContent("other_pubkey", "Hello how have you been?"),
  includeNameValueTag(["p", "other_pubkey"]),
);

// Signe the event
const signed = await factory.sign(draft);

// The plaintext content is still available for the app to use
const content = getEncryptedContent(signed);
```

### Replaceable Events

For replaceable events (kinds 10000-19999 and 30000-39999), the factory automatically includes required `d` tags:

```typescript
// Automatically adds "d" tag for addressable events
const profileEvent = await factory.build({
  kind: 30023, // Long-form content
  content: "Article content...",
  // "d" tag will be automatically added if missing
});
```

### Relay Hints

When relay hint functions are provided in the context, they're automatically used for `e` and `p` tags:

```typescript
const factory = new EventFactory({
  signer: mySigner,
  getEventRelayHint: (eventId) => "wss://relay.example.com",
  getPubkeyRelayHint: (pubkey) => "wss://relay.example.com",
});

// Tags will automatically include relay hints
const reply = await factory.noteReply("Great post!", "event-id");
// Results in: ["e", "event-id", "wss://relay.example.com"]
```

## Error Handling

```typescript
try {
  const event = await factory.create(NoteBlueprint, "Hello World!");
  console.log("Event created:", event);
} catch (error) {
  if (error.message.includes("signer")) {
    console.error("Signer not available or failed");
  } else {
    console.error("Event creation failed:", error);
  }
}
```
