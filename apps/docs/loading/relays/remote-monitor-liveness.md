---
description: Use trusted NIP-66 monitor reports as expiring relay liveness evidence
---

# Remote Monitor Relay Liveness

`RemoteMonitorRelayLiveness` from `applesauce-extra` uses signed NIP-66 reports from explicitly trusted monitors. It implements the same filtering interface as [local liveness](./local-liveness), so an app can offload health checks without changing its relay selection code.

The source connects to relays carrying monitor reports. It never probes target relays or records local connection failures. Monitor observations describe reachability from the monitor's network; application subscriptions still need their usual error handling and reconnection.

See [Relay Liveness](./liveness) for choosing a source and shared filtering patterns, or try the [remote monitor example](https://applesauce.build/examples/#/example/relay/remote-monitor-liveness).

## Usage

Reuse the app's `EventStore` and `RelayPool`. Each monitor needs a trusted public key and at least one relay carrying its reports; `monitorA` and `monitorB` below are hex public keys or npubs.

```ts
import { RemoteMonitorRelayLiveness } from "applesauce-extra";

const health = new RemoteMonitorRelayLiveness(eventStore, {
  monitors: [
    { pubkey: monitorA, relays: monitorRelays },
    { pubkey: monitorB, relays: monitorRelays },
  ],
  capability: "read",
});
health.connectToPool(pool);
```

One monitor is supported. With two monitors, the default requires two distinct publishers to explicitly report a failure before exclusion. Repeating the same publisher through multiple source relays does not add votes, and duplicate configured identities are rejected.

The shared store validates signatures and manages report revisions. The source reads configured publishers' monitor announcements (kind `10166`) and discovery reports (kind `30166`), including reports already in the store. Connecting a pool is idempotent; incoming reports are added to the store automatically.

### States and eligibility

| State | Meaning | Eligible for requests |
| --- | --- | --- |
| `online` | At least one fresh positive observation | Yes |
| `offline` | Enough distinct trusted publishers explicitly report failure | No |
| `unknown` | No usable evidence or insufficient agreement | Yes |

The default decoder recognizes a finite, nonnegative `rtt-open`, `rtt-read`, or `rtt-write` value for the configured capability as positive evidence. Missing or malformed RTTs do not establish failure. Reports for another network, expired reports, and timestamps beyond the allowed clock skew cannot establish reachability.

Any fresh positive observation overrides conflicting negative observations. An exclusion ends when its evidence expires or no longer reaches quorum; no target connection is opened automatically.

### Explicit failure reports

Standard NIP-66 discovery data does **not** define a universal explicit-negative result. With the default decoder, this source can confirm positive observations but cannot exclude offline relays. Missing reports, missing RTTs, and old last-seen timestamps remain `unknown`.

To offload negative decisions, configure a monitor's `interpretReport(report, capability)` callback for a provider with documented failed-check semantics. It receives a `RelayDiscovery` cast and returns `"online"`, `"offline"`, or `"unknown"`. The callback replaces the default RTT decoder for that publisher; it must handle positive observations as well as explicit failures. Parsing exceptions become unknown.

Alternatively, enable `staleAsOffline` to treat a report that outlived its monitor's lifetime as that monitor's offline observation, while the monitor still publishes fresh reports for other relays. Monitors stop reporting relays they can no longer reach, so a quorum of stale reports marks a relay offline. The report window is removed, so raise `limit` to cover every relay a monitor has reported on.

The SDK still enforces publisher trust, timestamp freshness, network matching, positive overrides, and negative quorum around custom decoding. It assumes no provider-specific failure tags.

### Options

Options use the exported `Nip66LivenessOptions` type; monitor entries use `Nip66Monitor`. Durations are milliseconds.

| Option | Default | Purpose |
| --- | --- | --- |
| `monitors` | Required | Distinct trusted public keys, source relay URLs, and optional `interpretReport` callbacks |
| `capability` | `"read"` | Required `"open"`, `"read"`, or `"write"` evidence |
| `network` | `"clearnet"` | Observation network: `"clearnet"`, `"tor"`, `"i2p"`, or `"loki"` |
| `maxAge` | `3600000` | Maximum observation lifetime |
| `maxClockSkew` | `60000` | Accepted future timestamp tolerance |
| `offlineQuorum` | `Math.min(2, monitors.length)` | Distinct explicit-negative publishers required to exclude a relay |
| `limit` | `2000` | Maximum initial discovery reports requested per monitor |
| `staleAsOffline` | `false` | Count an active monitor's expired report as its offline observation |

A valid announced monitor `frequency` shortens observation lifetime to three reporting periods, capped by `maxAge`. Expiry runs even when no new reports arrive. Tor and I2P endpoints require matching network evidence; an observation from another transport does not prove availability on the client's transport.

### Observing state

```ts
const current = health.getState("wss://relay.example/");
const stateSub = health.state("wss://relay.example/").subscribe(renderState);
const errorsSub = health.errors$.subscribe(renderMonitorErrors);
```

`getState(url)` and `state(url)` expose a `Nip66RelayState`: the aggregate `state` and fresh `observations`. Each observation includes the monitor public key, result, event ID, `observedAt`, and `expiresAt`. Times use milliseconds. Unmonitored relays return unknown with no observations.

`online$` reports relays with positive evidence, while `unhealthy$` reports exclusions. `healthy$` includes known eligible relays, including unknown results; it is not proof that those relays are reachable. Matching synchronous getters are available. Use `filter(urls)` to evaluate an arbitrary relay list, including URLs not present in monitor data.

`errors$` is a record of source transport errors keyed by monitor public key. Source failures retry with delays from five seconds up to one minute. Negative observations from a publisher with a source error become unknown; its fresh positive observations remain usable. A source error never becomes evidence that a target relay is offline.

## Integration

### Relay subscriptions and outbox selection

Pass the source to the [shared filtering operators](./liveness#integration) before creating subscriptions or selecting outbox relays:

```ts
import { ignoreUnhealthyRelays } from "applesauce-relay/operators";

const available$ = relayList$.pipe(ignoreUnhealthyRelays(health));
const group = pool.group(available$);
```

`ignoreUnhealthyRelaysOnPointers` and `ignoreUnhealthyMailboxes` accept the same source. Unknown relays remain candidates. Keep target connection status separate from monitor health in the UI: a monitor's successful check does not guarantee that this client can connect.

For monitor-only operation, connect this source to the pool carrying monitor reports. No local `RelayLiveness` instance or target-relay health pings are required. Normal application traffic can still connect to selected target relays.

### Store and subscription lifecycle

Use the app's existing event cache to persist monitor events if needed; this source has no separate `load()` or `save()` API. Cached reports still have to satisfy freshness and trust checks.

```ts
stateSub.unsubscribe();
errorsSub.unsubscribe();
health.disconnectFromPool(pool);
health.destroy();
```

`disconnectFromPool(pool)` stops that pool's monitor subscriptions while retaining store observation and report expiry. `destroy()` also releases all store observers and timers. Neither method closes unrelated pool connections or disposes the shared `EventStore`. Create a new source to resume after destruction.

## Best Practices

- Choose monitor identities explicitly; source relay operators do not become trusted publishers.
- Prefer two independent monitors when relying on explicit failures for exclusion.
- Keep unknown relays eligible so missing monitor coverage does not become an outage.
- Match capability and network to the requests the app intends to make.
- Use `interpretReport` only when the provider documents an explicit failed check.
- Display monitor source errors separately from target relay failures.
- Destroy the source when its owning application scope ends.
