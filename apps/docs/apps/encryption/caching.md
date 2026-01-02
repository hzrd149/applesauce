# Caching Encrypted Content

The `persistEncryptedContent` function from `applesauce-common/helpers` provides automatic persistence and restoration of encrypted content for Nostr events. This allows your application to cache decrypted content so users don't need to decrypt the same events repeatedly.

## Overview

When working with encrypted events (like direct messages, gift wraps, or wallet data), decrypting content can be expensive or require user interaction. The `persistEncryptedContent` helper automatically:

- **Persists** encrypted content to storage when events are unlocked/decrypted
- **Restores** encrypted content from storage when events are loaded
- **Handles** gift wrap seals automatically
- **Works** with any storage backend that implements the `EncryptedContentCache` interface

## Basic Setup

The simplest way to use encrypted content caching is to pass your event store and a storage observable. Here's an example using `localforage`:

```typescript
import { persistEncryptedContent } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { BehaviorSubject } from "rxjs";
import { defined } from "applesauce-core";
import localforage from "localforage";

// Create your event store
const eventStore = new EventStore();

// Create a localforage instance for encrypted content
const encryptedContentStorage = localforage.createInstance({
  name: "encrypted-content",
});

// Start persisting and restoring encrypted content
persistEncryptedContent(eventStore, encryptedContentStorage);

// Insert an event into the store that can have encrypted content
eventStore.add(bookmarks);
eventStore.add(nip04Message);
eventStore.add(giftWrap);

// Decrypt the events content
await unlockHiddenBookmarks(bookmarks, signer);
await unlockLegacyMessage(nip04Message, signer);
await unlockGiftWrap(giftWrap, signer);

// The decrypted content is now stored in the cache
```

## Implementing EncryptedContentCache

Your storage class must implement the `EncryptedContentCache` interface:

```typescript
interface EncryptedContentCache {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<any>;
}
```

## Complete Example

Here's a complete example showing how it's used in practice:

```typescript
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { defined, EventFactory, EventStore } from "applesauce-core";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { persistEventsToCache } from "applesauce-core/helpers";
import { BehaviorSubject } from "rxjs";
import { ExtensionSigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";

// Setup application state
const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ExtensionSigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

// Setup event store
const eventStore = new EventStore();
const factory = new EventFactory({
  signer: new ProxySigner(signer$.pipe(defined())),
});
const actions = new ActionRunner(eventStore, factory);

// Persist encrypted content - this is the key line!
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Later, when storage is unlocked/initialized:
storage$.next(new SecureStorage(/* ... */));
```

## How It Works

1. **When events are inserted** into the store, `persistEncryptedContent` checks if they have encrypted content that's locked
2. If locked, it attempts to restore the encrypted content from your storage
3. **When events are unlocked/decrypted**, it automatically saves the encrypted content to storage
4. **For gift wraps**, it also handles seals automatically - when a gift wrap is unlocked, it restores and persists the seal's encrypted content

## Using with Observable Storage

You can pass either a storage instance directly or an Observable of storage. This is useful when storage needs to be unlocked asynchronously:

```typescript
// Using Observable pattern (recommended)
const storage$ = new BehaviorSubject<SecureStorage | null>(null);

persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Later, when storage is ready:
await storage.unlock(pin);
storage$.next(storage);
```

## Fallback Function

You can optionally provide a fallback function that will be called when encrypted content is not found in storage:

```typescript
persistEncryptedContent(eventStore, storage$.pipe(defined()), async (event) => {
  // This function is called when content is not in storage
  // You could fetch from another source, decrypt on-demand, etc.
  return await fetchEncryptedContentFromAnotherSource(event.id);
});
```

## Stopping the Process

The function returns a cleanup function that you can call to stop persisting/restoring:

```typescript
const cleanup = persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Later, when you want to stop:
cleanup();
```

## Best Practices

1. **Use Observable pattern** - Pass an Observable of storage rather than the storage directly, so you can handle async initialization or multiple storage instances for each user
2. **Handle errors gracefully** - The function logs errors but doesn't throw, so your app continues working even if caching fails
3. **Store securely** - Since you're storing encrypted content, make sure your storage implementation is secure (encrypted at rest, etc.)
