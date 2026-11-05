---
description: Build NIP-04 and NIP-17 direct messaging with conversations, drafts, explicit decryption, and retryable sends
---

# Messaging clients

`applesauce-extra/messages` has two direct message clients that share the same shape:

- `LegacyMessagesClient` for [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) kind 4 messages, which most older clients still use.
- `WrappedMessagesClient` for [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) private messages sent in NIP-59 gift wraps, which hide who is talking to whom.

Both clients load messages into your app's `EventStore` through its `RelayPool`, group them into conversations, and handle decryption, drafts, sending, and relay authentication.

## How to use it

Create one client per account and protocol:

```ts
import { LegacyMessagesClient, WrappedMessagesClient } from "applesauce-extra/messages";

const legacy = new LegacyMessagesClient({ pubkey, signer, eventStore, pool });
const wrapped = new WrappedMessagesClient({ pubkey, signer, eventStore, pool });

wrapped.conversations$.subscribe(renderInbox);
await wrapped.start();
```

Set up the event store's profile and relay list loaders first; the clients use them to find each participant's inbox relays. The signer must belong to `pubkey`. Without a signer the client can still show cached messages but can't send or decrypt new ones.

When the user switches accounts, dispose the clients and create new ones. Disposing a client never closes the shared pool or event store.

### Conversations

`client.conversation(...)` returns a view of one conversation with its own `messages$`, drafts, and `send()`. Legacy conversations take one pubkey; wrapped conversations take a list of participants, so group chats work too:

```ts
const chat = wrapped.conversation([alice, bob]);
chat.messages$.subscribe(renderMessages);

await chat.send({ content: "Hello" });
```

The two protocols load conversations differently:

- **Legacy** messages can be filtered by correspondent, so a conversation can load on its own without starting the whole inbox. Subscribe to `conversation.watch$()` to load while a view is open.
- **Wrapped** messages only reveal their participants after decryption, so the client loads the whole inbox and each conversation is a local, filtered view of it.

Legacy messages are kind 4 events with encrypted content; read the plaintext with `getEncryptedContent()` or `EncryptedContentModel`. Wrapped conversations return the decrypted kind 14 and 15 rumors directly.

### Loading history

`start()` keeps live messages flowing and loads a recent window. To go further back, call `loadHistory()` with a time range, or subscribe to `sync$()` to show progress:

```ts
const result = await legacy.loadHistory({ since, until });
```

A finished load can still include relays that failed, and loaded messages may still be locked. Check both before telling the user their history is complete. For infinite scroll in a legacy conversation, use `conversation.createTimelineLoader()` with the [timeline loader](../loading/loaders/timeline-loader.md).

## Decryption and signer prompts

The clients never ask the signer to decrypt in the background unless you opt in. Showing `messages$` or `conversations$` only reveals messages that are already decrypted or cached. Unlock from a user action, or enable background decryption once the user agrees:

```ts
await wrapped.unlock(); // decrypt what's loaded now
wrapped.setAutoUnlock(true); // keep decrypting new messages
```

`decryptionState$` reports how many messages are locked, unlocked, or failed, which is useful for an "Unlock messages" button. Retry a failed message with `retryDecryption(event)`.

`readMessages$()` actively decrypts while subscribed, even with `autoUnlock` off. Use it when you want a reader that processes messages, not for passive rendering.

## Sending and drafts

Check `discover(...)` before offering to send so the UI can explain when a participant has no inbox relays. Wrapped messages need kind 10050 inbox relays for every participant, including the sender.

Messages support replies with `replyTo` and optional expirations. File attachments are covered in [Encrypted files](../features/files/encrypted-files.md).

Conversations keep a draft in `draft$` with `setDraft()`, `loadDraft()`, and `clearDraft()`. Pass `draftStorage` to keep drafts between sessions. Sending doesn't clear the draft, so clear it yourself after a successful send. Legacy conversations also have `prepareDraft()`, which signs the current draft and clears it only if the user hasn't edited it in the meantime.

### Retrying failed sends

Both clients split sending into prepare and publish steps so a failed publish can be retried without signing or encrypting again. Never call `send()` again to retry; that creates a new message.

For wrapped messages, keep the prepared handle and publish it again. The retry skips recipients whose relays already accepted it:

```ts
const prepared = await wrapped.prepareSend({ recipients: [alice], content: "Hello" });

try {
  await prepared.publish();
} catch (error) {
  showRetryButton(() => prepared.publish());
}
```

Wrapped handles only live in memory. Legacy messages can go further: pass `publicationStorage` and unsent messages survive a reload. Load them again with `conversation.loadPublications()` or `pendingPublications$`, then call `publish(messageId)` or `discardPublication(messageId)`.

A relay accepting a message means it was published, not that the recipient has read it.

## Integration

### Share an application receiver

The wrapped client creates its own [GiftWrapReceiver](./gift-wrap.md) by default. If your app already has a receiver for the account, pass it in so both features share one inbox:

```ts
const receiver = new GiftWrapReceiver({ pubkey, signer, eventStore, pool });
const wrapped = new WrappedMessagesClient({ pubkey, signer, eventStore, pool, receiver });

await receiver.start();
```

The app then owns loading and decryption: `wrapped.start()` won't open subscriptions, and `wrapped.setAutoUnlock()` changes the setting for everyone using the receiver. To configure a receiver the client creates itself, pass `receiverOptions` instead, for example to keep rumors in a database with `rumorStore`.

### Relay authentication

Relays that require [NIP-42 authentication](/loading/relays/authentication) add a request to `authRequests$`. Authenticating signs an event, so treat it as its own user action, separate from decrypting:

```ts
legacy.authRequests$.subscribe(showAuthRequests);

await legacy.authenticate(relayUrl); // approve one relay
await wrapped.authenticateAll(); // or every pending relay
```

Use `onAuthRequired` to apply an app-wide policy instead of asking each time.

### Storage

The app decides what's stored and how it's protected. All of these are optional:

| Option                | Stores                                               |
| --------------------- | ---------------------------------------------------- |
| `cacheRequest`        | Encrypted messages loaded from a local event cache   |
| `decryptionCache`     | Decrypted plaintext, so the signer isn't asked again |
| `draftStorage`        | Drafts                                               |
| `publicationStorage`  | Legacy messages waiting to be published              |
| `conversationStorage` | Legacy correspondents the user has talked to         |
| `draftFileStorage`    | Wrapped draft attachments, **unencrypted**           |

Storage keys aren't namespaced by account or protocol, so give each client its own adapter. Plaintext caches and drafts are private data; encrypt them at rest.

**Examples:** [Legacy messages](https://applesauce.build/examples/#/example/messages/legacy), [Gift-wrap messages](https://applesauce.build/examples/#/example/messages/gift-wrap)

For forward-secret messaging with multiple devices, see [Double-ratchet messaging](./ndr.md). For hosting messaging inside napplets, see [napplet messaging](../napplets/messaging.md).

## Best Practices

- Share one client per account and protocol, and let each view unsubscribe from only what it opened.
- Keep rendering passive; unlocking, authenticating, and sending should come from user actions.
- Retry a failed send through its prepared handle or message ID, never by sending again.
- Pass `{ signal }` to cancel long operations when a view closes.
- Report relay coverage and decryption progress separately; a finished load isn't a readable inbox.
