# 6. Creating Events with EventFactory

The `EventFactory` class is your tool for creating, signing, and modifying Nostr events. It provides a clean API with pre-built blueprints for common event types and handles the complexities of event creation for you.

## What is the EventFactory?

The `EventFactory` is a builder that:

- **Creates events using blueprints** - Pre-built templates for common event types
- **Handles signing** - Integrates with signers to sign events
- **Manages metadata** - Automatically adds client tags, relay hints, etc.
- **Provides operations** - Composable functions to modify events
- **Ensures validity** - Creates properly formatted Nostr events

## Setting up the EventFactory

First, you'll need a signer. For browser apps, the `ExtensionSigner` works with Nostr browser extensions:

```typescript
import { EventFactory } from "applesauce-core";
import { ExtensionSigner } from "applesauce-signers";

// Create a signer that uses the browser extension (like Alby or nos2x)
const signer = new ExtensionSigner();

// Create the event factory with the signer
const factory = new EventFactory({
  signer,
  // Optional: Add client information to events
  client: {
    name: "My Nostr App",
    address: { identifier: "my-app", pubkey: "app-pubkey" },
  },
});
```

> 💡 **Best Practice**: Create one `EventFactory` instance at the top level of your app and pass it down or use a context.

## Creating a Text Note

Let's create a simple text note using the `NoteBlueprint`:

```typescript
import { NoteBlueprint } from "applesauce-factory/blueprints";

async function createNote() {
  try {
    // Use the NoteBlueprint to create a draft event
    const draft = await factory.create(NoteBlueprint, "Hello Nostr! This is my first note. #introductions");

    // Sign the draft event with the signer
    const signed = await factory.sign(draft);

    console.log("Created note:", signed);
    return signed;
  } catch (error) {
    console.error("Failed to create note:", error);
  }
}
```

## Different Event Types with Blueprints

EventFactory comes with blueprints for many common event types:

### Text Note with Hashtags

The `NoteBlueprint` is setup to automatically handle hashtags and mentions.

```typescript
import { NoteBlueprint } from "applesauce-factory/blueprints";

// Simple note
const hashtagsNote = await factory.create(NoteBlueprint, "Just posted my first note! #introductions");
console.log(hashtagsNote.tags);
// Output: [["t", "introductions"]]

// Note with hashtags (automatically parsed)
const mentionsNote = await factory.create(
  NoteBlueprint,
  "GM nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
);
console.log(mentionsNote.tags);
// Output: [["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"]]
```

### Reply to Another Note

The `NoteReplyBlueprint` can be used to create a reply event to another kind 1 note.

```typescript
import { NoteReplyBlueprint } from "applesauce-factory/blueprints";

// Reply to an existing note
const originalNote = {
  /* some note event */
};

const reply = await factory.create(NoteReplyBlueprint, originalNote, "Great point! I totally disagree.");
```

### Reaction (Like)

The `ReactionBlueprint` can be used to create a reaction event to any nostr event.

```typescript
import { ReactionBlueprint } from "applesauce-factory/blueprints";

// React to a note with a like
const reaction = await factory.create(ReactionBlueprint, originalNote, "+");

// React with a heart
const heartReaction = await factory.create(ReactionBlueprint, originalNote, "❤️");
```

### Repost/Share

The `ShareBlueprint` can be used to create a repost/share event of any nostr event.

```typescript
import { ShareBlueprint } from "applesauce-factory/blueprints";

// Share/repost a note
const repost = await factory.create(ShareBlueprint, originalNote);
```

## Custom Event Creation

For more complex events, you can use the `build()` method with [operations](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-factory.Operations.EventOperations.html):

```typescript
import { setContent, includeHashtags, includeAltTag } from "applesauce-factory/operations";

// Build a custom note with specific operations
const customNote = await factory.build(
  { kind: 1 }, // Start with a kind 1 note
  setContent("Check out this amazing project!"),
  includeHashtags(["nostr", "project"]),
  includeAltTag("A short text note"),
);

const signed = await factory.sign(customNote);
```

## Error Handling Best Practices

Any step in the event creation process can fail. You should handle these errors gracefully.

```typescript
async function createNoteWithErrorHandling(content: string) {
  try {
    // Try to create the note
    const draft = await factory.create(NoteBlueprint, content);
    const signed = await factory.sign(draft);

    return signed;
  } catch (error) {
    console.error("Failed to create note:", error);
    return null;
  }
}
```

## Key Concepts

- **EventFactory creates events** using blueprints and operations
- **Signers handle cryptography** - you don't need to manage keys directly
- **Blueprints are templates** for common event types
- **Always sign events** before using them or publishing them
- **Handle errors gracefully** - users might cancel signing or
- **Add events to EventStore** to see them in your UI
