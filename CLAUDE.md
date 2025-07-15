# Applesauce - Nostr Development Framework

## Overview

Applesauce is a comprehensive TypeScript framework for building Nostr applications. It provides modular packages for handling events, signers, relays, and various Nostr protocol features.

## Core Architecture

### Package Structure

```
applesauce/
├── packages/
│   ├── core/           # Core types, helpers, and models
│   ├── signers/        # Various signer implementations
│   ├── factory/        # Event creation and signing
│   ├── relay/          # Relay connection management
│   ├── actions/        # High-level actions (bookmarks, profiles, etc.)
│   ├── loaders/        # Data loading utilities
│   ├── react/          # React hooks and components
│   └── examples/       # Example implementations
```

## Key Concepts

### 1. Signers

Signers handle private key management and event signing. Available types:

- **ExtensionSigner**: Integrates with browser extensions (NIP-07)
- **NostrConnectSigner**: Remote signing via NIP-46
- **PasswordSigner**: Encrypted key storage (NIP-49)
- **PrivateKeySigner**: Direct private key usage

### 2. Event Factory

The `EventFactory` simplifies event creation:

```typescript
const factory = new EventFactory({ signer });
const note = await factory.note("Hello Nostr!");
const signed = await factory.sign(note);
```

### 3. Relay Management

```typescript
const pool = new RelayPool();
pool.addRelays(["wss://relay.damus.io", "wss://nos.lol"]);
```

### 4. Models & Loaders

Models provide reactive data access:
- `UserProfileModel`: User profile data
- `UserBookmarkModel`: Bookmark management
- `UserContactsModel`: Contact lists

Loaders fetch and cache data:
- `userListsLoader`: NIP-51 lists
- `timelineLoader`: Event timelines
- `socialGraphLoader`: Social connections

## Common Patterns

### Authentication Flow

1. Select signer type (extension, nostr connect, password)
2. Initialize signer with appropriate config
3. Get public key for identification
4. Use factory for event creation

### Bookmark Management (NIP-51)

```typescript
// Load bookmarks
const actions = new ActionHub(eventStore, factory);

// Add bookmark
await actions.exec(BookmarkEvent, <nostr event>).forEach(e => pool.publish(<relays>, e))

// Remove bookmark
await actions.exec(UnbookmarkEvent, <nostr event>).forEach(e => pool.publish(<relays>, e))

### React Integration

```typescript
import { useObservableState } from "applesauce-react/hooks";
import { UserProfileModel } from "applesauce-core/models";

// useObservableState works similar to useMemo - it takes a function that returns an observable
const profile = useObservableState(() => eventStore.model(UserProfileModel, pubkey));
```

## Testing & Development

- Run examples: `pnpm dev` in packages/examples
- Test suite: `pnpm test`
- Type checking: `pnpm typecheck`

## Important NIPs Implemented

- NIP-01: Basic protocol
- NIP-04: Encrypted DMs (legacy)
- NIP-07: Browser extension signing
- NIP-17: Gift wrapped messages
- NIP-46: Nostr Connect
- NIP-49: Password encrypted keys
- NIP-51: Lists and sets
- NIP-57: Zaps
- NIP-59: Gift wrapping

## Best Practices

1. **Always check signer availability** before attempting to use
2. **Handle relay disconnections** gracefully
3. **Cache data appropriately** using EventStore or nostr-idb (Note: Loaders only fetch from relays, they don't cache)
4. **Use TypeScript types** for event validation
5. **Follow NIP specifications** for interoperability

## Common Tasks

### Creating a Simple Note

```typescript
const factory = new EventFactory({ signer });
const note = await factory.note("Hello world!");
const signed = await factory.sign(note);
await pool.publish(signed);
```

### Loading User Profile

```typescript
const addressLoader = addressPointerLoader(pool.request.bind(pool), {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});

/** A model that loads the profile if its not found in the event store */
function ProfileQuery(user: ProfilePointer): Model<ProfileContent | undefined> {
  return (events) =>
    merge(
      // Load the profile if its not found in the event store
      defer(() => {
        if (events.hasReplaceable(kinds.Metadata, user.pubkey)) return EMPTY;
        else return addressLoader({ kind: kinds.Metadata, ...user }).pipe(ignoreElements());
      }),
      // Subscribe to the profile content
      events.profile(user.pubkey),
    );
}

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return useObservableMemo(() => eventStore.model(ProfileQuery, user), [user.pubkey, user.relays?.join("|")]);
}

### Managing Bookmarks

```typescript
import { UserBookmarkModel } from "applesauce-core/models";
import { BookmarkEvent } from "applesauce-actions/actions";

// Subscribe to a user's bookmarks using the event store
const observable = eventStore.model(UserBookmarkModel, pubkey);

observable.subscribe(bookmarks => {
  // bookmarks will be an object with "notes" (kind 1), "articles" (kind 30023), "hashtags", and "urls"
  console.log(bookmarks.notes);
  console.log(bookmarks.urls);
});

// To add bookmarks, use the action
const action = new BookmarkEvent(factory, pool);
await action.bookmarkUrl("https://example.com");
```