---
description: Use typed factory classes from applesauce-common to create and modify common Nostr event types
---

# Common Factories

`applesauce-common/factories` is the high-level layer on top of `EventFactory`.

Each class targets a specific event type and exposes methods that match that event's shape. Instead of starting with a generic builder and composing everything yourself, you start with `NoteFactory`, `CommentFactory`, `ContactsFactory`, `LegacyMessageFactory`, or another typed class.

## What It Is

Most common factories follow the same pattern:

- `create(...)` starts a new event
- `reply(...)` exists when the event type has reply semantics
- `modify(event)` starts from an existing event
- instance methods apply event-specific operations

```ts
import { NoteFactory } from "applesauce-common/factories";

const note = await NoteFactory.create("Hello #nostr").subject("Intro").addHashtag("applesauce").sign(signer);
```

## How To Use It

### Create new events

```ts
import { CommentFactory } from "applesauce-common/factories";

const comment = await CommentFactory.create(parent, "Great post", {
  alt: "Comment on a note",
}).sign(signer);
```

### Modify existing events

```ts
import { ProfileFactory } from "applesauce-core/factories";

const updated = await ProfileFactory.modify(profileEvent).displayName("Alice").about("Building on Nostr").sign(signer);
```

### Work with replaceable and list events

```ts
import { ContactsFactory } from "applesauce-common/factories";

const contacts = await ContactsFactory.create().addContact(friend).addContact(otherFriend, "teammate").sign(signer);
```

### Publish nsite manifests

`NsiteFactory` creates NIP-5A root sites, named sites, and manifest snapshots. File edits refresh the aggregate hash; descriptions use a tag.

```ts
import { NsiteFactory } from "applesauce-common/factories";

const files = [{ path: "/index.html", sha256: indexHash }];
const site = await NsiteFactory.create("blog", files).title("Blog").sign(signer);
const snapshot = await NsiteFactory.snapshot(site).sign(signer);
const copy = await NsiteFactory.copy(site, "mirror").sign(otherSigner);
```

Use `createRoot(files)` for a root site and `modify(site).file(path, hash)` to update a manifest. Named identifiers use 1–13 lowercase letters, digits, or hyphens and cannot end in a hyphen. Snapshots require the source site's aggregate hash and preserve it unchanged.

### Publish NIP-89 app handlers

`AppHandlerFactory` creates kind 31990 handler information, and `AppRecommendationFactory` creates kind 31989 recommendations for an event kind.

```ts
import { AppHandlerFactory, AppRecommendationFactory } from "applesauce-common/factories";

const handler = await AppHandlerFactory.create("my-app")
  .metadata({ name: "My App" })
  .kind(1)
  .link("web", "https://my.app/e/<bech32>", "nevent")
  .latest(siteAddress)
  .sign(signer);
const rec = await AppRecommendationFactory.create(1).handler(handlerAddress, "web").sign(signer);
```

`.latest()` and `.next()` only accept named nsite (kind 35128) addresses.

## Integration

Nsite manifests integrate with the EventStore through `RootNsiteModel`, `UserNsitesModel`, and `NsiteSnapshotsModel`. Importing `applesauce-common/casts` adds `nsite$`, `nsites$`, and `nsiteSnapshots$` to User casts; Profile casts expose their author's sites.

```ts
import { castEvent } from "applesauce-core/casts";
import { NamedNsite } from "applesauce-common/casts";

const manifest = castEvent(site, NamedNsite, store);
manifest.snapshots$.subscribe((versions) => renderVersions(versions));
const index = manifest.resolvePath("/");
```

`Nsite` casts expose `copies$`, `lineage$` (on root and named casts), `parent$`, and `root$`. NIP-5A `app` tags can reference any addressable app kind, so `appPointers` is left unresolved. `servers$` combines manifest hints with the author's Blossom server list.

The NIP-89 `AppHandler` cast links handlers back to their sites. `latest$` and `next$` resolve the named nsites from the handler's tags, and `nsites$` lists loaded manifests whose `app` tag references the handler. That lookup filters locally because NIP-01 only indexes single-letter tags. `AppRecommendation.handlers$` resolves recommended handlers in tag order.

```ts
const handler = castEvent(event, AppHandler, store);
handler.latest$.subscribe((site) => site && open(site.url("nsite.run")));
store.model(AppHandlersModel, 30023).subscribe(renderHandlers);
```

Typed factories are the main event creation API used by `applesauce-actions`.

```ts
import { CommentFactory } from "applesauce-common/factories";

const event = await CommentFactory.create(parent, content, options).sign(signer);
await publish(event, relays);
```

They also compose cleanly with low-level helpers from `applesauce-core`:

```ts
import { NoteFactory } from "applesauce-common/factories";

const draft = NoteFactory.create("Hello").alt("Short text note");
const signed = await draft.sign(signer);
```

## Best Practices

- Use typed factories when the package already exposes the event type you need
- Prefer `modify(event)` over rebuilding replaceable events from scratch
- Keep event-specific behavior in the factory and reusable transforms in operations
- Treat `GiftWrapFactory.create(...)` as a special case because it returns a signed event directly

For nsites, use `.file()` and `.removeFile()` to keep the aggregate hash current, keep at least one file in a published manifest, and use `verifyNsiteAggregateHash(event)` before trusting an advertised site version.

For NIP-89, query `AppRecommendationsModel(kind, follows)` before `AppHandlersModel(kind)`, since anyone can publish a handler for any kind.
