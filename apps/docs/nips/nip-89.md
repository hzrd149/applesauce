---
description: Publish, discover, and open NIP-89 application handlers and recommendations
---

# NIP-89 App Handlers

[NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) lets clients find applications that can open event kinds they don't support. Apps publish kind 31990 handler information, users publish kind 31989 recommendations for a kind, and events can name the client that published them with a `client` tag.

`applesauce-common` ships helpers, operations, factories, casts, and models for all three, and `applesauce-actions` ships actions for managing recommendations.

## Handler information

`AppHandlerFactory` creates kind 31990 events. Link templates use `<bech32>` as the placeholder for the NIP-19 entity, and omitting the type registers a generic template.

```ts
import { AppHandlerFactory } from "applesauce-common/factories";

const handler = await AppHandlerFactory.create("my-app")
  .metadata({ name: "My App", picture })
  .kind(30023)
  .link("web", "https://my.app/a/<bech32>", "naddr")
  .link("web", "https://my.app/<bech32>")
  .sign(signer);
```

`.latest()` and `.next()` point the handler at the named nsite (kind 35128) it currently serves and the one it is rolling out, and only accept nsite addresses.

The `AppHandler` cast reads a handler and builds links for pointers. `link()` prefers the matching entity type, falls back to the generic template, and falls back to `web` on other platforms.

```ts
import { AppHandler } from "applesauce-common/casts";

const app = castEvent(event, AppHandler, store);
app.supportedKinds; // [30023]
app.link({ kind: 30023, pubkey, identifier }); // "https://my.app/a/naddr1..."
```

When a handler's content is empty, NIP-89 says to use the author's kind:0 profile. `metadata$` does this fallback, while `metadata`, `name`, and `picture` only read the handler itself.

```ts
const metadata = use$(app.metadata$);
```

## Recommendations

`AppRecommendationFactory` creates the kind 31989 event for one event kind. Each handler can carry an optional platform.

```ts
import { AppRecommendationFactory } from "applesauce-common/factories";

const rec = await AppRecommendationFactory.create(30023).handler(handlerAddress, "web").sign(signer);
```

The `AppRecommendation` cast exposes `handlers` and `handlers$`, which resolves each recommended handler in tag order.

## Client tag

Use `.clientTag()` on any factory, or the `setClient` operation, to name the publishing client. It skips private message kinds (4, 13, 14, and 1059) and writes the relay hint when the pointer has one.

```ts
const note = await NoteFactory.create("hi").clientTag("My App", { pubkey, identifier, relays }).sign(signer);
```

Read it back with `getClientTag(event)`, or with `note.client` and `note.client$` on the `Note` cast.

## Integration

Query handlers through the `EventStore` models after loading events from relays:

- `AppHandlersModel(kind)` returns every handler that advertises the kind
- `AppRecommendationsModel(kind, authors?)` returns recommendations for the kind
- `RecommendedAppHandlersModel(kind, authors?)` resolves the recommended handlers and ranks them by how many authors recommend each

```ts
store.model(RecommendedAppHandlersModel, 30023, follows).pipe(castTimelineStream(AppHandler, store));
```

The `RecommendAppHandler` and `RemoveAppHandlerRecommendation` actions read-modify-publish the current user's recommendation for a kind to their outboxes.

```ts
await actions.run(RecommendAppHandler, 30023, handlerAddress, "web");
```

## Best Practices

- Prefer `RecommendedAppHandlersModel` with the user's follows over `AppHandlersModel`, since anyone can publish a handler for any kind
- Only fall back to `AppHandlersModel` on trusted relays or with spam filtering
- Let users opt out of the `client` tag, since it reveals which app they use
- Render handler names and pictures from `metadata$` so handlers without their own metadata still display
