---
description: Open content in other apps, recommend apps, and identify your client
---

# App Handlers

App handlers let your app send users to another app when it can't display something. Apps publish a **handler** that lists the event kinds they support and the URLs that open them. Users publish **recommendations** of handlers for a kind, and events can carry a **client tag** naming the app that published them.

## Finding apps for an event

`RecommendedAppHandlersModel` returns the handlers a set of authors recommend for a kind, ranked by how many recommend each. Pass the user's follows so suggestions come from people they trust.

```ts
const handlers = use$(
  () => store.model(RecommendedAppHandlersModel, kind, follows).pipe(castTimelineStream(AppHandler, store)),
  [kind, follows],
);
```

`AppHandlersModel(kind)` returns every handler that supports a kind, whoever published it.

## Opening content in another app

The `AppHandler` cast builds the URL for a pointer. `link()` picks the template for the pointer's type and falls back to a generic one, and to `web` on other platforms.

```ts
const url = handler.link(pointer, "ios");
const metadata = use$(handler.metadata$); // name, picture, about
```

`metadata$` falls back to the author's profile when the handler has no metadata of its own.

## Recommending apps

The `RecommendAppHandler` and `RemoveAppHandlerRecommendation` actions update the current user's recommendation for a kind and publish it to their outboxes. A platform limits the recommendation to `web`, `ios`, or `android`.

```ts
await actions.run(RecommendAppHandler, kind, handlerAddress, "web");
await actions.run(RemoveAppHandlerRecommendation, kind, handlerAddress);
```

Read a recommendation with the `AppRecommendation` cast, whose `handlers$` loads each recommended handler in order.

## Identifying your client

Call `.clientTag()` on any factory to record which app published an event. Private messages are never tagged.

```ts
const note = await NoteFactory.create("hi").clientTag("My App", handlerPointer).sign(signer);
```

`note.client` reads the tag, and `note.client$` loads the publishing app as an `AppHandler`.

## Publishing your app's handler

`AppHandlerFactory` builds the handler for your app. Link templates use `<bech32>` as the placeholder for the encoded event, profile, or address, and a template without a type covers every type.

```ts
const handler = await AppHandlerFactory.create("my-app")
  .metadata({ name: "My App", picture })
  .kind(kind)
  .link("web", "https://my.app/a/<bech32>", "naddr")
  .link("web", "https://my.app/<bech32>")
  .sign(signer);
```

Use `AppHandlerFactory.modify(event)` to edit an existing handler without losing tags you didn't change.

## Best Practices

- Prefer `RecommendedAppHandlersModel` with the user's follows over `AppHandlersModel`, since anyone can publish a handler for any kind
- Mark handlers that come only from `AppHandlersModel` as unverified
- Let users opt out of the client tag, since it reveals which app they use
- Render handler names and pictures from `metadata$` so handlers without their own metadata still display
