# Applesauce Extra

A collection of stuff that doesn't fit into any applesauce package.

Each module has its own entry point (`applesauce-extra/nspam`, `applesauce-extra/vertex`, `applesauce-extra/primal`, `applesauce-extra/open-ranking`, `applesauce-extra/remote-monitor-relay-liveness`, `applesauce-extra/messages`, `applesauce-extra/kehto`), so importing one doesn't load the others or their optional dependencies.

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

`start()` restores cached plaintext and starts recent-history and live loading; it does not wait for history or decryption to finish. Signer-backed decryption defaults to off. Use `unlock()` for loaded messages, `unlock(event)` to retry one event, or `setAutoUnlock(true)` for continuous decryption. Observe `status$`, `syncStatus$`, `relayStatus$`, `decryptionState$`, and `errors$` for progress and failures.

`messages$`, `readMessages$()`, `send()`, and prepared publications expose native kind-4 events for legacy messages and validated kind-14 rumors for wrapped messages. Legacy plaintext remains available through `getEncryptedContent(event)` or `EncryptedContentModel`; the signed event's `content` remains encrypted. `conversations$` and `conversation$()` derive their state from the shared store.

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

Each legacy client belongs to one fixed account. `conversation(pubkey)` returns a stable `LegacyConversation` with its own live loading, history progress, and decryption controls. Opening it does not require `client.start()` or an account-wide history download.

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

Cache and relay history queries are restricted to incoming and outgoing messages with that correspondent. `start()` loads the configured recent history window and follows live messages; older history is explicit. `messages$` returns native events already in the shared store and does not start network loading by itself.

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
