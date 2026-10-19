---
description: Choose local or remote monitor evidence and apply relay liveness to subscriptions and outboxes
---

# Relay Liveness

Relay liveness keeps temporarily unreachable relays from consuming connection slots. Applesauce ships two optional sources; neither is required to use `RelayPool` or the loaders.

| Source | Package | Evidence | Guide |
| --- | --- | --- | --- |
| `RelayLiveness` | `applesauce-relay` | This client's connections and request outcomes | [Client-side tracking](./local-liveness) |
| `RemoteMonitorRelayLiveness` | `applesauce-extra` | Signed NIP-66 reports from trusted publishers | [Remote monitors](./remote-monitor-liveness) |

Choose local tracking for the client's own network perspective, or remote monitors to offload health checks. A monitor's reachability does not guarantee that a mobile client can reach the same relay. Both sources keep unknown relays eligible and expire exclusions rather than permanently blacklisting endpoints.

## How to use it

Create one source and attach it to a pool. Local tracking observes that pool's target connections:

```ts
import { RelayLiveness } from "applesauce-relay";

const liveness = new RelayLiveness();
liveness.connectToPool(pool);
```

Alternatively, use the app's existing `EventStore` and explicitly trusted monitor identities:

```ts
import { RemoteMonitorRelayLiveness } from "applesauce-extra";

const liveness = new RemoteMonitorRelayLiveness(eventStore, {
  monitors: [{ pubkey: monitorPubkey, relays: monitorRelays }],
});
liveness.connectToPool(pool);
```

Remote attachment reads monitor events from the configured source relays; it does not probe target relays or record their local failures. Standard NIP-66 reports confirm positive reachability. Offline exclusions require a provider-specific explicit-failure decoder; missing reports alone never exclude a relay. See [monitor observation policy](./remote-monitor-liveness).

## Integration

Both sources implement `RelayLivenessSource`, whose `unhealthy$` emits the current exclusions. The operators below work with either implementation. Creating a source alone does not change subscription routing.

### Subscribe to a relay list

```ts
import { ignoreUnhealthyRelays } from "applesauce-relay/operators";

const eligible$ = relayList$.pipe(ignoreUnhealthyRelays(liveness));
const subscription = pool.subscription(eligible$, { kinds: [1], limit: 20 })
  .subscribe((event) => eventStore.add(event));
```

`relayList$` emits candidate URL arrays. Filtering reacts to both candidate changes and liveness changes, so a fixed candidate set can use `of(relayUrls)`. Keep the original candidate list: an expired exclusion can then return a relay to the subscription. `liveness.filter(relayUrls)` provides a synchronous snapshot, without future updates.

### Outbox selection

Filter relay hints before selecting relays so excluded endpoints do not consume connection slots:

```ts
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";

const eligibleUsers$ = usersWithRelayHints$.pipe(
  ignoreUnhealthyRelaysOnPointers(liveness),
);
```

For the complete selection and subscription pipeline, see [Mailboxes & Outbox](/features/outbox#selecting-relays-for-many-users). `ignoreUnhealthyMailboxes(liveness)` filters the `inboxes` and `outboxes` of an individual mailbox object. These operators change relay hints without discarding the users or pointers that contain them.

### Lifecycle and UI

Use `unhealthy$` to display exclusions and `state(url)` to display source-specific evidence. Eligibility and proof of reachability are different: an unknown relay is eligible, and a local cooldown can expire before a new success is observed.

Unsubscribe application subscriptions when their owner ends, then call `liveness.destroy()` to release tracking resources. Destroying a source does not close unrelated pool connections. Monitor sources also leave the shared `EventStore` intact.

Try the [local liveness example](https://applesauce.build/examples/#/example/relay/local-liveness) to watch cooldowns and recovery, or the [remote monitor example](https://applesauce.build/examples/#/example/relay/remote-monitor-liveness) to use NIP-66 monitor reports instead.

## Best Practices

- Keep unknown relays eligible; absence of evidence is not evidence of failure.
- Filter candidates before relay selection and preserve the unfiltered input for recovery.
- Keep authentication, content retention, and event yield separate from reachability.
- Use one source consistently for routing and its UI state.
- Handle request errors and reconnection even when using remote monitor health.
