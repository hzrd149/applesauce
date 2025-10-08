# applesauce-factory

applesauce event factory is a package for easily creating or modifying nostr events

## Documentation

For detailed documentation and guides, visit:

- [Documentation](https://hzrd149.github.io/applesauce/overview/factory.html)
- [API Reference](https://hzrd149.github.io/applesauce/typedoc/)

## Creating a Factory

When creating a new event factory you can pass a [context](https://hzrd149.github.io/applesauce/typedoc/types/applesauce-factory.EventFactoryContext.html) object that is used by all blueprints:

```ts
const signer = new PrivateKeySigner();

const factory = new EventFactory({
  // optionally pass a signer in (required for encryption)
  signer: signer, // or pass NIP-07 window.nostr if it exists
  // optionally set a NIP-89 client
  client: {
    name: "My Awesome Client",
    address: {
      pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      identifier: "awesome-client",
    },
  },
});
```

## Creating a short text note

```js
import { EventFactory } from "applesauce-factory";
import { NoteBlueprint } from "applesauce-factory/blueprints";

const factory = new EventFactory({
  // config options,
  // see https://hzrd149.github.io/applesauce/typedoc/types/applesauce-factory.EventFactoryContext.html
});

const unsignedEvent = await factory.create(
  NoteBlueprint,
  "hello nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 #introductions",
);

console.log(unsignedEvent);
{
  kind: 1,
  content: "hello nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6 #introductions",
  created_at: 0,
  tags: [['p', '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'], ['t', 'introductions']]
}
```

## Relay Hints

Relay hints can be added to all event tags that support them by passing in `getEventRelayHint` and `getPubkeyRelayHint` methods into the context:

```ts
const factory = new EventFactory({
  getEventRelayHint: async (event) => {
    // an async process to find the best relay hint for this event
    try {
      return await calculateRelayHint(event)
    }
    catch(){
      return undefined
    }
  },
  getPubkeyRelayHint: async (pubkey) => {
    // an async process to find a relay hint for this pubkey
    return loadPubkeyMailboxes(pubkey).then((mailboxes) => getOutboxes(mailboxes)[0]);
  },
});
```

## Modifying Events

The factory provides methods to modify existing events:

- `EventFactory.modify` - Takes a list of EventOperations to modify common properties
- `EventFactory.modifyTags` - Takes a list of TagOperations to modify the tags array

Example of modifying a list:

```js
const list = {
  kind: 30003,
  content: "",
  tags: [
    ["title", "read later"],
    ["description", "notes ill read later"],
  ],
};

const modified = await factory.modify(
  list,
  setListTitle("read never"),
  setListDescription("I will never get around to reading these notes"),
);
```

## Prebuilt Blueprints

The `applesauce-factory` package comes with common event blueprints for social clients. you can find them in the [typescript docs](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-factory.Blueprints.html)
