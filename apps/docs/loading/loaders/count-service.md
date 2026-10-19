---
description: Share, cache, and refresh event counts with balanced NIP-45 requests across trusted relays
---

# Event count service

`createCountService` loads per-event totals without downloading the matching events. It shares observations, caches answers, and balances NIP-45 COUNT requests across trusted relays with adaptive concurrency and rate-limit recovery.

Each count comes from **one relay**. Relays can hold different datasets, so an answer is that relay's count, not a network-wide total. The service never sums answers. Use [Reactions Loader](./reactions-loader) or [Zaps Loader](./zaps-loader) when you need the matching events instead.

## How to use it

Create one service at application scope with your existing `RelayPool`:

```ts
import { createCountService } from "applesauce-loaders/loaders";

const counts = createCountService(pool, {
  relays: ["wss://relay.ditto.pub", "wss://relay.primal.net"],
  concurrency: 40,
});
const subscription = counts.event(event).reactions$.subscribe(renderCount);

subscription.unsubscribe(); // When the view closes.
counts.stop(); // When the application no longer needs the service.
```

The pool must expose `relay(url).count(...)`, as `applesauce-relay`'s `RelayPool` does. Generic event-request adapters used by other loaders do not automatically support this interface.

Handles are lazy: constructing one sends nothing. Subscribing starts work; observers of the same target and metric ID share it. Unsubscribing the last observer cancels that metric's queued request, active attempt, and refresh timer. `stop()` cancels the whole service without closing the pool, and future subscriptions complete without loading.

### Values and loading state

`reactions$` and `comments$` emit `number | undefined`. **Zero is a valid answer**; `undefined` means no answer is available. The chainable `reactions` and `comments` properties expose full state:

```ts
const note = counts.event(event);
const subscription = note.reactions.subscribe((state) => {
  renderCount(state.value);
  renderSpinner(state.refreshing);
});
```

| State field   | Meaning                                                                     |
| ------------- | --------------------------------------------------------------------------- |
| `value`       | Count, or `undefined` until an answer is available                          |
| `fresh`       | Whether the retained answer is within its freshness period                  |
| `refreshing`  | Whether the metric is waiting for capacity or a new answer                  |
| `origin`      | `{ relay }` identifying the answering relay, or `undefined`                 |
| `approximate` | The relay's optional approximation flag                                     |
| `observedAt`  | Time the answer was received, in milliseconds                               |
| `failure`     | Local metric or scheduler error; retried relay errors appear in diagnostics |

Keep stale values visible while `refreshing` is true. Relay failures keep the request pending until a relay answers or the observer unsubscribes. Empty relay lists also remain pending, allowing a reactive configuration to supply relays later.

### Built-in and custom metrics

| Descriptor                   | Handle property                      | Meaning                                                           |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `reactionCountMetric`        | `reactions`                          | Kind-7 reactions tagged with the target's `e` reference           |
| `rootCommentCountMetric`     | `comments`                           | Entire NIP-22 comment tree rooted at the target, using `E` or `A` |
| `legacyReferenceCountMetric` | `metric(legacyReferenceCountMetric)` | Kind-1 references, including indirect thread references           |

`comments` means NIP-22 comments, and legacy references are broader than direct replies. Define other event counts with a stable versioned ID and filters:

```ts
const quotes = counts.event(event).metric({
  id: "quotes:v1",
  filters: (target) => [{ kinds: [1], "#q": [target.id] }],
});
const subscription = quotes.subscribe(renderState);
```

The metric ID is part of the sharing and cache key. Use the same ID only for the same filter semantics; increment its version when those semantics change. Filters must describe one target's total, rather than several targets whose separate counts you need.

Return `undefined` for unsupported targets. Empty or throwing filters settle with `failure` and allocate no retry timer. Correct the metric and invalidate the target, or release all observers and subscribe again, to retry.

Targets accept ordinary events with `id`, `kind`, and `created_at`. Supply an explicit `address` to count a stable address across revisions. Built-in reactions and legacy references only support event IDs; root comments support either identity.

### Relay configuration and retries

`relays` accepts a static array or an observable array. URLs are normalized and deduplicated; reordering the same set preserves work and cached results. Changing the set cancels obsolete requests and discards answers accepted under the previous set. Invalid WebSocket URLs are ignored; a configuration error clears the effective set until the service is recreated.

The scheduler chooses one available relay per metric, favoring lower estimated outstanding work. Each relay starts with at most two active attempts and adapts toward `concurrency` as responses arrive. Structured rate limits and transport failures reduce admission and apply cooldowns. Refusals, authentication failures, and malformed responses allow other relays to answer. Arbitrary NOTICE text is not treated as a rate-limit instruction.

`attemptTimeout` bounds each dispatched attempt, including connection and authentication waits. There is no overall request deadline or queue-capacity rejection: observed metrics remain requested until answered or cancelled. Limit subscriptions to visible views to bound application demand.

For a caller-specific deadline, skip the initial missing value:

```ts
import { filter, firstValueFrom, timeout } from "rxjs";

const value = await firstValueFrom(
  counts.event(event).reactions$.pipe(
    filter((value) => value !== undefined),
    timeout({ first: 10_000 }),
  ),
);
```

### Caching, freshness, and invalidation

In-memory caching is always available. `cacheCapacity` bounds inactive entries; active metrics stay shared and pinned. Set it to `0` to discard inactive results. Optional persistent caching is configured separately below.

| Target age              | Default freshness |
| ----------------------- | ----------------- |
| Under 6 hours           | 1 minute          |
| 6 hours to under 1 day  | 5 minutes         |
| 1 day to under 7 days   | 30 minutes        |
| 7 days to under 30 days | 2 hours           |
| 30 days and older       | 6 hours           |

Only observed metrics refresh. Override freshness with `ttl: ({ age, query }) => milliseconds`; `age` is seconds. Finite intervals respect `minimumRefresh`; `Infinity` disables automatic successful refreshes. Counts are snapshots: use event subscriptions alongside them when you need live event details.

`await counts.invalidate(event)` clears one target and restarts observed metrics; `await counts.invalidate()` does the same for every target. Both clear memory immediately and resolve after persistent invalidation completes, not after replacement relay answers arrive. Call invalidation after a relevant publish when you want to refresh a displayed count; the remote relay still needs to have received the event.

### Options

| Option                | Default                             | Purpose                                            |
| --------------------- | ----------------------------------- | -------------------------------------------------- |
| `relays`              | Required                            | Static or observable trusted relay set             |
| `concurrency`         | 20                                  | Maximum participating attempts per relay           |
| `attemptTimeout`      | 5000 ms                             | Deadline per dispatched attempt                    |
| `countScheduler`      | Service-owned                       | Scheduler shared by several services               |
| `ttl`                 | Event-age curve above               | Freshness milliseconds for `{ age, query }`        |
| `minimumRefresh`      | 1000 ms                             | Minimum finite refresh interval                    |
| `cacheCapacity`       | 1000                                | Maximum inactive in-memory entries                 |
| `cache`               | None                                | Keyv-compatible persistent store                   |
| `cacheRetention`      | 24 hours                            | Persistent retention, independent of freshness     |
| `cacheTimeout`        | 1000 ms                             | Deadline per persistent cache operation            |
| `signal`              | None                                | Abort signal that stops the service                |
| `diagnostic`          | None                                | Callback for current activity and attempt outcomes |
| `logger`              | Core logger                         | Parent namespace for service and relay logs        |
| `scheduler`, `random` | RxJS async scheduler, `Math.random` | Injectable clock and cooldown jitter source        |

Attempt and cache-operation timeouts must be positive and at most 2,147,483,647 ms. Concurrency limits cover participating COUNT work, not unrelated traffic on the pool.

## Integration

### React

Share the service outside components and let hooks own subscriptions. Defer subscription past `use$`'s synchronous render probe so abandoned renders do not start relay work:

```tsx
import { asapScheduler, subscribeOn } from "rxjs";

const state = use$(() => counts.event(event).reactions.pipe(subscribeOn(asapScheduler)), [event]);
```

Virtualized rows naturally release offscreen demand. The [event counts example](https://applesauce.build/examples/#/example/loader/event-counts) demonstrates this with a persistence toggle and cache statistics.

### Persistent counts with Keyv

Use a dedicated store or Keyv namespace with asynchronous `get` and `set` methods. For `keyv-browser`, use a dedicated database: its adapter creates the object store only when the database is first created.

```ts
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";

const cache = new Keyv({
  store: new KeyvIndexedDB({ dbName: "my-client-counts", storeName: "counts" }),
});
const counts = createCountService(pool, {
  relays: trustedRelays$,
  cache,
  ttl: () => 5 * 60_000,
  cacheRetention: 24 * 60 * 60_000,
});
```

Only successful counts persist. Matching target, metric ID, and relay set are required for reuse. Fresh restored answers skip relay requests; stale answers remain visible during refresh. Hydration preserves original freshness and retention deadlines. `Infinity` disables the corresponding expiry.

Cache errors fall back to network loading. Invalidation rejects if its storage update fails. Invalidation markers have no expiry; plan storage cleanup for long-lived applications, particularly with unlimited retention. Stopping the service leaves saved data intact, and writes already started may finish asynchronously.

### Shared scheduler and diagnostics

One service already shares capacity across its observers. Supply a shared scheduler only when several services should share relay limits and feedback:

```ts
import { createCountScheduler } from "applesauce-loaders/loaders";

const scheduler = createCountScheduler({ concurrency: 40 });
const feed = createCountService(pool, { relays, countScheduler: scheduler });
const details = createCountService(pool, { relays, countScheduler: scheduler });

feed.stop();
details.stop();
scheduler.stop();
```

Configure concurrency on the shared scheduler, and let its owner stop it after its services. Capacity is shared by normalized relay URL, including across different pool objects. Each service keeps its own result cache.

`scheduler.status$` reports active attempts, outstanding requests, and per-relay limits, latency, cooldowns, and failures. A service's `diagnostic` callback includes these snapshots on `scheduler` notifications. With a shared scheduler, activity covers all its users; `cacheEntries` and `activeMetrics` remain service-local.

Enable cache, refresh, and attempt logs through the core logger, or pass your own parent `logger`:

```ts
import { enableLoggerNamespaces } from "applesauce-core";

enableLoggerNamespaces("applesauce:count-service*");
```

## Best Practices

- Use trusted relays and retain relay provenance when presenting totals.
- Share a service at application scope and release subscriptions when views close.
- Keep zero distinct from missing values; retain stale answers during refresh.
- Version metric IDs when filter semantics change.
- Use COUNT for event totals, not zap amounts or other numeric tag aggregates.
- Tune maximum concurrency against your relay workload; a higher limit does not guarantee faster answers.
