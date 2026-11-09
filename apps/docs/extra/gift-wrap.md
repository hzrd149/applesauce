---
description: Receive, decrypt, and store NIP-59 gift-wrapped events for one account
---

# Gift-wrap receiver

`GiftWrapReceiver` from `applesauce-extra/gift-wrap` handles incoming [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) gift wraps for one account. It loads the encrypted envelopes, decrypts them when you allow it, validates each layer, and keeps the decrypted rumors in their own store.

It accepts rumors of any kind, so use it for any gift-wrapped protocol. If you're building direct messages, use the [wrapped messaging client](./messages.md) instead; it adds conversations and sending on top of a receiver.

## How to use it

Create one receiver per account with your app's shared `RelayPool` and `EventStore`:

```ts
import { GiftWrapReceiver } from "applesauce-extra/gift-wrap";

const receiver = new GiftWrapReceiver({ pubkey, signer, pool, eventStore });

receiver.rumors$.subscribe(renderRumors);
await receiver.start();
```

The receiver reads from the account's kind 10050 inbox relays when they're already in the event store. Pass `relays` to choose them yourself, or `fallbackRelays` for accounts that haven't published any.

The pubkey is fixed. When the user switches accounts, dispose the receiver and create a new one. Leave out the `signer` to only show plaintext you've already cached.

### Narrowing the inbox

Pass one `filter` to select envelopes by additional tags, IDs, or authors. For example, a dedicated invite receiver can request only envelopes tagged with `k:3313`:

```ts
const receiver = new GiftWrapReceiver({
  pubkey,
  signer,
  pool,
  eventStore,
  filter: { "#k": ["3313"] },
});
```

The constraints apply to live reads, cache hydration, history sync, background processing, `readNext()`, `readInbox()`, and bulk `unlock()`. They also scope `giftWraps$` and `decryptionState$`, including when another component adds envelopes to the shared event store.

The receiver snapshots the filter at construction and always fixes `kinds` to 1059 and `#p` to its account. Time bounds belong to the loading options; `since`, `until`, `search`, and `limit` are not supported in the inbox filter and are ignored if supplied at runtime. Every processed envelope must still have a valid signature and exactly one recipient tag for the account.

Explicit `ingest(event)` and `unlock(event)` accept valid account envelopes even if they don't match the inbox filter. Ingestion alone does not prompt the signer; explicit unlock can decrypt and add the rumor to `rumors$`. An outer `k` tag is only a selection hint: consumers must still validate the decrypted rumor's kind and contents.

### Adding transport relays

Use `extraRelays` to read community or application relays alongside the selected inbox. It accepts an array or an observable of arrays:

```ts
const receiver = new GiftWrapReceiver({
  pubkey,
  signer,
  pool,
  eventStore,
  fallbackRelays: ["wss://inbox.example"],
  extraRelays: communityRelays$,
});
```

Extras are added to explicit `relays`, advertised kind-10050 relays, or the fallback set. `relays$` remains the selected inbox; `readRelays$` exposes the normalized, deduplicated union used for live reads and history sync. The wrapped client's `relayStatus$` includes these extra relays too.

Inbox reads start even if the extras observable hasn't emitted. Changing extras opens or closes only the affected live relay subscriptions, preserving other subscriptions and their authentication state. A history sync with `followRelays: false` snapshots the currently available union; it does not wait for future extras.

### Ways to receive

- `start()` and `stop()` keep the receiver loading envelopes in the background until you stop it.
- `watch$` does the same for as long as something is subscribed, which suits receiving that's owned by a view.
- `receive$` processes envelopes that something else adds to the event store, without opening any relay subscriptions.

Each of these streams emits a result per envelope. Failures are results too, so one bad envelope doesn't end the stream:

```ts
receiver.watch$.subscribe((result) => {
  if (result.status === "success") renderRumor(result.rumor);
  else showFailure(result.failure);
});
```

### Asking the signer to decrypt

By default the receiver never prompts the signer in the background. Subscribing to `rumors$` or `decryptionState$` only shows what's already been decrypted or cached. To decrypt, either call `unlock()` from a user action or turn on background decryption:

```ts
await receiver.unlock(); // decrypt everything loaded so far
receiver.setAutoUnlock(true); // or keep decrypting new arrivals
```

### Loading history

Background receiving only covers recent envelopes. To fetch older ones, call `loadHistory()` with a time range, then work through them at the user's pace with `readInbox()`, which decrypts one envelope per step:

```ts
await receiver.loadHistory({ since: 0, until: cutoff });

for await (const result of receiver.readInbox()) {
  if (result.status === "success") renderRumor(result.rumor);
}
```

The time range applies to the envelopes' timestamps, which NIP-59 randomizes. Use `sync$()` instead of `loadHistory()` to show progress while it runs.

### Failures and retries

Failed envelopes stay visible in `decryptionState$` and `errors$`. Each failure records which layer failed and whether a retry can help. A rejected signer prompt needs the user to try again, while a storage error can be retried automatically if you set a `retryPolicy`. Retry from a user action with `retry(id)` or `retryFailed()`.

### Relay authentication is separate

Relays that require [NIP-42 authentication](/loading/relays/authentication) add a request to `authRequests$`. Signing an auth event is a separate permission from decrypting, so `autoAuth` and `autoUnlock` are independent and both off by default:

```ts
receiver.authRequests$.subscribe(showAuthRequests);

// When the user approves:
await receiver.authenticateAll();
```

## Integration

The receiver uses your shared pool and event store but never disposes them. Encrypted envelopes go into the event store, and decrypted rumors go into a separate rumor store:

- By default, rumors are kept in memory and dropped when the receiver is disposed.
- Pass a `rumorStore` (or a database-backed one) to keep plaintext between sessions.
- Pass `cacheRequest` to load envelopes from a local cache, and `decryptionCache` to restore plaintext without asking the signer again. These work with the [encrypted content caching helpers](../apps/encryption/caching.md).
- Pass a `processingStore` to remember which envelopes were already processed or failed between sessions. Call `await receiver.ready()` to restore that progress before you rely on it.

Rumor stores and decryption caches hold plaintext, so protect them at rest and never share one between accounts.

The [wrapped messaging client](./messages.md#share-an-application-receiver) can use a receiver you created, so several features can share one inbox.

Prefer one receiver per account and envelope store: share a broad receiver between consumers, or give a dedicated narrow receiver its own stores. Overlapping receivers can duplicate decryption work and overwrite checkpoints if they share a `processingStore`; filters are not a coordination mechanism for splitting one inbox between receivers.

**Example:** [Gift-wrap messages](https://applesauce.build/examples/#/example/messages/gift-wrap)

## Best Practices

- Keep the receiver, signer, and stores bound to one account, and dispose the receiver when the account changes.
- Use `receive$` when another part of the app already loads envelopes, and `start()` or `watch$` when the receiver should load them.
- Ask before decrypting: leave `autoUnlock` off until the user opts in, and use `readInbox()` for one prompt at a time.
- Show failures next to the envelope or relay they belong to, and offer a retry action.
- Don't treat a finished history load as a fully read inbox; some envelopes may still be locked or failed.
