---
description: Fetch actual zaps events with batching and relay hints
---

# Zaps Loader

The Zaps Loader fetches zap receipt events for inspecting payments and senders. It wraps the [Tag Value Loader](./tag-value-loader.md) and returns finite, partial results rather than a live or complete total.

## How to use it

Create the loader once and subscribe with a target event:

```ts
import { createZapsLoader } from "applesauce-loaders/loaders";

const loader = createZapsLoader(pool, { eventStore });
const subscription = loader(target, ["wss://relay.example.com"]).subscribe((event) =>
  console.log(event.pubkey, event.content),
);

subscription.unsubscribe();
```

The loader queries kind 9735 using `e` for regular events and `a` for replaceable or addressable events. Relay hints include the target's seen relays by default; set `useSeenRelays: false` to use only explicit hints and configured extra relays.

It accepts the [Tag Value Loader options](./tag-value-loader.md#configuration-options) except `kinds`, which is fixed. Each wrapper has separate internal `e` and `a` loaders, so concurrency budgets apply independently to each. Pointer `force` is available through the generic tag value API, not this wrapper's call signature.

## Integration

Pass the application's EventStore to update its models and casts. An optional `cacheRequest` runs in parallel with relay requests and does not prevent network loading.

Use the [zap helpers](/features/zaps) to parse and validate receipts before displaying payment details. The loader requests kind 9735 events; it does not itself validate invoices or prove payment authenticity.

Use an abort signal to stop both internal loaders:

```ts
const controller = new AbortController();
const loader = createZapsLoader(pool, {
  eventStore,
  signal: controller.signal,
  onError: (error, source) => console.warn("Partial zaps load", source, error),
});

controller.abort();
```

The [count service](./count-service.md) handles supported shared feed metrics, but has no built-in zap count or amount total. Use this loader when receipt details are required, and treat aggregates over its results as partial.

## Best Practices

- Reuse one wrapper for related views to preserve batching and compatible request sharing.
- Display “No events loaded” rather than interpreting an empty result as proof of absence.
- Report partial source failures with `onError` while keeping received events visible.
- Use `signal` for deterministic teardown; the wrapper does not expose `stop()`.
- Keep the default deadlines or choose finite values appropriate to the view.
