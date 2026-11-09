---
description: Optional modules for messaging, search, web of trust, relay health, spam filtering, and napplets
---

# applesauce-extra

`applesauce-extra` collects modules that build on the core packages but don't belong in any of them: messaging clients, clients for third-party search and ranking services, monitor-backed relay health, an on-device spam classifier, and napplet hosting.

```sh
npm install applesauce-extra
```

## Entry points

Each module has its own entry point, so importing one doesn't load the others or their optional peer dependencies.

| Import                                           | Exports                                         | Docs                                                               |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------ |
| `applesauce-extra/messages`                      | `LegacyMessagesClient`, `WrappedMessagesClient` | [Messaging Clients](./messages.md)                                 |
| `applesauce-extra/gift-wrap`                     | `GiftWrapReceiver`                              | [Gift-wrap Receiver](./gift-wrap.md)                               |
| `applesauce-extra/messages/ndr`                  | `NdrMessagesClient`, `createNdrTransport`       | [Double-ratchet Messaging](./ndr.md)                               |
| `applesauce-extra/primal`                        | `PrimalCache`                                   | [Primal Cache](./primal.md)                                        |
| `applesauce-extra/vertex`                        | `Vertex` (deprecated)                           | [Vertex](./vertex.md)                                              |
| `applesauce-extra/open-ranking`                  | `OpenRanking`                                   | [Open Ranking](./open-ranking.md)                                  |
| `applesauce-extra/remote-monitor-relay-liveness` | `RemoteMonitorRelayLiveness`                    | [Remote Monitor Liveness](/loading/relays/remote-monitor-liveness) |
| `applesauce-extra/nspam`                         | `NspamClassifier`, `filterSpam`                 | [Spam Filtering](/features/moderation/spam-filtering)              |
| `applesauce-extra/kehto`, `.../kehto/host`       | `createKehtoHost`, Kehto service adapters       | [Napplets](/napplets/)                                             |

The root `applesauce-extra` import re-exports Primal, Vertex, Open Ranking, remote monitor liveness, and nspam. Prefer the subpath imports in browser apps so bundlers only include what you use.

## Optional peer dependencies

Only some modules need extra packages. Install them when you import that module:

- `nostr-double-ratchet` for `applesauce-extra/messages/ndr` and `applesauce-extra/kehto/services/dm/ndr`
- `@kehto/nip`, `@kehto/runtime`, `@kehto/services`, and `@kehto/shell` for `applesauce-extra/kehto`
- `@contextvm/sdk` and `@contextvm/mcp-sdk` for `applesauce-extra/kehto/services/dm/cordn`

## Integration

The modules plug into the objects your app already has instead of creating their own:

```ts
const health = new RemoteMonitorRelayLiveness(eventStore, { monitors });
const pool = new RelayPool({ liveness: health });

const messages = new LegacyMessagesClient({ pubkey, signer, eventStore, pool });
```

The service clients (`PrimalCache`, `Vertex`, `OpenRanking`) return events or profile pointers. Add returned events to your `EventStore` and load pointers through your [event loaders](/loading/loaders/event-loader) so the rest of the app sees them.
