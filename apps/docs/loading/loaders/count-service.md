# Event count service

`createCountService` loads individual event metrics without downloading every related event. Subscriptions share cached results and network work; releasing the last subscription cancels queued work, running requests, and refresh timers.

## How to use it

```ts
import { createCountService, relayCountSource } from "applesauce-loaders/loaders";

const counts = createCountService({
  sources: [relayCountSource({ count: pool.count.bind(pool), relays: trustedRelays$ })],
  ttl: ({ age }) => (age < 3600 ? 30_000 : 300_000),
});

const note = counts.event(event);
const subscription = note.reactions$.subscribe(renderCount);
subscription.unsubscribe();
```

Handles are lazy. `reactions$` and `comments$` emit `number | undefined`, with distinct numeric emissions. Zero is a successful count; undefined means no accepted value. The corresponding `reactions` and `comments` properties expose chainable state:

```ts
note.reactions.refreshing.subscribe(renderSpinner);
note.reactions.origin.subscribe(renderProvenance);
note.reactions.subscribe(({ value, fresh, failure }) => {
  // Stale successful values stay visible during refresh and after failures.
});
```

State also includes `approximate`, fetch time `observedAt` (milliseconds), and assertion creation time `assertedAt` (seconds). The assertion timestamp describes the published assertion, rather than the age of the provider's underlying dataset.

### Metric semantics

| Descriptor                            | Meaning                                                                    | COUNT mapping               |
| ------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| `reactionCountMetric` / `reactions`   | Kind-7 reaction events                                                     | `kinds: [7], #e`            |
| `rootCommentCountMetric` / `comments` | Entire NIP-22 comment tree rooted at the target                            | `kinds: [1111], #E` or `#A` |
| `legacyReferenceCountMetric`          | Kind-1 events referencing the target, including indirect thread references | `kinds: [1], #e`            |

`comments` never silently switches to legacy note references. Use `note.metric(legacyReferenceCountMetric)` when that is the intended meaning. NIP-85 providers define their own calculation rules; selecting one explicitly accepts its interpretation of the metric.

Event IDs are the default target identity. To count a stable address rather than one revision, supply `address` alongside `id`, `kind`, and `created_at`. Reactions and legacy references currently have no built-in address COUNT mapping; custom metrics can supply one.

### Sources and fallbacks

Sources implement the same `CountSource` interface. The service tries them in order, stops at the first valid result, and never adds counts from different relays or providers. `fallbackCountSource(children, id)` composes a nested hierarchy without adding another cache or scheduler.

```ts
const assertions = nip85CountSource({
  request: pool.request.bind(pool),
  providers: (kind, tag) => providerLists(kind, tag),
});
const counts = createCountService({
  sources: [assertions, relayCountSource({ count, relays: trustedRelays$ })],
});
```

COUNT tries ordered relays individually. Unsupported filters, missing assertions or tags, malformed values, timeouts, and errors advance to the next candidate. COUNT returns one total for its filters; it cannot return separate per-target totals in a single aggregate request. Amount sums and provider-specific scores need an appropriate custom metric and source.

NIP-85 batches demanded subjects by provider, relay, and assertion kind. It verifies signatures, selects the latest assertion per subject, parses the requested tag, and retries an unanswered subject once in a separate singleton request to handle relay truncation. Unsubscribing detaches a metric from its batch; the request is cancelled when its last interested metric leaves. Assertions older than `maxAge` are rejected (default 86400 seconds). `verify` overrides signature verification for controlled trusted transports; production applications should retain verification.

### Cache and scheduling options

| Option                    | Default                                                           | Behavior                                                                       |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ttl`                     | 30 seconds for targets younger than one hour; 5 minutes otherwise | Receives target `age` in seconds and returns freshness milliseconds            |
| `cacheCapacity`           | 1000                                                              | Maximum inactive retained result/cooldown entries; active entries are pinned   |
| `concurrency`             | 8                                                                 | Global active transport limit                                                  |
| `perRelay`, `perProvider` | 2 each                                                            | Additional atomic resource limits                                              |
| `admissionWindow`         | 0 ms (next scheduler turn)                                        | Absorbs synchronous subscription probes before dispatch                        |
| `queueCapacity`           | 256                                                               | Pending transport bound; overflow retries with other failures                  |
| `resolutionTimeout`       | 15000 ms                                                          | Bound for the full hierarchy, including queue time                             |
| `attemptTimeout`          | 5000 ms                                                           | Bound for an individual source/relay attempt                                   |
| `minimumRefresh`          | 1000 ms                                                           | Floor for finite freshness intervals                                           |
| `retryDelay`              | 10000 ms                                                          | Initial failure retry interval, with bounded exponential backoff and jitter    |
| `signal`                  | —                                                                 | Aborts the service                                                             |
| `diagnostic`              | —                                                                 | Receives bounded transport activity snapshots and cache/fallback notifications |

Future target timestamps have age zero. Invalid finite TTL values use the minimum interval; Infinity disables automatic successful refresh. Failed attempts retain a separate retry deadline across unmounts and revisits. Retained data can outlive freshness; stale revisits emit immediately when effective policy is available. A change to effective relay/provider content or priority conservatively clears affected accepted values, cancels obsolete work, and resolves again. Equivalent configuration emissions cause no refresh. Empty lists remain observed so later account/provider updates can activate loading.

`counts.invalidate(event)` clears one target; `counts.invalidate()` clears all retained values. Observed metrics refresh immediately. `counts.stop()` cancels the whole service and makes subsequent subscriptions complete without loading. Adapter instances can be shared across services; transport capacity and value caches belong to each service.

## Integration

### Common trusted provider casts

`TrustedProviderList.providersFor$(kind, tag)` preserves metric-scoped trust and hidden-provider unlock updates. Use `switchMap` to replace the list when the active account changes:

```ts
const assertions = nip85CountSource({
  request: pool.request.bind(pool),
  providers: (kind, tag) =>
    user.trustedProviders$.pipe(switchMap((list) => (list ? list.providersFor$(kind, tag) : of([])))),
});
```

`AssertionProvider` objects fit structurally, including their reactive `relays$`. Raw declarations from common helpers also work, scoped by their `kind` and `tag`; a raw declaration needs a relay hint to be queried. Trusting a provider for one metric does not trust it for every metric. Loaders adds no runtime dependency on common or relay.

### React

Share the service at application scope and let `use$` manage each component's demand:

```tsx
const reactions = use$(() => counts.event(event).reactions$, [event]);
const refreshing = use$(() => counts.event(event).reactions.refreshing, [event]);
```

Multiple components observing the same metric share one canonical resolution. Constructing new handles does not start requests or create another retained handle cache. Use a virtualized list so offscreen components release their subscriptions.

### Custom metrics and sources

Use stable versioned metric IDs and explicit units. A source's `policy(query)` stays observed after its finite `count(query, context)` settles. Change the policy identity whenever trust or routing changes. Return one valid safe nonnegative integer, complete empty when unsupported, and tear down work on unsubscribe. Dispatch transports with `context.transport.run(resources, factory)` so custom sources respect service limits and cancellation. Resource keys use `relay:<normalized-url>` and `provider:<pubkey>`.

## Best Practices

- Choose trusted ordered sources; bare totals cannot be merged safely.
- Keep recent-event TTLs short and older-event TTLs longer.
- Keep provider calculation semantics visible through provenance.
- Set relay capacity alongside the global limit; one relay with limit two can only run two transports.
- Compare COUNT, assertions, and related-event downloads in the **loader/count-service** example using the same seed and controls.
- Run stress scenarios in simulation; live mode requires explicit relay and event selection.
