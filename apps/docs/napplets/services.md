---
description: Connect Kehto services and shell hooks to an existing Applesauce application
---

# Services and adapters

`applesauce-extra/kehto` connects Kehto's NAP services to your application's EventStore, relay pool, and signer. Use this layer when your app already manages a Kehto shell. For artifact resolution and iframe lifecycle together, start with [Hosting napplets](./hosting.md). Kehto documents the underlying [runtime](https://kehto.github.io/web/docs/packages/runtime), [shell](https://kehto.github.io/web/docs/packages/shell), and [service factories](https://kehto.github.io/web/docs/packages/services).

## Shared context

Pass the same context object to services and shell adapters. Configure its store's [event loader](../loading/loaders/unified-loader.md) before creating them.

```ts
import type { KehtoContext } from "applesauce-extra/kehto";

const context: KehtoContext = {
  eventStore,
  pool,
  signer: accounts.active$,
  fallbackRelays,
  fallbackBlossomServers,
  approve: ({ windowId, template }) => askToSign(windowId, template),
};
```

The store, pool, accounts, relay lists, and approval UI belong to your application. `signer` accepts a signer or an observable such as `AccountManager.active$`; the latter follows login, logout, and account switches. Omitting it leaves operations requiring signing or decryption unavailable. Omitting `approve` allows adapter signing under the existing policy.

## Service registry

`createKehtoServices(context, options)` returns a Kehto service registry. Supply it to your existing shell adapter:

```ts
import { createKehtoServices } from "applesauce-extra/kehto";
import { createShellBridge } from "@kehto/shell";

const services = createKehtoServices(context, { disable: ["upload"] });
const bridge = createShellBridge({ ...existingAdapter, services });
```

`existingAdapter` supplies your app's Kehto shell hooks. Creating a registry alone does not mount documents, register source windows, install a browser message listener, or deliver account changes.

| Default service | Connects to                                                        |
| --------------- | ------------------------------------------------------------------ |
| `identity`      | Active identity, profiles, contacts, mutes, and application blocks |
| `outbox`        | Event reads, subscriptions, and publishing                         |
| `count`         | Relay counts                                                       |
| `common`        | Social data and actions such as reactions and follows              |
| `lists`         | List reads and mutations                                           |
| `resource`      | Resource resolution and verified content retrieval                 |
| `upload`        | Blossom uploads                                                    |
| `dm`            | NIP-17 and legacy NIP-04 messaging                                 |

Availability of individual operations depends on the active signer and its encryption support. See [Messaging](./messaging.md) for protocol selection and routing.

### Customization

Pass additional or replacement Kehto services through `services`. A replacement prevents the corresponding default from being constructed. `disable` suppresses defaults but does not remove explicitly supplied services.

```ts
const services = createKehtoServices(context, {
  disable: ["upload"],
  identity: { getBlocked: (pubkey) => appBlocks.get(pubkey) ?? [] },
  resource: { maxBytes: 5 * 1024 * 1024 },
  services: { theme: theme.handler, intent: intentService },
});
```

Here `appBlocks`, `theme`, and `intentService` are application-owned implementations. Custom services still need Kehto's matching capability hooks and protocol bindings. For domains outside the built-in dispatcher, Kehto also requires exact `messageCapabilities` mappings and explicit domain admission; registry membership alone is insufficient. See [Register a Service](https://kehto.github.io/web/docs/how-tos/register-service). Keep the registry fixed while documents run; their capability environment is established at initialization.

### Application block lists

Identity blocks are application policy. Pass an `identity.getBlocked` provider through the service options; it receives the active account pubkey and original request and returns blocked pubkeys.

```ts
const services = createKehtoServices(context, {
  identity: { getBlocked: (pubkey) => appBlocks.get(pubkey) ?? [] },
});
```

Alternatively, set `identity: { useMutesForBlocks: true }` to return public NIP-51 muted pubkeys as blocks. This uses the same reader as `getMutes` and does not decrypt private entries. An explicit `getBlocked` provider takes precedence. Without either option, Kehto returns an empty block list; applications decide how blocks affect filtering or delivery.

## Integration

### Applesauce shell hooks

Use `createKehtoShellAdapter` when you also want Applesauce's relay and signer hooks. It creates the default services internally and accepts the same service options, plus partial `overrides` for shell hooks:

```ts
import { createKehtoShellAdapter } from "applesauce-extra/kehto";
import { createShellBridge } from "@kehto/shell";

const adapter = createKehtoShellAdapter(context, { disable: ["upload"] });
const bridge = createShellBridge(adapter);
window.addEventListener("message", bridge.handleMessage);

// When the shell owner ends:
window.removeEventListener("message", bridge.handleMessage);
bridge.destroy();
adapter.stop({ services: false });
```

This is an alternative to supplying an existing adapter. See [Runtime and Shell Boundaries](https://kehto.github.io/web/docs/concepts/runtime-shell-boundaries) for how transport, dispatch, and browser lifecycle fit together. Your shell still owns manifest verification, source registration, document preparation, consent UI, and identity/theme broadcasts. The [browser host](./hosting.md) handles document lifecycle and identity broadcasts for you.

Let `bridge.destroy()` unregister attached services, then use `adapter.stop({ services: false })` to release its remaining subscriptions without unregistering twice. A standalone adapter that was never attached to a bridge can use `adapter.stop()`.

### Individual adapters

For a smaller registry, compose Kehto services with the exported option helpers:

```ts
import { createIdentityService } from "@kehto/services";
import { createIdentityOptions, kehtoAccount$ } from "applesauce-extra/kehto";

const account$ = kehtoAccount$(context);
const identity = createIdentityService(createIdentityOptions({ ...context, account$ }));
```

Other helpers include `createCountOptions`, `createCommonOptions`, `createListsOptions`, `createResourceOptions`, `createUploadOptions`, `createDmOptions`, and `createOutboxRouter`. Their option types describe the dependencies each needs; they do not all accept the full context unchanged. `createKehtoSigner` and `createKehtoRelayPool` expose the signer and pool foundations for custom shell integration.

## Best Practices

- Reuse one context object so adapters share resolved account state
- Let the attached Kehto runtime own service registration and cleanup
- Keep signing approval separate from runtime permissions and consent
- Use the browser host unless your application already owns the shell lifecycle
