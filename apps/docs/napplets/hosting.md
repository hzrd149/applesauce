---
description: Host concurrent Kehto napplets using a shared applesauce store, relay pool, and account
---

# Hosting napplets

`createKehtoHost` from `applesauce-extra/kehto/host` connects Kehto's browser shell to applesauce services. A napplet is a NIP-5D application loaded into a sandboxed iframe; NAP services let it request data and actions from your app. Kehto provides the runtime and protocol bridge, while applesauce supplies your existing store, relays, and account. See [Kehto’s runtime and shell boundaries](https://kehto.github.io/web/docs/concepts/runtime-shell-boundaries) for the underlying library responsibilities. This guide covers embedding napplets in an Applesauce app; guest napplets use `@napplet/core` and `window.napplet`. See [Napplets](./index.md) for discovery and handler preferences.

## Install

Install `applesauce-extra` and its optional Kehto peers. These ranges match the integration's current peer dependencies:

```sh
pnpm add applesauce-extra @kehto/nip@^0.7.0 @kehto/runtime@^0.26.0 @kehto/services@^0.25.1 @kehto/shell@^0.24.4
```

Use `applesauce-extra/kehto/host` in browser code. For server rendering, create the host only after the browser is available.

## Basic usage

Reuse your application's `eventStore`, `pool`, and `AccountManager` (`accounts` below). Configure the store's loader once so services can fetch missing profiles, relay lists, and other events:

```ts
import { createEventLoaderForStore } from "applesauce-loaders/loaders";

createEventLoaderForStore(eventStore, pool, { lookupRelays, extraRelays: fallbackRelays });
```

Skip this step if your store already has a loader. Create one host for the napplet windows your app manages:

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";
import { createKehtoIdentityService, createKehtoOutboxService, type KehtoContext } from "applesauce-extra/kehto";

const context: KehtoContext = {
  eventStore,
  pool,
  signer: accounts.active$,
  fallbackRelays,
  fallbackBlossomServers,
  approve: ({ windowId, template }) => askToSign(windowId, template),
};

const services = {
  identity: createKehtoIdentityService(context),
  outbox: createKehtoOutboxService(context),
};
const host = createKehtoHost(context, { services });
```

Resolve and mount a verified napplet artifact:

```ts
const instance = await host.resolve(manifestEvent);
instance.mount(iframe); // A connected, application-owned iframe
await instance.whenReady();
```

Here `manifestEvent` is a signed napplet manifest event (kind 5129, 15129, or 35129), and `iframe` is a connected `HTMLIFrameElement` created by your UI. `fallbackRelays`, `fallbackBlossomServers`, and `askToSign` are application-provided values; `askToSign` must return a boolean or `Promise<boolean>`.

Resolution verifies the manifest signature and artifact hashes before mounting. The default fetcher combines declared Blossom locations with the author's server list, using configured fallback servers when neither is available. It throws when resolution fails.

Mounting sets `sandbox="allow-scripts"`, applies Kehto's controller restrictions, registers the source window, and prepares the document with Kehto's CSP and namespace bindings. The host does not create or remove DOM elements. Kehto’s [shell package](https://kehto.github.io/web/docs/packages/shell) documents source registration, document preparation, and browser message routing.

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

### Choosing services

Pass a complete `services` registry containing only the services your app supports. Omitting it creates a host with no NAP services. The example above provides identity and outbox; messaging is unavailable because there is no `dm` entry. See [Services & Adapters](./services.md#service-registry) for the available constructors.

Pass `signer: accounts.active$` to follow login, logout, and account switches. Omit the signer for an anonymous host; operations requiring signing or decryption remain unavailable. See [Messaging](./messaging.md) to add DM support and choose protocols and send routing.

### Additional NAP services

Add application services or replace entries using object composition:

```ts
const host = createKehtoHost(context, {
  services: {
    ...services,
    theme: theme.handler,
    notify: notifyService,
    intent: intentService,
    resource: customResource,
  },
});
```

`theme`, `notifyService`, `intentService`, and `customResource` above are application-created Kehto services. The supplied registry is used as-is; there are no implicit defaults to disable. Kehto computes capabilities from the final registry and shell hooks. Known service domains such as `intent` and `link` receive their required availability hooks automatically.

Custom services still follow Kehto's registration, capability, and protocol requirements. Adding a registry entry does not invent a browser namespace binding or grant permissions. See [registering a service](https://kehto.github.io/web/docs/how-tos/register-service) for domain routing and extension requirements.

For custom shell behavior, supply partial hook groups. Unspecified methods retain the applesauce defaults:

```ts
const host = createKehtoHost(context, {
  services,
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
const relayContext = { ...context, pool, relaySelection: { maxConnections: 20, maxRelaysPerUser: max$ } };
const host = createKehtoHost(relayContext, {
  services: { outbox: createKehtoOutboxService(relayContext) },
});
```

### Caching and artifact fetching

Pass an application-owned artifact cache, or customize resolution for one instance:

```ts
import { openNappletArtifactCache } from "@kehto/nip/5d";

const cache = await openNappletArtifactCache();
const host = createKehtoHost(context, { services, cache });
const instance = await host.resolve(manifestEvent, {
  fetchBlob: (hash, servers) => fetchArtifact(hash, servers),
});
```

`openNappletArtifactCache()` returns `undefined` when Cache Storage is unavailable; the host then resolves over the network without a persistent artifact cache. See Kehto’s [artifact cache guide](https://kehto.github.io/web/docs/how-tos/implement-napplet-artifact-cache) for storage budgets, eviction, diagnostics, and verified writes.

Kehto verifies custom fetcher bytes too. `instance.source` is `"cache"` when no blob fetch was needed and `"fetch"` otherwise. Host destruction aborts its built-in fetch requests; application-supplied blob fetchers own their cancellation. Resolutions finishing after destruction reject without creating an instance.

### Permissions and host messages

Use `host.bridge` for Kehto's consent handlers, ACL management, and theme broadcasts. Manifest `R` tags declare required domains and `O` tags declare optional domains; neither grants permissions. Domain exposure and ACL grants are separate checks. See [capability negotiation](https://kehto.github.io/web/docs/concepts/capability-negotiation) and [granting a capability](https://kehto.github.io/web/docs/how-tos/grant-capability) for Kehto’s policy APIs. Signing approval is separate from Kehto's runtime permission checks. Omitting `context.approve` allows signing under the existing adapter policy; provide it when the application needs confirmation.

Register a consent handler before mounting to answer runtime requests, including destructive signing, undeclared-service, and firewall-policy consent:

```ts
host.bridge.registerConsentHandler((request) => {
  request.resolve(window.confirm("Allow this napplet request?"));
});
```

Use your application's consent UI in place of `window.confirm`. Inspect `request.type` and the available request details when presenting a decision; `request.event` is optional for firewall-policy requests. This handler answers runtime consent requests; `context.approve` remains the application policy for adapter signing requests.

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

Delivery requires a live initialized instance and current recipient permissions. Intent delivery requires the granted `intent` domain and `intent:read` capability. It returns false for unavailable instances, denied recipients, and unsupported message types. A true result means the message was sent, not that the napplet completed the action. Intent selection and sender identity remain application policy.

### Lower-level integration

If your application already manages a Kehto shell, use the [service registry and shell adapter](./services.md). The browser host has a separate entry point so services-only imports do not load the browser shell or artifact resolver.

The host registers its message listener automatically; do not also register `host.bridge.handleMessage`. Keep initial service configuration fixed while instances are running, because Kehto freezes each document's capability environment at initialization.

## Best Practices

- Create one host for related napplet windows and reuse the application's store and pool
- Render resolution and initialization errors in the surrounding host UI
- Call `instance.destroy()` before removing its iframe
- Call `host.destroy()` when its owner ends; repeated destruction is harmless
- Let Kehto own attached service lifecycle callbacks; clean up separately owned resources yourself
- Keep using the pool, store, signer, and cache after host destruction if other features need them

The [Napplet Loader example](https://applesauce.build/examples/#/example/napplet/loader) demonstrates prompts, theme changes, notifications, intent routing, persistent caches, and concurrent panes.
