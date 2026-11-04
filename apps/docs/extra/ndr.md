---
description: Run nostr-double-ratchet messaging and app-key device management on an Applesauce RelayPool, EventStore, and account signer
---

# Double-ratchet messaging

`NdrMessagesClient` runs the upstream `nostr-double-ratchet` runtime for one account: it owns the runtime, persistent outbox, decrypted history, and app-key devices, and exposes them as observables. `createNdrTransport` is the lower-level piece it is built on, for applications that manage the runtime themselves.

Install the optional peer `nostr-double-ratchet@0.0.183` to use either. Import them separately from `applesauce-extra/messages/ndr`; the generic messages entry point does not load or re-export NDR.

## Messages client

Give the client the account, the shared `pool` and `eventStore`, explicit NDR relays, and one durable, account/device-scoped `StorageAdapter`. The application must encrypt this storage at rest; the client does not add encryption:

```ts
import { NdrMessagesClient } from "applesauce-extra/messages/ndr";

const client = new NdrMessagesClient({ pubkey, signer, pool, eventStore, relays: NDR_RELAYS, storage });
await client.start(); // restores history, takes the account lock, and initializes the runtime
client.conversations$.subscribe(renderInbox);

client.dispose(); // on logout or account change
```

`createNdrStorage(store)` wraps a string key/value store with `getItem`, `setItem`, `removeItem`, and `keys` as a JSON `StorageAdapter`. It serializes values, but does not encrypt them; use an encrypting store for device secrets, ratchet state, and decrypted content:

```ts
import { createNdrStorage } from "applesauce-extra/messages/ndr";

const storage = createNdrStorage(encryptedStore);
```

Where Web Locks are available, `start()` holds a lock (`ndr:<pubkey>` by default) until disposal. Lock contention rejects `start()` and reports `lifecycle$` as `locked`; dispose the failed client and create a new instance to retry. Calling `start()` again on that instance returns the same rejected promise. Without Web Locks, or with `lockName: false`, the application must enforce single-writer storage isolation.

Lifecycle `ready` means initialization finished, not that this device is registered or able to send. Observe `state$` for runtime registration and `canSendPrivateMessages`, and the conversation's `canSend$` for peer readiness. Protocol state lives under the runtime's `v1/` keys, and decrypted history under `app/`; relay envelopes alone cannot rebuild either.

### Conversations

`client.conversation(peer)` returns an `NdrConversation` with `messages$`, `typing$`, `ttl$`, `peerDevices$`, and `canSend$`. Messages arrive newest first, with reactions grouped by content and receipts applied:

```ts
const chat = client.conversation(peer);
await chat.send({ content: "hi", replyTo: parentId });
await chat.react(messageId, "👍");
await chat.markSeen(); // seen receipt for unread incoming messages
chat.sendTyping(); // throttled
await chat.setTtl(86400); // disappearing messages for both sides
```

`draft$`, `setDraft()`, and `sendDraft()` use draft records backed by the client's `storage`; their protection depends on that store. Pass `draftFileStorage` to persist staged file bytes too. `sendDraft(attachments)` requires already-uploaded metadata: it does not upload `draft.files`. Calling it without attachments on a text-and-files draft sends only the text, then clears the unchanged draft, including its staged files. See [upload-before-sendDraft](../features/encrypted-files.md#draft-attachments).

The client sends a delivered receipt when an incoming message is first stored; set `deliveredReceipts: false` to disable it.

With an `upload` option on the client, `uploadFile()` encrypts a file and uploads the ciphertext. Attachments go out as `imeta` tags on a kind 14 message, with each URL also in the content so other NDR apps show a link; incoming NIP-17 kind 15 file messages are read too. See [Encrypted Files](../features/encrypted-files.md).

```ts
const file = await chat.uploadFile(input.files[0]);
await chat.send({ content: "Here's the photo", attachments: [file] });
```

A message's `delivery` is `queued` when it is encrypted and saved locally, `published` once a relay accepts an envelope, and `delivered` or `seen` when peer receipts arrive. Incoming messages are `received`.

Observe `errors$` for background failures (`{ operation, error }`) and `pendingPublications$` for the persistent outbox's envelope count. Call `retryPublications()` after connectivity returns to retry the original signed envelopes, not `send()` again. Startup also starts outbox recovery; see [Messages](./messages.md) for lifecycle and recovery patterns.

### Devices and linking

`devices$` lists the owner's app-key devices with local labels. Registration is two steps so the new roster can be reviewed before the signer prompt:

```ts
const prepared = await client.prepareRegistration("Laptop");
await client.publishRegistration(prepared, "Laptop"); // signs the roster, then publishes this device's invite
await client.republishInvite(); // retry invite publication for an already registered device
await client.revokeDevice(identityPubkey);
```

A device without the account signer can still be linked. Create its client without `signer`, then approve its link URL from a signed-in device:

```ts
const url = await linkedClient.createLinkInvite();
await ownerClient.approveLink(url, "Phone"); // opens a session and adds the device to the app keys
```

The linked device publishes its own invite once it sees itself in the roster. It can send and receive, but cannot register or revoke devices.

### Groups

`client.createGroup(name, members)` sends the roster to every member and returns an `NdrGroupConversation`. Invited members see `group$` with `accepted: false` until they call `accept()`. Admins can `addMember()`, `removeMember()`, and `rename()`; removing a member rotates this device's sender key. `pending$`, `admin$`, and `canSend$` derive the invitation, admin, and send state from the roster and the runtime.

Group summaries in `conversations$` carry a `groupId`, and `getNdrGroupId(conversationId)` returns it from a `group:<id>` conversation ID:

```ts
const groupId = getNdrGroupId(selected);
const conversation = groupId ? client.group(groupId) : client.conversation(selected);
```

**Example:** [Double-ratchet Messages](https://applesauce.build/examples/#/example/messages/ndr)

## Transport hooks

Given your application's `pool`, `eventStore`, resolved account `signer`, and `ownerPubkey`:

```ts
import { createNdrTransport } from "applesauce-extra/messages/ndr";

const transport = createNdrTransport(
  { pool, eventStore },
  {
    ownerPubkey,
    signer,
    relays: ["wss://your-ndr-relay.example/"],
    fetchTimeoutMs: 4000,
    actionTimeoutMs: 60000,
    onSubscriptionError: reportError,
  },
);
```

`NdrTransportContext`, `NdrTransportOptions`, and `NdrTransport` describe these dependencies, options, and upstream-compatible hooks. Relays must be explicit and nonempty: ephemeral device/session keys do not necessarily have NIP-65 mailboxes. The signer must stay bound to `ownerPubkey`; recreate the transport when accounts change. Omit it for a linked device, which signs only device envelopes; `nostrSign` then rejects.

`nostrSign` fills an empty owner-pubkey placeholder and checks the signer's identity, signature, and exact event hash. `nostrPublish` preserves already-signed device/session envelopes without calling the owner signer. It resolves only after at least one relay accepts the exact envelope, then caches it; rejection is not cached. Neither operation requests an owner secret key or replaces application approval.

## Integration

Provide durable, account-scoped implementations of upstream `StorageAdapter` for `protocolStorage` and `outboxStorage`. Protect device secrets and ratchet state at rest, and allow only one runtime writer per account/device storage scope. The shared EventStore holds signed relay envelopes, not protocol state or decrypted message history.

Use upstream's persistent outbox rather than retrying plaintext sends or advancing the ratchet again:

```ts
import { createPersistentNostrOutbox, NdrRuntime } from "nostr-double-ratchet";

const outbox = createPersistentNostrOutbox({
  storage: outboxStorage,
  publish: transport.nostrPublish,
  onError: reportPublicationError,
});
const runtime = new NdrRuntime({
  ...transport,
  storage: protocolStorage,
  nostrEnqueue: outbox.enqueue,
  nostrPublish: outbox.publish,
  onPublishError: reportPublicationError,
});
// Attach application message consumers before initialization.
await runtime.initForOwner(ownerPubkey);
await outbox.retry();
```

Complete device registration and invite setup explicitly before sending. A runtime send/enqueue can mean **persisted locally**, not relay ACK. The outbox retries exact signed envelopes; `transport.nostrPublish` means **relay acceptance**, not peer delivery or reading. Use the outbox's `onPublished` callback when the application needs a durable relay-acceptance record.

At account change or owner teardown, stop application sends and consumers, then release all three owners:

```ts
runtime.close();
await outbox.close();
transport.dispose();
```

Disposal unsubscribes owned fetches/listeners and rejects pending actions without closing the shared pool or deleting storage. Signer prompts and already-submitted relay events cannot be retracted; late results cannot trigger subsequent transport steps or cache writes.

### Fetch and live recovery

`nostrFetch` merges cached events with a finite relay request, deduplicating by event ID. It waits for the relay cohort to settle or a total `fetchTimeoutMs` deadline (default 4000, also configurable as context `timeout`). The deadline returns partial results and releases the request; it does **not** certify complete history. Pool request errors reject rather than masquerading as empty history. Healthy relays may still succeed when another fails, following the pool's cohort semantics.

`nostrSubscribe` replays matching cached events and follows both relay traffic and new store matches. Each subscription deduplicates independently and returns an unsubscribe function. Reconnect behavior is delegated to the pool; terminal errors call `onSubscriptionError`. Applications decide when to recreate failed subscriptions or fetch bounded recovery windows; no pagination or conversation database is added here.

Both paths independently verify signatures, including cached events with optimistic verification flags. Unsigned rumors never cross into the cryptographic runtime.

## Best Practices

- Use `NdrMessagesClient` unless you need runtime features it does not wrap; `client.runtime` and `client.transport` stay available for those.
- Keep the client in a stream keyed by account, signer, and storage, and call `dispose()` in its teardown so the lock and pending writes are released.
- Keep `relays` stable for an account; peers find device invites and envelopes only on the relays both sides use.

- Keep protocol state, persistent outbox, and application history account/device scoped; restoring envelopes cannot reconstruct advanced ratchet state.
- Use narrow runtime filters and bounded recovery windows; a deadline is not a pagination cursor.
- Retain the signed outbox envelope after uncertain publication rather than encrypting the same send again.
- See [napplet messaging](../napplets/messaging.md#ndr-messages-client) for the separate Kehto adapter wiring and compatibility import.
