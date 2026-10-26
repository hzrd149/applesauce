---
description: Choose the right level of Applesauce support for discovering, hosting, and integrating napplets
---

# Napplets

A **napplet** is a sandboxed application published as a Nostr manifest and a single HTML artifact on Blossom (NIP-5D). It requests data and actions from its host through NAP services. Applesauce connects those requests to your app's existing event store, relay pool, and active account.

This section is for developers and agents adding napplet support to an Applesauce app. Guest napplets use `@napplet/core` and `window.napplet`; the APIs here belong to the host application.

Kehto is a host-side toolkit and protocol kernel. Applesauce supplies the integration with your app's data and signer; Paja is Kehto's separate reference developer runtime. NIP-5D and NAP contracts are still evolving, so use the compatible package versions listed in [Hosting](./hosting.md#install). See Kehto's [architecture](https://kehto.github.io/web/docs/concepts/architecture) and [protocol status](https://kehto.github.io/web/docs/alpha-status) for the wider ecosystem context.

## Choose an integration level

You can use manifest and handler support without running napplets. To embed them, start with the browser host; use services and adapters directly when your app already manages a Kehto shell.

| Your app needs to…                                       | Start with                              | Package entry point                                                          |
| -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| Browse, inspect, or publish manifests                    | [Manifests & Discovery](./manifests.md) | `applesauce-common`                                                          |
| Save preferred apps and route intents                    | [Handlers & Intents](./handlers.md)     | `applesauce-common` helpers, casts, and models; `applesauce-actions/actions` |
| Resolve and run sandboxed apps                           | [Hosting](./hosting.md)                 | `applesauce-extra/kehto/host`                                                |
| Connect an existing shell or replace individual services | [Services & Adapters](./services.md)    | `applesauce-extra/kehto`                                                     |
| Configure DM transports and send routing                 | [Messaging](./messaging.md)             | `applesauce-extra/kehto`                                                     |

## How the layers fit together

**Manifests describe the app.** Helpers validate metadata, casts expose it, models find manifests, and factories build updates and snapshots. A manifest points to the artifact and advertises supported conventions and required domains.

**Handlers describe the user's choices.** Preferences rank apps for an archetype or intent. Your app checks compatibility, chooses a handler, and delivers its payload. Recommendations can inform a picker.

**The browser host runs the app.** `createKehtoHost` resolves and verifies the artifact, mounts it in an application-owned iframe, and manages its Kehto session. It creates the service registry and shell adapter for you.

**Services connect the app to Applesauce.** Kehto handles the protocol and runtime permissions. Applesauce services answer requests using your store, pool, and signer. Lower-level option builders let you reuse individual adapters with Kehto's service factories.

**Your application owns product policy.** It provides the surrounding UI, handler selection, consent prompts, signing approval, and any extra services such as theme, notifications, or intent routing.

## Kehto library details

Use these references when you need the contracts beneath the Applesauce adapters:

| Library           | Responsibility                                                | Reference                                                              |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@kehto/runtime`  | Protocol dispatch, capability checks, and service lifecycle   | [Runtime package](https://kehto.github.io/web/docs/packages/runtime)   |
| `@kehto/shell`    | Browser message bridge, source sessions, and injected domains | [Shell package](https://kehto.github.io/web/docs/packages/shell)       |
| `@kehto/services` | Service factories and adapter contracts                       | [Services package](https://kehto.github.io/web/docs/packages/services) |
| `@kehto/nip`      | Manifest verification, artifact resolution, and caching       | [NIP utilities](https://kehto.github.io/web/docs/packages/nip)         |

Kehto's [API reference](https://kehto.github.io/web/docs/reference/api) describes its current library APIs; the Applesauce guides describe the integration supported by this release.

## Add support to an existing app

1. [Set up the browser host](./hosting.md#basic-usage) with your shared store, loader, pool, and reactive account.
2. Add permission and signing UI, then resolve, mount, and await a napplet instance.
3. [Discover manifests](./manifests.md) if users need a catalog, and [save handler preferences](./handlers.md) if they need app choices or intent routing.
4. [Customize services](./services.md) and [messaging](./messaging.md) as your application requires.

For a complete implementation, see the [Napplet Loader example](https://applesauce.build/examples/#/example/napplet/loader). The [Browser](https://applesauce.build/examples/#/example/napplet/browser) and [Handler Preferences](https://applesauce.build/examples/#/example/napplet/handlers) examples cover discovery and selection separately.
