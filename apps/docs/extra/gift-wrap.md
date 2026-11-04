---
description: Receive, decrypt, and persist arbitrary NIP-59 rumors for a fixed account
---

# Gift-wrap receiver

`GiftWrapReceiver` from `applesauce-extra/gift-wrap` receives [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) envelopes for one fixed recipient. It validates the outer envelope, signed seal, and inner rumor before storing plaintext separately. Rumors can have any kind; this is not limited to kind 14 messages and does not provide conversations or sending. For those, see [Messaging](./messages.md).

## How to use it

Give the receiver your application's shared `RelayPool` and encrypted `EventStore`, plus an account-bound signer when decryption is needed:

```ts
import { GiftWrapReceiver } from "applesauce-extra/gift-wrap";

const receiver = new GiftWrapReceiver({
  pubkey,
  signer,
  pool,
  eventStore,
  relays: ["wss://inbox.example/"],
});
```

Construction does not open relays or invoke the signer. The pubkey is immutable; create a new receiver when the account changes. Before signer-backed decryption, the receiver checks that the signer matches that pubkey and supports NIP-44. Omit `signer` for cache-only processing.

`relays` accepts an array or observable of arrays. Without it, the receiver uses kind 10050 inbox relays already available through the EventStore, then `fallbackRelays` when none are advertised. Relay URLs are normalized and deduplicated. This does not itself fetch the account's kind 10050 event.

### Choose who owns receiving

| API | What it does |
| --- | --- |
| `receive$` | Processes existing and arriving envelopes in the EventStore; opens no relay subscriptions. |
| `watch$` | Adds envelope cache hydration and reconnecting live relay subscriptions to `receive$`. |
| `start()` | Holds an internal subscription to `watch$` until `stop()`. |
| `stop()` | Cancels current watches, operations, authentication requests, and retry timers; permits later restart. |
| `dispose()` | Permanently releases the receiver and its owned rumor store. |

`receive$` and `watch$` share processing among subscribers and remain active only while subscribed, unless `start()` holds ownership. Outcomes are not replayed to late subscribers; use `rumors$` for current stored plaintext.

```ts
const receiving = receiver.receive$.subscribe((result) => {
  if (result.status === "success") renderRumor(result.rumor);
  else showFailure(result.failure);
});

await receiver.ingest(envelope); // validates and stores, without signer permission
const rumor = await receiver.unlock(envelope); // explicitly permits decryption

receiving.unsubscribe();
receiver.dispose();
```

`unlock(envelope)` returns a rumor or rejects. `unlock()` processes loaded envelopes without prior failures, continuing past individual failures. `ingest()` itself does not decrypt, but an active receiver with automatic unlocking enabled may process the resulting insertion.

`lifecycle$` reports explicit `start()`/`stop()` ownership (`idle`, `running`, `disposed`), not history completeness or decryption success. A direct `watch$` subscription does not change it to `running`, and awaiting `start()` does not wait for history, readiness, or plaintext.

### Passive state and signer permission

`giftWraps$`, `rumors$`, `decryptionState$`, `relays$`, and `authRequests$` expose state; subscribing to them does not start receiving or grant signer permission. By default, active `receive$`/`watch$` processing restores available plaintext but does not ask the signer to decrypt cache misses.

Enable background decryption explicitly, either with the constructor's `autoUnlock: true` or later:

```ts
receiver.setAutoUnlock(true);
await receiver.start();

// Stop future background signer work, but keep loading encrypted envelopes.
receiver.setAutoUnlock(false);
```

`setAutoUnlock()` changes permission, not ownership: it does not start a receiver. Explicit `unlock()`, `readNext()`, `readInbox()`, and retry operations permit signer-backed processing regardless of `autoUnlock`. Disabling background permission cannot retract an already-open signer prompt.

### Load history, then pull at the user's pace

`sync$({ since, until })` is a cold stream of reconciliation progress. Its inclusive bounds apply to **envelope timestamps**, not rumor timestamps. It hydrates the envelope cache first, then reconciles against the shared EventStore inventory; by default it follows relay changes. `loadHistory()` fixes the relay selection for a finite operation and returns its final `SyncLoaderStatus`.

Neither history API itself decrypts. An independently active receiver may process the envelopes they insert.

```ts
await receiver.loadHistory({ since: 0, until: cutoff });

for await (const result of receiver.readInbox()) {
  if (result.status === "success") renderRumor(result.rumor);
  else showFailure(result.failure);
}
```

`readNext()` returns one `GiftWrapReadResult`, or `undefined` when no eligible loaded envelope remains. `readInbox()` yields those same outcomes, one per pull, without prefetching. It ends when no eligible envelope remains instead of waiting for future arrivals; it is not a live subscription or a fixed snapshot. Completed, previously failed, reserved, and already-processing envelopes are skipped.

Both success and failure are values: `{ status: "success", event, rumor }` or `{ status: "failed", event, failure }`. An envelope failure does not terminate the iterator or receiving stream. Cancellation, disposal, and checkpoint-restoration failures can still reject operations or error a receiving subscription.

For strict user-paced prompts, leave `autoUnlock` disabled and avoid another explicit decrypting consumer. Pass `{ signal }` to pull, unlock, retry, or history operations to cancel that caller's work.

### Capacity and timeouts

- `decryptionConcurrency` defaults to `1` and bounds simultaneous signer decryption calls across explicit, bulk, and background work. Concurrent readers share processing of the same envelope and encryption layers.
- `maxQueued` defaults to `64` and bounds distinct active envelope-processing requests, **not** the total stored inbox or a buffered arrival queue. Background processing leaves excess envelopes in the EventStore and scans again when capacity is released; excessive explicit parallel requests can fail with a capacity error.
- `timeout` defaults to 10 seconds for cache/checkpoint operations and relay-selection waits. `decryptionTimeout` defaults to 60 seconds for a reader's processing wait.

Cancellation or timeout releases a reader, not an underlying non-cancellable signer call. The signer slot remains occupied until that call settles, so a stalled prompt is not bypassed by starting more decryptions.

### State, failures, and retries

`decryptionState$` counts only currently loaded account envelopes: `total`, `unlocked` validated plaintext, `locked`, and distinct `pending` envelopes with active readers. Its `errors` map is keyed by envelope ID. Unlocked plaintext does not certify successful rumor storage or checkpoint persistence; a storage failure can coexist with `unlocked: 1`.

`GiftWrapFailure` contains `eventId`, `stage`, `code`, original `cause`, `attempts`, and `retry`. Stages distinguish envelope validation, outer wrap, seal, rumor validation, rumor storage, and checkpoint persistence.

| Failure codes | Default retry behavior |
| --- | --- |
| `invalid-envelope`, `invalid-seal`, `invalid-rumor` | `never` |
| `signer-unavailable`, `signer-mismatch`, `signer-rejected`, `decryption-failed` | `manual` |
| `timeout`, `storage-failed`, `persistence-failed` | `automatic`, only while the configured attempt budget remains |

`retryPolicy.maxAttempts` includes the initial attempt and defaults to `1`, so automatic retries require a larger budget. Backoff starts at `delay` (default 1000 ms), doubles per attempt, and is capped by `maxDelay` (default 30000 ms). A `classify` callback can classify otherwise ambiguous signer failures; recognized `signer-rejected` failures always require manual retry, even if the callback requests automatic retry.

```ts
const result = await receiver.retry(envelopeId);

for await (const result of receiver.retryFailed()) {
  if (result.status === "failed") showFailure(result.failure);
}
```

`retry()` requires a loaded envelope and returns an outcome. `retryFailed()` snapshots failed IDs and retries one per pull without prefetching. These are explicit user actions; retries reuse decrypted layers rather than reopening both prompts after a storage failure. External plaintext updates can also recover a wrap/seal failure without retrying the signer.

Use `errors$` for contextual loading, cache, decryption, storage, and persistence errors. It includes structured `failure` details when available. Cache failures are reported without necessarily preventing processing; an envelope failure remains visible until successful recovery.

### Relay authentication is separate

NIP-42 relay authentication signs an authentication event; it does not decrypt envelopes. Both `autoAuth` and `autoUnlock` default to `false`, and enabling one does not enable the other. Authentication can proceed independently of a blocked decryption prompt.

```ts
const authentication = receiver.authRequests$.subscribe(showAuthRequests);

// From a user approval handler:
const outcomes = await receiver.authenticateAll();
for (const outcome of outcomes) {
  if (outcome.status === "failed") showRelayError(outcome.url, outcome.error);
}

authentication.unsubscribe();
```

`authenticate(url)` handles one pending relay and rejects on failure. `authenticateAll()` snapshots pending relays and returns individual `{ url, status }` results: `authenticated`, `skipped`, or `failed` (with `error`). One relay's failure does not reject the whole batch; `stop()`/`dispose()` cancellation can. Duplicate attempts for a relay are shared. `authTimeout` defaults to `false`, allowing approval to remain pending for the operation's lifetime.

## Integration

### Shared envelopes, separate plaintext

The receiver never owns or disposes the supplied `pool` or `eventStore`. The shared EventStore holds signed kind 1059 envelopes addressed to the account and supplies reconciliation inventory. Validated unsigned rumors go into a separate, account-scoped destination:

- Omit `rumorStore` for an owned in-memory `RumorStore`, disposed with the receiver.
- Supply a `RumorStore` or database-backed `AsyncRumorStore` to control plaintext retention. The receiver awaits rumor writes and leaves supplied stores alive on disposal.

`rumors$` exposes the destination store's timeline, so do not share a plaintext rumor store across unrelated accounts. Protect plaintext stores and caches at rest.

### Envelope and decryption caches

`cacheRequest` reads encrypted envelopes into the EventStore during watching and history loading; the receiver does not implement an envelope-cache writer. `decryptionCache` restores and saves plaintext for **both** encryption layers, keyed separately by envelope and seal IDs. Cache hits can complete processing without a signer, including in a receiver constructed without one.

The same cache interface works with the [encrypted-content caching helpers](../apps/encryption/caching.md). Despite its name, a decryption cache holds plaintext and needs the same protection as the rumor store. Passive cache misses do not consume processing attempts or create checkpoints.

### Durable processing checkpoints

Pass `processingStore` to preserve progress beyond this receiver instance. It must implement `GiftWrapProcessingStore`: account-scoped `list()` and atomic replacement of an individual record with `set(record)`, synchronously or asynchronously. This is separate from the envelope cache, plaintext layer cache, and rumor database.

```ts
import type { GiftWrapProcessingStore } from "applesauce-extra/gift-wrap";

const processingStore: GiftWrapProcessingStore = {
  list: () => database.listAccountCheckpoints(pubkey),
  set: (record) => database.replaceAccountCheckpoint(pubkey, record),
};

const receiver = new GiftWrapReceiver({
  pubkey, signer, pool, eventStore, rumorStore, processingStore,
});
await receiver.ready();
```

The database methods above are application adapters. `ready()` restores and validates the checkpoint snapshot once, sharing restoration across concurrent calls. Receiving and explicit processing wait for it automatically; a failed read may be retried. It does not fetch envelopes or restore plaintext, and it does not start watching.

Version 1 records retain processing/completed/failed state, attempts, stage, stored rumor ID, serializable failure details, and the absolute retry time. Restored failures keep their attempt budget; automatic retries retain their remaining backoff and need the envelope loaded in the EventStore. Interrupted processing can be attempted again. Evicting an envelope from memory does not erase completion progress.

Success is published only after rumor storage and the completion checkpoint settle. If completion persistence fails after rumor storage, a later retry can look up that rumor and repair the checkpoint without decrypting or storing it again. Writes for one envelope are ordered within the receiver, including when a caller times out.

Persist the rumor destination alongside checkpoints: completed IDs are skipped by background processing and pull readers even when plaintext is not attached to a reloaded envelope. Consequently, restored completion can coexist with a `locked` decryption-state count. Explicit `unlock(envelope)` looks up the completed rumor and can repair a missing rumor by processing again.

Checkpoints do not contain plaintext or envelopes, provide a cross-instance lock, or make rumor and checkpoint writes one transaction. Coordinate writers for an account, make storage writes idempotent, and manage retention in the application; disposal does not delete persisted records. Without `processingStore`, processing progress lasts only for the receiver instance.

## Best Practices

- Keep the receiver, signer, rumor store, and checkpoints bound to one account; dispose the receiver on account change.
- Use `receive$` when another service already loads envelopes; use `watch$` or `start()` when this receiver should load them.
- Keep authentication approval separate from permission to decrypt; show failures beside the affected relay or envelope.
- Use finite history ranges and pull readers for user-paced processing; do not interpret an empty pull as complete relay history.
- Observe `rumors$` for retained plaintext and processing outcomes for write success; neither lifecycle nor unlocked counts replace those signals.
