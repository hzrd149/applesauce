# applesauce-extra

A collection of optional modules that build on applesauce but don't belong in any of the core packages: messaging clients, third-party service integrations, spam filtering, and napplet hosting.

## Installation

```bash
npm install applesauce-extra
```

Each module has its own entry point, so importing one doesn't load the others or their optional dependencies.

## Modules

| Entry point                                             | Description                                                                                 | Docs                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `applesauce-extra/gift-wrap`                            | `GiftWrapReceiver` loads, decrypts, and stores NIP-59 gift-wrapped rumors for an account    | [Gift-wrap Receiver](https://applesauce.build/extra/gift-wrap)                             |
| `applesauce-extra/messages`                             | `LegacyMessagesClient` (NIP-04) and `WrappedMessagesClient` (NIP-17) direct message clients | [Messaging Clients](https://applesauce.build/extra/messages)                               |
| `applesauce-extra/messages/ndr`                         | Forward-secret, multi-device messaging with nostr-double-ratchet                            | [Double-ratchet Messaging](https://applesauce.build/extra/ndr)                             |
| `applesauce-extra/primal`                               | Relay interface for Primal's caching server API                                             | [Primal Cache](https://applesauce.build/extra/primal)                                      |
| `applesauce-extra/vertex`                               | Relay interface for Vertex reputation and profile search                                    | [Vertex](https://applesauce.build/extra/vertex)                                            |
| `applesauce-extra/open-ranking`                         | Search and score pubkeys with any Open Ranking web-of-trust provider                        | [Open Ranking](https://applesauce.build/extra/open-ranking)                                |
| `applesauce-extra/remote-monitor-relay-liveness`        | `RemoteMonitorRelayLiveness` relay health from NIP-66 monitor reports                       | [Remote Monitor Liveness](https://applesauce.build/loading/relays/remote-monitor-liveness) |
| `applesauce-extra/nspam`                                | On-device [nspam](https://huggingface.co/barrydeen/nspam) reply-spam classifier             | [Spam Filtering](https://applesauce.build/features/moderation/spam-filtering)              |
| `applesauce-extra/kehto`, `applesauce-extra/kehto/host` | Host Kehto napplets on your app's EventStore, RelayPool, and accounts                       | [Napplets](https://applesauce.build/napplets/)                                             |

Some modules depend on optional peer dependencies (for example the `@kehto/*` packages for napplet hosting); install them only when you use that module.

## Documentation

- [applesauce-extra overview](https://applesauce.build/extra/)
- [API Reference](https://applesauce.build/typedoc/)
- [Examples](https://applesauce.build/examples/)
