---
description: Configure messaging protocols and send routing for napplets hosted with Kehto and Applesauce
---

# Napplet messaging

Add messaging explicitly with `createKehtoDmService`. It defaults to NIP-17 wrapped messages and legacy NIP-04 messages. Kehto's [`createDmService`](https://kehto.github.io/web/docs/api/modules/_kehto_services.html#dm-nap) handles request correlation, per-window subscriptions, and response envelopes; Applesauce supplies the message adapters. Your application chooses the transports, send policy, and signer.

Pass the service in the [host's registry](./hosting.md#choosing-services). To support only NIP-17:

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";
import { createKehtoDmService, createWrappedMessageProtocol } from "applesauce-extra/kehto";

const host = createKehtoHost(context, {
  services: {
    dm: createKehtoDmService(context, {
      protocols: [createWrappedMessageProtocol(context)],
    }),
  },
});
```

Use `createKehtoDmService(context)` to support both default protocols. Omit the `dm` registry entry entirely when your app does not support messaging.

`createMultiProtocolDmAdapter` from `applesauce-extra/kehto` composes message protocol adapters into Kehto's existing `DmAdapter`; `createDmOptions` wraps it as service options. Legacy NIP-04 and NDR integrations can borrow an application's client or construct their own; custom adapters can use other transports and authentication.

## Usage

Pass only the protocols the application supports. An empty array exposes an unavailable DM adapter; omit the `dm` registry entry to leave out the service entirely.

```ts
import { createDmOptions, createWrappedMessageProtocol, createLegacyMessageProtocol } from "applesauce-extra/kehto";

const nostr = { eventStore, pool, signer, fallbackRelays };
const dm = createDmOptions({
  protocols: [createWrappedMessageProtocol(nostr), createLegacyMessageProtocol(nostr)],
});
```

The default send router continues the last observed eligible conversation protocol, then tries advertised NIP-17 relays and advertised legacy inboxes. History, live messages, and successful sends update the routing metadata; sending does not fetch an entire conversation to select a protocol. Missing relay lists mean unknown support, and fallback relays do not prove recipient support.

NIP-17 supports groups and self messages. Legacy messages support one peer or self messages, read incoming inboxes and outgoing outboxes, and publish to the recipient's inbox/DM relays plus the sender's outboxes. Kehto message ids are namespaced by protocol; conversations merge by their participants, with a `group:` prefix for more than two participants. Protocol-owned conversations can supply an opaque `conversation` identity instead; their ids remain separate even when participants match.

NIP-17 publication requires nonempty kind-10050 relay advertisements for every participant, including the sender's backup copy. Missing or empty advertisements prevent sending; configured fallback relays are used only for reading wrapped messages. Content mentions never add recipients or change the requested text.

## Client ownership

Both `createLegacyMessageProtocol` and `createNdrMessageProtocol` accept either `client` or `clientOptions`:

```ts
const legacy = createLegacyMessageProtocol({ client: activeLegacyClient$, approve });
const ndr = createNdrMessageProtocol({
  clientOptions: { pubkey, signer, eventStore, pool, relays, storage },
  approve,
});
```

`client` accepts an existing instance or a client stream that emits `undefined` on logout. The application starts and disposes these clients; closing the protocol never stops them. Legacy sessions require a running client, and NDR sessions require a ready client.

`clientOptions` takes the core client's complete constructor options, including its storage and relay configuration. Construction and startup begin with the first subscription to `session$` or `client$`. The created client stays alive between requests until `protocol.close()`; closing the containing DM adapter also closes its protocols. Shared stores and pools remain application-owned. Create a new protocol for a different account, or supply a reactive app-owned client stream.

Both explicit ownership modes expose `protocol.client$` for host controls such as NDR registration, legacy authentication, and unlocking. NDR registration remains an explicit host action.

Legacy's explicit client modes read unlocked messages and observe subsequent unlock updates without initiating signer prompts. Configure `clientOptions.autoUnlock` or use the client's `unlock()` and `setAutoUnlock()` methods from host controls. History requests still call the client's finite `loadHistory()` before reading a snapshot; live relay loading follows the client's lifecycle.

The existing `createLegacyMessageProtocol({ eventStore, pool, signer, ... })` signature remains supported with its subscription-owned loading and automatic decryption behavior. In both APIs, Kehto owns plaintext send approval and window-scoped retry identities, while the core client owns encryption and publication retries.

## Decrypted content cache

Pass an `EncryptedContentCache` as `decryptionCache` to either Nostr protocol adapter to reuse decrypted content across reloads:

```ts
const nostr = { eventStore, pool, signer, decryptionCache };
const protocols = [createWrappedMessageProtocol(nostr), createLegacyMessageProtocol(nostr)];
```

`createKehtoDmService(context)` forwards `context.decryptionCache` to both default adapters. Custom protocol lists must receive the cache explicitly.

The adapters await cache restoration before asking the signer to decrypt and persist newly decrypted content afterward. Keys are event IDs, compatible with `persistEncryptedContent`: legacy entries contain message text, gift-wrap entries contain serialized seals, and seal entries contain serialized rumors. Both NIP-17 layers must be cached to avoid all decryption calls after a reload. The sender's own copy is also cached during send preparation.

Provide secure storage, such as the encrypted storage used in the [messaging examples](https://applesauce.build/examples/), since cache values are decrypted content. The host controls storage access and its account lifecycle; the adapters do not add account prefixes or manage storage encryption. Cache read failures fall back to the signer, and write failures do not prevent delivery. Event persistence remains separate from this plaintext cache.

## Custom Protocols and Routing

A `DmProtocolAdapter` supplies a unique `id` and a reactive `session$`. Its stable session implements `discover$`, `messages$`, and `prepareSend$`. Sessions use a common owner identity so their normalized conversations can be combined.

- `discover$` separates local `canSend` eligibility from recipient `support`: `supported`, `unsupported`, or `unknown`. It can return per-recipient support and advertised relays.
- `messages$` emits `DmProtocolMessage` values with native ids and all participants, including the owner. It completes after current history when `context.history` is true and otherwise stays live.
- `prepareSend$` performs the protocol's approval/encryption/signing work and emits one `DmPreparedSend`. Its `publish$` must be cold, must emit the final normalized message exactly once after publication succeeds, and must not publish during preparation. The optional `message` preview allows validation before publication.

The composer supplies an `AbortSignal` to each operation. Adapters must honor it, unsubscribe their transport streams on teardown, and check cancellation after asynchronous work before starting side effects. Emit `undefined` immediately when a session is invalidated, and emit a new session object when authentication changes. Expected malformed-message errors should be handled inside the adapter; live stream errors reconnect that protocol independently.

Given an application-provided `customProtocol`, prefer it when discovery detects support:

```ts
import { firstMatchingRoute, useProtocolWhenSupported, useProtocol, defaultDmRouter } from "applesauce-extra/kehto";

const routeSend = firstMatchingRoute(useProtocolWhenSupported(customProtocol.id), defaultDmRouter);
const dm = createDmOptions({
  protocols: [customProtocol, createWrappedMessageProtocol(nostr)],
  routeSend,
});
```

For custom-only messaging, pass `[customProtocol]` and `routeSend: useProtocol(customProtocol.id)`. Explicit selection permits unknown recipient support, but the adapter must still report `canSend: true`. The composer rejects unregistered or ineligible selections and never switches protocols after publication starts.

`useLastMessageProtocol({ direction: "incoming" })` follows the latest observed incoming message. `useWrappedWhenAdvertised` and `useLegacyWhenInboxAdvertised` expose the default router's remaining rules. `useWrappedFallback` is deprecated and cannot bypass the native adapter's relay requirements. Routers receive a bounded discovery snapshot and may also run application-owned asynchronous policy checks.

## History and Recovery

Successful history snapshots are cached per authenticated protocol session for `historyMaxAge` milliseconds (default 30000). Concurrent queries share the same load, and live messages and successful sends update the cached messages. Set `historyMaxAge: 0` to refresh on every query. Initial and expired loads still read the protocol's complete history; pagination reuses the snapshot during its cache lifetime.

A failed or timed-out history backend does not hide successful backends; failed loads are retried on the next query. If every backend fails, the query rejects. Live failures reconnect only the affected backend after `retryDelay` milliseconds (default 1000). Use `onProtocolError` to report these failures to the host:

```ts
const dm = createMultiProtocolDmAdapter({
  protocols,
  onProtocolError: ({ protocol, operation, error }) => {
    console.error(`${protocol} ${operation} failed`, error);
  },
});
```

Wrapped publication attempts every participant's envelope. `DmPublicationError` exposes `protocolMessage` and per-participant `publications` with `recipient`, `eventId`, `accepted`, and `error`. Acceptance means a relay accepted the envelope; it does not confirm the recipient read it. Native message publication adds encrypted events to the shared store only after relay acceptance.

Pass a stable `clientMessageId` when retrying a wrapped send. Within the same protocol session and requesting window, the last 100 prepared sends retain their original rumor and envelopes; retries publish only envelopes not yet accepted. Reusing an id for different content or recipients rejects. This cache is in memory, can be evicted, and does not survive session replacement or restart; a retry without a retained id is a new send. The error's structured outcomes are available to direct adapter callers; Kehto's message bridge forwards only its error text.

## Existing Kehto Adapters

`createDmAdapterProtocol` includes any existing Kehto `DmAdapter`, including the prebuilt NIP-17, NDR, and Cordn adapters. See the [Kehto services reference](https://kehto.github.io/web/docs/packages/services#scope-boundaries) for the library boundary and [DM adapter APIs](https://kehto.github.io/web/docs/api/modules/_kehto_services.html#dm-nap) for transport requirements. Kehto's `createNip17DmAdapter` accepts an owner secret key; Applesauce's `createWrappedMessageProtocol` uses your existing signer instead.

Given an application-owned adapter and recipient discovery function:

```ts
import { createDmAdapterProtocol, createMultiProtocolDmAdapter } from "applesauce-extra/kehto";

const external = createDmAdapterProtocol({
  id: "external",
  adapter: existingAdapter,
  discover$: discoverSupport$,
});
const adapter = createMultiProtocolDmAdapter({
  protocols: [external, createWrappedMessageProtocol(nostr)],
  routeSend: firstMatchingRoute(useProtocolWhenSupported("external"), defaultDmRouter),
});
```

The bridge reads every conversation/message page, preserves protocol-owned group ids, and translates subscription cleanup. Direct conversations merge by participants. Group support comes from the adapter's `group` capability or an explicit `supportsGroups` option; direct-only adapters cannot silently accept multiple peers. Discovery defaults to unknown support, so use explicit routing or provide `discover$`.

Pass a reactive adapter stream to invalidate sessions when authentication changes. Wrapped adapters must use the same normalized owner identity. Closing the bridge closes every adapter it has observed unless `closeAdapter: false` delegates ownership to the host.

Existing adapters own their send approval and publication behavior. The bridge invokes `send()` only after routing selects it, but cannot split or cancel the work inside that call. Native Applesauce adapters offer separate preparation/publication stages, signer support without raw secret keys, shared EventStore decryption caching, and reactive mailbox discovery. Runtime persistence for NDR and other stateful protocols stays owned by the application/runtime.

## NDR Messages Client

Use `createNdrMessageProtocol` to wrap or construct an [NDR messages client](../extra/ndr.md), following the [client ownership options](#client-ownership). The client manages runtime persistence, durable history, device registration, the outbox, and the Web Lock where available; the host supplies account/device-scoped storage and its encryption at rest. `createNdrStorage` is only a JSON wrapper, not an encrypting adapter. Kehto supplies routing, normalization, and plaintext send approval.

```ts
import { createNdrMessageProtocol, createMultiProtocolDmAdapter } from "applesauce-extra/kehto";

const ndr = createNdrMessageProtocol({
  client: activeNdrClient$, // NdrMessagesClient | undefined
  approve: ({ template, windowId }) => approveMessage(template, windowId),
});
const adapter = createMultiProtocolDmAdapter({
  protocols: [ndr, createWrappedMessageProtocol(nostr)],
  routeSend: firstMatchingRoute(useProtocolWhenSupported("ndr"), defaultDmRouter),
});
```

For an app-owned client, the host calls `client.start()` and `client.dispose()`. With `clientOptions`, the protocol owns those calls. Only clients with a ready lifecycle expose a session, but lifecycle readiness does not imply registration or send readiness: observe `state$` and conversation `canSend$`. A reactive client stream can emit `undefined` on logout; replacement invalidates pending Kehto operations. Registration remains explicit in either mode.

Use `errors$` for background failures, `pendingPublications$` for the queued-envelope count, and `retryPublications()` to retry durable envelopes rather than issuing another plaintext send. `republishInvite()` republishes an already registered device's invite. See [Messages](../extra/messages.md) for full client lifecycle and recovery guidance.

Discovery waits up to `discoveryTimeout` (default 3000 ms) for peer devices. Missing discovery is unknown support, so automatic routing can fall back while an explicit NDR route can still attempt delivery. Direct conversations merge by participants; existing groups retain their native IDs and require matching recipients and accepted membership. Create groups through the client before sending to them through Kehto.

Kehto's `sent` status means submitted: queued and relay-published NDR messages both map to it. Only peer `delivered` or `seen` receipts map to `delivered`. Subscriptions forward changed delivery statuses. Rich attachments, reactions, drafts, and typing remain available through the core client's conversation APIs.

Pass a stable `clientMessageId` to retain the last 100 send handles per client session and conversation/window scope. Retries reuse the original send result, including failures whose durable handoff may be ambiguous; a new ID starts a new send. Checks before approval and dispatch prevent cancelled requests from starting sends, but a client send already in progress can still complete its durable handoff.

For low-level runtime integrations, `createNdrTransport` remains available from `applesauce-extra/messages/ndr`; the older `applesauce-extra/kehto/services/dm/ndr` transport exports remain compatible alongside the new protocol factory.

### Testing in the messages example

Open [Napplet messages](https://applesauce.build/examples/#/example/napplet/messages) in two browser profiles with different accounts:

1. Unlock storage and log in, then enable **NDR** in each profile.
2. Configure the same NDR relays and apply them; the example uses its fallback relay set initially.
3. Click **Register device & publish invite** for each new device and approve the signer request. The status becomes **ready**; existing devices can republish their invites with **Publish invite**.
4. Select **NDR** under **Routing**, press **Refresh messages** in the napplet, open a conversation using the other account's npub, and send a message. The host asks for message approval before handing it to NDR.
5. Reply from the second profile, then reload, unlock, and re-enable NDR to test recovery. Device keys, ratchet state, message history, and pending signed publications are stored in account-scoped encrypted storage.

All example protocols start disabled. Expand a protocol's settings using its header and enable it independently of the other protocols. The generic napplet never inspects protocol labels or message-id prefixes.

After changing enabled protocols or device readiness, press **Refresh messages** in the napplet. The installed NAP-DM API has no availability-change or subscription-ended notification, and the composer invalidates existing subscriptions when protocol sessions change. Refresh uses only Kehto's public status, subscription, and history APIs; the example does not use custom iframe messages or polling to hide this limitation.

**Auto** prefers advertised NDR support before NIP-17/NIP-04; selecting NDR explicitly never silently falls back. The example's new-conversation UI addresses one other recipient; existing client groups can appear in history. **Submitted** means a local handoff, and delivery receipts update the normalized message status.

Turning NDR off cancels its pending approvals and subscriptions without deleting state. Where available, a Web Lock prevents two tabs from writing the same account's NDR state; contention rejects startup, and retry requires a new client instance. Without Web Locks, or with `lockName: false`, the host must enforce storage isolation. Use different browser profiles for independent devices. Retry handles do not survive reloads or toggle cycles.

The example imports history saved by its previous runtime adapter into the client's history once, keeping the existing account storage and device state.

## Cordn coordinator transport

`createCordnCoordinator` from `applesauce-extra/kehto/services/dm/cordn` provides the host-side coordinator connection, not an MLS runtime or a `DmProtocolAdapter`. Install its optional peers `@contextvm/sdk@0.13.10` and `@contextvm/mcp-sdk@1.30.0`. It uses the shared pool and store without changing the generic CVM service's ephemeral identity defaults.

```ts
const coordinator = createCordnCoordinator(context, {
  ownerPubkey,
  signer, // Account-bound signer with NIP-44, including extension or bunker signers
  coordinatorPubkey,
  relays: ["wss://your-coordinator-relay.example/"],
});
try {
  const packages = await coordinator.listKeyPackages();
} finally {
  await coordinator.close();
}
```

Key-package publication and welcome retrieval use the account identity; listing, key-package consumption, welcome storage, and encrypted group-message operations use a separate ephemeral caller. Requests use encrypted ephemeral gift wraps, bounded deadlines, and relay-acceptance checks. A transport/request failure closes the client; create a new instance to retry. Close it when its owning account or protocol ends.

The runtime consuming this client must verify consumed key-package publication events and their credential bindings, perform real MLS encryption and sender authentication, and durably persist MLS state and cursors before acknowledging welcomes. No base64-JSON message fallback is provided.

Cordn integration is shelved and its controls are not shown in the messages example. The coordinator client remains available separately; automated coverage uses a local in-memory ContextVM server, not a live Cordn deployment.

## Integration

`createKehtoDmService` builds wrapped and legacy adapters from the shared context by default. Override the protocol list for custom-only messaging:

```ts
import { createKehtoDmService } from "applesauce-extra/kehto";

const services = {
  dm: createKehtoDmService(context, {
    protocols: [customProtocol],
    routeSend: useProtocol(customProtocol.id),
  }),
};
```

For standalone use, pass `createDmOptions(...)` to Kehto's `createDmService`. `adapter.close()` owns the supplied protocol adapters and calls their optional `close` methods; create separate adapter instances for independently managed services.

## Best Practices

- Share the host EventStore, RelayPool, and resolved `account$` between Nostr adapters.
- Keep `session$` lazy and emit the current session when subscribed.
- Keep native protocol ids stable; the composer namespaces them for Kehto.
- Use `routingTimeout` to bound session resolution, discovery, and custom routing (default 4000 ms).
- Use `operationTimeout` to bound each history backend and complete send operations (default 120000 ms).
- Configure Nostr `decryptionTimeout` for slow signers (default 60000 ms per message) and `actionTimeout` for approval/send preparation (default 120000 ms).
- Publish only encrypted Nostr events to the shared store; let the host configure encrypted-content persistence.
- Reuse a wrapped send's `clientMessageId` when retrying partial publication, and remember cancellation may follow relay acceptance.
