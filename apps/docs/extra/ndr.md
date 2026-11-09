---
description: Add forward-secret, multi-device messaging with nostr-double-ratchet on an Applesauce RelayPool, EventStore, and signer
---

# Double-ratchet messaging

`NdrMessagesClient` from `applesauce-extra/messages/ndr` adds [nostr-double-ratchet](https://github.com/irislib/nostr-double-ratchet) messaging to an Applesauce app. Double-ratchet sessions give each message its own key, so a leaked key can't decrypt past messages. Each device gets its own keys, and the user's account manages which devices belong to it.

The client runs the upstream double-ratchet runtime for one account and exposes conversations, groups, devices, and delivery state as observables.

Install the optional peer dependency first:

```sh
npm install nostr-double-ratchet@0.0.183
```

## How to use it

Give the client the account, the shared `pool` and `eventStore`, the relays to use for messaging, and a storage adapter:

```ts
import { NdrMessagesClient } from "applesauce-extra/messages/ndr";

const client = new NdrMessagesClient({ pubkey, signer, pool, eventStore, relays, storage });

await client.start();
client.conversations$.subscribe(renderInbox);
```

`storage` holds device secrets, session state, and decrypted history. It can't be rebuilt from relays, so keep it durable, **encrypted at rest**, and scoped to one account on one device. It is a nostr-double-ratchet `StorageAdapter`, which you can implement over any encrypted key/value store:

```ts
const storage: StorageAdapter = {
  get: async (key) => {
    const value = await store.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  },
  put: (key, value) => store.setItem(key, JSON.stringify(value)),
  del: (key) => store.removeItem(key),
  list: async (prefix = "") => (await store.keys()).filter((key) => key.startsWith(prefix)),
};
```

Writes must reject when they fail. Use the library's `InMemoryStorageAdapter` in tests.

Use the same `relays` on every device of an account; peers only find each other's invites and messages on shared relays.

Only one client may use a storage at a time. Where Web Locks are available, `start()` takes an account lock and rejects if another tab holds it, with `lifecycle$` reporting `locked`; create a new client to retry. Without Web Locks, or with `lockName: false`, the app must keep to one client per storage. Call `dispose()` on logout or account change to release the lock.

### Conversations

`client.conversation(peer)` returns a conversation with messages, typing indicators, and read receipts:

```ts
const chat = client.conversation(peer);
chat.messages$.subscribe(renderMessages);

await chat.send({ content: "hi", replyTo: parentId });
await chat.react(messageId, "👍");
await chat.markSeen();
chat.sendTyping();
await chat.setTtl(86400); // disappearing messages for both sides
```

Sent messages move from `queued` to `published`, then to `delivered` and `seen` as the peer's receipts arrive; incoming messages are `received`. Before sending, check `canSend$`: it stays false until the peer has a device you can reach.

Conversations also support drafts with `draft$`, `setDraft()`, and `sendDraft()`. With an `upload` option on the client, `uploadFile()` encrypts and uploads a file to attach to a message. Upload staged draft files before calling `sendDraft()`; see [Encrypted files](../features/files/encrypted-files.md#draft-attachments).

Messages are queued locally and published in the background. If publishing fails, `errors$` reports it and `pendingPublications$` counts what's waiting. Call `retryPublications()` once the connection is back instead of sending again.

### Devices

Each device has to be registered on the account before it can send. Registration happens in two steps so the user can review the device list before the signer prompt:

```ts
const prepared = await client.prepareRegistration("Laptop");
await client.publishRegistration(prepared, "Laptop");
```

`devices$` lists the account's devices, and `revokeDevice()` removes one.

A device without the account's signer, like a phone where the user doesn't want to log in, can be linked from a device that has it:

```ts
const url = await phoneClient.createLinkInvite();
await laptopClient.approveLink(url, "Phone");
```

A linked device can send and receive messages but can't add or remove devices.

### Groups

`client.createGroup(name, members)` creates a group conversation and invites the members. Invited members see the group as pending until they call `accept()`. Admins can add and remove members and rename the group.

Groups appear in `conversations$` alongside direct chats. Use `getNdrGroupId()` to tell them apart:

```ts
const groupId = getNdrGroupId(selected);
const conversation = groupId ? client.group(groupId) : client.conversation(selected);
```

**Example:** [Double-ratchet messages](https://applesauce.build/examples/#/example/messages/ndr)

## Integration

The client sends and receives through your `RelayPool` and keeps the signed envelopes in your `EventStore`, but never closes either. The event store only holds encrypted envelopes; session state and decrypted history live in the client's storage.

If you need runtime features the client doesn't wrap, use `client.runtime` directly. To run the upstream runtime without the client, `createNdrTransport()` gives it Nostr fetch, subscribe, sign, and publish functions backed by your pool, event store, and signer. You then own the runtime's storage, outbox, and teardown yourself.

For napplets, see [napplet messaging](../napplets/messaging.md#ndr-messages-client).

## Best Practices

- Use `NdrMessagesClient` unless you need full control of the runtime.
- Create the client per account and call `dispose()` when the account changes.
- Keep `relays` the same for an account across all of its devices.
- Encrypt the storage at rest and never share it between accounts or devices.
- Retry failed publications with `retryPublications()` instead of sending the message again.
