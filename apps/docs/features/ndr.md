---
description: Connect nostr-double-ratchet to an Applesauce RelayPool, EventStore, and account signer
---

# Double-ratchet messaging

`createNdrTransport` connects the upstream `nostr-double-ratchet` runtime to a shared `RelayPool`, `EventStore`, and fixed-owner `ISigner`. It supplies transport hooks, not a messaging client: applications own the runtime, protocol storage, message history, approvals, and outbox.

Install the optional peer `nostr-double-ratchet@0.0.183` to use its runtime and types. Import the integration separately from `applesauce-extra/messages/ndr`; the generic messages entry point does not load or re-export NDR.

## Usage

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

`NdrTransportContext`, `NdrTransportOptions`, and `NdrTransport` describe these dependencies, options, and upstream-compatible hooks. Relays must be explicit and nonempty: ephemeral device/session keys do not necessarily have NIP-65 mailboxes. The signer must stay bound to `ownerPubkey`; recreate the transport when accounts change.

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

- Keep protocol state, persistent outbox, and application history account/device scoped; restoring envelopes cannot reconstruct advanced ratchet state.
- Use narrow runtime filters and bounded recovery windows; a deadline is not a pagination cursor.
- Retain the signed outbox envelope after uncertain publication rather than encrypting the same send again.
- See [napplet messaging](../napplets/messaging.md#ndr-transport) for the separate Kehto adapter wiring and compatibility import.
