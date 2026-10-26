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

Construct only the services your app supports and supply the complete registry to your existing shell adapter:

```ts
import { createKehtoIdentityService, createKehtoOutboxService } from "applesauce-extra/kehto";
import { createShellBridge } from "@kehto/shell";

const services = {
  identity: createKehtoIdentityService(context),
  outbox: createKehtoOutboxService(context),
};
const bridge = createShellBridge({ ...existingAdapter, services });
```

`existingAdapter` supplies your app's Kehto shell hooks. Creating a registry alone does not mount documents, register source windows, install a browser message listener, or deliver account changes.

| Constructor                  | Service    | Connects to                                                        |
| ---------------------------- | ---------- | ------------------------------------------------------------------ |
| `createKehtoIdentityService` | `identity` | Active identity, profiles, contacts, mutes, and application blocks |
| `createKehtoOutboxService`   | `outbox`   | Event reads, subscriptions, and publishing                         |
| `createKehtoCountService`    | `count`    | Relay counts                                                       |
| `createKehtoCommonService`   | `common`   | Social data and actions such as reactions and follows              |
| `createKehtoListsService`    | `lists`    | List reads and mutations                                           |
| `createKehtoResourceService` | `resource` | Resource resolution and verified content retrieval                 |
| `createKehtoUploadService`   | `upload`   | Blossom uploads                                                    |
| `createKehtoDmService`       | `dm`       | NIP-17 and legacy NIP-04 messaging                                 |

Availability of individual operations depends on the active signer and its encryption support. See [Messaging](./messaging.md) for protocol selection and routing.

### Customization

The registry is the complete set of services. Omit an entry to leave that service unavailable; the host and shell adapter construct no services automatically. Use ordinary object composition to add or replace entries:

```ts
const services = {
  ...appServices,
  identity: createKehtoIdentityService(context, {
    getBlocked: (pubkey) => appBlocks.get(pubkey) ?? [],
  }),
  resource: createKehtoResourceService(context, { maxBytes: 5 * 1024 * 1024 }),
  theme: theme.handler,
  intent: intentService,
};
```

Here `appBlocks`, `theme`, and `intentService` are application-owned implementations. Custom services still need Kehto's matching capability hooks and protocol bindings. For domains outside the built-in dispatcher, Kehto also requires exact `messageCapabilities` mappings and explicit domain admission; registry membership alone is insufficient. See [Register a Service](https://kehto.github.io/web/docs/how-tos/register-service). Keep the registry fixed while documents run; their capability environment is established at initialization.

### Application block lists

Identity blocks are application policy. Pass a `getBlocked` provider to `createKehtoIdentityService`; it receives the active account pubkey and original request and returns blocked pubkeys.

```ts
const identity = createKehtoIdentityService(context, {
  getBlocked: (pubkey) => appBlocks.get(pubkey) ?? [],
});
```

Alternatively, pass `{ useMutesForBlocks: true }` to the identity constructor to return public NIP-51 muted pubkeys as blocks. This uses the same reader as `getMutes` and does not decrypt private entries. An explicit `getBlocked` provider takes precedence. Without either option, Kehto returns an empty block list; applications decide how blocks affect filtering or delivery.

## Integration

### Applesauce shell hooks

Use `createKehtoShellAdapter` when you also want Applesauce's relay and signer hooks. Pass the complete `services` registry and optional partial `overrides` for shell hooks:

```ts
import { createKehtoShellAdapter } from "applesauce-extra/kehto";
import { createShellBridge } from "@kehto/shell";

const adapter = createKehtoShellAdapter(context, { services });
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

Each constructor in the table above is exported from `applesauce-extra/kehto` and accepts the shared context. Identity, common, resource, and DM also accept service-specific options.

For custom wiring, compose the exported option helpers with Kehto's own factories:

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
