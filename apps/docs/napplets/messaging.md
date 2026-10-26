---
description: Configure messaging protocols and send routing for napplets hosted with Kehto and Applesauce
---

# Napplet messaging

The [napplet host](./hosting.md) includes a `dm` service backed by NIP-17 wrapped messages and legacy NIP-04 messages. Kehto's [`createDmService`](https://kehto.github.io/web/docs/api/modules/_kehto_services.html#dm-nap) handles request correlation, per-window subscriptions, and response envelopes; Applesauce supplies the message adapters. Your application chooses the transports, send policy, and signer.

For the default setup, no separate DM adapter is needed. Pass your reactive signer and approval callback to `createKehtoHost`. To change protocols, pass `dm` in the host's second argument:

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";
import { createWrappedMessageProtocol } from "applesauce-extra/kehto";

const host = createKehtoHost(context, {
  dm: { protocols: [createWrappedMessageProtocol(context)] },
});
```

This example enables only NIP-17. The following sections cover standalone adapters and custom transports; use the host's defaults unless your app needs to change them.

`createMultiProtocolDmAdapter` from `applesauce-extra/kehto` composes message protocol adapters into Kehto's existing `DmAdapter`; `createDmOptions` wraps it as service options. Wrapped NIP-17 and legacy NIP-04 adapters own their Nostr dependencies; custom adapters can use other transports and authentication.

## Usage

Pass only the protocols the application supports. An empty array exposes an unavailable DM adapter; `disable: ["dm"]` omits the service entirely when using `createKehtoServices`.

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

Given an application-owned `ndrAdapter` and recipient discovery function:

```ts
import { createDmAdapterProtocol, createMultiProtocolDmAdapter } from "applesauce-extra/kehto";

const ndr = createDmAdapterProtocol({
  id: "ndr",
  adapter: ndrAdapter,
  discover$: discoverNdrSupport$,
});
const adapter = createMultiProtocolDmAdapter({
  protocols: [ndr, createWrappedMessageProtocol(nostr)],
  routeSend: firstMatchingRoute(useProtocolWhenSupported("ndr"), defaultDmRouter),
});
```

The bridge reads every conversation/message page, preserves protocol-owned group ids, and translates subscription cleanup. Direct conversations merge by participants. Group support comes from the adapter's `group` capability or an explicit `supportsGroups` option; direct-only adapters cannot silently accept multiple peers. Discovery defaults to unknown support, so use explicit routing or provide `discover$`.

Pass a reactive adapter stream to invalidate sessions when authentication changes. Wrapped adapters must use the same normalized owner identity. Closing the bridge closes every adapter it has observed unless `closeAdapter: false` delegates ownership to the host.

Existing adapters own their send approval and publication behavior. The bridge invokes `send()` only after routing selects it, but cannot split or cancel the work inside that call. Native Applesauce adapters offer separate preparation/publication stages, signer support without raw secret keys, shared EventStore decryption caching, and reactive mailbox discovery. Runtime persistence for NDR and other stateful protocols stays owned by the application/runtime.

## Integration

`createKehtoServices` defaults to wrapped and legacy adapters built from the host context. Override the whole protocol list to use custom-only messaging or a chosen subset:

```ts
import { createKehtoServices } from "applesauce-extra/kehto";

const services = createKehtoServices(context, {
  dm: {
    protocols: [customProtocol],
    routeSend: useProtocol(customProtocol.id),
  },
});
```

For standalone use, pass the returned options to Kehto's `createDmService(dm)`. `adapter.close()` owns the supplied protocol adapters and calls their optional `close` methods; create separate adapter instances for independently managed services.

## Best Practices

- Share the host EventStore, RelayPool, and resolved `account$` between Nostr adapters.
- Keep `session$` lazy and emit the current session when subscribed.
- Keep native protocol ids stable; the composer namespaces them for Kehto.
- Use `routingTimeout` to bound session resolution, discovery, and custom routing (default 4000 ms).
- Use `operationTimeout` to bound each history backend and complete send operations (default 120000 ms).
- Configure Nostr `decryptionTimeout` for slow signers (default 60000 ms per message) and `actionTimeout` for approval/send preparation (default 120000 ms).
- Publish only encrypted Nostr events to the shared store; let the host configure encrypted-content persistence.
- Reuse a wrapped send's `clientMessageId` when retrying partial publication, and remember cancellation may follow relay acceptance.
