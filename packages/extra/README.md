# Applesauce Extra

A collection of stuff that doesn't fit into any applesauce package.

Each module has its own entry point (`applesauce-extra/nspam`, `applesauce-extra/vertex`, `applesauce-extra/primal`, `applesauce-extra/open-ranking`, `applesauce-extra/remote-monitor-relay-liveness`, `applesauce-extra/kehto`), so importing one doesn't load the others or their optional dependencies.

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

## nspam Spam Filter

`NspamClassifier` runs the [nspam](https://huggingface.co/barrydeen/nspam) reply-spam model on-device and scores authors from their newest kind 1 replies. `filterSpam` removes spam replies from a timeline.

```ts
const nspam = await NspamClassifier.load();
const replies$ = eventStore.timeline({ kinds: [1], "#e": [root.id] }).pipe(filterSpam(nspam));
```

**Code:** [`src/nspam/`](src/nspam/)
**Upstream:** [barrydeen/nspam](https://huggingface.co/barrydeen/nspam)

## Kehto

Applesauce connects Kehto's sandboxed napplets to your app's existing EventStore, RelayPool, and active account. Import the browser host from `applesauce-extra/kehto/host`; import service adapters from `applesauce-extra/kehto` when you manage the shell yourself. Install the optional `@kehto/nip`, `@kehto/runtime`, `@kehto/services`, and `@kehto/shell` peers using versions compatible with this package's peer dependencies.

```ts
import { createKehtoHost } from "applesauce-extra/kehto/host";

const host = createKehtoHost({ eventStore, pool, signer: accounts.active$ });
const instance = await host.resolve(manifestEvent);
instance.mount(iframe);
await instance.whenReady();
```

Configure the store's event loader before creating the host. The application owns the iframe, permission UI, and signing approval policy. Call `instance.destroy()` before removing its iframe and `host.destroy()` when the host's owner ends.

The host includes identity, outbox, count, common, upload, lists, resource, and DM services. Messaging defaults to NIP-17 and legacy NIP-04; custom protocols and send routing are optional.

- [Napplets: manifests, discovery, and handlers](https://applesauce.build/napplets/)
- [Hosting: setup, permissions, services, and lifecycle](https://applesauce.build/napplets/hosting)
- [Messaging: protocols, routing, and recovery](https://applesauce.build/napplets/messaging)

**Code:** [`src/kehto/`](src/kehto/)
