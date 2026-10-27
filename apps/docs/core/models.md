---
description: Pre-built methods for subscribing to computed state from the EventStore with automatic caching and reactive updates
---

# Models

Models are pre-built methods for subscribing to computed state from the `EventStore`.

:::info
Models do not fetch any events from relays, they only subscribe to the events that are already in the event store.
:::

## Using models

The [`eventStore.model`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html#model) method can be used to create a model and returns a rxjs observable that can be subscribed to.

```ts
import { TimelineModel } from "applesauce-core/models";

// The first argument is the model constructor and the remaining are passed to the model
const observable = eventStore.model(TimelineModel, { kinds: [1] });

// start the query by subscribing to it
observable.subscribe((events) => {
  console.log(events);
});

// adding events to the event store will update the timeline query
eventStore.add({kind: 1, content: 'new note', ...})
```

## Performance

Models with similar arguments are cached in the event store and reused for performance reasons. This can help with multiple UI components subscribing to the same model.

```ts
import { ProfileModel } from "applesauce-core/models";

// Create the first model
const first = eventStore.model(ProfileModel, { pubkey: "pubkey" });

// Create the second model
const second = eventStore.model(ProfileModel, { pubkey: "pubkey" });

// Both will be the same observable
console.log(first === second); // true
```

## Prebuilt Models

`applesauce-core` includes a few common models:

- [`TimelineModel`](https://applesauce.build/typedoc/functions/applesauce-core.Models.TimelineModel.html) subscribes to a sorted array of matching events with batched live updates
- [`ProfileModel`](https://applesauce.build/typedoc/functions/applesauce-core.Models.ProfileModel.html) subscribes to a user's profile, see [Profiles](/features/profiles)
- [`ContactsModel`](https://applesauce.build/typedoc/functions/applesauce-core.Models.ContactsModel.html) subscribes to a user's contact list, see [Follows](/features/follows)
- [`MailboxesModel`](https://applesauce.build/typedoc/functions/applesauce-core.Models.MailboxesModel.html) subscribes to a user's inbox and outbox relays, see [Mailboxes & Outbox](/features/outbox)

`applesauce-common/models` adds models for specific features, for example:

- [`RepliesModel`](https://applesauce.build/typedoc/functions/applesauce-common.Models.RepliesModel.html) subscribes to direct replies and comments on an event, see [Notes & Threads](/features/notes-and-threads)
- [`ReactionsModel`](https://applesauce.build/typedoc/functions/applesauce-common.Models.ReactionsModel.html) subscribes to reactions for an event, see [Reactions & Reposts](/features/reactions-and-reposts)
- Git repository, thread, and patch models, see [Git](/features/git)

See the full list in [the API docs](https://applesauce.build/typedoc/modules/applesauce-core.Models.html) and [applesauce-common models](https://applesauce.build/typedoc/modules/applesauce-common.Models.html).

## Timeline snapshots

`TimelineModel` and `eventStore.timeline()` emit an initial snapshot immediately when the store query resolves, then coalesce live changes into fixed **16 ms windows** by default. Every insertion and removal updates indexed membership and claims immediately; only snapshot construction and notification are delayed.

At flush time, the model sorts pending additions and merges them with the previous sorted snapshot, excluding removed or replaced events. Sparse single-event additions use a binary insertion into a copied array, and removing nearly the entire timeline can rebuild only the small remainder. It does not re-sort the whole timeline for each ordinary batch.

```ts
const timeline$ = eventStore.timeline({ kinds: [1] });
const immediate$ = eventStore.timeline({ kinds: [1] }, { batchWindow: false });
const history$ = eventStore.timeline({ kinds: [0] }, { includeOldVersion: true });
```

- The initial snapshot emits immediately once the store query resolves, including when it is empty; previously emitted arrays are never mutated.
- `batchWindow` starts on the first change, not after a period of silence. Set it to `false` for synchronous live updates, or another non-negative number of milliseconds to tune the window. **`0` still schedules asynchronously**; it does not disable batching.
- Inserts and removals are all applied in arrival order. No input events are throttled or dropped.
- Events sort newest first; among equal timestamps, later inserts come first. Current-only replaceable timelines use the NIP-01 winner: newest timestamp, then lowest event id.
- Current-only timelines select one winning version per replaceable address, including in the initial snapshot. Set `includeOldVersion: true` to keep each stored version; the store must also retain those versions. The legacy boolean second argument is **deprecated** and will be removed in the next major release; it still controls version retention, not batching.
- Completion flushes pending changes. Unsubscribe, error, and store disposal cancel pending notifications and release owned claims. Previously emitted arrays are not mutated.

Replace `TimelineModel(filters, true)` with `TimelineModel(filters, { includeOldVersion: true })`, and `eventStore.timeline(filters, true)` with `eventStore.timeline(filters, { includeOldVersion: true })`. For the former `false` argument, omit it or use `{ includeOldVersion: false }`.

### Integration

Use the convenience method or `eventStore.model(TimelineModel, filters, options)` with either `EventStore` or `AsyncEventStore`; normal model caching, sharing, and keep-warm behavior apply. When an asynchronous initial query is pending, the model temporarily buffers and claims incoming inserts, then replays updates over the snapshot before its first emission. Canceling the subscription releases that buffer.

Membership changes release superseded and removed events without waiting for the next notification. A previously emitted snapshot can still reference an event until the next flush or until its consumer releases that array.

Wallet token models explicitly use immediate mode so spent-token exclusions and balance reads remain synchronous.

### Best Practices

- Use `{ batchWindow: false }` when consumers need every intermediate array or must read the updated timeline synchronously after `store.add()`. Cached batched models can replay the previous snapshot until their next flush.
- Choose a scheduling window that matches the view's latency needs. Immutable snapshots still require copying their entries; batching does not make an unbounded feed free. Downstream `throttleTime()` reduces notifications, not upstream snapshot construction.
- Keep sync filters narrow and reuse shared models instead of building overlapping global timelines.

## Custom Models

A custom model is simply a function that returns a [`Model`](https://applesauce.build/typedoc/types/applesauce-core.Model.html) function.

```ts
import { Model } from "applesauce-core";

function CustomModel(arg: string): Model<string> {
  return (eventStore) =>
    new Observable((observer) => {
      // observable code here
      observer.next("testing");
    });
}
```

As an example here is a custom model that will parse a [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) app event that contains JSON

```ts
import { map } from "rxjs/operators";
import { Model } from "applesauce-core";

/** A model that gets JSON from a app data event */
function AppSettingsModel<T>(pubkey: string): Model<T> {
  return (eventStore) =>
    eventStore.replaceable(30078, pubkey, "app-settings").pipe(
      map((event) => {
        if (!event) return undefined;
        return JSON.parse(event.content) as T;
      }),
    );
}

// Create the model and subscribe to it
const sub = eventStore
  .model(AppSettingsModel, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((json) => {
    // json will either be undefined or { theme: string }
    if (json) console.log("updated data", json);
  });

// Add an event to the event store to trigger the model
eventStore.add({
  kind: 30078,
  content: '{"theme": "dark"}',
  // rest of event
});
```
