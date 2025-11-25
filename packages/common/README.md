# applesauce-common

AppleSauce is a collection of utilities for building reactive nostr applications. The common package provides NIP-specific helpers and models for working with various Nostr Improvement Proposals (NIPs).

## Key Components

- **Helpers**: NIP-specific utility methods for parsing and extracting data from nostr events
- **Models**: Complex subscriptions for NIP-specific nostr data patterns

## Documentation

For detailed documentation and guides, visit:

- [Getting Started](https://hzrd149.github.io/applesauce/introduction/getting-started)
- [API Reference](https://hzrd149.github.io/applesauce/typedoc/)

## Example

```js
import { EventStore } from "applesauce-core";
import { ThreadModel } from "applesauce-common/models";
import { getNip10References } from "applesauce-common/helpers/threading";
import { Relay } from "nostr-tools/relay";

// Create a single EventStore instance for your app
const eventStore = new EventStore();

// Use any nostr library for relay connections (nostr-tools, ndk, nostrify, etc...)
const relay = await Relay.connect("wss://relay.example.com");

// Subscribe to events and add them to the store
const sub = relay.subscribe([{ ids: ["event-id"] }], {
  onevent(event) {
    eventStore.add(event);
  },
});

// Get NIP-10 thread references
const refs = getNip10References(event);

// Subscribe to a thread using ThreadModel
const thread = eventStore.model(ThreadModel, "event-id");

thread.subscribe((thread) => {
  console.log(thread);
});
```

## Supported NIPs

This package includes helpers and models for various NIPs including:
- NIP-10 (Threading)
- NIP-22 (Comments)
- NIP-53 (Streams)
- NIP-23 (Articles)
- NIP-52 (Calendar Events)
- NIP-88 (Polls)
- And many more...

