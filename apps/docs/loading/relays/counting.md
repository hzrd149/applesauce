---
description: Count matching events on relays with COUNT requests and merge HyperLogLog sketches across relays
---

# Counting

Relays that support [NIP-45](https://github.com/nostr-protocol/nips/blob/master/45.md) can count events matching a filter without sending them. `Relay.count()` sends a single `COUNT` request, and `RelayPool.count()` sends it to several relays and reports each relay's result separately.

## Counting on one relay

`count()` returns an Observable that emits one validated response and completes. Refusals, malformed responses and timeouts arrive on the error channel.

```typescript
import { lastValueFrom } from "rxjs";

const { count, approximate } = await lastValueFrom(relay.count({ kinds: [1], authors: [pubkey] }));
console.log(`Found ${count} events`, approximate ? "(approximate)" : "");
```

The second argument is an optional request ID and the third takes options:

```typescript
relay
  .count({ kinds: [7], "#e": [id] }, "reactions", { retries: 2, timeout: 5_000, onAuthRequired })
  .subscribe({ next: (res) => console.log(res.count), error: console.error });
```

- `onSent` runs immediately before each COUNT frame is written, including authentication resends; use it to distinguish wire response latency from readiness and authentication waiting.
- `timeout` is one deadline for the whole request, including retries (default 10s, or the relay's `countTimeout`). It pauses while authenticating. Pass `false` to disable it.
- `retries` retries connection failures and takes precedence over its `reconnect` alias.
- `onAuthRequired`, `waitForAuth` and `authTimeout` work like other requests. See [Authentication](./authentication).

## Validated responses

Every response has a non-negative integer `count`. The optional `approximate` flag is a boolean and the optional `hll` is a 512-character hex sketch, normalized to lowercase. Unknown fields are kept.

An invalid reply errors with `RelayCountResponseError`, and an expired deadline errors with `RelayCountTimeoutError`.

## Counting across relays

`pool.count()` emits a cumulative record of `RelayOutcome` values keyed by normalized relay URL each time a relay settles. Relays missing from a snapshot are still pending, and one relay's failure never affects the others.

```typescript
pool.count(relays, { kinds: [1], authors: [pubkey] }).subscribe((outcomes) => {
  for (const [url, outcome] of Object.entries(outcomes))
    console.log(url, outcome.ok ? outcome.value.count : outcome.error);
});
```

`RelayGroup.count()` behaves the same, and both accept the same ID and options as `Relay.count()`.

## Merging counts with HyperLogLog

Relays overlap, so summing their counts double-counts events. When relays return `hll` sketches, merge them with `mergeHllRegisters()` and estimate the size of the union with `estimateHllCardinality()`.

```typescript
import { estimateHllCardinality, mergeHllRegisters } from "applesauce-relay";

pool.count(relays, filter).subscribe((outcomes) => {
  const sketches = Object.values(outcomes).flatMap((o) => (o.ok && o.value.hll ? [o.value.hll] : []));
  if (sketches.length) console.log("Estimated total:", estimateHllCardinality(mergeHllRegisters(sketches)));
});
```

Failed relays and responses without a sketch can't contribute, so the estimate only covers the relays that returned one.

## Integration

To load per-event metrics that components share, cache and refresh, use the [count service](/loading/loaders/count-service). It runs NIP-45 COUNT requests through a pool and can balance requests across trusted relays.

## Best Practices

- Never sum counts from overlapping relays. Merge HLL sketches instead, and don't treat a missing sketch as zero.
- Treat pool snapshots as provisional until the Observable completes.
- Always handle the error channel; relays without NIP-45 support refuse or ignore `COUNT`.
- Pass a stable request ID when you need to correlate logs.
