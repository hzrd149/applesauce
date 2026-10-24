---
description: Host concurrent Kehto napplets using a shared applesauce store, relay pool, and account
---

# Hosting napplets

`createKehtoHost` from `applesauce-extra/kehto/host` connects Kehto's browser shell to applesauce services. One host runs multiple sandboxed napplet instances using your application's event store, relay pool, event loader, and active account.

Install the optional Kehto peers alongside `applesauce-extra`: `@kehto/nip`, `@kehto/runtime`, `@kehto/services`, and `@kehto/shell`. Use versions compatible with the package's peer dependencies.

## Basic usage

Configure your store's event loader first. Pass the same store, pool, and signer stream used by the rest of your application:

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";

const host = createKehtoHost({
  eventStore,
  pool,
  signer: accounts.active$,
  fallbackRelays,
  fallbackBlossomServers,
  approve: ({ windowId, template }) => askToSign(windowId, template),
});

const instance = await host.resolve(manifestEvent);
instance.mount(iframe); // A connected, application-owned iframe
await instance.whenReady();
```

Resolution verifies the manifest signature and artifact hashes before mounting. The default fetcher combines declared Blossom locations with the author's server list, using configured fallback servers when neither is available. It throws when resolution fails.

Mounting sets `sandbox="allow-scripts"`, applies Kehto's controller restrictions, registers the source window, and prepares the document with Kehto's CSP and namespace bindings. The host does not create or remove DOM elements.

`whenReady()` waits for document load and for Kehto to accept `shell.ready` and queue `shell.init`. It does not acknowledge that application code consumed initialization. The default deadline is ten seconds from mounting; configure `readyTimeout` to change it. Failure destroys the instance and rejects the promise.

## Multiple instances

Resolve each running instance separately, including when opening the same manifest twice:

```ts
const first = await host.resolve(manifestEvent);
const second = await host.resolve(manifestEvent);
first.mount(firstIframe);
second.mount(secondIframe);

first.destroy(); // The second instance keeps running
firstIframe.remove();
```

Each instance has a unique `windowId`. Kehto routes requests and replies by registered source window and manages per-window subscriptions. The instances share event data, relay connections, and the host's active account; they are not separate account sessions or private databases.

Instances represent one document. Mounting into another iframe requires a new instance. Calling `mount` again with the same iframe is harmless. A subsequent document load destroys the instance; use a new instance for reloads. Keep iframe navigation under host control.

## Integration

### Additional NAP services

Add services by name, or replace an applesauce default with your own implementation:

```ts
const host = createKehtoHost(context, {
  disable: ["upload"],
  services: {
    theme: theme.handler,
    notify,
    intent,
    resource: customResource,
  },
});
```

An explicit service replaces the matching default before it is constructed. `disable` suppresses default creation; it does not remove an explicitly supplied service. Kehto computes capabilities from the final registry and shell hooks. Known service domains such as `intent` and `link` receive their required availability hooks automatically.

Custom services still follow Kehto's registration, capability, and protocol requirements. Adding a registry entry does not invent a browser namespace binding or grant permissions.

For custom shell behavior, supply partial hook groups. Unspecified methods retain the applesauce defaults:

```ts
const host = createKehtoHost(context, {
  shell: {
    relayPool: {
      openScopedRelay,
      closeScopedRelay,
      publishToScopedRelay,
    },
    relayConfig: hostRelaySettings,
  },
});
```

The default shell does not implement scoped relays, relay-setting mutations, NIP-66 suggestions, window creation, or forwarded hotkeys. Those hooks exist for host integration. Normal relay traffic uses the shared applesauce pool and store.

### Outbox relay selection

Napplet reads through NAP-OUTBOX select relays from the authors' NIP-65 outboxes, limited to 12 connections and 3 relays per author by default. Pass numbers or observables to tune the limits; open subscriptions reroute when they change:

```ts
const pool = new RelayPool({ liveness }); // Unhealthy outboxes are replaced by healthy ones
const host = createKehtoHost({ ...context, pool, relaySelection: { maxConnections: 20, maxRelaysPerUser: max$ } });
```

### Caching and artifact fetching

Pass an application-owned artifact cache, or customize resolution for one instance:

```ts
const cache = await openNappletArtifactCache(); // From @kehto/nip/5d
const host = createKehtoHost(context, { cache });
const instance = await host.resolve(manifestEvent, {
  fetchBlob: (hash, servers) => fetchArtifact(hash, servers),
});
```

Kehto verifies custom fetcher bytes too. `instance.source` is `"cache"` when no blob fetch was needed and `"fetch"` otherwise. Host destruction aborts its built-in fetch requests; application-supplied blob fetchers own their cancellation. Resolutions finishing after destruction reject without creating an instance.

### Permissions and host messages

Use `host.bridge` for Kehto's consent handlers, ACL management, and theme broadcasts. Signing approval is separate from Kehto's runtime permission checks. Omitting `context.approve` allows signing under the existing adapter policy; provide it when the application needs confirmation.

Account changes are broadcast through Kehto's identity publication path. The application remains responsible for theme changes and other UI events.

Use `instance.send()` for host-originated protocol messages, including intent delivery:

```ts
await instance.whenReady();
const delivered = instance.send({
  type: "intent.deliver",
  delivery: { sender, archetype, action, convention, payload },
});
if (!delivered) throw new Error("Target unavailable or delivery denied");
```

Delivery requires a live initialized instance and current recipient permissions. Intent delivery checks the granted `intent` domain and `intent:read` capability explicitly because this Kehto version omits its recipient mapping; other messages use Kehto's recipient API. It returns false for unavailable instances, denied recipients, and unsupported message types. A true result means the message was sent, not that the napplet completed the action. Intent selection and sender identity remain application policy.

### Lower-level integration

The browser host has a separate entry point so services-only imports do not load the browser shell or artifact resolver. Use `createKehtoServices(context, options)` from `applesauce-extra/kehto` with an existing shell adapter when your application already manages iframe lifecycle. `createKehtoShellAdapter` and the foundation helpers remain available independently.

The new host registers its message listener automatically; do not also register `host.bridge.handleMessage`. Keep initial service configuration fixed while instances are running, because Kehto freezes each document's capability environment at initialization.

## Best Practices

- Create one host for related napplet windows and reuse the application's store and pool
- Render resolution and initialization errors in the surrounding host UI
- Call `instance.destroy()` before removing its iframe
- Call `host.destroy()` when its owner ends; repeated destruction is harmless
- Let Kehto own attached service lifecycle callbacks; clean up separately owned resources yourself
- Keep using the pool, store, signer, and cache after host destruction if other features need them

The [Napplet Loader example](https://applesauce.build/examples/#/example/napplet/loader) demonstrates prompts, theme changes, notifications, intent routing, persistent caches, and concurrent panes.

### Application block lists

Identity blocks are application policy. Pass an `identity.getBlocked` provider through the service options; it receives the active account pubkey and original request and returns blocked pubkeys.

```ts
const services = createKehtoServices(context, {
  identity: { getBlocked: (pubkey) => appBlocks.get(pubkey) ?? [] },
});
```

Alternatively, set `identity: { useMutesForBlocks: true }` to return public NIP-51 muted pubkeys as blocks. This uses the same reader as `getMutes` and does not decrypt private entries. An explicit `getBlocked` provider takes precedence. Without either option, Kehto returns an empty block list; applications decide how blocks affect filtering or delivery.
