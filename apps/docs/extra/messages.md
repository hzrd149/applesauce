---
description: Use NIP-04 and NIP-17 messaging clients with explicit loading, decryption, drafts, and publication recovery
---

# Messaging clients

`LegacyMessagesClient` implements NIP-04 direct messages; `WrappedMessagesClient` implements NIP-17 messages carried in NIP-59 gift wraps. Both combine a fixed account with your application's shared EventStore and RelayPool. They work independently of Kehto.

```ts
import { LegacyMessagesClient, WrappedMessagesClient } from "applesauce-extra/messages";

const legacy = new LegacyMessagesClient({ pubkey, signer, eventStore, pool });
const wrapped = new WrappedMessagesClient({ pubkey, signer, eventStore, pool });
```

Configure the shared store's profile and relay-list loaders first. Use hex pubkeys and a signer belonging to `pubkey`, with `nip04` for legacy or `nip44` for wrapped messaging. Omitting the signer permits browsing/restoring available plaintext, but not sending, authenticating, or decrypting cache misses.

Create new clients when the account changes; do not pass a signer proxy whose identity changes. Disposing a client does not dispose the application's shared store or pool.

## Loading and lifecycle

### Legacy inbox and independent conversations

`legacy.start()` hydrates encrypted cached events, restores cached plaintext, and starts live incoming/outgoing mailbox subscriptions with the configured lookback (`historySpan`, default 30 days). It **does not reconcile relay history**. `lifecycle$` emits `idle`, `running`, or `disposed`; `running` is ownership state, not a success indicator.

You can open one correspondent without starting the account-wide inbox:

```ts
const conversation = legacy.conversation(recipient);
const subscription = conversation.messages$.subscribe(renderMessages);
await conversation.start();
const result = await conversation.loadHistory({ since, until });
// Inspect result.mailboxes for incomplete or failed relay coverage.

subscription.unsubscribe();
conversation.stop();
```

Conversation `start()` starts live processing and restores plaintext for already-loaded events; it does not hydrate encrypted cache history or reconcile history. `messages$` alone reads the shared store without opening network requests.

For view-owned loading, prefer `watch$()`:

```ts
import { merge } from "rxjs";

const conversation = legacy.conversation(recipient);
const subscription = merge(conversation.messages$, conversation.watch$())
  .subscribe(renderMessages);

// On leaving the view:
subscription.unsubscribe();
```

`watch$()` emits no values. Watchers share live loading, plaintext restoration, and automatic decryption with other watchers and explicit `start()`. The last unsubscribe releases only that interest, not sends or history operations. A watch-only conversation's `lifecycle$` remains `idle`; explicit `start()` retains ownership until `stop()`.

Conversation `stop()` cancels its operations, completes current watchers, and allows later use. It leaves other conversations running. Client `stop()` stops all its conversations; `dispose()` permanently releases the owner. A disposed conversation is replaced on the next `legacy.conversation(recipient)` lookup.

### Wrapped inbox and local conversation views

```ts
const conversation = wrapped.conversation([recipient]);
const subscription = conversation.messages$.subscribe(renderMessages);
await wrapped.start();

// On ending this client's lifetime:
subscription.unsubscribe();
wrapped.dispose();
```

Wrapped `start()` hydrates cache, starts plaintext restoration, reconciles recent history, and follows live envelopes. Awaiting it does not wait for history reconciliation or decryption to finish.

- `status$`: `idle`, `loading`, `ready`, or `disposed`; `ready` means background reconciliation finished, not that all relays succeeded or messages decrypted.
- `syncStatus$`: latest background reconciliation progress.
- `relayStatus$`: selected read relays and pool connection state.
- `errors$`: contextual, nonterminal failures.

Encrypted envelopes cannot be filtered by conversation. Start, sync, unlock, and authenticate through `wrapped`; `wrapped.conversation(participants)` creates only a local decrypted view without loading or prompting. Participant order and duplicates resolve to the same conversation instance.

Wrapped conversations expose `messages$`, `threads$`, `replies$(parent)`, and a local `RumorStore` at `eventStore`. Keep profile queries on the application's shared store. Disposing a conversation cancels its sends and releases its local view without stopping the inbox; stopping the client leaves local views available.

### Explicit history

Both clients offer cold `sync$({ since, until })` streams and finite `loadHistory({ since, until })` promises. Inspect each result's `mailboxes`: `done` can include failed relays and does not imply decryption finished.

Legacy history can be limited with `correspondent`; conversation history is already scoped. Legacy `sync$()` follows mailbox relay changes by default; use `followRelays: false` for a fixed run. `loadHistory()` always uses a finite snapshot. Progress belongs to that operation, not retained legacy client state: legacy clients and conversations have no `status$` or `syncStatus$`.

Wrapped history is mailbox-wide and applies two days of overlap before `since` to accommodate randomized envelope timestamps; `until` bounds envelope timestamps. Conversations are selected after decryption.

For viewport-driven legacy history, use `conversation.createTimelineLoader()`. See [Timeline loader](../loading/loaders/timeline-loader.md) for window ownership and loading controls.

## Decryption and signer prompts

Signer-backed automatic decryption defaults to off. Observing `messages$`, `conversations$`, conversation views, or `decryptionState$` does not request signer decryption. Cached plaintext can still become visible.

```ts
// From an explicit user action:
await legacy.unlock();
await wrapped.unlock();

// Or opt into processing arriving messages while background loading runs:
legacy.setAutoUnlock(true);
wrapped.setAutoUnlock(true);
```

Legacy conversations have their own `unlock()` and `setAutoUnlock()` controls for one correspondent. Bulk unlock skips prior failures; retry a specific loaded kind-4 event or gift wrap with `unlock(event)`. That promise rejects on failure. Both clients also expose `retryDecryption(event)`.

**`readMessages$()` is an active reader, not a passive UI selector.** It can decrypt through the signer even with `autoUnlock: false`. It processes already-loaded events and watches store additions, without loading from relays; `{ history: true }` reads a finite stored snapshot. Use passive timelines plus explicit unlock actions when signer prompts require user consent.

### Interpret decryption state by protocol

Legacy `decryptionState$` describes currently loaded messages:

- `total = unlocked + locked`; failed messages remain in `locked`.
- `pending` counts distinct locked messages with active readers.
- `errors` is a `ReadonlyMap<string, unknown>` keyed by event ID, not a `failed` array.

Use `errors.has(event.id)` to detect failure even if the rejection value was `undefined`; read it with `errors.get(event.id)`. Retries retain the previous error until plaintext becomes available. Bulk-unlock eligibility is `locked - errors.size`.

Wrapped state counts envelopes and exposes `total`, `unlocked`, `locked`, `pending`, and `failed` (an array of envelope IDs). Its `locked` count excludes failed envelopes; do not apply the legacy counting formula to it. Read contextual decryption failures from wrapped `errors$`.

Legacy timelines and send results are native kind-4 events: `event.content` stays encrypted. Read plaintext with `getEncryptedContent(event)` from `applesauce-core/helpers` or `EncryptedContentModel`. Wrapped timelines expose validated, deduplicated kind-14 chat and kind-15 file rumors, not gift wraps.

## Sending and drafts

Legacy clients take `{ recipient, content }`; wrapped clients take `{ recipients, content }` and add the sender's copy automatically. Conversation methods supply their own recipients:

```ts
await legacy.conversation(recipient).send({ content: "Hello" });
await wrapped.conversation([recipient]).send({ content: "Hello" });
```

Check `discover(...)` before offering delivery. Wrapped sends require advertised kind-10050 inbox relays for **every participant, including the sender**. `fallbackRelays` supplies wrapped read relays only, never publication targets; legacy can also use it for delivery.

`replyTo` identifies a kind-4 event for legacy or a rumor for wrapped messaging. `expiration` expires the logical message; wrapped `envelopeExpiration` independently expires relay envelopes. `mirrorExpiration` optionally derives a lifetime from the newest available conversation message.

Both conversation types provide `draft$`, `loadDraft()`, `setDraft()`, and `clearDraft()`. Drafts are independent of ordinary `send()` and `prepareSend()`; those methods never clear them.

### Legacy revision-safe draft handoff

```ts
const conversation = legacy.conversation(recipient);
await conversation.setDraft({ content: "Hello", replyTo: parent.id });
const prepared = await conversation.prepareDraft();
await conversation.publish(prepared);
```

Legacy `prepareDraft()` restores the draft, forwards content/reply/expiration, and clears only that exact unchanged draft revision after successful preparation, before publication. New edits survive, even identical replacements. Missing drafts reject without signing; preparation failures preserve the draft.

With `publicationStorage`, the signed event is durable before draft removal. A removal failure still returns the prepared handle and reports a contextual `storage` error on conversation `errors$`; the draft remains available. Cancellation before preparation succeeds preserves the draft; after success it can return a recoverable handle without clearing the draft. Do not blindly clear the draft again in a `finally` block.

Legacy conversation `sending$` stays true during active preparation, signer prompts, persistence, and publication, including overlapping operations. Waiting prepared/failed records are not active. Wrapped clients use `busy$`; wrapped conversations do not implement `prepareDraft()`.

## Legacy durable publication and recovery

Pass an application-scoped `publicationStorage` adapter when creating the legacy client. Preparation persists the signed event and its selected relays before returning; publication retries reuse both without signer prompts.

```ts
const legacy = new LegacyMessagesClient({
  pubkey, signer, eventStore, pool,
  publicationStorage: accountLegacyOutbox,
});
const conversation = legacy.conversation(recipient);
const prepared = await conversation.prepareSend({ content: "Retryable" });
const messageId = prepared.message.id;

try {
  await conversation.publish(messageId);
} catch (error) {
  showPublicationFailure(messageId, error);
}
```

Keep the message ID and correspondent for recovery; do not call `prepareSend()` again to retry the same message. Reload with the same account/protocol storage:

```ts
const conversation = legacy.conversation(recipient);
const pending = await conversation.loadPublications();
// Or observe conversation.pendingPublications$ for the pending handles.

await conversation.publish(messageId); // Lazily restores by ID if needed.
// For a different message the user chooses to abandon:
await conversation.discardPublication(otherMessageId);
```

`publish`, `discardPublication`, and `publicationState$` accept either an owned prepared handle or its message ID. `prepared.publish()` proxies to the conversation. Unknown IDs reject, even if the event exists in the shared EventStore; the outbox is not reconstructed from store contents. Foreign, forged, or stale handles also reject.

`publicationState$(reference)` and `prepared.state$` expose `prepared`, `publishing`, `failed` (with the original error), `accepted`, or `discarded`. Publication failures reject and update state, without duplicate conversation `errors$` notifications. Relay acceptance is not a recipient delivery receipt.

`pendingPublications$` restores storage on subscription and excludes accepted/discarded records. `loadPublications()` rejects on read or validation errors and can be retried after storage is repaired. Discard removes durable work without publishing and rejects while publication is active.

`stop()` completes current state subscriptions and invalidates old handles without discarding pending work. Recover with IDs or fresh pending handles. An uncancellable in-flight publication must settle before retrying; cancellation does not prove the relay rejected it.

Accepted-state cleanup failures appear on conversation `errors$` and leave acceptance intact. Publishing that accepted ID again retries cleanup only, not network publication. Successfully removed terminal entries are not restored after reload; failed cleanup can leave a recoverable durable entry.

## Wrapped partial-publication retry

Retain the handle returned by `prepareSend()` when delivery may need retry:

```ts
import { WrappedMessagePublicationError } from "applesauce-extra/messages";

const prepared = await wrapped.prepareSend({ recipients: [recipient], content: "Hello" });
try {
  await prepared.publish();
} catch (error) {
  if (error instanceof WrappedMessagePublicationError) {
    showRecipientOutcomes(error.publications);
  } else throw error;
}
// From a later retry action, using this same retained handle:
await prepared.publish();
```

`prepared.publications` reports each participant's `recipient`, `eventId`, `accepted`, and optional `error`. Retry reuses the original envelopes and skips accepted participants. Calling `send()` again prepares a new message instead. `publications$` tracks this client's message states; it is not a durable outbox.

Wrapped handles are in-memory and invalidated by client `stop()`/disposal; there is no wrapped equivalent of legacy `publicationStorage` or recovery by ID. Conversation-owned handles also end with their conversation.

Neither core client accepts `clientMessageId`, operation `scope`, or an `approve` callback. Those belong to the [Kehto messaging integration](../napplets/messaging.md). In a standalone app, present plaintext approval **before** calling preparation, encryption, signing, or sending.

## Integration

### Relay authentication

Both clients expose passive `authRequests$` lists containing relay URL, context, state (`pending`, `authenticating`, or `failed`), and last error. Authentication is separate from decryption and may prompt the fixed-account signer:

```ts
// From an explicit user action for a pending request:
await legacy.authenticate(relayUrl);

// Or authenticate the current pending batch and inspect per-relay results:
const results = await wrapped.authenticateAll();
```

`authenticateAll()` processes the current batch sequentially and returns per-relay outcomes. Concurrent attempts for the same relay share work; failed requests remain retryable. Read-only clients cannot authenticate. Legacy conversations share their client's request list.

`onAuthRequired` runs after a request is recorded; use it for application policy, and `authTimeout` to configure approval waits. Successful external authentication clears requests too. Authentication resumes operations still waiting; timed-out operations require explicit retry. Ending an operation removes its requests, and client stop clears them all.

### Storage and errors

The application owns persistence and encryption at rest:

| Option | Purpose |
| --- | --- |
| `cacheRequest` | Restores encrypted kind-4 events or gift wraps into the shared store |
| `decryptionCache` | Restores/saves private plaintext; wrapped messaging caches both envelope and seal layers |
| `draftStorage` | Stores plaintext drafts, scoped by account and protocol by your adapter |
| Legacy `publicationStorage` | Stores unpublished signed events and frozen relay targets |
| Legacy `conversationStorage` | Retains known correspondents, keyed by owner pubkey |
| Wrapped `draftFileStorage` | Stores staged draft files **unencrypted** |

Draft and publication keys are conversation-based, not an account/protocol namespace. Supply separate adapters or namespace their keys for each account and protocol. Protect plaintext caches, drafts, and files at rest; supplying a cache reader does not implement event persistence for your application.

For legacy background loading, observe `cacheError$` and `conversationStorageError$` (cleared after a successful corresponding operation), and `mailboxErrors$` for live failures with direction and relays. Use `pool.status$` for connection state and `legacy.relays$` for selection. Conversation `errors$` reports loading, restoration, and storage failures, not duplicate decryption/publication errors. Wrapped `errors$` reports contextual operation failures; promise operations must still be caught by their caller.

For encrypted attachment upload/download and wrapped file messages, see [Encrypted files](../features/encrypted-files.md). For NIP-DR sessions rather than these protocols, see [NDR messaging](./ndr.md).

## Best Practices

- Share one client per account and protocol; let views release only their own subscriptions.
- Separate passive rendering from unlock, authentication, and send actions that can prompt the signer.
- Inspect relay coverage and decryption separately; a completed load is not a fully readable inbox.
- Retry legacy publication by owned ID and wrapped publication through its retained handle, not a new send.
- Pass `{ signal }` to cancellable operations; an already-issued signer or network request cannot be recalled.
- Scope private storage explicitly and retain the shared pool/store beyond individual client lifetimes.
