---
description: Pre-built methods for subscribing to computed state from the EventStore with automatic caching and reactive updates
---

# Models

Models are pre-built methods for subscribing to computed state from the `EventStore`.

:::info
Models do not fetch any events from relays, they only subscribe to the events that are already in the event store.
:::

## Using models

The [`eventStore.model`](https://applesauce.hzrd149.com/typedoc/classes/applesauce-core.EventStore.html#model) method can be used to create a model and returns a rxjs observable that can be subscribed to.

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

There are some common prebuilt models that come with `applesauce-core`

- [`ProfileModel`](https://applesauce.hzrd149.com/typedoc/classes/applesauce-core.Models.ProfileModel.html) subscribes to a single pubkey's profile (kind 0)
- [`TimelineModel`](https://applesauce.hzrd149.com/typedoc/classes/applesauce-core.Models.TimelineModel.html) subscribes to a sorted array of events that match filters
- [`RepliesQuery`](https://applesauce.hzrd149.com/typedoc/classes/applesauce-core.Models.RepliesModel.html) subscribes to all NIP-10 and NIP-22 replies to an event

And there are a lot more in [the docs](https://applesauce.hzrd149.com/typedoc/modules/applesauce-core.Models.html)

## Custom Models

A custom model is simply a function that returns a [`Model`](https://applesauce.hzrd149.com/typedoc/types/applesauce-core.Model.html) function.

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
