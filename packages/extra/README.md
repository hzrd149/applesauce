# Applesauce Extra

A collection of stuff that doesn't fit into any applesauce package.

Each module has its own entry point (`applesauce-extra/nspam`, `applesauce-extra/vertex`, `applesauce-extra/primal`, `applesauce-extra/open-ranking`, `applesauce-extra/remote-monitor-relay-liveness`, `applesauce-extra/messages`, `applesauce-extra/kehto`), so importing one doesn't load the others or their optional dependencies.

## Gift-wrap receiver

`GiftWrapReceiver` from `applesauce-extra/gift-wrap` receives account-addressed NIP-59 envelopes containing any rumor kind. It requires an application-owned `EventStore` and `RelayPool`; validated plaintext goes into a separate `RumorStore`, or an application-provided database-backed `AsyncRumorStore`.

```ts
const receiver = new GiftWrapReceiver({ pubkey, signer, eventStore, pool, rumorStore });
const watch = receiver.watch$.subscribe();
receiver.setAutoUnlock(true);
const history = await receiver.loadHistory({ since });
// Consume receiver.rumors$ or query receiver.rumorStore by kind.
watch.unsubscribe();
receiver.dispose();
```

`receive$` processes existing envelopes and follows the event store's `insert$` and `update$` feeds, including envelopes loaded or decrypted by other application components. It checks in-memory plaintext and `decryptionCache` before optionally using the signer for each layer. Subscribing opens no relay requests; `watch$` adds live loading and encrypted-cache hydration to the same shared processor.

Both streams emit `GiftWrapReadResult` successes after rumor storage and per-envelope failures without terminating. Active subscribers also receive outcomes from explicit unlocks and retries. Cache misses with auto-unlock disabled emit nothing; completed envelopes are not emitted again, and late subscribers receive no replay. Use `rumors$` and `decryptionState$` for current state.

`start()` retains its own watch; `stop()` cancels current receive/watch subscriptions and operations, and later subscriptions can restart. Observing `giftWraps$`, `rumors$`, or `decryptionState$` does not prompt the signer. `sync$(options)` returns operation-local progress; `loadHistory()` uses a finite relay snapshot. Both take inclusive **envelope** timestamps without implicit message-timestamp overlap and load without starting processing; subscribe to `receive$` or `watch$` to process their arrivals automatically.

Use `ingest(event)` for externally loaded envelopes, `unlock(event)` to decrypt or retry one envelope, and `unlock()` to process loaded envelopes without prior failures. `autoUnlock$` reflects `setAutoUnlock()`; automatic decryption defaults to off. `decryptionConcurrency` limits simultaneous decryption calls across automatic and explicit processing (default `1`). Cancelled or timed-out calls retain their capacity until the underlying promise settles. `maxQueued` bounds concurrent envelope processing requests; background processing walks stored envelopes rather than buffering arrivals.

Use `readNext()` to process one eligible loaded envelope, or `readInbox()` to pull rumors without prefetching. Each pull decrypts both layers as needed and awaits rumor storage. Completed, failed, and currently processing envelopes are skipped; a selected envelope's failure rejects the pull. The iterator ends when no eligible loaded envelopes remain, rather than waiting for future arrivals. Keep `autoUnlock` off for application-controlled pacing.

```ts
for await (const rumor of receiver.readInbox({ signal })) {
  await handleRumor(rumor); // The next envelope starts after this finishes.
}
```

### Integration

The receiver discovers kind-10050 relays unless `relays` supplies an explicit array or observable; `fallbackRelays` applies when none are advertised. `authRequests$` exposes operation-owned authentication requests; call `authenticate(url)` for one relay or `authenticateAll()` to start all pending relays concurrently. Set `autoAuth: true` to authenticate as requirements arrive. Authentication runs independently of decryption and shares simultaneous attempts for the same relay. Manual authentication defaults to waiting without an approval timeout; set `authTimeout` to bound that wait. Live and history operations share the same authentication coordinator.

Encrypted-event persistence belongs to the supplied `eventStore` and the application's cache integration (`cacheRequest`). Optional `decryptionCache` restores and saves both encryption layers. `rumorStore` persists decrypted rumors, not envelopes, and should be account-scoped. An asynchronous rumor write is awaited; a failed write appears as a `storage` failure and can be retried without another signer call. Disposal releases only the default, receiver-owned rumor store.

Marmot consumers can select kind-444 rumors and retain their own invite/read state; messaging consumers select kind 14/15 and derive conversations. The receiver validates transport integrity without imposing those application protocols.

### Best Practices

- Share one receiver per account across consumers to share signer work.
- Inspect per-relay sync results: completion does not mean every relay succeeded or decryption finished.
- Read per-envelope failures from `decryptionState$.errors`; background cache, loading and rumor-storage errors also appear on `errors$`.
- Persist encrypted events and plaintext caches separately; failure records and envelope-processing bookkeeping currently remain in memory.

## Messaging clients

`LegacyMessagesClient` (NIP-04) and `WrappedMessagesClient` (NIP-17) combine a shared store, pool and fixed account into ready-to-use messaging clients. Import them from `applesauce-extra/messages`; no Kehto dependencies are required.

Each client owns its options, request types, lifecycle, and protocol orchestration independently in [`messages/legacy`](src/messages/legacy/) and [`messages/wrapped`](src/messages/wrapped/); protocol-neutral helper contracts and small utilities live in [`messages/common`](src/messages/common/).

```ts
const client = new WrappedMessagesClient({ pubkey, signer, eventStore, pool });
await client.start();
const subscription = client.conversation$([recipient]).subscribe(renderMessages);
client.setAutoUnlock(true);
await client.send({ recipients: [recipient], content: "Hello" });
// When the owner ends:
subscription.unsubscribe();
client.dispose();
```

Wrapped `start()` restores cached plaintext and starts recent-history and live loading; it does not wait for history or decryption to finish. Its `status$`, `syncStatus$`, `relayStatus$`, and `errors$` expose progress and failures. Signer-backed decryption defaults to off for both clients. Use `unlock()` for loaded messages, `unlock(event)` to retry one event, or `setAutoUnlock(true)` for continuous decryption; observe `decryptionState$` for decryption progress.

Legacy `decryptionState$` emits `LegacyDecryptionState` for currently loaded messages: `total = unlocked + locked`, with failed messages included in `locked` and `pending` counting distinct locked messages with active readers. Its `errors` is a `ReadonlyMap<string, unknown>` of the latest failures for loaded, still-locked events; retries retain the previous error until plaintext becomes available, including from cache or external helpers. Use `errors.has(event.id)` to detect failures (even an `undefined` rejection) and `errors.get(event.id)` to read them; there is no separate `failed` ID list. Bulk unlock skips prior failures, so its eligible count is `locked - errors.size`; retry one with `unlock(event)`, whose promise rejects on failure. Legacy conversation `errors$` reports loading, cache restoration, and storage failures, not duplicate decryption or publication errors; the wrapped-client state contract is unchanged.

Legacy `client.start()` hydrates encrypted cached events, restores plaintext, and starts live mailbox subscriptions with the configured recent lookback, but never reconciles relay history. `lifecycle$` exposes `idle`, `running`, and `disposed`; `running` means background work is active, not that every operation succeeded. History progress belongs to explicit `sync$()` subscriptions or `loadHistory()` results, not retained client state.

Legacy `cacheError$` and `conversationStorageError$` emit the latest error or `undefined`, cleared by the next successful event-cache hydration or conversation-index read/write respectively. `mailboxErrors$` emits live subscription failures as `{ mailbox: "incoming" | "outgoing", relays, error }`; it does not retain failures or include connection state. Observe `pool.status$` for connections and `client.relays$` for the mailbox relay set. Publication state and `sending$` belong to legacy conversations, not the legacy client.

`LegacyConversation.sending$` emits distinct booleans while preparation or publication is active, including signer prompts and storage work; `send()` stays active across both phases, and overlapping operations stay active until all settle. Prepared messages waiting for publication or retry are not active. Wrapped messaging retains its existing `busy$` API.

Use `conversation.publish(reference, options)` and `discardPublication(reference)` with a prepared handle or its message ID; `prepared.publish(options)` is only a convenience proxy. Retries reuse the signed event and frozen relays without signer prompts. IDs lazily restore durable pending records, never reconstructing publications from the EventStore; unknown IDs and foreign, forged, or stale handles reject.

`conversation.publicationState$(reference)` and `prepared.state$` observe the same conversation-owned `LegacyPublicationState`: `prepared`, `publishing`, `failed` (with the original `error`, even `undefined`), `accepted`, or `discarded`. These cold streams validate on subscription and error for invalid references. Acceptance means a relay acknowledgement, not recipient receipt. Publication failures reject and update state, without duplicate `errors$` notifications; storage cleanup failures use `errors$` and leave acceptance intact. Retrying acceptance only retries cleanup, never publication.

`pendingPublications$` excludes accepted and discarded records and retains stable handles per generation. `stop()` completes active state subscriptions and invalidates old handles, without inventing failure or discarding work; resubscribe by ID or use refreshed pending handles. An uncancellable in-flight publication blocks retries until it settles, and late acceptance still updates owned state. Accepted and discarded states remain addressable by ID for the conversation's lifetime, but are not restored after successful durable removal; `dispose()` releases observers and invalidates methods. Failed cleanup can leave a durable entry to recover after reload.

`prepareDraft()` restores the current draft and forwards its content, reply, and expiration to preparation, then clears only that unchanged draft revision before publication; newer edits survive, including identical replacements. Preparation failure preserves the draft, and no draft rejects without signing. Ordinary `prepareSend()`, `send()`, and publication retries never change drafts.

```ts
await conversation.setDraft({ content: "Hello", replyTo: parent.id });
const prepared = await conversation.prepareDraft();
await conversation.publish(prepared);
```

`sending$` stays active through the complete draft handoff, including storage. If draft removal fails after preparation, the handle is still returned and `errors$` reports a contextual `storage` error with its event ID; the draft remains available. Cancellation before preparation succeeds preserves the draft; cancellation after success skips removal if it has not started and still returns the handle. An already-started storage removal may finish after cancellation, but queued newer edits are preserved. With `publicationStorage`, preparation retains the signed event durably before removing the draft; after `stop()` or disposal, recover pending publications through an active conversation.

`messages$`, `readMessages$()`, `send()`, and prepared publications expose native kind-4 events for legacy messages and validated kind-14 rumors for wrapped messages. `readMessages$()` only reads events already in memory and watches store additions; `{ history: true }` reads a finite stored snapshot. Use `start()`, `sync$()`, `loadHistory()`, or conversation timeline loaders to load from the network. Legacy plaintext remains available through `getEncryptedContent(event)` or `EncryptedContentModel`; the signed event's `content` remains encrypted. `conversations$` and `conversation$()` derive their state from the shared store.

Legacy sends take `{ recipient, content }` and use `LegacyMessagesClientOptions`; wrapped sends take `{ recipients, content }` and use `WrappedMessagesClientOptions`. Kehto's protocol adapters translate native events into normalized messages before the multi-protocol adapter merges them.

### Authenticate message relays

Both clients expose `authRequests$` and `authenticate(url)` for user-driven NIP-42 authentication. Requests are grouped by relay and include their context, state (`pending`, `authenticating`, or `failed`), and last error.

```ts
const requests = use$(client.authRequests$) ?? [];
// From an explicit user action:
await client.authenticate(requests[0].url);
```

Authentication uses the client's fixed-account signer and checks the relay verdict. Concurrent attempts for the same relay share one promise, and rejected attempts remain available for retry. Read-only clients expose requests but cannot authenticate.

The optional `onAuthRequired` callback still runs after a request is recorded. Successful external authentication also clears requests. Requests belong to active reads, history syncs, or publications; ending an operation removes only its requests, and stopping the client clears all of them. Legacy conversations share their owner's authentication list.

Authentication resumes operations still waiting for it; operations that already timed out need an explicit retry. Subscribing to `authRequests$` never prompts the signer.

### Load a legacy conversation independently

Each legacy client belongs to one fixed account. `conversation(pubkey)` returns a stable `LegacyConversation` with its own live loading, lifecycle, and decryption controls. Opening it does not require `client.start()` or an account-wide history download.

```ts
const conversation = client.conversation(recipient);
const subscription = conversation.messages$.subscribe(renderMessages);
await conversation.start();
await conversation.loadHistory({ since, until });
await conversation.unlock();
await conversation.send({ content: "Hello" });
subscription.unsubscribe();
conversation.stop();
```

`start()` follows live messages with the configured recent lookback and restores cached plaintext for events already in the store, optionally decrypting them when auto-unlock is enabled; it never requests cache history or reconciles relay history. `lifecycle$` exposes `idle`, `running`, and `disposed`; `running` means background processing has started, not that history succeeded. `messages$` returns native events already in the shared store and does not start network loading by itself.

For a subscription-owned view, use `watch$()` instead of pairing `start()` with `stop()`:

```ts
const view$ = merge(conversation.messages$, conversation.watch$());
const subscription = view$.subscribe(renderMessages);
// Leaving this view releases only its live-processing interest.
subscription.unsubscribe();
```

`watch$()` emits no values and shares live loading, cached-plaintext restoration, and auto-unlock processing with other watchers and `start()`. The last unsubscribe releases that work unless an explicit start still owns it; it never cancels sends, history loaders, or other operations. `lifecycle$` tracks explicit `start()` ownership, so a watch-only conversation stays `idle`. Explicit `stop()` still cancels all conversation operations and completes current watchers; a later subscription starts fresh, while subscribing after disposal errors.

History loading is explicit and scoped to this correspondent: subscribe to `conversation.sync$({ since, until })` for operation-local progress, await `loadHistory({ since, until })` for its final result, or use `createTimelineLoader()` for viewport windows. Legacy clients and conversations no longer expose `status$` or retained `syncStatus$`, and conversation `start()` takes no history option.

The [legacy example](../../apps/examples/src/examples/messages/legacy.tsx) combines subscription-owned watching with a timeline loader and a DOM intersection observer. It disables speculative prefetch, extends the requested window only after successful relay and cache coverage, and doubles quiet-period lookback up to a year, resetting to a month near messages. No relays or incomplete coverage pauses expansion; only successful coverage reaching timestamp zero displays history completion, which describes the current sources rather than every possible relay.

Use `client.start()` separately for account-wide inbox discovery. Stopping a conversation leaves other conversations running; stopping or disposing the client stops all its conversations. Disposing a conversation releases it permanently, and the next `client.conversation(pubkey)` lookup creates a fresh instance.

`sync$({ since })` reconciles older history with progress; `loadHistory({ since })` returns its final status as a promise. Legacy history also accepts `correspondent`; wrapped history is mailbox-wide because participant metadata is encrypted. Wrapped date ranges include two days of envelope-timestamp overlap. A completed sync can contain failed relays; inspect its mailbox results.

### Consume a wrapped conversation

`WrappedConversation` exposes a local `RumorStore` containing the conversation's decrypted kind-14 messages. Participant order and duplicate pubkeys resolve to the same client-owned instance, including self-conversations.

```ts
const conversation = client.conversation([recipient]);
const messages = use$(conversation.messages$);
const threads = use$(conversation.threads$);
const replies = use$(() => conversation.replies$(parent), [conversation, parent]);

await conversation.send({ content: "Hello" });
await conversation.reply(parent, { content: "Reply" });
const prepared = await conversation.prepareSend({ content: "Retryable" });
await prepared.publish();
```

`conversation.eventStore` supports ordinary rumor queries and custom models. `ConversationMessagesModel`, `ConversationThreadsModel`, and `ConversationRepliesModel` are also exported from `applesauce-extra/messages` for use with conversation-scoped rumor stores. Threads are root messages with direct replies; replies select only the specified parent.

Creating a conversation follows already-decrypted messages without loading or prompting the signer. Start, sync, unlock, and authenticate through the client: encrypted gift wraps cannot be filtered by conversation. Removing the last envelope for a rumor removes it from the local store too.

`dispose()` or `[Symbol.dispose]()` releases the local store and cancels conversation sends without stopping the inbox. The next `client.conversation(...)` call creates a fresh instance. Disposing the client disposes all its conversations; stopping inbox loading leaves local views available. Keep profile queries on the application's shared store, and persist private plaintext only through encrypted storage.

### Integration

Configure the store's profile/relay-list loaders before creating the client. Supply `cacheRequest` for encrypted-event hydration and `decryptionCache` for private plaintext; the application owns event persistence and encryption at rest. Pass `onAuthRequired` and `authTimeout` to integrate relay authentication with your UI.

Wrapped sends require kind-10050 relays for every participant, including the sender. `fallbackRelays` applies to reads and legacy delivery only. `expiration` tags the logical message; `envelopeExpiration` independently expires wrapped relay envelopes.

```ts
const prepared = await client.prepareSend({ recipients, content });
try {
  await prepared.publish();
} catch (error) {
  // Retain prepared and retry publish() after inspecting the failure.
  // Wrapped failures expose per-recipient outcomes on WrappedMessagePublicationError.
}
```

Retries reuse signed events and skip accepted wrapped envelopes. `clientMessageId` provides a bounded, in-memory retry window for repeated `send()` calls; it is scoped by the optional operation `scope`. Relay acceptance is not a recipient delivery receipt.

### Best Practices

- Create a new client when the account changes; avoid a signer proxy that changes identity.
- Keep the shared pool and store alive when disposing an individual client.
- Connect client ownership to observable teardown and consume its state through `use$` in React.
- Pass an `AbortSignal` to cancellable operations; an already-issued signer or network request cannot be recalled.
- Keep approval UI in the `approve` callback, which receives plaintext before encryption or signing.

**Examples:** [`messages/gift-wrap`](../../apps/examples/src/examples/messages/gift-wrap.tsx), [`messages/legacy`](../../apps/examples/src/examples/messages/legacy.tsx), [`messages/personal-notes`](../../apps/examples/src/examples/messages/personal-notes.tsx)

## PrimalCache

Extended relay interface for Primal's caching server. Provides access to Primal's enhanced API endpoints for content discovery, user recommendations, trending hashtags, notifications, and more. Includes methods for:

- Content exploration and scoring
- User search and recommendations
- Trending hashtags and images
- Notification management
- Advanced search and feeds
- Media metadata retrieval

**Code:** [`src/primal.ts`](src/primal.ts)
**Upstream:** [PrimalHQ/primal-server](https://github.com/PrimalHQ/primal-server)

## Vertex

Extended relay interface for the Vertex relay (relay.vertexlab.io). Provides reputation-based user discovery and verification services. Includes methods for:

- Profile lookup with reputation scoring
- Reputation verification
- Credit balance checking
- Automatic authentication handling

**Code:** [`src/vertex.ts`](src/vertex.ts)
**Upstream:** [vertexlab.io](https://vertexlab.io/docs/services/)

## NIP-66 Relay Liveness

`RemoteMonitorRelayLiveness` supplies monitor-backed health through the same relay filtering interface as local `RelayLiveness`, without probing target relays.

```ts
const health = new RemoteMonitorRelayLiveness(eventStore, {
  monitors: [{ pubkey: monitor, relays: monitorRelays }],
});
const pool = new RelayPool({ liveness: health });
```

### Integration

Pass `health` to `RelayPool` to skip its unhealthy relays in every request, or to `ignoreUnhealthyRelays`, `ignoreUnhealthyRelaysOnPointers`, or `ignoreUnhealthyMailboxes` to filter specific relay lists. The shared EventStore validates and caches monitor events; the source manages publisher trust, report expiry, and negative consensus. See [Relay Liveness](https://applesauce.build/loading/relays/liveness) for configuration and lifecycle management.

### Best Practices

- Configure trusted publishers explicitly and prefer two independent monitors.
- Preserve unknown relays when reports are missing.
- Supply `interpretReport` only for a provider with documented explicit-negative semantics, or enable `staleAsOffline` to treat reports that active monitors stopped refreshing as offline.
- Match the requested capability and transport to the application.

## nspam Spam Filter

`NspamClassifier` runs the [nspam](https://huggingface.co/barrydeen/nspam) reply-spam model on-device and scores authors from their newest kind 1 replies. `filterSpam` removes spam replies from a timeline.

```ts
const nspam = await NspamClassifier.load();
const replies$ = eventStore.timeline({ kinds: [1], "#e": [root.id] }).pipe(filterSpam(nspam));
```

**Code:** [`src/nspam/`](src/nspam/)
**Upstream:** [barrydeen/nspam](https://huggingface.co/barrydeen/nspam)

## Kehto

Applesauce connects Kehto's sandboxed napplets to your app's existing EventStore, RelayPool, and active account. Import the browser host from `applesauce-extra/kehto/host`; import service adapters from `applesauce-extra/kehto` when you manage the shell yourself. Install the optional `@kehto/nip`, `@kehto/runtime`, `@kehto/services`, and `@kehto/shell` peers using versions compatible with this package's peer dependencies.

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";
import { createKehtoIdentityService, createKehtoOutboxService } from "applesauce-extra/kehto";

const context = { eventStore, pool, signer: accounts.active$ };
const host = createKehtoHost(context, {
  services: {
    identity: createKehtoIdentityService(context),
    outbox: createKehtoOutboxService(context),
  },
});
const instance = await host.resolve(manifestEvent);
instance.mount(iframe);
await instance.whenReady();
```

Configure the store's event loader before creating the host. The application owns the iframe, permission UI, and signing approval policy. Call `instance.destroy()` before removing its iframe and `host.destroy()` when the host's owner ends.

Choose services with individual constructors and pass the complete registry to the host. No services are created automatically. Add `dm: createKehtoDmService(context)` only when the app supports messaging; it defaults to NIP-17 and legacy NIP-04, with optional custom protocols and send routing.

- [Napplets: manifests, discovery, and handlers](https://applesauce.build/napplets/)
- [Hosting: setup, permissions, services, and lifecycle](https://applesauce.build/napplets/hosting)
- [Messaging: protocols, routing, and recovery](https://applesauce.build/napplets/messaging)

**Code:** [`src/kehto/`](src/kehto/)
