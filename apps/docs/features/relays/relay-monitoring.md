---
description: Discover relays and their health from relay monitor reports
---

# Relay Monitoring

Relay monitors are services that check relays and publish what they find (NIP-66). A monitor announces itself with a kind 10166 event, then publishes an addressable kind 30166 discovery event per relay, keyed by the relay URL, with its latency, supported NIPs, and requirements.

## Finding monitors

Cast monitor announcements with `RelayMonitor` to read how often a monitor publishes and what it checks.

```ts
const monitors = use$(
  () => store.timeline({ kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND] }).pipe(castTimelineStream(RelayMonitor, store)),
  [],
);

monitor.frequency; // seconds between reports
monitor.checks; // ["open", "read", "write", ...]
monitor.timeouts; // [{ test?: "open", timeout: 5000 }]
monitor.geohash;
```

## Checking a relay

`monitor.relayStatus(url)` returns an observable of the monitor's report for one relay, requested from the monitor's outboxes. The URL must match the report's `d` tag exactly, so normalize it with `normalizeURL()` first.

```ts
const status = use$(() => monitor.relayStatus(normalizeURL(url)), [monitor, url]);
```

## Reading a report

The `RelayDiscovery` cast reads a kind 30166 report. Load every report from a monitor with a `{ kinds: [RELAY_DISCOVERY_KIND], authors: [pubkey] }` filter.

```ts
report.url; // the relay from the "d" tag
report.rttOpen; // ms to connect; also rttRead and rttWrite
report.networkType; // "clearnet", "tor", "i2p", or "loki"
report.supportedNIPs; // ["1", "11", "42"]
report.requirements; // ["auth", "!payment"]
report.acceptedKinds; // ["1", "!4"]
```

`types`, `attributes`, `topics`, `geohash`, and `geohashes` read the remaining tags. Values prefixed with `!` mean the opposite, such as no payment required.

## Helpers

- `isValidRelayMonitorAnnouncement(event)` and `isValidRelayDiscovery(event)` validate the two kinds; a report needs a `d` tag
- `getMonitorFrequency`, `getMonitorTimeouts`, `getMonitorChecks`, and `getMonitorGeohash` read announcements
- `getRelayDiscoveryRTT(event, "open" | "read" | "write")` and the other `getRelayDiscovery*` helpers read reports
- `RELAY_MONITOR_ANNOUNCEMENT_KIND` and `RELAY_DISCOVERY_KIND` are the kind numbers

**Examples:** [Monitor feed](https://applesauce.build/examples/#/example/relay-discovery/monitor-feed) · [Relay directory](https://applesauce.build/examples/#/example/relay-discovery/relay-directory)

## Best Practices

- Filter reports with `since` a few multiples of `monitor.frequency` to skip relays the monitor stopped checking
- Combine reports from several monitors before ranking relays, since each sees the network from one place
- Request reports from the monitor's outboxes, as `relayStatus()` does
