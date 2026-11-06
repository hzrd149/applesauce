---
description: Build NIP-04 and NIP-17 direct messaging with conversations, drafts, explicit decryption, and retryable sends
---

# Messaging clients

`applesauce-extra/messages` has two direct message clients:

- `LegacyMessagesClient` for [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) kind 4 messages, which most older clients still use.
- `WrappedMessagesClient` for [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) private messages sent in NIP-59 gift wraps, which hide who is talking to whom.

Both clients use your app's `RelayPool` and encrypted-event `EventStore`. The wrapped client delegates receiving and decryption to `GiftWrapReceiver`, which writes validated plaintext into a separate `RumorStore` or `AsyncRumorStore`.

## How to use it

Create one client per account and protocol:

```ts
import { LegacyMessagesClient, WrappedMessagesClient } from "applesauce-extra/messages";

const legacy = new LegacyMessagesClient({ pubkey, signer, eventStore, pool });
const wrapped = new WrappedMessagesClient({ pubkey, signer, eventStore, pool });

await wrapped.start();
```

Set up the event store's profile and relay list loaders first; the clients use them to find each participant's inbox relays. The signer must belong to `pubkey`. Without a signer the client can still show cached messages but can't send or decrypt new ones.

When the user switches accounts, dispose the clients and create new ones. Disposing a client never closes the shared pool or event store.

### Conversations

`client.conversation(...)` returns a handle with drafts and sending methods. Legacy conversations take one pubkey; wrapped conversations take a list of participants, so group chats work too. Wrapped reads use ordinary NIP-01 filters over the shared rumor store:

```ts
const chat = wrapped.conversation([alice, bob]);
chat.timeline$({ since, until }).subscribe(renderMessages);

await chat.send({ content: "Hello" });
```

The two protocols load conversations differently:

- **Legacy** messages can be filtered by correspondent, so a conversation can load on its own without starting the whole inbox. Subscribe to `conversation.watch$` to load while a view is open.
- **Wrapped** messages only reveal their participants after decryption. The receiver loads envelopes for the account; conversation handles query the shared rumor store without creating local copies or loading relays.

Legacy messages are kind 4 events with encrypted content; read the plaintext with `getEncryptedContent()` or `EncryptedContentModel`. Wrapped conversations return the decrypted kind 14 and 15 rumors directly.

### Query stored rumors

Use `wrapped.rumorStore` for the existing store APIs: `getEvent`, `getByFilters`, `getTimeline`, `filters`, `timeline`, and `model`. `wrapped.messageFilters` selects the account's kind-14 and kind-15 rumors, including sent messages. Queries never invoke the decryption signer.

```ts
const filters = wrapped.messageFilters.map((filter) => ({ ...filter, since, until }));
const messages = await wrapped.rumorStore.getTimeline(filters);
const incoming$ = wrapped.rumorStore.filters(filters, true);
const replies$ = chat.replies$(parentId, { since, until });
```

`chat.getMessages(filter)` reads one snapshot; `chat.timeline$(filter)` watches a selected window. Both apply `chat.matches(rumor)` after the store query because NIP-01 filters cannot express exact participant-set equality. `chat.filter` exposes the candidate filter for custom store models.

A `limit` applies to candidate events **before** exact participant matching, so the resulting conversation list can be shorter or empty. It also limits only the initial store timeline query, not later matching arrivals. Use explicit `since`/`until` windows for history views; there is no automatic full-inbox array or custom cursor API.

### List conversations

Both clients keep a conversation index with one entry per conversation: its `id`, `lastMessageId`, and `lastActivity`. Messages are recorded as they arrive, from the event store for legacy and the rumor store for wrapped. Page through it newest first with `conversations()`, and watch `conversationUpdates$` for conversations whose newest message changed:

```ts
for await (const summary of wrapped.conversations({ until })) {
  renderRow(summary); // { id, participants, lastActivity, lastMessage? }
  if (++count === 30) break;
}

wrapped.conversationUpdates$.subscribe((summary) => moveToTop(summary));
```

Legacy summaries also include the `correspondent`, so a row can open `legacy.conversation(summary.correspondent)`.

The index defaults to memory. Pass a `conversationIndex` store to persist it, so the list renders before any message is loaded or decrypted again. A store implements `get(id)`, `set(entry)`, and `list({ until })`, which returns entries newest first as an array or an async iterable. In the browser, `IndexedDBConversationIndexStore` stores the index in IndexedDB. Give each account and protocol its own database:

```ts
const conversationIndex = await IndexedDBConversationIndexStore.open(`legacy-conversations:${pubkey}`);
const legacy = new LegacyMessagesClient({ pubkey, signer, eventStore, pool, conversationIndex });
```

Messages stored before the index existed are not indexed automatically. Call `indexConversations({ since, until })` once to scan them in pages: legacy scans its `cacheRequest` event cache and wrapped scans its rumor store. `lastMessage` is `undefined` when the message isn't loaded. Failed index writes appear on legacy's `conversationIndexError$` and as `storage` errors on wrapped's `errors$`.

### Loading history

`start()` keeps live messages flowing and loads a recent window. To go further back, call `loadHistory()` with a time range, or subscribe to `sync$()` to show progress:

```ts
const result = await legacy.loadHistory({ since, until });
```

A finished load can still include relays that failed, and loaded messages may still be locked. Check both before telling the user their history is complete. For infinite scroll in a legacy conversation, use `conversation.createTimelineLoader()` with the [timeline loader](../loading/loaders/timeline-loader.md).

## Decryption and signer prompts

The clients never ask the signer to decrypt in the background unless you opt in. Reading the wrapped rumor store only reveals messages already processed by the receiver. Unlock from a user action, or enable background decryption once the user agrees:

```ts
await wrapped.unlock(); // decrypt what's loaded now
wrapped.setAutoUnlock(true); // keep decrypting new messages
```

`decryptionState$` reports how many messages are locked, unlocked, or failed, which is useful for an "Unlock messages" button. Retry a failed message with `retryDecryption(event)`.

For explicit wrapped processing, use `wrapped.receiver.unlock(envelope)` or iterate `wrapped.receiver.readInbox({ signal })`. Observe receiver outcomes through `receive$` and stored messages through the rumor store. Legacy `readMessages$()` retains its active-decryption behavior.

### Legacy receiving modes

NIP-04 messages are received in two ways, each with its own receiver:

- `legacy.receiver` is a `LegacyInboxReceiver`. It reads the whole account from the owner's own inbox, DM and outbox relays.
- `conversation.receiver` is a `LegacyConversationReceiver`. It reads one conversation from both participants' relays, so messages the peer only sent to their own outboxes are still found.

Both receivers share one `LegacyMessageDecryptor`, so an event loaded by both is decrypted once, with one signer prompt at a time. They have the same explicit processing methods as the gift-wrap receiver:

```ts
for await (const result of legacy.receiver.readInbox({ signal })) {
  if (result.status === "failed") showFailure(result.failure);
}
```

## Sending and drafts

Check `discover(...)` before offering to send so the UI can explain when a participant has no inbox relays. Wrapped messages need kind 10050 inbox relays for every participant, including the sender.

Messages support replies with `replyTo` and optional expirations. File attachments are covered in [Encrypted files](../features/files/encrypted-files.md).

Wrapped sends use the explicit `expiration` and `envelopeExpiration` request fields. They do not query message history to infer an expiration policy.

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

The app then owns loading and decryption: `wrapped.start()` won't open subscriptions, and `wrapped.setAutoUnlock()` changes the setting for everyone using the receiver. Use `receiverOptions` for receiver-specific construction policies such as processing concurrency.

The legacy client works the same way with a `LegacyInboxReceiver`. Its conversations reuse the injected receiver's decryptor and relay authentication:

```ts
const receiver = new LegacyInboxReceiver({ pubkey, signer, eventStore, pool });
const legacy = new LegacyMessagesClient({ pubkey, signer, eventStore, pool, receiver });
```

### Share a rumor store

Pass `rumorStore` at the top level to use an application-owned `RumorStore` or database-backed `AsyncRumorStore`. The client and receiver expose the same instance:

```ts
const rumorStore = new AsyncRumorStore({ database });
const wrapped = new WrappedMessagesClient({ pubkey, signer, eventStore, pool, rumorStore });

await wrapped.receiver.unlock(envelope);
const rumor = await rumorStore.getEvent(messageId);
wrapped.dispose(); // The application still owns rumorStore
```

Without an injected store or receiver, the receiver creates and owns an in-memory `RumorStore`. With an injected receiver, the client uses `receiver.rumorStore`; supplying a different `rumorStore` is an error.

Wrapped conversation handles have no disposal lifecycle. Unsubscribe to release a query view and pass an operation `signal` to cancel a query or send. The client owns draft state and cleans it up on disposal; conversation queries remain usable while the shared rumor store is usable.

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

| Option               | Stores                                                      |
| -------------------- | ----------------------------------------------------------- |
| `cacheRequest`       | Encrypted messages loaded from a local event cache          |
| `decryptionCache`    | Decrypted plaintext, so the signer isn't asked again        |
| `rumorStore`         | Validated wrapped rumors, queried through normal store APIs |
| `draftStorage`       | Drafts                                                      |
| `publicationStorage` | Legacy messages waiting to be published                     |
| `draftFileStorage`   | Wrapped draft attachments, **unencrypted**                  |
| `conversationIndex`  | Conversation ids, newest message ids, and timestamps        |

Storage keys aren't namespaced by account or protocol, so give each client its own adapter. Plaintext caches and drafts are private data; encrypt them at rest.

**Examples:** [Legacy messages](https://applesauce.build/examples/#/example/messages/legacy), [Gift-wrap messages](https://applesauce.build/examples/#/example/messages/gift-wrap)

For forward-secret messaging with multiple devices, see [Double-ratchet messaging](./ndr.md). For hosting messaging inside napplets, see [napplet messaging](../napplets/messaging.md).

## Best Practices

- Share one client per account and protocol, and let each view unsubscribe from only what it opened.
- Keep rendering passive; unlocking, authenticating, and sending should come from user actions.
- Retry a failed send through its prepared handle or message ID, never by sending again.
- Pass `{ signal }` to cancel long operations when a view closes.
- Report relay coverage and decryption progress separately; a finished load isn't a readable inbox.
