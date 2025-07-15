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

const profile = useObservableState(userProfileModel);
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
3. **Cache data appropriately** using loaders
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
const model = new UserProfileModel(pubkey, pool);
model.subscribe(profile => {
  console.log(profile.name, profile.picture);
});
```

### Managing Bookmarks

```typescript
// See bookmark-manager.tsx example for full implementation
const bookmarks = new UserBookmarkModel(pubkey, pool);
const action = new BookmarkEvent(factory, pool);
await action.bookmarkUrl("https://example.com");
```