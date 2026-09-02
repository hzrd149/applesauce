---
description: Efficient event synchronization using the Negentropy protocol for set reconciliation
---

# Negentropy Sync

Negentropy compares local and relay event inventories using [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md). It identifies missing IDs without downloading the complete remote set.

## How to Use It

Use `negentropy()` when you need the raw reconciliation rounds. It returns an Observable of `NegentropyRound`; each round contains IDs the local side has and needs.

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

Raw negotiation discovers differences but does not transfer events. Use `sync()` for managed uploads and downloads.

```typescript
relay.sync(eventStore, filter).subscribe((message) => {
  if (message.type === "received") eventStore.add(message.event);
  if (message.type === "send-failed") console.error(message.error);
});
```

## Integration

`Relay.sync()` turns rounds into bounded SEND and RECEIVE work. `RelayGroup.sync()` and `RelayPool.sync()` add `relay-failed` results so one relay failure does not hide sibling progress.

For low-level work across several relays, create one raw stream per relay:

```typescript
const streams = urls.map((url) =>
  pool.relay(url).negentropy(eventStore, filter),
);

merge(...streams).subscribe(({ have, need }) => {
  console.log({ have, need });
});
```

## Lifetime and Cancellation

Negentropy has no built-in timeout policy. Cancel with an `AbortSignal` or compose an RxJS lifetime operator.

```typescript
const controller = new AbortController();

relay.negentropy(eventStore, filter, {
  signal: controller.signal,
}).subscribe(handleRound);

controller.abort();
```

```typescript
relay.negentropy(eventStore, filter)
  .pipe(takeUntil(timer(30_000)))
  .subscribe(handleRound);
```

## Best Practices

- Check NIP-77 support before starting synchronization.
- Use `since` and `until` to limit large inventories.
- Treat completion as a drained operation, not proof every upload succeeded.
- Inspect every `send-failed` and `relay-failed` result.
