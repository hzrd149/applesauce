---
description: Cache decrypted event content and restore plaintext to avoid repeated signer requests
---

# Caching Encrypted Content

The `persistEncryptedContent` function from `applesauce-common/helpers` persists and restores decrypted event content. Cache values are plaintext; encrypt the storage at rest and scope it to the intended account.

## Overview

When working with encrypted events (like direct messages, gift wraps, or wallet data), decrypting content can be expensive or require user interaction. The `persistEncryptedContent` helper automatically:

- **Persists** plaintext to storage when events are unlocked/decrypted
- **Restores** plaintext from storage when events are loaded
- **Handles** gift wrap seals automatically
- **Works** with any storage backend that implements the `EncryptedContentCache` interface

## Basic Setup

Pass the application's event store and an account-scoped cache. Storage implements `getItem` and `setItem`; the application supplies its encryption at rest:

```typescript
import { persistEncryptedContent } from "applesauce-common/helpers";
import { unlockLegacyMessage } from "applesauce-common/helpers";

const cleanup = persistEncryptedContent(eventStore, accountStorage);
eventStore.add(message);
await unlockLegacyMessage(message, pubkey, signer); // From a user action

// When this account's persistence owner ends:
cleanup();
```

## Implementing EncryptedContentCache

Storage methods may return values synchronously or return promises. The cache helpers remain asynchronous and support both forms:

```typescript
interface EncryptedContentCache {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<any>;
}
```

## Direct Cache Access

Apps and signers can use the cache helpers from `applesauce-core/helpers` without an EventStore. They are also re-exported from `applesauce-common/helpers` for compatibility. All helpers use the event ID as the storage key, matching `persistEncryptedContent`.

```typescript
import { getOrDecryptEncryptedContent } from "applesauce-core/helpers";

const plaintext = await getOrDecryptEncryptedContent(event, storage, (event) =>
  signer.nip44.decrypt(peerPubkey, event.content),
);
```

`getOrDecryptEncryptedContent` returns plaintext already on the event or in storage before calling `decrypt`. On a miss, it attaches the returned plaintext to the event and awaits its storage write. The callback chooses the encryption method and peer public key.

For separate restore and save steps:

```typescript
import { restoreEncryptedContent, saveEncryptedContent } from "applesauce-core/helpers";
import { unlockEncryptedContent } from "applesauce-core/helpers";

const restored = await restoreEncryptedContent(event, storage);
if (restored === undefined) {
  await unlockEncryptedContent(event, peerPubkey, signer);
  await saveEncryptedContent(event, storage);
}
```

`restoreEncryptedContent` returns `undefined` on a miss and marks restored content before notifying event observers. `saveEncryptedContent` returns `false` for a locked event. Empty plaintext is a valid cache entry. These helpers reject on storage or decryption errors; if a write fails after decryption, plaintext remains available on the event and `saveEncryptedContent` can retry the write.

### Restoring an Event Stream

Use `restoreEncryptedContentFromCache` before consumers that need cached plaintext:

```typescript
import { restoreEncryptedContentFromCache } from "applesauce-core/observable";

const restoredEvents$ = events$.pipe(restoreEncryptedContentFromCache(storage, 8));
```

The operator defaults to eight concurrent lookups and emits each original event after its restore attempt. Cache misses and failures still emit the event; failures are logged. Unsupported kinds and already unlocked events pass through without a lookup. Parallel lookups may reorder events; set concurrency to `1` to preserve order. Completion waits for pending lookups. Unsubscribing stops queued lookups and emissions, but an in-flight cache read may still update its event.

### Integration

Use the same storage instance with these helpers and `persistEncryptedContent` to share cached plaintext. Direct helpers operate on one event at a time; pass gift wraps and seals separately when managing their lifecycle yourself. Keep storage scoped to the intended account or session.

The [Gift-wrap Receiver](/extra/gift-wrap) manages restoration and saving of both encryption layers through its `decryptionCache` option. For conversation-level loading and decryption controls, see [Messaging Clients](/extra/messages).

## How It Works

1. **When events are inserted** into the store, `persistEncryptedContent` checks if they have encrypted content that's locked
2. If locked, it attempts to restore plaintext from your storage
3. **When events are unlocked/decrypted**, it automatically saves plaintext to storage
4. **For gift wraps**, it also handles seals automatically - when a gift wrap is unlocked, it restores and persists the seal's plaintext

## Using with Observable Storage

You can pass either a storage instance directly or an Observable of storage. This is useful when an account's storage needs to be unlocked asynchronously:

```typescript
// Using Observable pattern (recommended)
import { BehaviorSubject } from "rxjs";
import { defined } from "applesauce-core/observable";

const storage$ = new BehaviorSubject<SecureStorage | null>(null);

const cleanup = persistEncryptedContent(eventStore, storage$.pipe(defined()));

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

The function returns a cleanup function that you can call to stop persisting/restoring. Call it when the account session ends before wiring another account's cache. Cleanup does not erase plaintext already attached to events; dispose account-owned private stores and views separately.

```typescript
const cleanup = persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Later, when you want to stop:
cleanup();
```

## Best Practices

1. **Match the account lifecycle** - Use observable storage for delayed initialization, and stop the old persistence process when changing accounts
2. **Handle errors gracefully** - The function logs errors but doesn't throw, so your app continues working even if caching fails
3. **Protect plaintext** - Cache values are decrypted content; use account-scoped storage encrypted at rest
