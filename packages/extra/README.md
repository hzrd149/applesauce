# Applesauce Extra

A collection of stuff that doesn't fit into any applesauce package.

## PrimalCache

Extended relay interface for Primal's caching server. Provides access to Primal's enhanced API endpoints for content discovery, user recommendations, trending hashtags, notifications, and more. Includes methods for:

- Content exploration and scoring
- User search and recommendations
- Trending hashtags and images
- Notification management
- Advanced search and feeds
- Media metadata retrieval

**Code:** [`src/primal.ts`](src/primal.ts)
**Upstream:** [PrimalHQ/primal-server](https://github.com/PrimalHQ/primal-server)

## Vertex

Extended relay interface for the Vertex relay (relay.vertexlab.io). Provides reputation-based user discovery and verification services. Includes methods for:

- Profile lookup with reputation scoring
- Reputation verification
- Credit balance checking
- Automatic authentication handling

**Code:** [`src/vertex.ts`](src/vertex.ts)
**Upstream:** [vertexlab.io](https://vertexlab.io/docs/services/)

## NIP-66 Relay Liveness

`RemoteMonitorRelayLiveness` supplies monitor-backed health through the same relay filtering interface as local `RelayLiveness`, without probing target relays.

```ts
const health = new RemoteMonitorRelayLiveness(eventStore, {
  monitors: [{ pubkey: monitor, relays: monitorRelays }],
});
const pool = new RelayPool({ liveness: health });
```

### Integration

Pass `health` to `RelayPool` to skip its unhealthy relays in every request, or to `ignoreUnhealthyRelays`, `ignoreUnhealthyRelaysOnPointers`, or `ignoreUnhealthyMailboxes` to filter specific relay lists. The shared EventStore validates and caches monitor events; the source manages publisher trust, report expiry, and negative consensus. See [Relay Liveness](https://applesauce.build/loading/relays/liveness) for configuration and lifecycle management.

### Best Practices

- Configure trusted publishers explicitly and prefer two independent monitors.
- Preserve unknown relays when reports are missing.
- Supply `interpretReport` only for a provider with documented explicit-negative semantics, or enable `staleAsOffline` to treat reports that active monitors stopped refreshing as offline.
- Match the requested capability and transport to the application.
