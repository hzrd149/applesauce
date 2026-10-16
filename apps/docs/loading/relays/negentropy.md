---
description: Efficient event synchronization using the Negentropy protocol for set reconciliation
---

# Negentropy Sync

Negentropy compares local and relay event inventories using [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md). It identifies missing IDs without downloading the complete remote set.

## Finding differences

Use `negentropy()` when you need the raw reconciliation rounds. It returns an Observable of `NegentropyRound`; each round contains IDs the local side has and needs. It does not transfer any events.

```typescript
import type { NegentropyRound } from "applesauce-relay";

relay.negentropy(eventStore, { kinds: [1] }).subscribe({
  next: ({ have, need }: NegentropyRound) => {
    console.log("Local-only IDs", have);
    console.log("Relay-only IDs", need);
  },
  error: (error) => console.error("Negotiation failed", error),
});
```

## Transferring events

`sync()` runs the negotiation and then downloads and uploads the missing events. It only downloads by default; pass a `SyncDirection` to choose `RECEIVE`, `SEND` or `BOTH`.

```typescript
import { SyncDirection } from "applesauce-relay";

relay.sync(eventStore, filter, SyncDirection.BOTH).subscribe({
  next: (message) => {
    if (message.type === "received") eventStore.add(message.event);
    if (message.type === "sent") uploaded += 1;
    if (message.type === "send-failed") failures.push(message);
  },
  complete: () => console.log("Transfers drained", { uploaded, failures }),
});
```

The fourth argument takes `concurrency` (default 4), `batchSize` (default 500), `reconnect`, `signal` and the [auth options](./authentication#handling-auth-required-responses).

## Syncing with several relays

`pool.sync()` and `RelayGroup.sync()` run `sync()` on every relay and add a `relay-failed` message so one relay's failure does not hide progress on the others.

```typescript
pool.sync(relays, eventStore, filter, SyncDirection.RECEIVE).subscribe((message) => {
  if (message.type === "received") eventStore.add(message.event);
  if (message.type === "relay-failed") console.warn(message.from, message.error);
});
```

There is no pool-level `negentropy()`. For raw rounds across several relays, create one stream per relay:

```typescript
const streams = urls.map((url) => pool.relay(url).negentropy(eventStore, filter));

merge(...streams).subscribe(({ have, need }) => console.log({ have, need }));
```

## Lifetime and cancellation

Negentropy and sync have no built-in timeout. Cancel with an `AbortSignal` or compose an RxJS lifetime operator.

```typescript
const controller = new AbortController();

relay.negentropy(eventStore, filter, { signal: controller.signal }).subscribe(handleRound);
controller.abort();

relay
  .sync(eventStore, filter)
  .pipe(takeUntil(timer(30_000)))
  .subscribe(handleMessage);
```

## Integration

Both methods check the relay's [information document](./relay-information) and fail early when it does not list NIP-77.

## Best Practices

- Use `since` and `until` to limit large inventories.
- Treat completion as a drained operation, not proof every upload succeeded.
- Inspect every `send-failed` and `relay-failed` message before reporting success.
