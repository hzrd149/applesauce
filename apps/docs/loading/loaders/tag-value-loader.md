---
description: Batch, cache, and deduplicate requests for events that reference a tag value
---

# Tag Value Loader

The Tag Value Loader fetches actual events containing a requested tag value, such as reactions, zap receipts, and thread references. It batches nearby requests and returns finite, partial results suitable for detail views.

Completion means the sources settled, not that every related event was found. Relay result limits and deadlines can leave targets with few or no results, and the loader does not paginate or retry for completeness. For shared feed metrics without downloading related events, use the [count service](./count-service.md).

## How to use it

Create the loader once and subscribe when events are needed:

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();
const references = createTagValueLoader(pool, "e", { kinds: [1] });
const subscription = references({
  value: "a".repeat(64),
  relays: ["wss://relay.example.com"],
}).subscribe((event) => console.log(event));

subscription.unsubscribe();
references.stop();
```

A tag match establishes a reference; use relationship-specific helpers to distinguish direct replies, reaction targets, and other relationship semantics.

## Configuration Options

The `createTagValueLoader` function accepts these options:

- `bufferTime`: Time interval to buffer requests in ms (default 1000)
- `bufferSize`: Max buffer size (default 200)
- `shareInflight`: Shares compatible queued or running requests (default true, disabled automatically for observable `extraRelays`)
- `maxConcurrentBatches`: Maximum running batches (default 4, `Infinity` disables the limit)
- `relayConcurrency`: Maximum running relay requests per batch (default 8, `Infinity` disables the limit)
- `requestTimeout`: Total lifetime of each cache request, relay request, or extra relay discovery in ms (default 10000, `Infinity` disables the deadline)
- `kinds`: Restrict queries to specific kinds
- `authors`: Restrict queries to specific authors
- `since`: Restrict queries since timestamp
- `cacheRequest`: A method used to load events from a local cache
- `onError`: Receives a failed source’s error and `{ source: "cache" }`, `{ source: "relay", relay }`, or `{ source: "routing" }` while other sources continue
- `extraRelays`: An array (or observable array) of relays to always fetch from
- `eventStore`: An event store used to deduplicate events (defaults to an in-memory store, pass `null` to disable)
- `signal`: An `AbortSignal` that tears down the loader when aborted

Cache, relay discovery, and individual relay failures are skipped, including exceptions thrown when starting a request. Events already received remain available, and healthy sources continue until they complete. If every source fails, the loader completes without events; use `onError` to distinguish failures from an empty result. Exceptions thrown by `onError` propagate to subscribers.

Concurrency limits must be positive integers or `Infinity`. Timeouts must be positive, at most 2147483647 ms, or `Infinity`; invalid values throw `RangeError` when creating a loader.

With the default limits, one loader runs at most 32 relay requests and four cache requests at once. Relay deadlines start when each request is subscribed, excluding time spent queued. Events do not reset the deadline. A timed-out source is cancelled and reported through `onError`; other sources continue. These limits do not bound the number of queued callers, and observable `extraRelays` discovery uses its own deadline of the same duration.

Started batches continue warming the store after consumers unsubscribe, within their source deadlines. Queued batches whose consumers have all unsubscribed are skipped. Calling `stop()` or aborting `signal` cancels active requests and completes queued callers.

Explicit relay hints start without waiting for observable `extraRelays`. The loader uses the first emitted relay list to request only relay/value pairs not already covered by hints, within the same relay concurrency limit. Empty discovery completes normally; failed or timed-out discovery reports `{ source: "routing" }` through `onError` without cancelling hinted requests.

Set `force: true` on a pointer to skip cache lookup for that caller and receive only relay results. In a mixed batch, ordinary callers can still query the same value from cache; those cache arrivals are excluded from forced callers. A relay arrival is delivered even when the same event arrived from cache first, and ordinary callers still receive that event only once. Relay results may reuse the store’s canonical event object, so `force` does not bypass the event store.

Repeated calls for the same value and force mode join a queued or running request when its relay coverage includes the new caller’s hints. Late joiners receive previously delivered events, and a call after completion starts a new fetch. Sharing applies only to static relay routing; set `shareInflight: false` to request independently. Replay retains matching events until the batch finishes, so high-volume targets can use more memory while running.

## Integration

Pass the application's EventStore so fetched events update models and casts. Cache and relay requests run in parallel; cached results do not suppress network requests.

```ts
const references = createTagValueLoader(pool, "e", {
  eventStore,
  cacheRequest,
  onError: (error, source) => console.warn("Partial reference load", source, error),
});
```

A custom upstream must implement the finite [request contract](./upstream-pool.md), respect filters, and release its transport when unsubscribed. Results are matched locally by tag value; the loader relies on upstream filtering for kinds, authors, and timestamps.

For actual reaction events and zap receipts, use the [Reactions Loader](./reactions-loader.md) and [Zaps Loader](./zaps-loader.md). They select `e` or `a` queries from the target event. Use the [count service](./count-service.md) for its supported shared feed metrics rather than deriving authoritative totals from these partial downloads.

## Best Practices

- Reuse a loader to batch requests and share compatible in-flight work.
- Supply explicit relay hints for immediate loading when extra relay discovery is asynchronous.
- Keep finite deadlines when completing started work after consumers unsubscribe.
- Use `onError` to report partial failures; an empty result alone cannot establish absence.
- Keep `onError` callbacks non-throwing so healthy sources can continue.
- Label downloaded totals as loaded results and use relationship helpers before interpreting them.
- Set limits for each loader instance; separate instances have separate concurrency budgets.
