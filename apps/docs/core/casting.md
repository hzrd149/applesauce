# Casting System

The casting system transforms raw Nostr events into easy-to-use classes with both synchronous properties and reactive observable interfaces. This makes it simple to work with Nostr data in web UIs, where you need to read event data and subscribe to updates.

## Overview

The casting system provides two main functions:

- **`castEvent`** - Converts a Nostr event into a typed class instance
- **`castUser`** - Converts a pubkey or profile pointer into a `User` instance

All cast classes extend `EventCast` and provide:

1. **Synchronous properties** - Direct access to event data (e.g., `note.id`, `note.createdAt`)
2. **Observable properties** - Reactive streams that update when data changes (e.g., `note.author.profile$`, `user.outboxes$`)

## Basic Usage

### Casting Events

Use `castEvent` to convert a Nostr event into a typed class:

```typescript
import { castEvent, Note } from "applesauce-common/casts";
import { EventStore } from "applesauce-core/event-store";

const eventStore = new EventStore();
const event: NostrEvent = /* ... */;

// Cast the event to a Note
const note = castEvent(event, Note, eventStore);

// Access synchronous properties
console.log(note.id); // Event ID
console.log(note.createdAt); // Date object
console.log(note.isReply); // Boolean
```

### Casting Users

Use `castUser` to create a `User` instance from a pubkey or event:

```typescript
import { castUser } from "applesauce-common/casts";

// From a pubkey string
const user = castUser("abc123...", eventStore);

// From a Nostr event (extracts the pubkey)
const user = castUser(event, eventStore);

// From a profile pointer
const user = castUser({ pubkey: "abc123...", relays: [...] }, eventStore);
```

## Cast Classes

All cast classes extend `EventCast` and provide a consistent interface:

### Base Properties

All cast classes inherit these base properties from `EventCast`:

```typescript
const note = castEvent(event, Note, eventStore);

// Base properties available on all cast classes
note.id; // string - The event ID (32-byte hex string)
note.uid; // string - Unique identifier for the event
note.createdAt; // Date - Creation timestamp as a Date object
note.author; // User - The User instance that authored this event
note.seen; // Set<string> - Set of relay URLs where this event was seen
note.event; // NostrEvent - The raw event object
note.store; // CastRefEventStore - The event store instance
```

**Property Details:**

- **`id`** - The event's unique identifier (32-byte hex string)
- **`uid`** - A unique identifier that may differ from `id` for parameterized replaceable events
- **`createdAt`** - The event's creation timestamp converted to a JavaScript `Date` object
- **`author`** - A `User` instance created from the event's `pubkey`. This is cached, so multiple accesses return the same instance
- **`seen`** - A `Set` of relay URLs where this event was observed. Useful for knowing which relays have this event
- **`event`** - The raw `NostrEvent` object. Access this when you need the original event data
- **`store`** - The event store instance used for loading related events and data

### Synchronous Properties

These are regular getters that return values directly:

```typescript
const note = castEvent(event, Note, eventStore);

// Direct property access
note.id; // string - Event ID
note.uid; // string - Unique identifier
note.createdAt; // Date - Creation timestamp
note.author; // User - Author instance
note.isReply; // boolean - Whether this is a reply
note.references; // object - NIP-10 references
```

### Observable Properties

Properties ending with `$` return chainable observables that emit values and update reactively:

```typescript
// Observable properties return ChainableObservable instances
const profile$ = note.author.profile$; // Observable<Profile | undefined>
const outboxes$ = note.author.outboxes$; // Observable<string[] | undefined>
const replies$ = note.replies$; // Observable<Note[]>
```

## Chainable Observables

The casting system uses **chainable observables** to enable deep property access through observable chains. This allows you to subscribe to nested properties without manually chaining RxJS operators.

### Deep Property Access

Chainable observables let you access nested properties using dot notation:

```typescript
// Access nested observable properties
// Note: author is a synchronous property, so we access it directly
const displayName$ = note.author.profile$.displayName;
// Observable<string | undefined>

const outboxes$ = note.author.outboxes$;
// Observable<string[] | undefined>
```

The `$` suffix indicates an observable property. When you access a property on a chainable observable:

- **Properties ending with `$`** - Returns the inner observable value (extracts from `Observable<T>`)
- **Regular properties** - Returns an observable of that property's value

### Using in React

The `use$` hook from `applesauce-react` makes it easy to subscribe to chainable observables:

```typescript
import { use$ } from "applesauce-react/hooks";

function NoteItem({ note }: { note: Note }) {
  // Subscribe to nested observable properties
  const profile = use$(note.author.profile$);
  const replies = use$(note.replies$);
  const zaps = use$(note.zaps$);

  return (
    <div>
      <h3>{profile?.displayName || note.author.npub}</h3>
      <p>{note.event.content}</p>
      {replies && replies.length > 0 && (
        <div>Replies: {replies.length}</div>
      )}
    </div>
  );
}
```

### Async Code with `$first`

For async code (outside React), use the `$first` method to wait for the first value from a deep subscription:

```typescript
// Wait for the first value with a timeout
const displayName = await note.author.profile$.displayName.$first(5000);
// Returns: string | undefined (or throws if timeout)

// With a fallback value
const displayName = await note.author.profile$.displayName.$first(5000, "Anonymous");
// Returns: string (never undefined)
```

The `$first` method signature:

```typescript
$first(timeout?: number): Promise<NonNullable<T>>;
$first<V>(timeout?: number, fallback?: V): Promise<NonNullable<T> | V>;
```

**Parameters:**

- `timeout` - Maximum time to wait in milliseconds (default: 10,000ms)
- `fallback` - Optional value to return if timeout occurs

**Example:**

```typescript
// Get user's outboxes with timeout
const outboxes = await user.outboxes$.$first(5000, []);
if (outboxes.length === 0) {
  console.log("No outboxes available");
}

// Get profile display name
const displayName = await note.author.profile$.displayName.$first(3000, "Unknown");
```

### `$last` Method

Similar to `$first`, but waits for the last value emitted before the observable completes:

:::info
Most observables will not complete automatically, which means in almost all cases this will wait for the full timeout.
:::

```typescript
const lastValue = await observable.$last(5000);
const lastValue = await observable.$last(5000, fallback);
```

## Casting in Observable Streams

Use `castEventStream` and `castTimelineStream` to cast events within RxJS pipelines:

### Single Event

```typescript
import { castEventStream } from "applesauce-common/observable";

const note$ = eventStore.event(eventPointer).pipe(castEventStream(Note, eventStore));
```

### Multiple Events

```typescript
import { castTimelineStream } from "applesauce-common/observable";

const notes$ = eventStore.timeline([{ kinds: [1] }]).pipe(castTimelineStream(Note, eventStore));
```

## Available Cast Classes

The casting system provides classes for common Nostr event types:

- **`Note`** - Kind 1 (Short text notes)
- **`Profile`** - Kind 0 (User metadata)
- **`User`** - User instance (not an event, but provides user-related observables)
- **`Reaction`** - Kind 7 (Reactions)
- **`Zap`** - Kind 9735 (Lightning zaps)
- **`Comment`** - NIP-22 comments
- **`Share`** - Kind 6 (Reposts)
- **`Article`** - Kind 30023 (Long-form articles)
- **`Mutes`** - Kind 10000 (Mute lists)
- **`BookmarksList`** - Kind 10003 (Bookmarks)
- **`Stream`** - Kind 30311 (Live streams)
- [And more...](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-common.Casts.html)

## User Class

The `User` class is special - it's not an event cast, but provides a rich interface for working with users:

### Synchronous Properties

```typescript
const user = castUser(pubkey, eventStore);

user.pubkey; // string - User's public key
user.npub; // string - NIP-19 encoded npub
user.pointer; // ProfilePointer - Profile pointer with relay hints
user.nprofile; // string - NIP-19 encoded nprofile
```

### Observable Properties

```typescript
// Profile metadata
user.profile$; // Observable<Profile | undefined>

// Contact list
user.contacts$; // Observable<User[]>

// Mute list
user.mutes$; // Observable<Mutes | undefined>

// Relay lists
user.outboxes$; // Observable<string[] | undefined>
user.inboxes$; // Observable<string[] | undefined>
user.favoriteRelays$; // Observable<FavoriteRelays | undefined>
user.searchRelays$; // Observable<SearchRelays | undefined>
user.blockedRelays$; // Observable<BlockedRelays | undefined>

// Bookmarks
user.bookmarks$; // Observable<BookmarksList | undefined>

// Groups (NIP-29)
user.groups$; // Observable<GroupsList | undefined>

// Live stream
user.live$; // Observable<Stream | undefined>
```

## Example: Contact Manager

Using `castUser` to manage contacts:

```typescript
import { castUser, User } from "applesauce-common/casts";
import { use$ } from "applesauce-react/hooks";

function ContactManager({ user }: { user: User }) {
  // Subscribe to user's contacts
  const contacts = use$(user.contacts$);
  const outboxes = use$(user.outboxes$);

  return (
    <div>
      <h1>Contacts ({contacts?.length || 0})</h1>
      {contacts?.map(contact => (
        <ContactCard key={contact.pubkey} user={contact} />
      ))}
    </div>
  );
}

// Create a user instance
const user = castUser(pubkey, eventStore);
```

## Example: Async Code

Using `$first` in async functions:

```typescript
async function publishNote(content: string, user: User) {
  // Wait for outboxes with 5 second timeout
  const outboxes = await user.outboxes$.$first(5000);

  if (!outboxes || outboxes.length === 0) {
    throw new Error("No outbox relays available");
  }

  // Create and publish event
  const event = await createNote(content);
  await pool.publish(outboxes, event);
}

async function getAuthorDisplayName(note: Note): Promise<string> {
  // Get display name with fallback
  return await note.author.profile$.displayName.$first(3000, "Anonymous");
}
```

## Caching

Cast instances are cached to avoid creating duplicate instances:

- **Events** - Each event can only be cast once per class type. Subsequent calls return the cached instance.
- **Users** - User instances are cached globally by pubkey. Creating a user with the same pubkey returns the existing instance.

This ensures referential equality and prevents unnecessary object creation.

## Best Practices

1. **Use observables for reactive data** - Properties that may change over time should use observables (ending with `$`)

2. **Use synchronous properties for static data** - Properties that don't change (like `id`, `createdAt`) are available directly

3. **Chain observables for nested data** - Use chainable observables to access nested properties: `note.author.profile$.displayName`

4. **Handle undefined values** - Observable properties may emit `undefined` while loading. Always check for undefined values

5. **Use `$first` in async code** - When you need to wait for a value in async functions, use `$first` with appropriate timeouts

6. **Cache user instances** - The `castUser` function automatically caches instances, so you can safely call it multiple times with the same pubkey

## Type Safety

All cast classes are fully typed. TypeScript will infer types for:

- Synchronous properties
- Observable properties (as `ChainableObservable<T>`)
- Chained observable properties

For better type inference in complex chains, you may need to explicitly type the result:

```typescript
const displayName$: Observable<string | undefined> = note.author.profile$.displayName;
```
